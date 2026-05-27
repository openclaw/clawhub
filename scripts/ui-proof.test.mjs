/* @vitest-environment node */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProofUiPlan,
  buildRsyncSshCommand,
  parseProofUiArgs,
  renderRemoteLaneScript,
  runProofUi,
} from "./ui-proof.mjs";

describe("ui-proof", () => {
  it("parses proof defaults for temporary scenarios", () => {
    expect(parseProofUiArgs(["--scenario", ".artifacts/proof-scenarios/demo.pw.ts"])).toMatchObject(
      {
        baseline: "origin/main",
        candidate: "worktree",
        devAuth: false,
        mode: "before-after",
        provider: "hetzner",
        scenario: ".artifacts/proof-scenarios/demo.pw.ts",
      },
    );
  });

  it("parses explicit proof modes and rejects unknown modes", () => {
    expect(
      parseProofUiArgs([
        "--mode",
        "before-after",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toMatchObject({
      mode: "before-after",
    });
    expect(
      parseProofUiArgs([
        "--mode",
        "feature",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toMatchObject({
      mode: "feature",
    });
    expect(() =>
      parseProofUiArgs(["--mode", "smoke", "--scenario", ".artifacts/proof-scenarios/demo.pw.ts"]),
    ).toThrow("Unknown proof:ui mode: smoke");
  });

  it("parses seed command and explicit proof env options", () => {
    expect(
      parseProofUiArgs([
        "--dev-auth",
        "--env",
        "FEATURE_FLAG=1",
        "--seed-command",
        "bunx convex run --no-push devSeed:seedNixSkills",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toMatchObject({
      devAuth: true,
      env: { FEATURE_FLAG: "1" },
      seedCommand: "bunx convex run --no-push devSeed:seedNixSkills",
    });

    expect(() =>
      parseProofUiArgs([
        "--backend",
        "prod",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toThrow("Unknown proof:ui argument: --backend");
    expect(() =>
      parseProofUiArgs([
        "--env",
        "FEATURE_FLAG",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toThrow("--env requires KEY=VALUE");
  });

  it("builds a before/after plan with stable lane output directories", () => {
    const plan = buildProofUiPlan({
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      opts: parseProofUiArgs(["--scenario", ".artifacts/proof-scenarios/demo.pw.ts"]),
      repoRoot: "/repo/clawhub",
    });

    expect(plan.mode).toBe("before-after");
    expect(plan.outputDir).toBe(
      "/repo/clawhub/.artifacts/clawhub-ui-proof/2026-05-12T12-34-56-000Z",
    );
    expect(plan.lanes.map((lane) => [lane.name, lane.ref, lane.outputDir])).toEqual([
      ["baseline", "origin/main", `${plan.outputDir}/baseline`],
      ["candidate", "worktree", `${plan.outputDir}/candidate`],
    ]);
  });

  it("builds a feature plan with candidate-only lane output", () => {
    const plan = buildProofUiPlan({
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      opts: parseProofUiArgs([
        "--mode",
        "feature",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
      repoRoot: "/repo/clawhub",
    });

    expect(plan.mode).toBe("feature");
    expect(plan.lanes.map((lane) => [lane.name, lane.ref, lane.outputDir])).toEqual([
      ["candidate", "worktree", `${plan.outputDir}/candidate`],
    ]);
  });

  it("dry-runs without invoking Crabbox and writes the planned report", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-"));
    const scenario = path.join(repoRoot, ".artifacts/proof-scenarios/demo.pw.ts");
    await fs.mkdir(path.dirname(scenario), { recursive: true });
    await fs.writeFile(scenario, "export default async function demo() {}\n");
    const commands = [];

    const result = await runProofUi({
      args: ["--scenario", scenario, "--dry-run"],
      commandRunner: async (command, commandArgs) => {
        commands.push([command, commandArgs]);
        return { stdout: "", stderr: "" };
      },
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      repoRoot,
    });

    expect(commands).toEqual([]);
    expect(result.status).toBe("dry-run");
    const report = await fs.readFile(path.join(result.outputDir, "report.md"), "utf8");
    expect(report).toContain("Mode: `before-after`");
    expect(report).toContain("Baseline: `origin/main`");
    expect(report).toContain("Candidate: `worktree`");
    expect(report).toContain("Dry run");
    await expect(
      fs.readFile(path.join(result.outputDir, "summary.json"), "utf8"),
    ).resolves.toContain('"scenario"');
  });

  it("dry-runs feature proof with candidate-only report language", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-"));
    const scenario = path.join(repoRoot, ".artifacts/proof-scenarios/demo.pw.ts");
    await fs.mkdir(path.dirname(scenario), { recursive: true });
    await fs.writeFile(scenario, "export default async function demo() {}\n");

    const result = await runProofUi({
      args: ["--mode", "feature", "--scenario", scenario, "--dry-run"],
      commandRunner: async () => {
        throw new Error("Crabbox should not run during dry-run");
      },
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      repoRoot,
    });

    const report = await fs.readFile(path.join(result.outputDir, "report.md"), "utf8");
    expect(report).toContain("Mode: `feature`");
    expect(report).toContain("Baseline: not run for feature proof.");
    expect(report).toContain("Candidate: `worktree`");
    expect(report).not.toContain("### baseline");
    expect(report).toContain("### candidate");
    await expect(
      fs.readFile(path.join(result.outputDir, "summary.json"), "utf8"),
    ).resolves.toContain('"mode": "feature"');
  });

  it("treats a passing proof manifest as authoritative after a Crabbox transport error", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-"));
    const scenario = path.join(repoRoot, ".artifacts/proof-scenarios/demo.pw.ts");
    await fs.mkdir(path.dirname(scenario), { recursive: true });
    await fs.writeFile(scenario, "export default async function demo() {}\n");
    let laneIndex = 0;

    const result = await runProofUi({
      args: ["--scenario", scenario],
      commandRunner: async (command, commandArgs) => {
        if (commandArgs.includes("warmup")) {
          return { stdout: "leased cbx_deadbeef", stderr: "" };
        }
        if (commandArgs.includes("run")) {
          const lane = laneIndex === 0 ? "baseline" : "candidate";
          laneIndex += 1;
          const error = new Error(`transport failed for ${lane}`);
          error.stdout = `__CLAWHUB_UI_PROOF_REMOTE_OUTPUT__=/remote/${lane}\n`;
          error.stderr = "";
          throw error;
        }
        if (commandArgs.includes("inspect")) {
          return {
            stdout: JSON.stringify({
              sshHost: "203.0.113.10",
              sshKey: "/tmp/crabbox key",
              sshPort: 22,
              sshUser: "crabbox",
            }),
            stderr: "",
          };
        }
        if (command === "rsync") {
          const localOutputDir = commandArgs.at(-1).replace(/\/$/u, "");
          const lane = localOutputDir.endsWith("baseline") ? "baseline" : "candidate";
          await fs.mkdir(localOutputDir, { recursive: true });
          await fs.writeFile(
            path.join(localOutputDir, "proof-steps.json"),
            `${JSON.stringify({
              lane,
              status: "pass",
              steps: [
                {
                  name: `${lane} /skills`,
                  screenshot: "screenshots/skills.png",
                  status: "pass",
                },
              ],
            })}\n`,
          );
          return { stdout: "", stderr: "" };
        }
        if (commandArgs.includes("stop")) {
          return { stdout: "", stderr: "" };
        }
        throw new Error(`unexpected command: ${command} ${commandArgs.join(" ")}`);
      },
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      repoRoot,
    });

    expect(result.status).toBe("pass");
    await expect(
      fs.readFile(path.join(result.outputDir, "summary.json"), "utf8"),
    ).resolves.toContain('"status": "pass"');
  });

  it("quotes Crabbox ssh key paths with spaces for rsync artifact copying", () => {
    const { ssh } = buildRsyncSshCommand({
      sshHost: "203.0.113.10",
      sshKey: "/Users/patrick/Library/Application Support/crabbox/testboxes/cbx_123/id_ed25519",
      sshPort: 22,
      sshUser: "crabbox",
    });

    expect(ssh).toContain(
      "-i '/Users/patrick/Library/Application Support/crabbox/testboxes/cbx_123/id_ed25519'",
    );
  });

  it("bootstraps Bun on desktop Crabbox images before running proof commands", () => {
    const script = renderRemoteLaneScript({
      lane: {
        name: "candidate",
        outputDir: "/tmp/out/candidate",
        port: 4318,
        ref: "worktree",
      },
      opts: {
        skipInstall: false,
        videoDuration: "1",
      },
      plan: {
        outputDir: "/tmp/out",
      },
      scenarioText: "export default async function scenario() {}\n",
    });

    expect(script).toContain("command -v bun");
    expect(script).toContain("command -v unzip");
    expect(script).toContain("curl -fsSL https://bun.sh/install | bash");
    expect(script).toContain('export PATH="$BUN_INSTALL/bin:$PATH"');
    expect(script).toContain("bunx playwright install chromium");
    expect(script).toContain("trap cleanup_proof_processes EXIT");
    expect(script).toContain("return 0");
    expect(script).toContain("bun -e");
    expect(script).toContain("bun 'scripts/ui-proof-runtime.mjs' run-scenario");
    expect(script).toContain(
      'manifest_status="$(CLAWHUB_UI_PROOF_MANIFEST="$remote_out/proof-steps.json" bun -e',
    );
  });

  it("renders lane-local Convex env, seed command, and process cleanup for proof lanes", () => {
    const script = renderRemoteLaneScript({
      lane: {
        convexCloudPort: 4417,
        convexSitePort: 4517,
        name: "baseline",
        outputDir: "/tmp/out/baseline",
        port: 4317,
        ref: "origin/main",
      },
      opts: {
        devAuth: true,
        env: { FEATURE_FLAG: "1" },
        seedCommand: "bunx convex run --no-push devSeed:seedNixSkills",
        skipInstall: true,
        videoDuration: "1",
      },
      plan: {
        outputDir: "/tmp/out",
      },
      scenarioText: "export default async function scenario() {}\n",
    });

    expect(script).toContain('convex_pid=""');
    expect(script).toContain('kill "$convex_pid"');
    expect(script).toContain("VITE_CONVEX_URL='http://127.0.0.1:4417'");
    expect(script).toContain("VITE_CONVEX_SITE_URL='http://127.0.0.1:4517'");
    expect(script).toContain("CONVEX_DEPLOYMENT='local:anonymous-clawhub-ui-proof-baseline'");
    expect(script).toContain(
      "DEV_AUTH_CONVEX_DEPLOYMENT='local:anonymous-clawhub-ui-proof-baseline'",
    );
    expect(script).toContain("local Convex did not write $app_root/.env.local");
    expect(script).toContain('. "$app_root/.env.local"');
    expect(script).toContain('export DEV_AUTH_CONVEX_DEPLOYMENT="$CONVEX_DEPLOYMENT"');
    expect(script).toContain("--local-cloud-port 4417");
    expect(script).toContain("--local-site-port 4517");
    expect(script).toContain('bunx convex dev --local --env-file "$lane_env_file"');
    expect(script).toContain("bunx convex run --no-push devSeed:seedNixSkills");
    expect(script).toContain("VITE_ENABLE_DEV_AUTH=1");
    expect(script).toContain("FEATURE_FLAG='1'");
    expect(script).not.toContain("https://wry-manatee-359.convex.cloud");
  });

  it("does not enable dev auth by default but still uses lane-local Convex", () => {
    const script = renderRemoteLaneScript({
      lane: {
        convexCloudPort: 4418,
        convexSitePort: 4518,
        name: "candidate",
        outputDir: "/tmp/out/candidate",
        port: 4318,
        ref: "worktree",
      },
      opts: {
        devAuth: false,
        env: {},
        skipInstall: true,
        videoDuration: "1",
      },
      plan: {
        outputDir: "/tmp/out",
      },
      scenarioText: "export default async function scenario() {}\n",
    });

    expect(script).toContain("VITE_CONVEX_URL='http://127.0.0.1:4418'");
    expect(script).toContain("VITE_CONVEX_SITE_URL='http://127.0.0.1:4518'");
    expect(script).toContain("convex dev --local");
    expect(script).not.toContain("VITE_ENABLE_DEV_AUTH=1");
    expect(script).not.toContain("https://wry-manatee-359.convex.cloud");
  });
});
