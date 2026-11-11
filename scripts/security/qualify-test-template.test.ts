/* @vitest-environment node */
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClawScanContainerCleanupError } from "./clawscan-docker-cleanup";
import { QUALIFIED_PLUGIN_IMAGE, QUALIFIED_PLUGIN_SOURCE } from "./clawscan-plugin-runtime";
import { resolveTemplateScanForTarget } from "./clawscan-template-runtime";
import { qualifyTestTemplate } from "./qualify-test-template";
import { runNativeClawScan, runNativeTruffleHog } from "./run-prepublication-worker";

vi.mock("./clawscan-template-runtime", () => ({ resolveTemplateScanForTarget: vi.fn() }));
vi.mock("./run-prepublication-worker", () => ({
  runNativeClawScan: vi.fn(),
  runNativeTruffleHog: vi.fn(),
}));

// Synthetic native responses test orchestration and the REAL consumer validation.
// They are not evidence of a live AIG/model run.
function report(verdict = "benign") {
  const result = {
    verdict,
    confidence: "high",
    scan_findings_in_context: [],
    dimensions: Object.fromEntries(
      [
        "purpose_capability",
        "instruction_scope",
        "install_mechanism",
        "environment_proportionality",
        "persistence_privilege",
      ].map((key) => [key, { status: "ok", confidence: 0.9 }]),
    ),
  };
  return {
    schemaVersion: "clawscan-run-v1",
    configSource: "built-in",
    profile: "clawhub-template",
    target: { kind: "template" },
    sandbox: { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE },
    status: "completed",
    complete: true,
    startedAt: "2026-11-10T00:00:00Z",
    completedAt: "2026-11-10T00:00:01Z",
    scanners: {
      "aig-mcp": {
        status: "completed",
        error: "",
        exitCode: 0,
        durationMs: 10,
        startedAt: "2026-11-10T00:00:00Z",
        completedAt: "2026-11-10T00:00:01Z",
        command: ["aig-mcp-scan", "--repo", "artifact"],
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
      error: "",
      result,
      outputSchemaPath: "evidence-judge.schema.json",
      promptPath: "evidence-judge.md",
      outputSchemaSha256: "a".repeat(64),
      promptSha256: "b".repeat(64),
      attempts: [{ status: "completed", commandStarted: true, error: "", durationMs: 30, result }],
    },
  };
}
let workspace = "";
let nativeReport = report();
beforeEach(() => {
  vi.stubEnv("GITHUB_REF", "refs/heads/main");
  vi.stubEnv("GITHUB_SHA", "c".repeat(40));
  vi.stubEnv("CONVEX_URL", "https://academic-chihuahua-392.convex.cloud");
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "LLM_API_KEY"])
    vi.stubEnv(key, "private-test-placeholder");
  for (const key of [
    "CONVEX_DEPLOY_KEY",
    "SECURITY_SCAN_WORKER_TOKEN",
    "ATTEMPT_ID",
    "PREPUBLICATION_TRUFFLEHOG_COMMAND",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("SECURITY_SCAN_WORKER_HOST_DEADLINE_MS", String(Date.now() + 90 * 60_000));
  vi.mocked(resolveTemplateScanForTarget).mockResolvedValue({
    source: QUALIFIED_PLUGIN_SOURCE,
    image: QUALIFIED_PLUGIN_IMAGE,
    command: "reviewed-host-binary",
  });
  vi.mocked(runNativeTruffleHog).mockResolvedValue({ status: "clean", exitCode: 0 });
  nativeReport = report();
  workspace = "";
  vi.mocked(runNativeClawScan).mockImplementation(async (job, path) => {
    workspace = path;
    expect(job.target).toEqual({
      package: { family: "template" },
      release: { artifactKind: "legacy-zip" },
    });
    expect(job.job.leaseToken).toBe("");
    expect(await readFile(join(path, "artifact/CLAW.md"), "utf8")).toContain(
      "Project notes assistant",
    );
    await writeFile(join(path, "clawscan-result.json"), JSON.stringify(nativeReport));
    return {
      check: { status: nativeReport.judge.result.verdict === "malicious" ? "blocked" : "clean" },
    };
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("fixed nonpublishing Template native qualification", () => {
  it("accepts only completed native evidence, binds pins, preserves bytes and removes its workspace", async () => {
    const receipt = await qualifyTestTemplate([]);
    expect(receipt).toMatchObject({
      schemaVersion: "clawhub-template-native-qualification-v1",
      status: "passed",
      failure: null,
      mode: "nonpublishing",
      source: QUALIFIED_PLUGIN_SOURCE,
      image: QUALIFIED_PLUGIN_IMAGE,
      profile: "clawhub-template",
      targetKind: "template",
      sourceAndBinaryVerified: true,
      secretGate: "clean",
      nativeEvidence: "completed",
      verdict: "benign",
      fixtureUnchanged: true,
      workspaceRemoved: true,
    });
    expect(receipt.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain("private-test-placeholder");
    await expect(access(workspace)).rejects.toThrow();
    expect(runNativeClawScan).toHaveBeenCalledTimes(1);
  });
  it.each(["--attempt-id", "--source", "--command", "--path"])(
    "rejects supplied %s without fallback",
    async (arg) => {
      expect(await qualifyTestTemplate([arg, "anything"])).toMatchObject({
        status: "failed",
        failure: "configuration",
      });
      expect(resolveTemplateScanForTarget).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_SHA", "main"],
    ["CONVEX_URL", "https://other.convex.cloud"],
    ["OPENAI_API_KEY", ""],
    ["CONVEX_DEPLOY_KEY", "private-test-placeholder"],
    ["SECURITY_SCAN_WORKER_TOKEN", "private-test-placeholder"],
    ["ATTEMPT_ID", "a".repeat(32)],
    ["PREPUBLICATION_TRUFFLEHOG_COMMAND", "other"],
  ])("rejects invalid %s", async (key, value) => {
    vi.stubEnv(key, value);
    expect(await qualifyTestTemplate([])).toMatchObject({
      status: "failed",
      failure: "configuration",
    });
    expect(runNativeTruffleHog).not.toHaveBeenCalled();
  });
  it.each(["", "bad", String(Date.now() + 10 * 60_000)])(
    "does not start without a drain window (%s)",
    async (value) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_HOST_DEADLINE_MS", value);
      expect(await qualifyTestTemplate([])).toMatchObject({
        status: "failed",
        failure: "deadline",
      });
      expect(resolveTemplateScanForTarget).not.toHaveBeenCalled();
    },
  );
  it("rechecks the absolute deadline after source verification and preparation", async () => {
    const now = Date.now();
    vi.stubEnv("SECURITY_SCAN_WORKER_HOST_DEADLINE_MS", String(now + 66 * 60_000));
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 2 * 60_000);
    expect(await qualifyTestTemplate([])).toMatchObject({
      status: "failed",
      failure: "deadline",
      workspaceRemoved: true,
    });
    expect(runNativeTruffleHog).not.toHaveBeenCalled();
  });
  it("does not bypass an unqualified source/binary", async () => {
    vi.mocked(resolveTemplateScanForTarget).mockRejectedValue(
      new Error("private-test-placeholder"),
    );
    const receipt = await qualifyTestTemplate([]);
    expect(receipt).toMatchObject({
      status: "failed",
      failure: "runtime",
      sourceAndBinaryVerified: false,
    });
    expect(JSON.stringify(receipt)).not.toContain("private-test-placeholder");
    expect(runNativeClawScan).not.toHaveBeenCalled();
  });
  it.each(["blocked", "failed"] as const)("stops on %s secret gate", async (status) => {
    vi.mocked(runNativeTruffleHog).mockResolvedValue({
      status,
      summary: "private-test-placeholder",
    });
    const receipt = await qualifyTestTemplate([]);
    expect(receipt).toMatchObject({
      status: "failed",
      failure: "secrets",
      secretGate: status,
      workspaceRemoved: true,
      nativeEvidence: "not_validated",
    });
    expect(runNativeClawScan).not.toHaveBeenCalled();
    expect(JSON.stringify(receipt)).not.toContain("private-test-placeholder");
  });
  it.each(["throw", "failed"])("never treats native %s as clean", async (mode) => {
    if (mode === "throw")
      vi.mocked(runNativeClawScan).mockRejectedValue(new Error("private-test-placeholder"));
    else
      vi.mocked(runNativeClawScan).mockResolvedValue({
        check: { status: "failed", summary: "private-test-placeholder" },
      });
    const receipt = await qualifyTestTemplate([]);
    expect(receipt).toMatchObject({
      status: "failed",
      failure: "native_execution",
      verdict: null,
      workspaceRemoved: true,
    });
    expect(JSON.stringify(receipt)).not.toContain("private-test-placeholder");
  });
  it.each(["suspicious", "malicious"])(
    "retains terminal %s but fails the known benign fixture without retry",
    async (verdict) => {
      nativeReport = report(verdict);
      expect(await qualifyTestTemplate([])).toMatchObject({
        status: "failed",
        failure: "unexpected_verdict",
        nativeEvidence: "completed",
        verdict,
        workspaceRemoved: true,
      });
      expect(runNativeClawScan).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["profile", "target", "image", "incomplete", "imported", "sarif", "judge", "hash"])(
    "rejects bad %s evidence despite a clean wrapper result",
    async (kind) => {
      if (kind === "profile") nativeReport.profile = "clawhub";
      if (kind === "target") nativeReport.target.kind = "plugin";
      if (kind === "image") nativeReport.sandbox.image = "unqualified";
      if (kind === "incomplete") nativeReport.complete = false;
      if (kind === "imported") nativeReport.scanners["aig-mcp"].command = ["scanner-result"];
      if (kind === "sarif")
        nativeReport.scanners["aig-mcp"].raw.runs[0].properties.scanNote = "partial";
      if (kind === "judge") nativeReport.judge.status = "failed";
      if (kind === "hash") nativeReport.judge.outputSchemaSha256 = "missing";
      expect(await qualifyTestTemplate([])).toMatchObject({
        status: "failed",
        failure: "native_evidence",
        nativeEvidence: "not_validated",
        verdict: null,
        workspaceRemoved: true,
      });
    },
  );
  it("preserves mount custody when Docker cleanup is unconfirmed", async () => {
    vi.mocked(runNativeClawScan).mockImplementation(async (_job, path) => {
      workspace = path;
      throw new ClawScanContainerCleanupError("private-test-placeholder");
    });
    try {
      const receipt = await qualifyTestTemplate([]);
      expect(receipt).toMatchObject({
        status: "failed",
        failure: "docker_cleanup",
        workspaceRemoved: false,
        nativeEvidence: "not_validated",
      });
      expect(JSON.stringify(receipt)).not.toContain("private-test-placeholder");
      await expect(access(workspace)).resolves.toBeUndefined();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it("rejects scanner edits to the artifact", async () => {
    const original = vi.mocked(runNativeClawScan).getMockImplementation()!;
    vi.mocked(runNativeClawScan).mockImplementation(async (...args) => {
      const result = await original(...args);
      await writeFile(join(args[1], "artifact/workspace/PLAN.md"), "changed");
      return result;
    });
    expect(await qualifyTestTemplate([])).toMatchObject({
      status: "failed",
      failure: "artifact_changed",
      fixtureUnchanged: false,
      workspaceRemoved: true,
    });
  });
});
