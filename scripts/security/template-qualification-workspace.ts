import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkerCommand } from "../lib/runWorkerCommand";

const cleanupCodes = [
  "EACCES",
  "EPERM",
  "EBUSY",
  "ENOTEMPTY",
  "ENOENT",
  "EIO",
  "ENOSPC",
  "EROFS",
  "EMFILE",
  "ENFILE",
  "ELOOP",
  "EXDEV",
  "identity",
  "limit",
  "other",
] as const;
type CleanupCode = (typeof cleanupCodes)[number];
export type WorkspaceCleanup = {
  method: "not_run" | "unprivileged" | "scoped_privileged" | "preserved";
  initialError: CleanupCode | null;
  finalError: CleanupCode | "helper_failed" | null;
};
function errorCode(error: unknown): CleanupCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return cleanupCodes.includes(code as CleanupCode) ? (code as CleanupCode) : "other";
}

// No caller-selected root. Capture custody before any scanner can write here.
export async function createTemplateQualificationWorkspace() {
  const parent = await realpath(tmpdir());
  const path = await mkdtemp(join(parent, "template-qualification-"));
  const identity = await lstat(path, { bigint: true });
  return {
    path,
    // Call only after native process-group AND Docker finality is confirmed, or
    // before native execution. A custody error must never call this fallback.
    async remove(): Promise<{ removed: boolean; diagnostic: WorkspaceCleanup }> {
      const diagnostic: WorkspaceCleanup = {
        method: "unprivileged",
        initialError: null,
        finalError: null,
      };
      try {
        const current = await lstat(path, { bigint: true });
        if (
          !current.isDirectory() ||
          current.dev !== identity.dev ||
          current.ino !== identity.ino ||
          current.uid !== identity.uid
        ) {
          diagnostic.finalError = "identity";
          return { removed: false, diagnostic };
        }
      } catch (error) {
        if (errorCode(error) === "ENOENT") return { removed: true, diagnostic };
        diagnostic.finalError = errorCode(error);
        return { removed: false, diagnostic };
      }
      try {
        await rm(path, { recursive: true, force: true });
        return { removed: true, diagnostic };
      } catch (error) {
        diagnostic.initialError = errorCode(error);
        diagnostic.finalError = diagnostic.initialError;
      }
      // Native Docker writes root-owned logs beneath its writable scratch bind.
      // Do not change its user/image, chmod/chown the host, or run a root container.
      if (process.platform !== "linux" || !["EACCES", "EPERM"].includes(diagnostic.initialError!))
        return { removed: false, diagnostic };
      diagnostic.method = "scoped_privileged";
      diagnostic.finalError = "helper_failed";
      try {
        const result = await runWorkerCommand(
          "/usr/bin/sudo",
          [
            "-n",
            "--",
            "/usr/bin/python3",
            "-I",
            fileURLToPath(new URL("./cleanup-template-qualification.py", import.meta.url)),
            path,
            String(identity.dev),
            String(identity.ino),
            String(identity.uid),
          ],
          {
            cwd: parent,
            // No model, Docker, user-config or registry credentials enter cleanup.
            env: { PATH: "/usr/bin:/bin", LANG: "C" },
            commandLabel: "Owned Template qualification workspace cleanup",
            timeoutMs: 15_000,
            maxStdoutBytes: 1024,
            maxStderrBytes: 1024,
            cleanupProcessGroup: true,
          },
        );
        const output = JSON.parse(result.stdout);
        if (output.error !== null) {
          diagnostic.finalError = errorCode({ code: output.error });
          return { removed: false, diagnostic };
        }
        // A helper exit is not proof: confirm absence using the host filesystem.
        try {
          await lstat(path);
          return { removed: false, diagnostic };
        } catch (error) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
        diagnostic.finalError = null;
        return { removed: true, diagnostic };
      } catch {
        // Never expose sudo/Python stderr, command arguments, filenames or errors.
        return { removed: false, diagnostic };
      }
    },
  };
}
