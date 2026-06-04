/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCodexWorkerExecutionAllowed,
  isCodexWorkerExecutionAllowed,
  LOCAL_CODEX_WORKER_OPT_IN,
  resolveCodexWorkerHome,
} from "../codex-worker-guard";
import {
  assertCodexArtifactCoverageForVerdict,
  buildPrompt,
  normalizeSkillSpectorAnalysis,
  resolveSkillSpectorScanInput,
  writeArtifactWorkspace,
  writeJobDiagnostic,
} from "./run-codex-scan-worker";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-codex-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

function coverageRange(kind: "full" | "head" | "tail") {
  return {
    kind,
    startLine: null,
    endLine: null,
    startByte: null,
    endByte: null,
  };
}

function codexResult(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    verdict: "benign",
    confidence: "high",
    summary: "The artifact is coherent and proportionate.",
    dimensions: {
      purpose_capability: { status: "ok", detail: "Purpose and capabilities align." },
      instruction_scope: { status: "ok", detail: "Instructions are scoped." },
      install_mechanism: { status: "ok", detail: "No unusual install behavior." },
      environment_proportionality: { status: "ok", detail: "Credentials are proportionate." },
      persistence_privilege: { status: "ok", detail: "No persistence concern." },
    },
    scan_findings_in_context: [],
    user_guidance: "Looks coherent.",
    artifact_coverage: {
      status: "complete",
      inspected_files: [
        {
          path: "SKILL.md",
          coverage: "full",
          ranges: [coverageRange("full")],
          reason: "Primary instructions were fully read.",
        },
        {
          path: "src/large.ts",
          coverage: "head_tail",
          ranges: [coverageRange("head"), coverageRange("tail")],
          reason: "Large source file was sampled at both ends.",
        },
      ],
    },
    ...overrides,
  });
}

const coverageJob = {
  job: {
    _id: "job123",
    hasMaliciousSignal: false,
    leaseToken: "lease-secret",
    source: "publish",
    targetKind: "skillVersion" as const,
    waitForVtUntil: 0,
  },
  target: {
    files: [
      {
        path: "SKILL.md",
        sha256: "abc123",
        size: 42,
        url: "https://signed.example.invalid/skill",
      },
      {
        path: "src/large.ts",
        sha256: "def456",
        size: 70_000,
        url: "https://signed.example.invalid/large",
      },
    ],
  },
};

describe("run-codex-scan-worker diagnostics", () => {
  it("blocks direct local Codex security worker runs without opt-in", () => {
    expect(isCodexWorkerExecutionAllowed({})).toBe(false);
    expect(() => assertCodexWorkerExecutionAllowed({})).toThrow(
      `Refusing to run local Codex workers without ${LOCAL_CODEX_WORKER_OPT_IN}=1`,
    );
  });

  it("does not treat a bare GITHUB_ACTIONS flag as CI authorization", () => {
    expect(isCodexWorkerExecutionAllowed({ GITHUB_ACTIONS: "true" })).toBe(false);
    expect(() => assertCodexWorkerExecutionAllowed({ GITHUB_ACTIONS: "true" })).toThrow(
      `Refusing to run local Codex workers without ${LOCAL_CODEX_WORKER_OPT_IN}=1`,
    );
  });

  it("allows direct Codex security worker runs in GitHub Actions", () => {
    const env = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "openclaw/clawhub",
      GITHUB_RUN_ID: "123",
    };

    expect(isCodexWorkerExecutionAllowed(env)).toBe(true);
    expect(() => assertCodexWorkerExecutionAllowed(env)).not.toThrow();
  });

  it("allows direct local Codex security worker runs with explicit opt-in", () => {
    expect(isCodexWorkerExecutionAllowed({ [LOCAL_CODEX_WORKER_OPT_IN]: "1" })).toBe(true);
    expect(() =>
      assertCodexWorkerExecutionAllowed({ [LOCAL_CODEX_WORKER_OPT_IN]: "1" }),
    ).not.toThrow();
  });

  it("uses an isolated local Codex home for opted-in local workers by default", () => {
    expect(
      resolveCodexWorkerHome(
        { [LOCAL_CODEX_WORKER_OPT_IN]: "1" },
        "/repo/.codex/runtime/codex-workers/security-scan",
      ),
    ).toBe("/repo/.codex/runtime/codex-workers/security-scan");
    expect(
      resolveCodexWorkerHome(
        { [LOCAL_CODEX_WORKER_OPT_IN]: "1", CODEX_HOME: "/tmp/custom-codex-home" },
        "/repo/.codex/runtime/codex-workers/security-scan",
      ),
    ).toBe("/tmp/custom-codex-home");
  });

  it("frames workspace inspection as discretionary Codex research", () => {
    const prompt = buildPrompt(
      {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {},
      },
      [],
    );

    expect(prompt).toContain("Do your own security research");
    expect(prompt).toContain("Inspect workspace files when needed");
    expect(prompt).toContain("A benign verdict requires complete artifact coverage proof");
    expect(prompt).toContain("Submitted artifact files that must be covered");
    expect(prompt).toContain("artifact_coverage");
    expect(prompt).toContain("set unused line or byte coordinates to null");
    expect(prompt).toContain("SkillSpector findings are advisory research-preview evidence");
    expect(prompt).toContain("not validated ground truth");
    expect(prompt).toContain("artifact-backed evidence");
    expect(prompt).toContain("totality of evidence");
    expect(prompt).not.toContain("incomplete_artifact_inspection");
    expect(prompt).not.toContain("Return the required JSON object only after those reads complete");
  });

  it("requires artifact coverage proof in the output schema", async () => {
    const raw = await readFile("scripts/security/codex-scan-output.schema.json", "utf8");
    const schema = JSON.parse(raw) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(schema.required).toContain("artifact_coverage");
    expect(schema.properties).toHaveProperty("artifact_coverage");
    expect(schema.required).not.toContain("incomplete_artifact_inspection");
    expect(schema.properties).not.toHaveProperty("incomplete_artifact_inspection");
  });

  it("keeps artifact coverage ranges compatible with Codex structured outputs", async () => {
    const raw = await readFile("scripts/security/codex-scan-output.schema.json", "utf8");
    const schema = JSON.parse(raw);
    const rangeSchema =
      schema.properties.artifact_coverage.properties.inspected_files.items.properties.ranges.items;

    expect(rangeSchema.required).toEqual(Object.keys(rangeSchema.properties));
    expect(rangeSchema.properties.startLine.type).toContain("null");
    expect(rangeSchema.properties.endLine.type).toContain("null");
    expect(rangeSchema.properties.startByte.type).toContain("null");
    expect(rangeSchema.properties.endByte.type).toContain("null");
  });

  it("accepts benign Codex results only when submitted files have coverage proof", () => {
    expect(() =>
      assertCodexArtifactCoverageForVerdict(codexResult(), coverageJob, "benign"),
    ).not.toThrow();
  });

  it("rejects benign Codex results that omit artifact coverage", () => {
    const raw = codexResult({ artifact_coverage: undefined });

    expect(() => assertCodexArtifactCoverageForVerdict(raw, coverageJob, "benign")).toThrow(
      "artifact_coverage missing",
    );
  });

  it("rejects benign Codex results when large files lack tail coverage", () => {
    const raw = codexResult({
      artifact_coverage: {
        status: "complete",
        inspected_files: [
          {
            path: "SKILL.md",
            coverage: "full",
            ranges: [coverageRange("full")],
            reason: "Primary instructions were fully read.",
          },
          {
            path: "src/large.ts",
            coverage: "partial",
            ranges: [coverageRange("head")],
            reason: "Only the beginning was read.",
          },
        ],
      },
    });

    expect(() => assertCodexArtifactCoverageForVerdict(raw, coverageJob, "benign")).toThrow(
      "src/large.ts: large file lacks full or head/tail coverage",
    );
  });

  it("rejects benign Codex results when the coverage summary overstates ranges", () => {
    const inspectedFiles = JSON.parse(codexResult()).artifact_coverage.inspected_files.map(
      (file: { path: string }) =>
        file.path === "src/large.ts"
          ? {
              ...file,
              coverage: "head_tail",
              ranges: [coverageRange("head")],
            }
          : file,
    );
    const raw = codexResult({
      artifact_coverage: {
        status: "complete",
        inspected_files: inspectedFiles,
      },
    });

    expect(() => assertCodexArtifactCoverageForVerdict(raw, coverageJob, "benign")).toThrow(
      "src/large.ts: large file lacks full or head/tail coverage",
    );
  });

  it.each([
    {
      path: "SKILL.md",
      coverage: "metadata_only",
      ranges: [coverageRange("full")],
    },
    {
      path: "src/large.ts",
      coverage: "not_inspected",
      ranges: [coverageRange("head"), coverageRange("tail")],
    },
  ])("rejects benign Codex results with contradictory $coverage coverage", (contradiction) => {
    const inspectedFiles = JSON.parse(codexResult()).artifact_coverage.inspected_files.map(
      (file: { path: string }) =>
        file.path === contradiction.path ? { ...file, ...contradiction } : file,
    );
    const raw = codexResult({
      artifact_coverage: {
        status: "complete",
        inspected_files: inspectedFiles,
      },
    });

    expect(() => assertCodexArtifactCoverageForVerdict(raw, coverageJob, "benign")).toThrow(
      `${contradiction.path}: coverage is ${contradiction.coverage}`,
    );
  });

  it("passes SkillSpector findings to Codex without asking for OWASP finding output", () => {
    const prompt = buildPrompt(
      {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          version: {
            skillSpectorAnalysis: {
              status: "suspicious",
              score: 55,
              recommendation: "DO_NOT_INSTALL",
              issueCount: 1,
              checkedAt: 123,
              issues: [
                {
                  issueId: "SDI-1",
                  severity: "HIGH",
                  confidence: 0.98,
                  file: "SKILL.md",
                  startLine: 3,
                  endLine: 6,
                  explanation:
                    "The manifest advertises a generic benchmark while the skill body executes shell commands.",
                  remediation: "Make the manifest and skill body describe the same behavior.",
                },
              ],
            },
          },
        },
      },
      [],
    );

    expect(prompt).toContain("SkillSpector findings supplied to Codex");
    expect(prompt).toContain("SDI-1");
    expect(prompt).toContain("DO_NOT_INSTALL");
    expect(prompt).not.toContain("agentic_risk_findings");
    expect(prompt).not.toContain("OWASP");
  });

  it("normalizes real SkillSpector JSON risk assessment fields", () => {
    const analysis = normalizeSkillSpectorAnalysis(
      JSON.stringify({
        risk_assessment: {
          score: 55,
          severity: "HIGH",
          recommendation: "DO_NOT_INSTALL",
        },
        metadata: {
          skillspector_version: "2.0.0",
        },
        issues: [
          {
            id: "SDI-1",
            pattern: "Description-Behavior Mismatch",
            severity: "HIGH",
            confidence: 0.97,
            location: {
              file: "SKILL.md",
              start_line: 3,
              end_line: 4,
            },
            explanation: "The manifest description does not match the skill behavior.",
            remediation: "Make the manifest and skill body describe the same behavior.",
            code_snippet: "description: Harmless local demo",
          },
        ],
      }),
      123,
    );

    expect(analysis).toMatchObject({
      checkedAt: 123,
      issueCount: 1,
      recommendation: "DO_NOT_INSTALL",
      scannerVersion: "2.0.0",
      score: 55,
      severity: "HIGH",
      status: "suspicious",
    });
    expect(analysis.issues[0]).toMatchObject({
      issueId: "SDI-1",
      file: "SKILL.md",
      startLine: 3,
      endLine: 4,
      codeSnippet: "description: Harmless local demo",
    });
  });

  it("caps stored SkillSpector issues while preserving the full issue count", () => {
    const longSnippet = "sensitive artifact text ".repeat(200);
    const analysis = normalizeSkillSpectorAnalysis(
      JSON.stringify({
        issues: Array.from({ length: 30 }, (_, index) => ({
          id: `SDI-${index + 1}`,
          severity: "HIGH",
          confidence: 0.97,
          explanation: `Issue ${index + 1}: ${longSnippet}`,
          finding: longSnippet,
          code_snippet: longSnippet,
        })),
      }),
      123,
    );

    expect(analysis.issueCount).toBe(30);
    expect(analysis.issues).toHaveLength(25);
    expect(analysis.issues[0]?.codeSnippet).toContain("...[truncated ");
    expect(analysis.issues[0]?.codeSnippet?.length).toBeLessThan(longSnippet.length);
  });

  it("scans the extracted package root for ClawPack artifacts", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact", "package"), { recursive: true });
    await writeFile(join(workspace, "artifact.tgz"), "packed artifact");
    await writeFile(join(workspace, "artifact", "package", "package.json"), "{}");
    await writeFile(join(workspace, "artifact", "package.json"), "{}");

    await expect(resolveSkillSpectorScanInput(workspace)).resolves.toBe("artifact/package");
  });

  it("scans the artifact root when there is no ClawPack extraction", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });
    await writeFile(join(workspace, "artifact", "SKILL.md"), "# Skill");

    await expect(resolveSkillSpectorScanInput(workspace)).resolves.toBe("artifact");
  });

  it("writes scanner metadata without lease tokens or signed file URLs", async () => {
    const workspace = await tempDir();

    await writeArtifactWorkspace(
      {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: "SKILL.md",
              sha256: "abc123",
              size: 42,
              url: "data:text/plain,%23%20Skill",
            },
          ],
          job: {
            leaseToken: "nested-lease-secret",
          },
        },
      },
      workspace,
    );

    const metadataText = await readFile(join(workspace, "metadata.json"), "utf8");
    expect(metadataText).not.toContain("lease-secret");
    expect(metadataText).not.toContain("nested-lease-secret");
    expect(metadataText).not.toContain("data:text/plain");

    const metadata = JSON.parse(metadataText);
    expect(metadata.job).toMatchObject({
      _id: "job123",
      source: "publish",
      targetKind: "skillVersion",
    });
    expect(metadata.target.files).toEqual([{ path: "SKILL.md", sha256: "abc123", size: 42 }]);
  });

  it("writes redacted Codex diagnostics without copying submitted artifact files or signed URLs", async () => {
    const diagnosticsRoot = await tempDir();
    const artifactWorkspace = await tempDir();
    await mkdir(join(artifactWorkspace, "artifact"), { recursive: true });

    await writeJobDiagnostic({
      codex: {
        args: ["exec", "--sandbox", "read-only"],
        exitCode: 0,
        rawResult:
          '{"verdict":"benign","scan_findings_in_context":[{"ruleId":"x","expected_for_purpose":true,"note":"quoted artifact payload should not persist"}]}',
        stderr: "workspace read failed https://signed.example.invalid/file?token=secret",
        stdout:
          '{"type":"error","message":"Codex CLI provider returned HTTP 429 for https://signed.example.invalid/file?token=secret with api_key=sk-short-secret"}\n{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I could not inspect the artifact because the provider returned a transient error."}}\n{"type":"tool_call","status":"failed","api_key":"sk-short-secret","output":"read https://signed.example.invalid/file?token=secret","content":["quoted array artifact payload should not persist"]}\n',
      },
      skillSpector: {
        args: ["scan", "artifact", "--format", "json"],
        exitCode: 0,
        rawResult:
          '{"issues":[{"id":"SDI-1","code_snippet":"quoted SkillSpector artifact payload should not persist","finding":"matched SkillSpector artifact payload should not persist","explanation":"safe to redact"}]}',
      },
      completedAt: 2000,
      diagnosticsRoot,
      error:
        "Codex result did not match ClawScan schema: quoted artifact payload should not persist https://signed.example.invalid/file?token=secret",
      job: {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: "SKILL.md",
              sha256: "abc123",
              size: 42,
              url: "https://signed.example.invalid/file?token=secret",
            },
          ],
        },
      },
      llmAnalysis: { confidence: "low", status: "clean", verdict: "benign" },
      skillSpectorAnalysis: {
        status: "suspicious",
        issueCount: 1,
        checkedAt: 123,
        issues: [
          {
            issueId: "SDI-1",
            severity: "HIGH",
            explanation: "safe to redact",
            finding: "matched SkillSpector artifact payload should not persist",
            codeSnippet: "quoted SkillSpector artifact payload should not persist",
          },
        ],
      },
      runId: "26127771775",
      startedAt: 1000,
      status: "failed",
    });

    const jobDir = join(diagnosticsRoot, "job123");
    const stdoutText = await readFile(join(jobDir, "codex.stdout.redacted.jsonl"), "utf8");
    expect(stdoutText).toContain('"tool_call"');
    expect(stdoutText).toContain("Codex CLI provider returned HTTP 429");
    expect(stdoutText).toContain(
      "I could not inspect the artifact because the provider returned a transient error.",
    );
    expect(stdoutText).not.toContain("token=secret");
    expect(stdoutText).not.toContain("signed.example.invalid");
    expect(stdoutText).not.toContain("sk-short-secret");
    expect(stdoutText).not.toContain("quoted array artifact payload");
    expect(stdoutText).toContain('"api_key":"[redacted-secret]"');
    expect(stdoutText).toContain('"content":"[redacted 1 item(s)]"');
    await expect(readFile(join(jobDir, "codex.stderr.redacted.log"), "utf8")).resolves.toContain(
      "workspace read failed",
    );
    const stderrText = await readFile(join(jobDir, "codex.stderr.redacted.log"), "utf8");
    expect(stderrText).not.toContain("token=secret");
    const resultText = await readFile(join(jobDir, "codex-result.redacted.json"), "utf8");
    expect(resultText).toContain('"verdict"');
    expect(resultText).toContain('"note": "[redacted');
    expect(resultText).not.toContain("quoted artifact payload");
    const skillSpectorResultText = await readFile(
      join(jobDir, "skillspector-result.redacted.json"),
      "utf8",
    );
    expect(skillSpectorResultText).toContain('"code_snippet": "[redacted');
    expect(skillSpectorResultText).toContain('"finding": "[redacted');
    expect(skillSpectorResultText).not.toContain("SkillSpector artifact payload");

    const diagnostic = JSON.parse(await readFile(join(jobDir, "diagnostic.json"), "utf8"));
    expect(diagnostic).toMatchObject({
      job: {
        id: "job123",
        source: "publish",
        targetKind: "skillVersion",
      },
      llmAnalysis: {
        confidence: "low",
        status: "clean",
        verdict: "benign",
      },
      runId: "26127771775",
      status: "failed",
    });
    expect(diagnostic.job.leaseToken).toBeUndefined();
    expect(diagnostic.error).toBe(
      "Codex result did not match ClawScan schema: [redacted result body]",
    );
    expect(diagnostic.target.files).toEqual([{ path: "SKILL.md", sha256: "abc123", size: 42 }]);

    const diagnosticText = await readFile(join(jobDir, "diagnostic.json"), "utf8");
    expect(diagnosticText).not.toContain("lease-secret");
    expect(diagnosticText).not.toContain("token=secret");
    expect(diagnosticText).not.toContain("quoted artifact payload");
    expect(diagnosticText).not.toContain("SkillSpector artifact payload");
    expect(await readdir(jobDir)).not.toContain("artifact");
  });
});
