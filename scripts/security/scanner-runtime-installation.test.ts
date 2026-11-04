/* @vitest-environment node */
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const scripts = resolve("scripts/security");
const pin = "a".repeat(40);

async function installFixture() {
  const root = await mkdtemp(join(tmpdir(), "clawscan-runtime-install-"));
  const bin = join(root, "bin");
  const scriptDir = join(root, "scripts");
  const fixture = join(root, "reviewed-source");
  const runtime = join(fixture, "docker/clawscan-runtime");
  for (const path of [bin, scriptDir, join(runtime, "judges"), join(runtime, "tests")])
    await mkdir(path, { recursive: true });
  for (const file of ["install-clawscan.sh", "install-clawscan-scanners.sh"])
    await copyFile(join(scripts, file), join(scriptDir, file));
  await writeFile(join(scriptDir, "clawscan-source-commit.txt"), pin + "\n");
  const fake = [
    "#!/bin/sh",
    'echo "$(basename "$0") $*" >> "$COMMAND_LOG"',
    'case "$(basename "$0")" in',
    ' git) if [ "${3:-}" = rev-parse ]; then echo "$CLAWSCAN_PIN"; elif [ "${3:-}" = checkout ]; then cp -R "$REVIEWED_FIXTURE/." "$2/"; fi;;',
    ' go) if [ "${1:-}" = build ]; then printf "#!/bin/sh\nexit 0\n" > "$4"; chmod 0755 "$4"; fi;;',
    "esac",
  ].join("\n");
  for (const command of ["git", "go"]) {
    await writeFile(join(bin, command), fake);
    await chmod(join(bin, command), 0o755);
  }
  const env = {
    PATH: bin + ":" + process.env.PATH,
    COMMAND_LOG: join(root, "commands.log"),
    CLAWSCAN_PIN: pin,
    REVIEWED_FIXTURE: fixture,
    RUNNER_TEMP: root,
    GITHUB_PATH: join(root, "github-path"),
    GITHUB_ENV: join(root, "github-env"),
    QUALIFICATION_LOG: join(root, "qualification.log"),
  };
  return { root, bin, scriptDir, fixture, runtime, env };
}

async function addJudge(runtime: string) {
  await writeFile(
    join(runtime, "judges/clawscan_decisions_judge.py"),
    [
      "#!/usr/bin/env python3",
      "import os",
      "from pathlib import Path",
      "def qualify():",
      "    assert __file__.endswith('clawscan_decisions_judge.py')",
      "if __name__ == '__main__':",
      "    assert __import__('sys').argv[1:] == ['--help']",
      "    raise SystemExit(int(os.environ.get('HELP_FAILURE', '0')))",
    ].join("\n"),
  );
  await writeFile(
    join(runtime, "tests/test_decisions_judge.py"),
    [
      "import importlib.util, os, unittest",
      "from pathlib import Path",
      "spec = importlib.util.spec_from_file_location('judge', os.environ['CLAWSCAN_DECISIONS_JUDGE'])",
      "judge = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(judge)",
      "class Qualification(unittest.TestCase):",
      "    def test_matching_source(self):",
      "        judge.qualify()",
      "        self.assertTrue(__import__('sys').flags.isolated)",
      "        self.assertTrue(__import__('sys').dont_write_bytecode)",
      "        Path(os.environ['QUALIFICATION_LOG']).write_text(judge.__file__)",
      "if __name__ == '__main__':",
      "    if os.environ.get('QUALIFICATION_FAILURE'): raise SystemExit(73)",
      "    unittest.main()",
    ].join("\n"),
  );
}

describe("optional source-qualified scanner runtime commands", () => {
  it("keeps old source working without Python or a Decisions command", async () => {
    const fixture = await installFixture();
    try {
      await mkdir(join(fixture.root, "clawscan-bin"));
      await writeFile(join(fixture.root, "clawscan-bin/clawscan-decisions-judge"), "stale judge");
      await writeFile(join(fixture.bin, "python3"), "#!/bin/sh\nexit 91\n");
      await chmod(join(fixture.bin, "python3"), 0o755);
      await run("sh", [join(fixture.scriptDir, "install-clawscan.sh")], {
        env: fixture.env,
      });
      expect(await readFile(fixture.env.GITHUB_PATH, "utf8")).toBe(
        join(fixture.root, "clawscan-bin") + "\n",
      );
      expect(await readdir(join(fixture.root, "clawscan-bin"))).toEqual(["clawscan"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("qualifies the matching stdlib judge before installing its PATH command", async () => {
    const fixture = await installFixture();
    try {
      await addJudge(fixture.runtime);
      await run("sh", [join(fixture.scriptDir, "install-clawscan.sh")], {
        env: fixture.env,
      });
      const sourceDir = (await readFile(fixture.env.GITHUB_ENV, "utf8"))
        .trim()
        .replace("CLAWSCAN_SOURCE_DIR=", "");
      expect(await readFile(fixture.env.QUALIFICATION_LOG, "utf8")).toBe(
        join(sourceDir, "docker/clawscan-runtime/judges/clawscan_decisions_judge.py"),
      );
      const command = join(fixture.root, "clawscan-bin/clawscan-decisions-judge");
      expect(await readFile(command, "utf8")).toBe(
        await readFile(join(fixture.runtime, "judges/clawscan_decisions_judge.py"), "utf8"),
      );
      const path = (await readFile(fixture.env.GITHUB_PATH, "utf8")).trim();
      await run("sh", ["-c", "clawscan-decisions-judge --help"], {
        env: { ...fixture.env, PATH: path + ":" + fixture.env.PATH },
      });
      expect((await readdir(sourceDir, { recursive: true })).join("\n")).not.toContain(
        "__pycache__",
      );
      expect(await readFile(fixture.env.COMMAND_LOG, "utf8")).not.toMatch(/pip|uv /);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(["source", "tests", "source-symlink", "tests-symlink"])(
    "rejects an incomplete or indirect judge pair (%s) without exposing commands",
    async (missing) => {
      const fixture = await installFixture();
      try {
        await addJudge(fixture.runtime);
        const file = join(
          fixture.runtime,
          missing.startsWith("source")
            ? "judges/clawscan_decisions_judge.py"
            : "tests/test_decisions_judge.py",
        );
        const content = await readFile(file, "utf8");
        await rm(file);
        if (missing.endsWith("-symlink")) {
          await writeFile(join(fixture.root, "indirect.py"), content);
          await symlink(join(fixture.root, "indirect.py"), file);
        }
        await expect(
          run("sh", [join(fixture.scriptDir, "install-clawscan.sh")], { env: fixture.env }),
        ).rejects.toThrow(/matching regular source and qualification tests/);
        await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
        await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
        await expect(
          readFile(join(fixture.root, "clawscan-bin/clawscan-decisions-judge"), "utf8"),
        ).rejects.toThrow();
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["QUALIFICATION_FAILURE", 73],
    ["HELP_FAILURE", 74],
  ] as const)("does not expose a judge when %s fails", async (failure, code) => {
    const fixture = await installFixture();
    try {
      await addJudge(fixture.runtime);
      await expect(
        run("sh", [join(fixture.scriptDir, "install-clawscan.sh")], {
          env: {
            ...fixture.env,
            [failure]: "1",
            ...(failure === "HELP_FAILURE" ? { HELP_FAILURE: "74" } : {}),
          },
        }),
      ).rejects.toMatchObject({ code });
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
      await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
      await expect(
        readFile(join(fixture.root, "clawscan-bin/clawscan-decisions-judge"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("blocks aig-mcp before fetching or installing an unqualified implementation", async () => {
    const fixture = await installFixture();
    try {
      await expect(
        run("sh", [join(fixture.scriptDir, "install-clawscan-scanners.sh"), "aig-mcp"], {
          env: { ...fixture.env, CLAWSCAN_SOURCE_DIR: fixture.fixture },
        }),
      ).rejects.toThrow(
        /corrected reviewed static-tools patch, qualification tests and dependency pins/,
      );
      expect(await readFile(fixture.env.COMMAND_LOG, "utf8")).toBe(
        "git -C " + fixture.fixture + " rev-parse HEAD\n",
      );
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
