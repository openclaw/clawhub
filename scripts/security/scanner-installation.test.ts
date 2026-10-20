/* @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const run = promisify(execFile);
const scripts = resolve("scripts/security");

describe("reviewed ClawScan installation", () => {
  it("ships a full immutable source lock for the workflow installers", async () => {
    expect(await readFile(join(scripts, "clawscan-source-commit.txt"), "utf8")).toMatch(
      /^[a-f0-9]{40}\n$/,
    );
  });

  it.each([
    "security-scan-codex",
    "prepublication-publish-checks",
    "test-claw-canary-prepublication",
  ])("installs the matched binary and both Responses adapters in %s", async (name) => {
    const workflow = parseYaml(await readFile(".github/workflows/" + name + ".yml", "utf8"));
    const jobs = Object.values(workflow.jobs) as Array<{
      steps?: Array<{ name?: string; run?: string }>;
    }>;
    const steps = jobs.flatMap((job) => job.steps ?? []);
    const binary = steps.findIndex((step) => step.name === "Install ClawScan CLI");
    expect(binary).toBeGreaterThan(-1);
    expect(steps[binary].run).toContain("sh scripts/security/install-clawscan.sh");
    for (const [stepName, adapter] of [
      ["Install SkillSpector", "skillspector"],
      ["Install A.I.G scanner", "aig"],
    ]) {
      const index = steps.findIndex((step) => step.name === stepName);
      expect(index).toBeGreaterThan(binary);
      expect(steps[index].run).toContain(
        "sh scripts/security/install-clawscan-scanners.sh " + adapter,
      );
    }
    expect(steps.find((step) => step.name === "Install Codex CLI")?.run).toContain(
      "@openai/codex@0.160.0",
    );
    expect(JSON.stringify(workflow)).not.toContain("@openclaw/clawscan@");
    expect(JSON.stringify(workflow)).not.toContain("69dcdfb74487d361ba4c811d088cfdea2ff3a9dc");
  });

  it("rejects mutable or missing source revisions before executing installation tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawscan-install-reject-"));
    try {
      await copyFile(join(scripts, "install-clawscan.sh"), join(root, "install.sh"));
      await expect(
        run("sh", [join(root, "install.sh")], { env: { PATH: process.env.PATH } }),
      ).rejects.toThrow();
      for (const pin of ["main", "latest", "abc123", "a".repeat(41), "a".repeat(40) + "\nmain"]) {
        await writeFile(join(root, "clawscan-source-commit.txt"), pin);
        await expect(
          run("sh", [join(root, "install.sh")], { env: { PATH: process.env.PATH } }),
        ).rejects.toThrow();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["aig", "skillspector"],
    ["skillspector", "aig"],
  ])(
    "runs pinned %s then %s source patch and adapter tests without shadowing Python",
    async (first, second) => {
      const root = await mkdtemp(join(tmpdir(), "clawscan-install-contract-"));
      try {
        const pin = "a".repeat(40);
        const scannerPin = "b".repeat(40);
        const bin = join(root, "bin");
        const source = join(root, "clawscan");
        const runtime = join(source, "docker/clawscan-runtime");
        const scriptDir = join(root, "scripts");
        const log = join(root, "commands.log");
        for (const path of [bin, runtime, scriptDir]) await mkdir(path, { recursive: true });
        await copyFile(
          join(scripts, "install-clawscan-scanners.sh"),
          join(scriptDir, "install.sh"),
        );
        await writeFile(join(scriptDir, "clawscan-source-commit.txt"), pin);
        await writeFile(
          join(runtime, "Dockerfile"),
          "ARG SKILLSPECTOR_REF=" + scannerPin + "\nARG AIG_SKILL_SCAN_REF=" + scannerPin + "\n",
        );
        const fake = [
          "#!/bin/sh",
          'echo "$(basename "$0") $*" >> "$COMMAND_LOG"',
          'case "$(basename "$0")" in',
          ' git) if [ "${3:-}" = rev-parse ]; then case "$2" in */clawscan) echo "$CLAWSCAN_PIN";; *) echo "$SCANNER_PIN";; esac; fi;;',
          ' python) if [ "${1:-}" = -m ] && [ "${2:-}" = venv ]; then mkdir -p "$3/bin"; cp "$0" "$3/bin/python"; cp "$0" "$3/bin/aig-skill-scan"; fi;;',
          ' uv) if [ "${1:-}" = sync ]; then for last; do :; done; mkdir -p "$last/.venv/bin"; cp "$0" "$last/.venv/bin/python"; cp "$0" "$last/.venv/bin/skillspector"; fi;;',
          "esac",
        ].join("\n");
        for (const command of ["git", "python", "uv"]) {
          await writeFile(join(bin, command), fake);
          await chmod(join(bin, command), 0o755);
        }
        let path = bin + ":" + process.env.PATH;
        for (const scanner of [first, second]) {
          await run("sh", [join(scriptDir, "install.sh"), scanner], {
            env: {
              PATH: path,
              COMMAND_LOG: log,
              CLAWSCAN_PIN: pin,
              SCANNER_PIN: scannerPin,
              CLAWSCAN_SOURCE_DIR: source,
              RUNNER_TEMP: root,
              GITHUB_PATH: join(root, "github-path"),
            },
          });
          const addedPaths = (await readFile(join(root, "github-path"), "utf8")).trim().split("\n");
          path = [...addedPaths.reverse(), bin, process.env.PATH].join(":");
          expect(
            (await run("sh", ["-c", "command -v python"], { env: { PATH: path } })).stdout.trim(),
          ).toBe(join(bin, "python"));
        }
        const commands = await readFile(log, "utf8");
        expect(commands).toContain("fetch --quiet --depth 1 origin " + scannerPin);
        for (const scanner of [first, second]) {
          expect(commands).toContain(
            "apply --check " + runtime + "/patches/" + scanner + "-responses.patch",
          );
          expect(commands).toContain(
            "-m pytest -q " + runtime + "/tests/test_" + scanner + "_responses.py",
          );
        }
        expect(commands).toContain(
          "--require-hashes -r " + scriptDir + "/aig-worker-requirements.txt",
        );
        expect(commands).toContain("--no-deps " + root + "/aig-source.");
        expect(commands).toContain("uv sync --locked --no-dev --project");
        const paths = await readFile(join(root, "github-path"), "utf8");
        expect(paths).toBe((join(root, "clawscan-scanner-bin") + "\n").repeat(2));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
