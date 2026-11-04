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
const pin = "c3cfaf1515a47685786d72f031c714b1e5d9b34e";
const candidate = "56d17aaa423cdb1ed87aeda970b9a2b30eed7dd8";
const candidateTree = "d860e0022e5832b76abf7c7ab6c3a679fdda1f64";
const runtimeTree = "ddfec1285eaf19beb3043e9e5ad043a0d274cb53";
const image =
  "ghcr.io/openclaw/clawscan-runtime@sha256:9c765a089a034451c428d563f0f09f4004c898ac14802470bb6a58fca7755960";

async function installFixture() {
  const root = await mkdtemp(join(tmpdir(), "clawscan-runtime-install-"));
  const bin = join(root, "bin");
  const scriptDir = join(root, "scripts");
  const fixture = join(root, "reviewed-source");
  const runtime = join(fixture, "docker/clawscan-runtime");
  for (const path of [bin, scriptDir, join(runtime, "judges"), join(runtime, "tests")])
    await mkdir(path, { recursive: true });
  for (const file of [
    "install-clawscan.sh",
    "install-clawscan-scanners.sh",
    "clawscan-install-source.sh",
  ])
    await copyFile(join(scripts, file), join(scriptDir, file));
  await writeFile(join(scriptDir, "clawscan-source-commit.txt"), pin + "\n");
  const fake = [
    "#!/bin/sh",
    'echo "$(basename "$0") $*" >> "$COMMAND_LOG"',
    'case "$(basename "$0")" in',
    ' git) if [ "${3:-}" = rev-parse ]; then case "$4" in HEAD) echo "$CLAWSCAN_PIN";; HEAD^{tree}) echo "$SOURCE_TREE";; HEAD:docker/clawscan-runtime) echo "$RUNTIME_TREE";; esac; elif [ "${3:-}" = status ]; then printf "%s" "${SOURCE_STATUS:-}"; exit "${STATUS_FAILURE:-0}"; elif [ "${3:-}" = checkout ]; then cp -R "$REVIEWED_FIXTURE/." "$2/"; fi;;',
    ' go) if [ "${1:-}" = build ]; then printf "#!/bin/sh\nexit 0\n" > "$4"; chmod 0755 "$4"; fi;;',
    ' docker) case "$1" in pull) exit "${PULL_FAILURE:-0}";; image) printf "%s\n" "${REPORTED_IMAGE:-$QUALIFIED_IMAGE}"; exit "${INSPECT_FAILURE:-0}";; run) exit "${CLI_FAILURE:-0}";; esac;;',
    "esac",
  ].join("\n");
  for (const command of ["git", "go", "docker"]) {
    await writeFile(join(bin, command), fake);
    await chmod(join(bin, command), 0o755);
  }
  const env = {
    PATH: bin + ":" + process.env.PATH,
    COMMAND_LOG: join(root, "commands.log"),
    CLAWSCAN_PIN: pin,
    SOURCE_TREE: candidateTree,
    RUNTIME_TREE: runtimeTree,
    QUALIFIED_IMAGE: image,
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
      ).rejects.toThrow(/exact qualified source and immutable runtime image/);
      expect(await readFile(fixture.env.COMMAND_LOG, "utf8")).toBe(
        "git -C " + fixture.fixture + " rev-parse HEAD\n",
      );
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("explicit qualified candidate installation", () => {
  it("builds the explicit candidate and qualifies its matching stdlib judge without changing the default", async () => {
    const fixture = await installFixture();
    try {
      await addJudge(fixture.runtime);
      const result = await run("sh", [join(fixture.scriptDir, "install-clawscan.sh"), candidate], {
        env: { ...fixture.env, CLAWSCAN_PIN: candidate },
      });
      expect(result.stdout).toContain("ClawScan source: " + candidate);
      expect(await readFile(join(fixture.scriptDir, "clawscan-source-commit.txt"), "utf8")).toBe(
        pin + "\n",
      );
      const commands = await readFile(fixture.env.COMMAND_LOG, "utf8");
      expect(commands).toContain("fetch --quiet --depth 1 origin " + candidate);
      expect(commands).toContain("rev-parse HEAD^{tree}");
      expect(commands).toContain("rev-parse HEAD:docker/clawscan-runtime");
      expect(commands).toContain("status --porcelain=v1 --untracked-files=all --ignored");
      expect(await readFile(fixture.env.QUALIFICATION_LOG, "utf8")).toContain(
        "clawscan_decisions_judge.py",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    "",
    "main",
    "A".repeat(40),
    "a".repeat(39),
    "a".repeat(41),
    "a".repeat(40),
    candidate + "\nmain",
  ])("rejects a malformed or unapproved explicit source before tools (%j)", async (source) => {
    const fixture = await installFixture();
    try {
      for (const args of [
        ["install-clawscan.sh", source],
        ["install-clawscan-scanners.sh", "aig-mcp", source],
      ]) {
        await expect(
          run("sh", [join(fixture.scriptDir, args[0]), ...args.slice(1)], {
            env: { ...fixture.env, CLAWSCAN_SOURCE_DIR: fixture.fixture },
          }),
        ).rejects.toThrow();
      }
      await expect(readFile(fixture.env.COMMAND_LOG, "utf8")).rejects.toThrow();
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
      await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    { CLAWSCAN_PIN: pin },
    { SOURCE_TREE: "a".repeat(40) },
    { RUNTIME_TREE: "a".repeat(40) },
    { SOURCE_STATUS: " M docker/clawscan-runtime/Dockerfile\n" },
    { SOURCE_STATUS: "?? unreviewed.py\n" },
    { SOURCE_STATUS: "!! ignored.py\n" },
    { STATUS_FAILURE: "72" },
  ])("rejects candidate source drift before image or build tools (%j)", async (failure) => {
    const fixture = await installFixture();
    try {
      for (const args of [
        ["install-clawscan.sh", candidate],
        ["install-clawscan-scanners.sh", "aig-mcp", candidate],
      ]) {
        await expect(
          run("sh", [join(fixture.scriptDir, args[0]), ...args.slice(1)], {
            env: {
              ...fixture.env,
              CLAWSCAN_PIN: candidate,
              CLAWSCAN_SOURCE_DIR: fixture.fixture,
              ...failure,
            },
          }),
        ).rejects.toThrow();
      }
      expect(await readFile(fixture.env.COMMAND_LOG, "utf8")).not.toMatch(/docker |go /);
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
      await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("requires the candidate's judge pair even when both files are missing", async () => {
    const fixture = await installFixture();
    try {
      await expect(
        run("sh", [join(fixture.scriptDir, "install-clawscan.sh"), candidate], {
          env: { ...fixture.env, CLAWSCAN_PIN: candidate },
        }),
      ).rejects.toThrow(/matching regular source and qualification tests/);
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
      await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("prepares only the approved digest and qualifies MCP/judge CLIs with no host install, mounts or network", async () => {
    const fixture = await installFixture();
    try {
      const result = await run(
        "sh",
        [join(fixture.scriptDir, "install-clawscan-scanners.sh"), "aig-mcp", candidate],
        {
          env: { ...fixture.env, CLAWSCAN_PIN: candidate, CLAWSCAN_SOURCE_DIR: fixture.fixture },
        },
      );
      expect(result.stdout).toContain("Qualified ClawScan aig-mcp runtime: " + image);
      const commands = await readFile(fixture.env.COMMAND_LOG, "utf8");
      expect(commands).toContain("docker pull " + image + "\n");
      expect(commands).toContain(
        "docker image inspect --format {{range .RepoDigests}}{{println .}}{{end}} " + image + "\n",
      );
      expect(commands).toContain(
        "docker run --rm --pull never --network none --entrypoint /bin/sh " +
          image +
          " -ec aig-mcp-scan --help >/dev/null; clawscan-decisions-judge --help >/dev/null\n",
      );
      expect(commands).not.toMatch(/pip|uv |fetch |--mount|--volume/);
      await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
      await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
      await expect(readdir(join(fixture.root, "clawscan-scanner-bin"))).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    { PULL_FAILURE: "71" },
    { INSPECT_FAILURE: "72" },
    { REPORTED_IMAGE: "ghcr.io/openclaw/clawscan-runtime:latest" },
    { REPORTED_IMAGE: image + "-unexpected" },
    { CLI_FAILURE: "73" },
  ])(
    "fails closed without exposing a host command or successful qualification (%j)",
    async (failure) => {
      const fixture = await installFixture();
      try {
        await expect(
          run(
            "sh",
            [join(fixture.scriptDir, "install-clawscan-scanners.sh"), "aig-mcp", candidate],
            {
              env: {
                ...fixture.env,
                CLAWSCAN_PIN: candidate,
                CLAWSCAN_SOURCE_DIR: fixture.fixture,
                ...failure,
              },
            },
          ),
        ).rejects.toThrow();
        const commands = await readFile(fixture.env.COMMAND_LOG, "utf8");
        if (!("CLI_FAILURE" in failure)) expect(commands).not.toContain("docker run ");
        expect(commands).not.toMatch(/pip|uv |fetch /);
        await expect(readFile(fixture.env.GITHUB_PATH, "utf8")).rejects.toThrow();
        await expect(readFile(fixture.env.GITHUB_ENV, "utf8")).rejects.toThrow();
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  );
});
