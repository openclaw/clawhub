/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePrepublicationScannerRuntime } from "./prepublicationScannerSource";

describe("opt-in pre-publication scanner source reporting", () => {
  it.each([undefined, "false"])(
    "performs no installation access while disabled (%s)",
    async (flag) => {
      expect(
        await resolvePrepublicationScannerRuntime(
          {
            PREPUBLICATION_REPORT_SCANNER_SOURCE: flag,
            CLAWSCAN_SOURCE_DIR: "/nonexistent-source",
            RUNNER_TEMP: "/nonexistent-runner",
          },
          "/nonexistent-pin",
        ),
      ).toBeUndefined();
    },
  );

  it("checks a real Git checkout and Go build before accepting a reported source", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepublication-source-"));
    try {
      const sourceDir = join(root, "source");
      const binaryDir = join(root, "clawscan-bin");
      await mkdir(sourceDir);
      await mkdir(binaryDir);
      const sourceFile = join(sourceDir, "main.go");
      const program = "package main\nfunc main() {}\n";
      await writeFile(join(sourceDir, "go.mod"), "module scanner-source-fixture\n\ngo 1.22\n");
      await writeFile(sourceFile, program);
      const commandEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        GOTOOLCHAIN: "local",
        GOENV: "off",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Scanner source fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Scanner source fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      };
      const run = (command: string, args: string[]) =>
        execFileSync(command, args, { cwd: sourceDir, env: commandEnv, encoding: "utf8" }).trim();
      run("git", ["init", "--quiet"]);
      run("git", ["add", "."]);
      run("git", ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic scanner"]);
      const source = run("git", ["rev-parse", "HEAD"]);
      const command = join(binaryDir, "clawscan");
      run("go", ["build", "-buildvcs=true", "-o", command, "."]);
      const resolvedCommand = await realpath(command);
      const cleanBinary = join(root, "clean-binary");
      await copyFile(command, cleanBinary);
      const pin = join(root, "pin.txt");
      await writeFile(pin, source + "\n");
      const env = {
        ...commandEnv,
        PREPUBLICATION_REPORT_SCANNER_SOURCE: "true",
        PREPUBLICATION_CLAWSCAN_SANDBOX: "off",
        CLAWSCAN_SOURCE_DIR: sourceDir,
        RUNNER_TEMP: root,
      };
      expect(await resolvePrepublicationScannerRuntime(env, pin)).toEqual({
        source,
        command: resolvedCommand,
      });
      await writeFile(pin, "a".repeat(40));
      await expect(resolvePrepublicationScannerRuntime(env, pin)).rejects.toThrow("do not match");
      await writeFile(pin, "main");
      await expect(resolvePrepublicationScannerRuntime(env, pin)).rejects.toThrow(
        "Invalid reviewed",
      );
      await writeFile(pin, source);
      const untracked = join(sourceDir, "untracked-adapter.py");
      await writeFile(untracked, "# Unexpected scanner code\n");
      await expect(resolvePrepublicationScannerRuntime(env, pin)).rejects.toThrow("do not match");
      await rm(untracked);
      await writeFile(sourceFile, program + "// uncommitted change\n");
      await expect(resolvePrepublicationScannerRuntime(env, pin)).rejects.toThrow("do not match");
      run("go", ["build", "-buildvcs=true", "-o", command, "."]);
      await writeFile(sourceFile, program);
      await expect(resolvePrepublicationScannerRuntime(env, pin)).rejects.toThrow("do not match");
      await copyFile(cleanBinary, command);
      run("git", [
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "New scanner source",
      ]);
      await writeFile(pin, run("git", ["rev-parse", "HEAD"]));
      await expect(resolvePrepublicationScannerRuntime(env, pin)).rejects.toThrow("do not match");
      run("git", ["checkout", "--quiet", "--detach", source]);
      await writeFile(pin, source);
      await expect(
        resolvePrepublicationScannerRuntime(
          { ...env, PREPUBLICATION_CLAWSCAN_COMMAND: cleanBinary },
          pin,
        ),
      ).rejects.toThrow("differs from");
      await expect(
        resolvePrepublicationScannerRuntime(
          { ...env, PREPUBLICATION_CLAWSCAN_SANDBOX: "docker" },
          pin,
        ),
      ).rejects.toThrow("host scanner runtime");
      expect(await readFile(sourceFile, "utf8")).toBe(program);
      expect(await resolvePrepublicationScannerRuntime(env, pin)).toEqual({
        source,
        command: resolvedCommand,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
