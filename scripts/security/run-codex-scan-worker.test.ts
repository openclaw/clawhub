/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCodexWorkerExecutionAllowed,
  isCodexWorkerExecutionAllowed,
  LOCAL_CODEX_WORKER_OPT_IN,
  resolveCodexWorkerHome,
} from "../codex-worker-guard";
import * as codexScanWorker from "./run-codex-scan-worker";
import {
  buildPrompt,
  normalizeSkillSpectorAnalysis,
  processJob,
  resolveSkillSpectorScanInput,
  writeArtifactWorkspace,
  writeJobDiagnostic,
} from "./run-codex-scan-worker";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-codex-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

async function readAllFilesText(dir: string) {
  const texts: string[] = [];
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        texts.push(await readFile(path, "utf8"));
      }
    }
  }
  await visit(dir);
  return texts.join("\n");
}

function unsafeFixtureLabels() {
  return {
    label: ["API", "key"].join(" "),
    pathSegment: ["unsafe", "label"].join("-"),
    runtimeValue: "sk-short-fixture",
    workerValue: "worker-token-fixture",
  };
}

describe("run-codex-scan-worker diagnostics", () => {
  it("keeps successful claims when a parallel claim request fails", async () => {
    const claimCodexScanJobBatch = (
      codexScanWorker as typeof codexScanWorker & {
        claimCodexScanJobBatch?: (
          claimLimit: number,
          claimOne: () => Promise<
            Array<{
              job: {
                _id: string;
                leaseToken: string;
                targetKind: "skillVersion";
                source: string;
                hasMaliciousSignal: boolean;
                waitForVtUntil: number;
              };
              target: Record<string, unknown>;
            }>
          >,
        ) => Promise<{ claimFailures: number; jobs: Array<{ job: { _id: string } }> }>;
      }
    ).claimCodexScanJobBatch;
    expect(claimCodexScanJobBatch).toBeTypeOf("function");
    if (!claimCodexScanJobBatch) return;

    const claimOne = vi
      .fn()
      .mockResolvedValueOnce([
        {
          job: {
            _id: "securityScanJobs:1",
            leaseToken: "lease",
            targetKind: "skillVersion",
            source: "publish",
            hasMaliciousSignal: false,
            waitForVtUntil: 0,
          },
          target: {},
        },
      ])
      .mockRejectedValueOnce(
        new Error(
          "temporary claim failure https://signed.example.invalid/file?token=claim-secret OPENAI_API_KEY=claim-process-secret",
        ),
      )
      .mockResolvedValueOnce([]);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(claimCodexScanJobBatch(3, claimOne)).resolves.toMatchObject({
      claimFailures: 1,
      jobs: [{ job: { _id: "securityScanJobs:1" } }],
    });
    expect(claimOne).toHaveBeenCalledTimes(3);
    const logged = stdoutWrite.mock.calls.map((call) => String(call[0])).join("");
    expect(logged).toContain("security_scan_claim_failed");
    expect(logged).toContain("temporary claim failure");
    expect(logged).not.toContain("https://signed.example.invalid");
    expect(logged).not.toContain("claim-secret");
    expect(logged).not.toContain("claim-process-secret");
    stdoutWrite.mockRestore();
  });

  it("counts total claim failures even when no jobs are claimed", async () => {
    const claimCodexScanJobBatch = (
      codexScanWorker as typeof codexScanWorker & {
        claimCodexScanJobBatch?: (
          claimLimit: number,
          claimOne: () => Promise<never[]>,
        ) => Promise<{ claimFailures: number; jobs: Array<{ job: { _id: string } }> }>;
      }
    ).claimCodexScanJobBatch;
    expect(claimCodexScanJobBatch).toBeTypeOf("function");
    if (!claimCodexScanJobBatch) return;

    const claimOne = vi.fn().mockRejectedValue(new Error("claim outage"));
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(claimCodexScanJobBatch(2, claimOne)).resolves.toMatchObject({
      claimFailures: 2,
      jobs: [],
    });
    expect(claimOne).toHaveBeenCalledTimes(2);
    const logged = stdoutWrite.mock.calls.map((call) => String(call[0])).join("");
    expect(logged).toContain("security_scan_claim_failed");
    expect(logged).toContain("claim outage");
    stdoutWrite.mockRestore();
  });

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
    expect(prompt).toContain("SkillSpector findings are advisory research-preview evidence");
    expect(prompt).toContain("not validated ground truth");
    expect(prompt).toContain("artifact-backed evidence");
    expect(prompt).toContain("totality of evidence");
    expect(prompt).not.toContain("incomplete_artifact_inspection");
    expect(prompt).not.toContain("Return the required JSON object only after those reads complete");
  });

  it("does not expose incomplete artifact inspection as an output-schema field", async () => {
    const raw = await readFile("scripts/security/codex-scan-output.schema.json", "utf8");
    const schema = JSON.parse(raw) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(schema.required).not.toContain("incomplete_artifact_inspection");
    expect(schema.properties).not.toHaveProperty("incomplete_artifact_inspection");
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

  it("omits signed artifact URLs from download failure errors", async () => {
    const unsafeLabels = unsafeFixtureLabels();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const workspace = await tempDir();

    await expect(
      writeArtifactWorkspace(
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
                url: "https://signed.example.invalid/file?token=secret&X-Amz-Signature=abc123",
              },
            ],
          },
        },
        workspace,
      ),
    ).rejects.toThrow("Download failed 403 for artifact file SKILL.md");

    const error = await writeArtifactWorkspace(
      {
        job: {
          _id: "job124",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: "package.json",
              sha256: "def456",
              size: 54,
              url: "https://signed.example.invalid/package?Authorization=Bearer-secret",
            },
          ],
        },
      },
      await tempDir(),
    ).catch((caught: unknown) => caught);

    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain("https://");
    expect(message).not.toContain("signed.example.invalid");
    expect(message).not.toContain("token=secret");
    expect(message).not.toContain("X-Amz-Signature");
    expect(message).not.toContain("Authorization");

    const unsafePath =
      `unsafe/token=${unsafeLabels.workerValue}-api_key=${unsafeLabels.pathSegment}-` +
      `X-Amz-Signature=${"a".repeat(32)}.md`;
    const unsafePathError = await writeArtifactWorkspace(
      {
        job: {
          _id: "job124b",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: unsafePath,
              sha256: "unsafe-label-fixture",
              size: 61,
              url: "https://signed.example.invalid/package?token=secret",
            },
          ],
        },
      },
      await tempDir(),
    ).catch((caught: unknown) => caught);
    const unsafePathMessage =
      unsafePathError instanceof Error ? unsafePathError.message : String(unsafePathError);
    expect(unsafePathMessage).toContain("Download failed 403 for artifact file");
    expect(unsafePathMessage).not.toContain(unsafeLabels.workerValue);
    expect(unsafePathMessage).not.toContain(`api_key=${unsafeLabels.pathSegment}`);
    expect(unsafePathMessage).not.toContain(unsafeLabels.pathSegment);
    expect(unsafePathMessage).not.toContain("X-Amz-Signature");

    fetchMock.mockRejectedValueOnce(
      new Error(
        `fetch failed https://signed.example.invalid/file?token=secret Authorization: Bearer abc ` +
          `OPENAI_API_KEY=${unsafeLabels.runtimeValue} ` +
          `${unsafeLabels.label}: ${unsafeLabels.pathSegment} ` +
          `X-Amz-Signature=${"b".repeat(32)}`,
      ),
    );
    const networkError = await writeArtifactWorkspace(
      {
        job: {
          _id: "job125",
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
              sha256: "ghi789",
              size: 60,
              url: "https://signed.example.invalid/file?token=secret",
            },
          ],
        },
      },
      await tempDir(),
    ).catch((caught: unknown) => caught);
    const networkMessage =
      networkError instanceof Error ? networkError.message : String(networkError);
    expect(networkError).toBeInstanceOf(Error);
    if (!(networkError instanceof Error)) throw new Error("Expected network error");
    const networkCause = networkError.cause;
    expect(networkCause).toBeInstanceOf(Error);
    const networkCauseMessage =
      networkCause instanceof Error ? networkCause.message : String(networkCause);
    expect(networkMessage).toContain("Download failed for artifact file SKILL.md");
    expect(networkMessage).not.toContain("https://");
    expect(networkMessage).not.toContain("signed.example.invalid");
    expect(networkMessage).not.toContain("token=secret");
    expect(networkMessage).not.toContain("Authorization");
    expect(networkMessage).not.toContain("Bearer abc");
    expect(networkMessage).not.toContain(" abc");
    expect(networkMessage).not.toContain("OPENAI_API_KEY");
    expect(networkMessage).not.toContain(`${unsafeLabels.label}: ${unsafeLabels.pathSegment}`);
    expect(networkMessage).not.toContain(unsafeLabels.pathSegment);
    expect(networkMessage).not.toContain(unsafeLabels.runtimeValue);
    expect(networkMessage).not.toContain("X-Amz-Signature");
    expect(networkCauseMessage).not.toContain("https://");
    expect(networkCauseMessage).not.toContain("signed.example.invalid");
    expect(networkCauseMessage).not.toContain("token=secret");
    expect(networkCauseMessage).not.toContain("Authorization");
    expect(networkCauseMessage).not.toContain(`${unsafeLabels.label}: ${unsafeLabels.pathSegment}`);
    expect(networkCauseMessage).not.toContain(unsafeLabels.pathSegment);

    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const clawpackError = await writeArtifactWorkspace(
      {
        job: {
          _id: "job126",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "packageRelease",
          waitForVtUntil: 0,
        },
        target: {
          clawpackUrl:
            "https://signed.example.invalid/package.tgz?token=secret&X-Amz-Signature=abc123",
        },
      },
      await tempDir(),
    ).catch((caught: unknown) => caught);
    const clawpackMessage =
      clawpackError instanceof Error ? clawpackError.message : String(clawpackError);
    expect(clawpackMessage).toContain("Download failed 403 for artifact tarball artifact.tgz");
    expect(clawpackMessage).not.toContain("https://");
    expect(clawpackMessage).not.toContain("signed.example.invalid");
    expect(clawpackMessage).not.toContain("token=secret");
    expect(clawpackMessage).not.toContain("X-Amz-Signature");
    fetchMock.mockRestore();
  });

  it("sanitizes download failures before logging or failing the Convex job", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const previousGitHubActions = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "true";
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const client = {
      action: vi.fn(async (..._args: unknown[]) => ({ retry: false })),
    };

    await expect(
      processJob(
        client,
        "worker-token",
        {
          job: {
            _id: "securityScanJobs:download-failed",
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
                url: "https://signed.example.invalid/file?token=secret&X-Amz-Signature=abc123",
              },
            ],
          },
        },
        undefined,
      ),
    ).resolves.toBe(false);

    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        error: "Download failed 403 for artifact file SKILL.md",
      }),
    );
    const logged = stdoutWrite.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain(
      "::add-mask::https://signed.example.invalid/file?token=secret&X-Amz-Signature=abc123",
    );
    expect(logged).toContain("security_scan_job_failed");
    expect(logged).toContain("Download failed 403 for artifact file SKILL.md");
    const laterLogs = logged
      .split("\n")
      .filter((line) => !line.startsWith("::add-mask::"))
      .join("\n");
    expect(laterLogs).not.toContain("https://");
    expect(laterLogs).not.toContain("signed.example.invalid");
    expect(laterLogs).not.toContain("token=secret");
    expect(laterLogs).not.toContain("X-Amz-Signature");

    stdoutWrite.mockRestore();
    if (previousGitHubActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previousGitHubActions;
    fetchMock.mockRestore();
  });

  it("sanitizes key-value secrets from non-download failures before logging or failing", async () => {
    const previousGitHubActions = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "true";
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const client = {
      action: vi.fn(async (..._args: unknown[]) => ({ retry: false })),
    };

    await expect(
      processJob(
        client,
        "worker-token",
        {
          job: {
            _id: "securityScanJobs:path-failed",
            hasMaliciousSignal: false,
            leaseToken: "lease-secret",
            source: "publish",
            targetKind: "skillVersion",
            waitForVtUntil: 0,
          },
          target: {
            files: [
              {
                path:
                  "../OPENAI_API_KEY=scan-process-secret " +
                  "CONVEX_DEPLOY_KEY=convex-process-secret.md",
                sha256: "abc123",
                size: 42,
                url: "data:text/plain,%23%20Skill",
              },
            ],
          },
        },
        undefined,
      ),
    ).resolves.toBe(false);

    const failArgs = client.action.mock.calls[0]?.[1] as { error?: unknown } | undefined;
    const error = String(failArgs?.error);
    expect(error).toBe("Unsafe artifact path: [redacted-path]");
    expect(error).not.toContain("scan-process-secret");
    expect(error).not.toContain("convex-process-secret");
    const logged = stdoutWrite.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("security_scan_job_failed");
    expect(logged).toContain("Unsafe artifact path: [redacted-path]");
    expect(logged).not.toContain("scan-process-secret");
    expect(logged).not.toContain("convex-process-secret");

    stdoutWrite.mockRestore();
    if (previousGitHubActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previousGitHubActions;
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
          '{"type":"error","message":"Codex CLI provider returned HTTP 429 for https://signed.example.invalid/file?token=secret with api_key=sk-short-fixture"}\n{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I could not inspect the artifact because the provider returned a transient error."}}\n{"type":"tool_call","status":"failed","source":"artifact controlled source string","api_key":"sk-short-fixture","output":"read https://signed.example.invalid/file?token=secret","content":["quoted array artifact payload should not persist"],"code-snippet":["hyphenated artifact payload should not persist"],"raw_result":["snake artifact payload should not persist"],"userImpact":["camel artifact payload should not persist"],"token":123456,"headers":{"authorization":["Bearer numeric-secret"]}}\n',
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
              path: "artifacts/token=artifact-path-secret.md",
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
    expect(stdoutText).not.toContain("Codex CLI provider returned HTTP 429");
    expect(stdoutText).not.toContain(
      "I could not inspect the artifact because the provider returned a transient error.",
    );
    expect(stdoutText).not.toContain("token=secret");
    expect(stdoutText).not.toContain("signed.example.invalid");
    expect(stdoutText).not.toContain("sk-short-fixture");
    expect(stdoutText).not.toContain("123456");
    expect(stdoutText).not.toContain("numeric-secret");
    expect(stdoutText).not.toContain("quoted array artifact payload");
    expect(stdoutText).not.toContain("hyphenated artifact payload");
    expect(stdoutText).not.toContain("snake artifact payload");
    expect(stdoutText).not.toContain("camel artifact payload");
    expect(stdoutText).toContain('"api_key":"[redacted-secret]"');
    expect(stdoutText).toContain('"token":"[redacted-secret]"');
    expect(stdoutText).toContain('"authorization":"[redacted-secret]"');
    expect(stdoutText).toContain('"source":"[redacted ');
    expect(stdoutText).not.toContain("artifact controlled source");
    expect(stdoutText).toContain('"content":"[redacted 1 item(s)]"');
    expect(stdoutText).toContain('"code-snippet":"[redacted 1 item(s)]"');
    expect(stdoutText).toContain('"raw_result":"[redacted 1 item(s)]"');
    expect(stdoutText).toContain('"userImpact":"[redacted 1 item(s)]"');
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
    expect(diagnostic.target.files).toEqual([
      { path: "[redacted-path]", sha256: "abc123", size: 42 },
    ]);

    const diagnosticText = await readFile(join(jobDir, "diagnostic.json"), "utf8");
    expect(diagnosticText).not.toContain("lease-secret");
    expect(diagnosticText).not.toContain("artifact-path-secret");
    expect(diagnosticText).not.toContain("token=secret");
    expect(diagnosticText).not.toContain("quoted artifact payload");
    expect(diagnosticText).not.toContain("SkillSpector artifact payload");
    const allDiagnosticText = await readAllFilesText(jobDir);
    expect(allDiagnosticText).not.toContain("lease-secret");
    expect(allDiagnosticText).not.toContain("token=secret");
    expect(allDiagnosticText).not.toContain("signed.example.invalid");
    expect(allDiagnosticText).not.toContain("sk-short-fixture");
    expect(allDiagnosticText).not.toContain("quoted artifact payload");
    expect(allDiagnosticText).not.toContain("SkillSpector artifact payload");
    expect(await readdir(jobDir)).not.toContain("artifact");
  });
});
