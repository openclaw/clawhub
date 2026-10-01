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
        runner: "crabbox",
        scenario: ".artifacts/proof-scenarios/demo.pw.ts",
      },
    );
  });

  it("parses local proof URLs and rejects non-local targets", () => {
    expect(
      parseProofUiArgs([
        "--runner",
        "local",
        "--mode",
        "before-after",
        "--baseline-url",
        "http://127.0.0.1:4317",
        "--candidate-url",
        "http://localhost:4318",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toMatchObject({
      baselineUrl: "http://127.0.0.1:4317",
      candidateUrl: "http://localhost:4318",
      runner: "local",
    });

    expect(() =>
      parseProofUiArgs([
        "--runner",
        "local",
        "--mode",
        "feature",
        "--candidate-url",
        "https://clawhub.ai",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toThrow("--candidate-url must use localhost");
    expect(() =>
      parseProofUiArgs([
        "--runner",
        "local",
        "--mode",
        "before-after",
        "--candidate-url",
        "http://127.0.0.1:4318",
        "--scenario",
        ".artifacts/proof-scenarios/demo.pw.ts",
      ]),
    ).toThrow("local before-after proof requires --baseline-url and --candidate-url");
  });

  it.each(["before-after", "feature", "smoke"])("validates proof mode %s", (mode) => {
    const parse = () => parseProofUiArgs(["--mode", mode, "--scenario", "scenario.mjs"]);
    if (mode === "smoke") expect(parse).toThrow("Unknown proof:ui mode: smoke");
    else expect(parse()).toMatchObject({ mode });
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

  it.each(["before-after", "feature"])("builds stable output directories for %s", (mode) => {
    const plan = buildProofUiPlan({
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      opts: parseProofUiArgs(["--mode", mode, "--scenario", "scenario.mjs"]),
      repoRoot: "/repo/clawhub",
    });
    expect(plan.mode).toBe(mode);
    expect(plan.outputDir).toBe(
      "/repo/clawhub/.artifacts/clawhub-ui-proof/2026-05-12T12-34-56-000Z",
    );
    const lanes = mode === "feature" ? ["candidate"] : ["baseline", "candidate"];
    expect(plan.lanes.map((lane) => [lane.name, lane.ref, lane.outputDir])).toEqual(
      lanes.map((name) => [
        name,
        name === "baseline" ? "origin/main" : "worktree",
        `${plan.outputDir}/${name}`,
      ]),
    );
  });

  it.each(["before-after", "feature"])(
    "dry-runs %s without Crabbox and writes the planned report",
    async (mode) => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-"));
      try {
        const scenario = path.join(repoRoot, "scenario.mjs");
        await fs.writeFile(scenario, "export default async function demo() {}\n");
        const result = await runProofUi({
          args: ["--scenario", scenario, "--mode", mode, "--dry-run"],
          commandRunner: async () => {
            throw new Error("Crabbox should not run during dry-run");
          },
          now: () => new Date("2026-05-12T12:34:56.000Z"),
          repoRoot,
        });
        expect(result.status).toBe("dry-run");
        const report = await fs.readFile(path.join(result.outputDir, "report.md"), "utf8");
        expect(report).toContain(`Mode: \`${mode}\``);
        expect(report).toContain(
          mode === "feature" ? "Baseline: not run for feature proof." : "Baseline: `origin/main`",
        );
        expect(report).toContain("Candidate: `worktree`");
        expect(report).toContain("Dry run: no proof runtime was invoked.");
        expect(report).toContain("### candidate");
        expect(report.includes("### baseline")).toBe(mode === "before-after");
        expect(JSON.parse(await fs.readFile(result.summaryPath, "utf8"))).toMatchObject({
          scenario,
          mode,
        });
      } finally {
        await fs.rm(repoRoot, { recursive: true, force: true });
      }
    },
  );

  it("runs a publishable local Playwright proof without invoking Crabbox", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-"));
    const scenario = path.join(repoRoot, ".artifacts/proof-scenarios/demo.pw.ts");
    await fs.mkdir(path.dirname(scenario), { recursive: true });
    await fs.writeFile(scenario, "export default async function demo() {}\n");
    const commands = [];

    const result = await runProofUi({
      args: [
        "--runner",
        "local",
        "--mode",
        "feature",
        "--candidate-url",
        "http://127.0.0.1:4318",
        "--scenario",
        scenario,
      ],
      commandRunner: async (command, commandArgs) => {
        commands.push([command, commandArgs]);
        const outputDir = commandArgs[commandArgs.indexOf("--output-dir") + 1];
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(
          path.join(outputDir, "proof-steps.json"),
          `${JSON.stringify({
            lane: "candidate",
            status: "pass",
            steps: [
              {
                name: "candidate /skills",
                screenshot: "screenshots/skills.png",
                status: "pass",
              },
            ],
          })}\n`,
        );
        return { stdout: "", stderr: "" };
      },
      now: () => new Date("2026-05-12T12:34:56.000Z"),
      repoRoot,
    });

    expect(commands).toHaveLength(1);
    expect(commands[0][0]).toBe("bun");
    expect(commands[0][1]).toContain("run-scenario");
    expect(commands[0][1]).toContain("http://127.0.0.1:4318");
    expect(result.status).toBe("pass");
    const summary = JSON.parse(await fs.readFile(result.summaryPath, "utf8"));
    expect(summary).toMatchObject({ runner: "local", status: "pass" });
    expect(summary.lanes).toHaveLength(1);
    await expect(fs.readFile(path.join(result.outputDir, "report.md"), "utf8")).resolves.toContain(
      "Runner: `local`",
    );
  });

  it.each(["pass", "fail", "missing"])(
    "recovers a Crabbox transport error only with successful UI and bootstrap manifests (%s)",
    async (bootstrapStatus) => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-"));
      const scenario = path.join(repoRoot, ".artifacts/proof-scenarios/demo.pw.ts");
      await fs.mkdir(path.dirname(scenario), { recursive: true });
      await fs.writeFile(scenario, "export default async function demo() {}\n");
      // Ignored operator-state names in the local caller must not block remote proof.
      await fs.symlink("/unreadable/operator-state", path.join(repoRoot, ".env.local"));
      await fs.symlink("/unreadable/operator-state", path.join(repoRoot, ".convex"));
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
            if (bootstrapStatus !== "missing") {
              await fs.writeFile(
                path.join(localOutputDir, "bootstrap-summary.json"),
                JSON.stringify({
                  status: bootstrapStatus,
                  error: bootstrapStatus === "fail" ? "backend cleanup failed" : undefined,
                }),
              );
            }
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

      const expected = bootstrapStatus === "pass" ? "pass" : "fail";
      expect(result.status).toBe(expected);
      const summary = JSON.parse(
        await fs.readFile(path.join(result.outputDir, "summary.json"), "utf8"),
      );
      expect(summary.status).toBe(expected);
      if (bootstrapStatus !== "pass") {
        expect(
          summary.lanes.every((lane) =>
            lane.error.includes(
              bootstrapStatus === "fail" ? "backend cleanup failed" : "completion manifest",
            ),
          ),
        ).toBe(true);
      }
    },
  );

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

  it.each(["HOME", "CONVEX_DEPLOYMENT", "VITE_CONVEX_URL", "NODE_OPTIONS", "BASH_ENV"])(
    "rejects reserved remote env %s during argument parsing",
    (key) => {
      expect(() =>
        parseProofUiArgs(["--scenario", "scenario.mjs", "--env", `${key}=unsafe`]),
      ).toThrow("Reserved proof --env");
    },
  );

  it("keeps the attach-only local environment path unchanged", () => {
    expect(
      parseProofUiArgs([
        "--runner",
        "local",
        "--mode",
        "feature",
        "--candidate-url",
        "http://127.0.0.1:4318",
        "--scenario",
        "scenario.mjs",
        "--env",
        "CONVEX_DEPLOYMENT=unused",
      ]),
    ).toMatchObject({ env: { CONVEX_DEPLOYMENT: "unused" } });
  });

  it.each(["baseline", "candidate"])(
    "runs trusted tooling from the wrapper and builds %s from its lane root",
    (name) => {
      const lane = {
        convexCloudPort: 4417,
        convexSitePort: 4517,
        name,
        outputDir: `/tmp/out/${name}`,
        port: 4317,
        ref: name === "baseline" ? "origin/main" : "worktree",
      };
      const script = renderRemoteLaneScript({
        lane,
        opts: {
          devAuth: true,
          env: { FEATURE_FLAG: "1" },
          seedCommand: "seed-fixture",
          skipInstall: true,
          videoDuration: "1",
        },
        plan: { outputDir: "/tmp/out" },
        scenarioText: "export default async function scenario() {}\n",
      });
      // Decode the literal JSON argument using the same single-quote escaping as a shell.
      const raw = script.match(/ui-proof-backend\.mjs" '(.*)' "\$app_root"/u)[1];
      const config = JSON.parse(raw.replaceAll("'\\''", "'"));
      expect(config).toMatchObject({
        lane,
        devAuth: true,
        env: { FEATURE_FLAG: "1" },
        seedCommand: "seed-fixture",
      });
      expect(script).toContain('exec env -i PATH="$PATH"');
      expect(script).toContain('node "$wrapper_root/scripts/ui-proof-backend.mjs"');
      expect(script).toContain(
        name === "baseline"
          ? 'app_root="$PWD/.artifacts/clawhub-ui-proof/worktrees/baseline"'
          : 'app_root="$PWD"',
      );
      expect(config).toMatchObject({
        skipInstall: true,
        videoDuration: "1",
        scenarioText: "export default async function scenario() {}\n",
      });
      expect(config).not.toHaveProperty("prepareCommand");
      expect(config).not.toHaveProperty("proofCommand");
      expect(script).not.toContain("trap");
      expect(script).not.toContain("preview_pid");
      expect(script).not.toContain("dev --local");
      expect(script).not.toContain(".env.local");
      expect(script).not.toContain("convex.pid");
    },
  );
});
