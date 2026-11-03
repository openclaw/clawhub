import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { runWorkerCommand } from "../lib/runWorkerCommand";

// Roll out the backend first. With reporting disabled, older backends receive
// exactly their existing claim arguments and no installed-source checks run.
export async function resolvePrepublicationScannerRuntime(
  env: NodeJS.ProcessEnv = process.env,
  sourcePinFile: string | URL = new URL("./clawscan-source-commit.txt", import.meta.url),
) {
  if (env.PREPUBLICATION_REPORT_SCANNER_SOURCE !== "true") return undefined;
  if (!env.CLAWSCAN_SOURCE_DIR || !env.RUNNER_TEMP) {
    throw new Error("Scanner source reporting requires the reviewed source installation.");
  }
  if (env.PREPUBLICATION_CLAWSCAN_SANDBOX !== "off") {
    throw new Error("Scanner source reporting requires the reviewed host scanner runtime.");
  }
  const source = (await readFile(sourcePinFile, "utf8")).trim();
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error("Invalid reviewed scanner source pin.");
  const command = await realpath(join(env.RUNNER_TEMP, "clawscan-bin/clawscan"));
  const override = env.PREPUBLICATION_CLAWSCAN_COMMAND?.trim();
  if (override && (await realpath(override)) !== command) {
    throw new Error("Scanner command differs from the reviewed installed binary.");
  }
  const commandEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    TMPDIR: env.TMPDIR,
    GOTOOLCHAIN: "local",
    GOENV: "off",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const run = async (tool: string, args: string[]) =>
    (
      await runWorkerCommand(tool, args, {
        cwd: env.CLAWSCAN_SOURCE_DIR!,
        env: commandEnv,
        timeoutMs: 30_000,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
      })
    ).stdout.trim();
  const head = await run("git", ["rev-parse", "HEAD"]);
  const changes = await run("git", ["status", "--porcelain", "--untracked-files=all"]);
  const build = await run("go", ["version", "-m", command]);
  if (
    head !== source ||
    changes ||
    /\bvcs.revision=([a-f0-9]{40})\b/.exec(build)?.[1] !== source ||
    !/\bvcs.modified=false\b/.test(build)
  ) {
    throw new Error(
      "Installed scanner source and binary do not match the reviewed clean revision.",
    );
  }
  // The caller uses this exact binary for scans, avoiding PATH shadowing.
  return { source, command };
}
