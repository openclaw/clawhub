/* @vitest-environment node */
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorkerCommand } from "../lib/runWorkerCommand";
import { createTemplateQualificationWorkspace } from "./template-qualification-workspace";

vi.mock("../lib/runWorkerCommand", () => ({ runWorkerCommand: vi.fn() }));
const exec = promisify(execFile);
const helper = fileURLToPath(new URL("./cleanup-template-qualification.py", import.meta.url));
afterEach(() => vi.resetAllMocks());
async function identityArgs(path: string) {
  const s = await lstat(path, { bigint: true });
  return [path, String(s.dev), String(s.ino), String(s.uid)];
}
async function runHelper(args: string[]) {
  const result = await exec("/usr/bin/python3", ["-I", helper, ...args], {
    env: { PATH: "/usr/bin:/bin" },
  });
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

describe.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
  "owned qualification cleanup",
  () => {
    it("normally removes its workspace without privilege", async () => {
      const root = await createTemplateQualificationWorkspace();
      await writeFile(join(root.path, "file"), "inert");
      expect(await root.remove()).toEqual({
        removed: true,
        diagnostic: {
          method: "unprivileged",
          initialError: null,
          finalError: null,
        },
      });
      expect(runWorkerCommand).not.toHaveBeenCalled();
      await expect(lstat(root.path)).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("refuses a replaced root before even unprivileged removal", async () => {
      const root = await createTemplateQualificationWorkspace();
      const retained = root.path + "-retained";
      await rename(root.path, retained);
      await mkdir(root.path, { mode: 0o700 });
      await writeFile(join(root.path, "sentinel"), "unchanged");
      try {
        expect(await root.remove()).toEqual({
          removed: false,
          diagnostic: {
            method: "unprivileged",
            initialError: null,
            finalError: "identity",
          },
        });
        expect(await readFile(join(root.path, "sentinel"), "utf8")).toBe("unchanged");
        expect(runWorkerCommand).not.toHaveBeenCalled();
      } finally {
        await rm(root.path, { recursive: true, force: true });
        await rm(retained, { recursive: true, force: true });
      }
    });
    it.each(["throw", "invalid", "refusal", "false_success"])(
      "fails closed with bounded %s diagnostics",
      async (mode) => {
        const root = await createTemplateQualificationWorkspace();
        const locked = join(root.path, "private-test-placeholder");
        await mkdir(locked);
        await writeFile(join(locked, "log"), "private-test-placeholder");
        await chmod(locked, 0o500);
        if (mode === "throw") vi.mocked(runWorkerCommand).mockRejectedValue(new Error(locked));
        else
          vi.mocked(runWorkerCommand).mockResolvedValue({
            stderr: locked,
            stdout:
              mode === "invalid"
                ? locked
                : JSON.stringify({ error: mode === "refusal" ? "identity" : null }),
          });
        try {
          // This is a real unprivileged permission failure, not a mocked rm.
          await expect(rm(root.path, { recursive: true, force: true })).rejects.toMatchObject({
            code: "EACCES",
          });
          const result = await root.remove();
          expect(result).toEqual({
            removed: false,
            diagnostic: {
              method: "scoped_privileged",
              initialError: "EACCES",
              finalError: mode === "refusal" ? "identity" : "helper_failed",
            },
          });
          expect(JSON.stringify(result)).not.toContain("private-test-placeholder");
          const [command, args, options] = vi.mocked(runWorkerCommand).mock.calls[0];
          expect(command).toBe("/usr/bin/sudo");
          expect(args).toEqual([
            "-n",
            "--",
            "/usr/bin/python3",
            "-I",
            helper,
            ...(await identityArgs(root.path)),
          ]);
          expect(options.env).toEqual({ PATH: "/usr/bin:/bin", LANG: "C" });
          expect(options.timeoutMs).toBe(15_000);
        } finally {
          await chmod(locked, 0o700);
          await rm(root.path, { recursive: true, force: true });
        }
      },
    );
    it("the actual helper unlinks nested and dangling symlinks without touching their targets", async () => {
      const root = await createTemplateQualificationWorkspace();
      const outside = await mkdtemp(join(await realpath(tmpdir()), "qualification-sentinel-"));
      try {
        await writeFile(join(outside, "sentinel"), "unchanged");
        await symlink(outside, join(root.path, "linked"));
        await symlink(join(outside, "absent"), join(root.path, "dangling"));
        await mkdir(join(root.path, "nested"));
        await symlink(join(outside, "sentinel"), join(root.path, "nested/link"));
        expect(await runHelper(await identityArgs(root.path))).toEqual({ error: null });
        expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("unchanged");
        await expect(lstat(root.path)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root.path, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });
    it.each(["inode", "device", "owner", "mode", "name", "symlink", "ancestor"])(
      "refuses mismatched %s custody",
      async (kind) => {
        const root = await createTemplateQualificationWorkspace();
        const outside = await mkdtemp(join(await realpath(tmpdir()), "qualification-sentinel-"));
        const args = await identityArgs(root.path);
        try {
          await writeFile(join(root.path, "sentinel"), "unchanged");
          if (kind === "inode") args[2] = String(BigInt(args[2]) + 1n);
          if (kind === "device") args[1] = String(BigInt(args[1]) + 1n);
          if (kind === "owner") args[3] = "0";
          if (kind === "mode") await chmod(root.path, 0o755);
          if (kind === "name") args[0] = outside;
          if (kind === "symlink") {
            args[0] = join(outside, "template-qualification-abcdef");
            await symlink(root.path, args[0]);
          }
          if (kind === "ancestor") {
            await symlink(root.path, join(outside, "parent"));
            args[0] = join(outside, "parent/template-qualification-abcdef");
          }
          expect((await runHelper(args)).error).not.toBeNull();
          expect(await readFile(join(root.path, "sentinel"), "utf8")).toBe("unchanged");
        } finally {
          await rm(root.path, { recursive: true, force: true });
          await rm(outside, { recursive: true, force: true });
        }
      },
    );
    it("bounds traversal depth instead of reporting false cleanup success", async () => {
      const root = await createTemplateQualificationWorkspace();
      await mkdir(join(root.path, ...Array(66).fill("d")), { recursive: true });
      try {
        expect(await runHelper(await identityArgs(root.path))).toEqual({ error: "limit" });
        await expect(lstat(root.path)).resolves.toBeDefined();
      } finally {
        await root.remove();
      }
    });
    it.skipIf(process.env.TEMPLATE_QUALIFICATION_CLEANUP_ROOT_TEST !== "1")(
      "removes real root-owned 0755 logs and 0500 directories, preserving an external sentinel",
      async () => {
        const actual =
          await vi.importActual<typeof import("../lib/runWorkerCommand")>(
            "../lib/runWorkerCommand",
          );
        vi.mocked(runWorkerCommand).mockImplementation(actual.runWorkerCommand);
        const root = await createTemplateQualificationWorkspace();
        const outside = await mkdtemp(join(await realpath(tmpdir()), "qualification-sentinel-"));
        try {
          await writeFile(join(outside, "sentinel"), "unchanged");
          // Privilege is restricted to creating this test root's synthetic native logs.
          await exec("/usr/bin/sudo", [
            "-n",
            "--",
            "/usr/bin/python3",
            "-I",
            "-c",
            "import os,sys; p=sys.argv[1]; os.mkdir(p+'/logs',0o755); open(p+'/logs/log','w').write('inert'); os.mkdir(p+'/locked',0o700); open(p+'/locked/log','w').write('inert'); os.chmod(p+'/locked',0o500)",
            root.path,
          ]);
          expect((await lstat(join(root.path, "logs"))).uid).toBe(0);
          await symlink(outside, join(root.path, "outside"));
          await expect(rm(root.path, { recursive: true, force: true })).rejects.toMatchObject({
            code: "EACCES",
          });
          expect(await root.remove()).toEqual({
            removed: true,
            diagnostic: {
              method: "scoped_privileged",
              initialError: "EACCES",
              finalError: null,
            },
          });
          expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("unchanged");
          await expect(lstat(root.path)).rejects.toMatchObject({ code: "ENOENT" });
        } finally {
          await root.remove();
          await rm(outside, { recursive: true, force: true });
        }
      },
    );
  },
);
