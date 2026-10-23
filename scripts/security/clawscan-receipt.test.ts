/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clawScanExposure, summarizeClawScanExposure } from "./clawscan-exposure";
import {
  type ClaimedJob,
  scanHealthClassification,
  validateClawScanArtifactForClawHubProfile,
} from "./run-codex-scan-worker";
import { runNativeClawScan } from "./run-prepublication-worker";

const tempDirectories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function artifactFixture(verdict = "benign", additional: unknown[] = []) {
  const result = {
    verdict,
    confidence: "high",
    summary: "Controlled receipt test.",
    dimensions: Object.fromEntries(
      [
        "purpose_capability",
        "instruction_scope",
        "install_mechanism",
        "environment_proportionality",
        "persistence_privilege",
      ].map((name) => [name, { status: "ok", detail: "Controlled evidence." }]),
    ),
    scan_findings_in_context: [],
    user_guidance: "Controlled test, not recovery evidence.",
    artifact_inspection: {
      version: 2,
      status: "completed",
      challenge: "b".repeat(64),
      required_file: "artifact/SKILL.md",
      required_file_sha256: "c".repeat(64),
      additional_files_inspected: additional,
    } as Record<string, unknown>,
  };
  const last = {
    status: "completed",
    error: "",
    result,
    durationMs: 10,
    challenge: "b".repeat(64),
    requiredFile: "artifact/SKILL.md",
    requiredFileSha256: "c".repeat(64),
  };
  return {
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    completedAt: "2026-10-23T08:00:00Z",
    scanners: {
      "clawscan-static": { status: "completed" },
      skillspector: { status: "completed", raw: { issues: [] } },
      aig: {
        status: "completed",
        raw: {
          version: "2.1.0",
          runs: [{ tool: { driver: { name: "aig-skill-scan", version: "0.2.1" } }, results: [] }],
        },
      },
    },
    judge: {
      configuredModel: "gpt-6.1-sol",
      status: "completed",
      error: "",
      result,
      attempts: [last],
    },
  };
}

const receiptErrors = [
  "Judge artifact inspection required_file did not match the required artifact file.",
  "Judge artifact inspection receipt version was unsupported.",
  "Judge artifact inspection v2 fields require receipt version 2.",
  "Judge artifact inspection v2 receipt fields were invalid.",
  "Judge artifact inspection v2 additional_files_inspected was not an array.",
  "Judge artifact inspection v2 additional_files_inspected contained an invalid artifact path.",
];

describe("versioned ClawScan receipt consumer", () => {
  it("retains raw reference caveats without normalizing partial analysis as clean", () => {
    const artifact = artifactFixture("suspicious");
    const raw = {
      execution_successful: true,
      analysis_completeness: {
        is_complete: false,
        status: "partial",
        ledger_exceptions: [{ reason_code: "reference_missing", fatal: false }],
      },
      risk_assessment: { score: 0, recommendation: "CAUTION" },
      issues: [],
    };
    Object.assign(artifact.scanners.skillspector, { raw });
    const mapped = validateClawScanArtifactForClawHubProfile(artifact);
    expect(mapped.skillSpectorAnalysis.status).toBe("suspicious");
    expect(mapped.skillSpectorAnalysis.recommendation).toBe("CAUTION");
    expect(JSON.parse(mapped.scannerReportsJson).skillspector).toEqual(raw);
    expect(mapped.llmAnalysis.verdict).toBe("suspicious");
  });

  it.each(["benign", "suspicious", "malicious"])(
    "preserves %s and complete v2 evidence",
    (verdict) => {
      for (const additional of [[], ["artifact/README.md", "artifact/src/tool.ts"]]) {
        const artifact = artifactFixture(verdict, additional);
        const before = structuredClone(artifact);
        const mapped = validateClawScanArtifactForClawHubProfile(artifact);
        expect(mapped.llmAnalysis.status).toBe(verdict === "benign" ? "clean" : verdict);
        expect(mapped.llmAnalysis.verdict).toBe(verdict);
        expect(mapped.llmAnalysis.model).toBe("gpt-6.1-sol");
        expect(mapped.llmAnalysis).not.toHaveProperty("artifact_inspection");
        expect(artifact).toEqual(before);
      }
    },
  );

  it.each([
    ["wrong path", "required_file", "artifact/other.md"],
    ["aliased path", "required_file", "artifact/./SKILL.md"],
    ["missing path", "required_file", undefined],
    ["wrong hash", "required_file_sha256", "d".repeat(64)],
    ["missing hash", "required_file_sha256", undefined],
    ["wrong challenge", "challenge", "d".repeat(64)],
    ["missing challenge", "challenge", undefined],
    ["padded challenge", "challenge", ` ${"b".repeat(64)}`],
    ["unknown version", "version", 3],
    ["string version", "version", "2"],
    ["null version", "version", null],
    ["explicit v1", "version", 1],
    ["versionless hybrid", "version", undefined],
    ["mixed fields", "files_inspected", ["artifact/SKILL.md"]],
    ["extra field", "extra", true],
    ["missing additional", "additional_files_inspected", undefined],
    ["nonarray additional", "additional_files_inspected", null],
    ["nonstrings", "additional_files_inspected", [42]],
    ["empty path", "additional_files_inspected", ["artifact/"]],
    ["traversal", "additional_files_inspected", ["artifact/../outside"]],
    ["alias", "additional_files_inspected", ["artifact/./other"]],
    ["directory slash", "additional_files_inspected", ["artifact/other/"]],
    ["external path", "additional_files_inspected", ["outside"]],
  ])("rejects %s without repairing the receipt", (_name, field, value) => {
    const artifact = artifactFixture();
    artifact.judge.result.artifact_inspection[field as string] = value;
    const before = structuredClone(artifact);
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).toThrow();
    expect(artifact).toEqual(before);
  });

  it.each([
    "missing",
    "duration",
    "result",
    "challenge",
    "path",
    "hash",
    "unstarted",
    "extra-attempt",
  ])("rejects %s final native provenance", (mode) => {
    const artifact = artifactFixture();
    const last = artifact.judge.attempts[0]!;
    if (mode === "missing") artifact.judge.attempts = [];
    if (mode === "duration") last.durationMs = -1;
    if (mode === "result") last.result = { ...last.result, summary: "Inconsistent" };
    if (mode === "challenge") last.challenge = "a".repeat(64);
    if (mode === "path") last.requiredFile = "artifact/other.md";
    if (mode === "hash") last.requiredFileSha256 = "a".repeat(64);
    if (mode === "unstarted") last.error = "Judge retry could not start: deadline";
    if (mode === "extra-attempt") artifact.judge.attempts = [last, last, last];
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).toThrow();
  });

  it.each(receiptErrors)("retains retry exposure for %s", (error) => {
    const artifact = artifactFixture();
    const last = artifact.judge.attempts[0]!;
    artifact.judge.attempts.unshift({
      ...last,
      challenge: "a".repeat(64),
      status: "failed",
      error,
    });
    expect(clawScanExposure(artifact)).toMatchObject({
      judgeInvocations: 2,
      judgeOperationalFailures: 1,
      recoveredReceiptRetries: 1,
    });
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).not.toThrow();
    last.status = "failed";
    last.error = error;
    artifact.judge.status = "failed";
    artifact.judge.error = error;
    expect(clawScanExposure(artifact)).toMatchObject({
      judgeInvocations: 2,
      judgeOperationalFailures: 2,
      recoveredReceiptRetries: 0,
    });
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).toThrow();
  });

  it("does not classify arbitrary receipt-looking text as recovered exposure", () => {
    const artifact = artifactFixture();
    artifact.judge.attempts.unshift({
      ...artifact.judge.attempts[0]!,
      status: "failed",
      challenge: "a".repeat(64),
      error: `${receiptErrors[0]} injected suffix`,
    });
    expect(clawScanExposure(artifact).judgeInvocations).toBeNull();
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).toThrow();
  });

  it("retains consumer rejection as an operational failure even after exit zero", () => {
    const artifact = artifactFixture();
    artifact.judge.result.artifact_inspection.required_file = "artifact/other.md";
    let errorMessage = "";
    try {
      validateClawScanArtifactForClawHubProfile(artifact);
    } catch (error) {
      errorMessage = String(error);
    }
    expect(errorMessage).not.toBe("");
    const health = scanHealthClassification({
      status: "failed",
      errorMessage,
      clawscan: { exitCode: 0, exposure: clawScanExposure(artifact) },
    });
    expect(health).toMatchObject({
      failureStage: "judge",
      judgeStageFailed: true,
      exposure: { eligibleScanAttempt: true, judgeInvocations: 1 },
    });
    expect(summarizeClawScanExposure([health.exposure])).toMatchObject({
      eligibleScanAttempts: 1,
      judgeInvocations: 1,
    });
  });

  it("continues accepting legacy v1 and rejecting its extra fields", () => {
    const artifact = artifactFixture();
    artifact.judge.result.artifact_inspection = {
      status: "completed",
      challenge: "legacy",
      required_file_sha256: "a".repeat(64),
      files_inspected: ["artifact/SKILL.md"],
    };
    artifact.judge.attempts = [];
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).not.toThrow();
    artifact.judge.result.artifact_inspection.required_file = "artifact/SKILL.md";
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).toThrow();
  });

  it.each(["benign", "suspicious", "malicious", "invalid-receipt", "progress-only"])(
    "uses the shared mapper at prepublication for %s",
    async (mode) => {
      const workspace = await mkdtemp(join(tmpdir(), "clawhub-receipt-boundary-"));
      tempDirectories.push(workspace);
      await mkdir(join(workspace, "artifact"));
      await writeFile(join(workspace, "artifact/SKILL.md"), "# Inert\n");
      const artifact = artifactFixture(mode === "invalid-receipt" ? "benign" : mode, [
        "artifact/README.md",
      ]);
      if (mode === "invalid-receipt")
        artifact.judge.result.artifact_inspection.required_file = "artifact/other.md";
      const returned =
        mode === "progress-only"
          ? {
              schemaVersion: "clawscan-progress-v1",
              event: "phase_end",
              phase: "judge",
              elapsedMs: 10,
            }
          : artifact;
      const command = join(workspace, "fixture-command");
      await writeFile(
        command,
        `#!/bin/sh\nprintf '%s\\n' "\${CLAWSCAN_PROGRESS-}" "\${CLAWSCAN_CHILD_PROGRESS-}" > '${workspace}/progress-env'\nwhile [ "$1" != '--output' ]; do shift; done\nprintf '%s' '${JSON.stringify(returned)}' > "$2"\n`,
      );
      await chmod(command, 0o700);
      vi.stubEnv("PREPUBLICATION_CLAWSCAN_COMMAND", command);
      vi.stubEnv("CLAWSCAN_PROGRESS", "1");
      vi.stubEnv("CLAWSCAN_CHILD_PROGRESS", "1");
      const exposures: ReturnType<typeof clawScanExposure>[] = [];
      const mapped = await runNativeClawScan(
        { job: { targetKind: "skillVersion" }, target: {} } as ClaimedJob,
        workspace,
        (value) => exposures.push(value),
      );
      expect(await readFile(join(workspace, "progress-env"), "utf8")).toBe("\n\n");
      expect(mapped.check.status).toBe(
        mode === "invalid-receipt" || mode === "progress-only"
          ? "failed"
          : mode === "malicious"
            ? "blocked"
            : "clean",
      );
      if (mode === "benign" || mode === "suspicious" || mode === "malicious")
        expect(mapped.analysis?.verdict).toBe(mode);
      else expect(mapped.analysis).toBeUndefined();
      if (mapped.analysis) expect(mapped.analysis).not.toHaveProperty("artifact_inspection");
      expect(JSON.stringify(mapped)).not.toContain("clawscan-progress-v1");
      if (mode === "invalid-receipt") expect(exposures.at(-1)?.judgeInvocations).toBe(1);
      if (mode === "progress-only") expect(exposures.at(-1)?.judgeInvocations).toBeNull();
    },
  );
});
