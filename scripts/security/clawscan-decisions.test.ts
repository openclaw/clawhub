/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clawScanExposure } from "./clawscan-exposure";
import { validateClawScanArtifactForClawHubProfile } from "./run-codex-scan-worker";
import type { ClaimedJob } from "./run-codex-scan-worker";
import { runNativeClawScan } from "./run-prepublication-worker";

// Wire shape from #148 JudgeResult/JudgeAttempt and #149 ScannerResult/SARIF.
// Synthetic provider response: proves the consumer seam, not live qualification.
function fixture(verdict = "benign") {
  const result = {
    verdict,
    confidence: "high",
    dimensions: Object.fromEntries(
      [
        "purpose_capability",
        "instruction_scope",
        "install_mechanism",
        "environment_proportionality",
        "persistence_privilege",
      ].map((key) => [key, { status: "ok", confidence: 0.9 }]),
    ),
    scan_findings_in_context: [],
    decision: {
      api: "decisions",
      endpointHost: "api.openai.com",
      requestedModel: "requested-model",
      model: "provider-returned-model",
      latencyMs: 30,
      httpAttempts: 1,
      usage: {},
      input: {},
      verdict: { choice: verdict, confidence: 0.9, probabilities: {} },
      signals: {},
    },
  };
  return {
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    status: "completed",
    complete: true,
    startedAt: "2026-11-03T00:00:00Z",
    completedAt: "2026-11-03T00:00:01Z",
    scanners: {
      "aig-mcp": {
        status: "completed",
        error: "",
        exitCode: 0,
        durationMs: 10,
        startedAt: "2026-11-03T00:00:00Z",
        completedAt: "2026-11-03T00:00:01Z",
        command: ["aig-mcp-scan", "--repo", "plugin"],
        raw: {
          version: "2.1.0",
          runs: [
            {
              tool: { driver: { name: "aig-mcp-scan", version: "0.2.0" } },
              results: [],
              properties: { scanNote: "complete" },
              invocations: [{ executionSuccessful: true }],
            },
          ],
        },
      },
    },
    judge: {
      status: "completed",
      commandStarted: true,
      command: "clawscan-decisions-judge --workspace workspace",
      configuredModel: "not-the-provider-model",
      error: "",
      result,
      outputSchemaSha256: "a".repeat(64),
      promptSha256: "b".repeat(64),
      attempts: [{ status: "completed", commandStarted: true, error: "", durationMs: 30, result }],
    },
  };
}
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function runFixture(
  artifact: unknown,
  targetKind: ClaimedJob["job"]["targetKind"] = "packageRelease",
) {
  const workspace = await mkdtemp(join(tmpdir(), "decisions-consumer-"));
  dirs.push(workspace);
  await mkdir(join(workspace, "artifact"));
  await writeFile(join(workspace, "artifact", "openclaw.plugin.json"), '{"id":"fixture"}');
  const command = join(workspace, "clawscan-fixture");
  await writeFile(
    command,
    '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.argv[process.argv.indexOf("--output")+1], ' +
      JSON.stringify(JSON.stringify(artifact)) +
      ");\n",
  );
  await chmod(command, 0o755);
  vi.stubEnv("PREPUBLICATION_CLAWSCAN_COMMAND", command);
  return runNativeClawScan(
    {
      job: {
        _id: "fixture",
        targetKind,
        source: "pre-publication",
        leaseToken: "fixture",
        hasMaliciousSignal: false,
      },
      target: { package: { family: "code-plugin" }, release: { artifactKind: "legacy-zip" } },
    },
    workspace,
  );
}
describe("Decisions publication consumer", () => {
  it("rejects standalone skill evidence for a plugin claim", async () => {
    const artifact = fixture() as Record<string, any>;
    artifact.scanners.aig = artifact.scanners["aig-mcp"];
    artifact.scanners.aig.raw.runs[0].tool.driver.name = "aig-skill-scan";
    artifact.scanners.skillspector = { ...artifact.scanners.aig, raw: { issues: [] } };
    delete artifact.scanners["aig-mcp"];
    expect((await runFixture(artifact)).check.status).toBe("failed");
    expect(() => validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"])).toThrow();
  });

  it.each([
    ["benign", "clean"],
    ["suspicious", "clean"],
    ["malicious", "blocked"],
  ])("maps %s without inventing prose", async (verdict, check) => {
    const result = await runFixture(fixture(verdict));
    expect(result.check.status).toBe("failed");
    expect(result.check.summary).toContain("corrected scanner runtime");
    const projected = validateClawScanArtifactForClawHubProfile(fixture(verdict), ["aig-mcp"]);
    expect(projected.llmAnalysis).toMatchObject({
      verdict,
      model: "provider-returned-model",
      status: verdict === "benign" ? "clean" : verdict,
    });
    expect(projected.llmAnalysis.summary).toBeUndefined();
    expect(check).toBe(verdict === "malicious" ? "blocked" : "clean");
  });
  it("rejects plugin evidence for a standalone skill", async () => {
    expect((await runFixture(fixture(), "skillVersion")).check.status).toBe("failed");
    expect(() => validateClawScanArtifactForClawHubProfile(fixture())).toThrow();
  });
  it.each([
    "missing judge",
    "failed judge",
    "missing invocation",
    "unsuccessful invocation",
    "mixed-case invocation",
    "coverage gap",
    "empty output",
    "no command",
    "synthetic time",
    "inconsistent attempt",
    "missing verdict",
  ])("fails closed: %s", async (scenario) => {
    const artifact = fixture() as Record<string, any>;
    const scanner = artifact.scanners["aig-mcp"];
    if (scenario === "missing judge") delete artifact.judge;
    if (scenario === "failed judge") artifact.judge.status = "failed";
    if (scenario === "missing invocation") delete scanner.raw.runs[0].invocations;
    if (scenario === "unsuccessful invocation")
      scanner.raw.runs[0].invocations[0].executionSuccessful = false;
    if (scenario === "mixed-case invocation")
      scanner.raw.runs[0].invocations[0].ExecutionSuccessful = false;
    if (scenario === "coverage gap") scanner.raw.runs[0].properties.scanNote = "incomplete";
    if (scenario === "empty output") scanner.raw = {};
    if (scenario === "no command") scanner.command = [];
    if (scenario === "synthetic time") {
      delete scanner.exitCode;
      delete scanner.durationMs;
    }
    if (scenario === "inconsistent attempt") artifact.judge.attempts[0].result = {};
    if (scenario === "missing verdict") delete artifact.judge.result.verdict;
    expect(() => validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"])).toThrow();
    expect((await runFixture(artifact)).check.status).toBe("failed");
  });
  it("takes prose only from a successful optional overview", async () => {
    const artifact = fixture() as Record<string, any>;
    artifact.overview = {
      status: "completed",
      commandStarted: true,
      error: "",
      result: {
        summary: "Optional overview.",
        user_guidance: "Optional guidance.",
        scan_findings_in_context: [],
        dimensions: Object.fromEntries(
          Object.keys(artifact.judge.result.dimensions).map((key) => [key, "Overview detail."]),
        ),
      },
    };
    expect(
      validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]).llmAnalysis,
    ).toMatchObject({ summary: "Optional overview.", guidance: "Optional guidance." });
    artifact.overview.status = "failed";
    artifact.overview.error = "timeout";
    const result = validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]);
    expect(result.llmAnalysis.status).toBe("clean");
    expect(result.llmAnalysis.summary).toBeUndefined();
  });
  it("accounts actual execution without removed receipts or static scanner", () => {
    const artifact = fixture();
    expect(clawScanExposure(artifact)).toMatchObject({
      eligibleScanAttempt: true,
      judgeInvocations: 1,
      judgeOperationalFailures: 0,
      recoveredReceiptRetries: 0,
    });
    artifact.scanners["aig-mcp"].command = [];
    expect(clawScanExposure(artifact).eligibleScanAttempt).toBe(false);
    artifact.complete = false;
    expect(clawScanExposure(artifact).eligibleScanAttempt).toBe(false);
  });
});
