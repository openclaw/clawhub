/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCodexWorkerExecutionAllowed,
  isCodexWorkerExecutionAllowed,
  LOCAL_CODEX_WORKER_OPT_IN,
  resolveCodexWorkerHome,
} from "../codex-worker-guard";
import {
  normalizeSkillSpectorAnalysis,
  publishWorkerHealthSummary,
  processJob,
  runContinuouslyRefilledWorkerPool,
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

function unsafeFixtureLabels() {
  return {
    label: ["API", "key"].join(" "),
    pathSegment: ["unsafe", "label"].join("-"),
    runtimeValue: "sk-short-fixture",
    workerValue: "worker-token-fixture",
  };
}

describe("run-codex-scan-worker diagnostics", () => {
  it("publishes the worker report to the Actions summary and diagnostics artifact", async () => {
    const diagnosticsRoot = await tempDir();
    const stepSummaryPath = join(await tempDir(), "step-summary.md");
    await writeFile(stepSummaryPath, "");
    const previousStepSummary = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = stepSummaryPath;
    try {
      await publishWorkerHealthSummary(diagnosticsRoot, {
        clawscan: {
          averageDurationMs: 30_000,
          completed: 1,
          failed: 0,
          judgeStageFailures: 0,
          scannerStageFailures: 0,
          timedOut: 0,
          unclassifiedFailures: 0,
          verdicts: {
            benign: 1,
            malicious: 0,
            suspicious: 0,
            unknown: 0,
          },
        },
        claimFailures: 0,
        durationMs: 30_000,
        queueHealth: {
          snapshotAt: 1,
          queueDepth: 2,
          queueDepthIsEstimate: false,
          readyQueueDepth: 1,
          readyQueueDepthIsEstimate: false,
          oldestReadyJobAgeSeconds: 60,
          oldestReadyJobNextRunAt: 0,
        },
        throughputPerMinute: 2,
        totalClaimed: 1,
        workerId: "fixture-worker",
      });
    } finally {
      if (previousStepSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previousStepSummary;
    }

    const markdown = await readFile(stepSummaryPath, "utf8");
    expect(markdown).toContain("## Security scan worker health");
    expect(markdown).toContain("| Completed | 1 |");
    const artifact = JSON.parse(
      await readFile(join(diagnosticsRoot, "worker-summary.json"), "utf8"),
    );
    expect(artifact).toMatchObject({
      clawscan: { completed: 1 },
      workerId: "fixture-worker",
      queueHealth: { queueDepth: 2 },
    });
  });

  it("refills a free slot without waiting for the slowest active job", async () => {
    const started: string[] = [];
    let releaseSlowJob: (() => void) | undefined;
    const slowJob = new Promise<void>((resolve) => {
      releaseSlowJob = resolve;
    });
    const jobs = ["slow", "fast", "next"];
    const claimJobs = vi.fn(async (limit: number) => {
      const claimedJobs = jobs.splice(0, limit).map((id) => ({ id }));
      return { claimedCount: claimedJobs.length, jobs: claimedJobs };
    });
    const processClaimedJob = vi.fn(async (job: { id: string }) => {
      started.push(job.id);
      if (job.id === "slow") await slowJob;
      return {
        completed: true,
        hardFailed: false,
        retryableFailed: false,
      };
    });

    const run = runContinuouslyRefilledWorkerPool({
      concurrency: 2,
      maxJobs: undefined,
      canClaim: () => true,
      claimJobs,
      processClaimedJob,
    });

    while (!started.includes("next")) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["slow", "fast", "next"]);
    expect(releaseSlowJob).toBeTypeOf("function");
    releaseSlowJob?.();

    await expect(run).resolves.toMatchObject({
      totalClaimed: 3,
      totalCompleted: 3,
      totalClaimFailures: 0,
    });
    expect(claimJobs.mock.calls.map(([limit]) => limit)).toEqual([2, 1, 1]);
  });

  it("keeps refilling after a full lease batch has no hydratable jobs", async () => {
    const claimJobs = vi
      .fn()
      .mockResolvedValueOnce({ claimedCount: 2, jobs: [] })
      .mockResolvedValueOnce({
        claimedCount: 2,
        jobs: [{ id: "next-1" }, { id: "next-2" }],
      })
      .mockResolvedValue({ claimedCount: 0, jobs: [] });
    const processClaimedJob = vi.fn(async () => ({
      completed: true,
      hardFailed: false,
      retryableFailed: false,
    }));

    await expect(
      runContinuouslyRefilledWorkerPool({
        concurrency: 2,
        maxJobs: undefined,
        canClaim: () => true,
        claimJobs,
        processClaimedJob,
      }),
    ).resolves.toMatchObject({
      totalClaimed: 4,
      totalCompleted: 2,
      totalClaimFailures: 0,
    });
    expect(claimJobs.mock.calls.map(([limit]) => limit)).toEqual([2, 2, 1]);
    expect(processClaimedJob).toHaveBeenCalledTimes(2);
  });

  it("counts one failed batch lease request without multiplying it by slot count", async () => {
    const claimJobs = vi.fn(async () => {
      throw new Error("claim outage");
    });

    await expect(
      runContinuouslyRefilledWorkerPool({
        concurrency: 4,
        maxJobs: undefined,
        canClaim: () => true,
        claimJobs,
        processClaimedJob: vi.fn(),
      }),
    ).resolves.toMatchObject({
      totalClaimed: 0,
      totalClaimFailures: 1,
      totalFailed: 1,
    });
    expect(claimJobs).toHaveBeenCalledTimes(1);
  });

  it("keeps the priority lane alive after processing a partial batch", async () => {
    let canClaim = true;
    const sleep = vi.fn(async () => {
      canClaim = false;
    });

    await expect(
      runContinuouslyRefilledWorkerPool({
        concurrency: 4,
        maxJobs: undefined,
        canClaim: () => canClaim,
        claimJobs: vi.fn(async () => ({
          claimedCount: 1,
          jobs: [{ id: "publish" }],
        })),
        processClaimedJob: vi.fn(async () => ({
          completed: true,
          hardFailed: false,
          retryableFailed: false,
        })),
        idlePollMs: 15_000,
        sleep,
      }),
    ).resolves.toMatchObject({
      totalClaimed: 1,
      totalCompleted: 1,
    });
    expect(sleep).toHaveBeenCalledWith(15_000);
  });

  it("exits a priority worker after reaching its explicit max-jobs cap", async () => {
    const sleep = vi.fn();

    await expect(
      runContinuouslyRefilledWorkerPool({
        concurrency: 4,
        maxJobs: 1,
        canClaim: () => true,
        claimJobs: vi.fn(async () => ({
          claimedCount: 1,
          jobs: [{ id: "publish" }],
        })),
        processClaimedJob: vi.fn(async () => ({
          completed: true,
          hardFailed: false,
          retryableFailed: false,
        })),
        idlePollMs: 15_000,
        sleep,
      }),
    ).resolves.toMatchObject({
      totalClaimed: 1,
      totalCompleted: 1,
    });
    expect(sleep).not.toHaveBeenCalled();
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
              sha256: "e2151f8490121dc5e6fd36c1d4e00b6da5593595e3eb8ece76c1d0ec3f310979",
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
    expect(metadata.target.files).toEqual([
      {
        path: "SKILL.md",
        sha256: "e2151f8490121dc5e6fd36c1d4e00b6da5593595e3eb8ece76c1d0ec3f310979",
        size: 42,
      },
    ]);
  });

  it("rejects downloaded bytes that do not match the stored file hash", async () => {
    const workspace = await tempDir();
    await expect(
      writeArtifactWorkspace(
        {
          job: {
            _id: "catalog-job",
            hasMaliciousSignal: false,
            leaseToken: "test-auth-token",
            source: "skills-sh-catalog-test",
            targetKind: "skillScanRequest",
            waitForVtUntil: 0,
          },
          target: {
            files: [
              {
                path: "SKILL.md",
                sha256: "0".repeat(64),
                size: 7,
                url: "data:text/plain,%23%20Skill",
              },
            ],
          },
        },
        workspace,
      ),
    ).rejects.toThrow("Downloaded artifact hash mismatch for artifact file SKILL.md");
  });

  it("materializes zero-byte directory markers with descendant files", async () => {
    const workspace = await tempDir();

    await writeArtifactWorkspace(
      {
        job: {
          _id: "job-directory-marker",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "pre-publication",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: "scripts",
              sha256: "empty",
              size: 0,
              url: "data:application/octet-stream,",
            },
            {
              path: "scripts/run.sh",
              sha256: "script",
              size: 18,
              url: "data:text/plain,echo%20ready%0A",
            },
            {
              path: "EMPTY",
              sha256: "empty",
              size: 0,
              url: "data:application/octet-stream,",
            },
          ],
        },
      },
      workspace,
    );

    expect(await readFile(join(workspace, "artifact", "scripts", "run.sh"), "utf8")).toBe(
      "echo ready\n",
    );
    expect(await readFile(join(workspace, "artifact", "EMPTY"))).toHaveLength(0);
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
    ).resolves.toEqual({
      completed: false,
      hardFailed: true,
      retryableFailed: false,
    });

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
      action: vi.fn(async (..._args: unknown[]) => ({ retry: true })),
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
    ).resolves.toEqual({
      completed: false,
      hardFailed: false,
      retryableFailed: true,
    });

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

  it("retains full ClawScan artifact and scanner outputs with secret-safe redaction", async () => {
    const diagnosticsRoot = await tempDir();
    const workspace = await tempDir();
    const scannerOutputRoot = join(workspace, "clawscan-artifact", "scanner-results");
    await mkdir(scannerOutputRoot, { recursive: true });

    const artifactLongText = `ARTIFACT-BEGIN-${"a".repeat(25_050)}-ARTIFACT-END`;
    const scannerLongText = `SCANNER-BEGIN-${"b".repeat(25_050)}-SCANNER-END`;
    const artifactPath = join(workspace, "clawscan-artifact.json");

    const skillspectorOutputPath = join(scannerOutputRoot, "skillspector.json");
    const virustotalOutputPath = join(scannerOutputRoot, "virustotal.log");
    await writeFile(
      skillspectorOutputPath,
      `${JSON.stringify(
        {
          api_key: "example",
          evidence: scannerLongText,
          signedUrl: "https://signed.example.invalid/skillspector?token=placeholder",
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      virustotalOutputPath,
      `Authorization: Bearer placeholder\n${scannerLongText}\nhttps://signed.example.invalid/virustotal?token=placeholder\n`,
    );

    const clawscanArtifact = {
      schemaVersion: "clawscan-run-v1",
      profile: "clawhub",
      scanners: {
        skillspector: {
          status: "completed",
          outputPath: "clawscan-artifact/scanner-results/skillspector.json",
          raw: {
            details: artifactLongText,
          },
        },
        virustotal: {
          status: "completed",
          outputPath: "clawscan-artifact/scanner-results/virustotal.log",
          raw: {
            summary: "https://signed.example.invalid/vt?token=placeholder",
          },
        },
        "clawscan-static": {
          status: "completed",
          raw: { status: "clean" },
        },
      },
      judge: {
        status: "completed",
        result: {
          verdict: "benign",
          confidence: "high",
          summary: artifactLongText,
          dimensions: {
            purpose_capability: {
              status: "ok",
              detail: "ok",
            },
          },
          scan_findings_in_context: [],
          user_guidance: "guidance",
          metadata: {
            api_key: "example",
          },
        },
      },
    };
    await writeFile(artifactPath, `${JSON.stringify(clawscanArtifact)}\n`);

    await writeJobDiagnostic({
      clawscan: {
        args: ["clawscan", "./artifact", "--profile", "clawhub"],
        artifactPath,
        exitCode: 0,
        rawArtifact: JSON.stringify(clawscanArtifact),
      },
      completedAt: 2000,
      diagnosticsRoot,
      job: {
        job: {
          _id: "job-clawscan-evidence",
          hasMaliciousSignal: false,
          leaseToken: "placeholder",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {},
      },
      startedAt: 1000,
      status: "completed",
    });

    await rm(workspace, { recursive: true, force: true });

    const jobDir = join(diagnosticsRoot, "job-clawscan-evidence");
    const artifactText = await readFile(join(jobDir, "clawscan-artifact.redacted.json"), "utf8");
    const artifactJson = JSON.parse(artifactText) as {
      judge?: {
        result?: {
          metadata?: {
            api_key?: string;
          };
          summary?: string;
        };
      };
      scanners?: {
        skillspector?: {
          raw?: {
            details?: string;
          };
        };
        virustotal?: {
          raw?: {
            summary?: string;
          };
        };
      };
    };
    expect(artifactText).toContain("ARTIFACT-END");
    expect(artifactText).not.toContain("...[truncated ");
    expect(artifactText).toContain(artifactLongText);
    expect(artifactJson.judge?.result?.metadata?.api_key).toBe("[redacted-secret]");
    expect(artifactText).not.toContain('"api_key":"example"');
    expect(String(artifactJson.scanners?.virustotal?.raw?.summary)).toContain("[redacted-url]");
    expect(artifactText).not.toContain("signed.example.invalid");
    expect(artifactJson.scanners?.skillspector?.raw?.details).toContain(artifactLongText);

    const skillspectorCopiedPath = join(
      jobDir,
      "clawscan-scanner-outputs",
      "clawscan-artifact",
      "scanner-results",
      "skillspector.json",
    );
    const virustotalCopiedPath = join(
      jobDir,
      "clawscan-scanner-outputs",
      "clawscan-artifact",
      "scanner-results",
      "virustotal.log",
    );
    const skillspectorCopiedText = await readFile(skillspectorCopiedPath, "utf8");
    const skillspectorCopiedJson = JSON.parse(skillspectorCopiedText) as {
      api_key?: string;
      evidence?: string;
      signedUrl?: string;
    };
    const virustotalCopiedText = await readFile(virustotalCopiedPath, "utf8");
    expect(skillspectorCopiedJson.evidence).toContain("SCANNER-END");
    expect(skillspectorCopiedJson.evidence).toContain(scannerLongText);
    expect(skillspectorCopiedText).not.toContain('"api_key":"example"');
    expect(skillspectorCopiedJson.api_key).toBe("[redacted-secret]");
    expect(String(skillspectorCopiedJson.signedUrl)).toContain("[redacted-url]");
    expect(skillspectorCopiedText).not.toContain("signed.example.invalid");
    expect(skillspectorCopiedText).not.toContain("...[truncated ");
    expect(virustotalCopiedText).toContain("SCANNER-END");
    expect(virustotalCopiedText).toContain(scannerLongText);
    expect(virustotalCopiedText).not.toContain("Bearer placeholder");
    expect(virustotalCopiedText).toContain("[redacted-secret]");
    expect(virustotalCopiedText).toContain("[redacted-url]");
    expect(virustotalCopiedText).not.toContain("signed.example.invalid");

    const diagnostic = JSON.parse(await readFile(join(jobDir, "diagnostic.json"), "utf8"));
    expect(diagnostic.clawscanResult.scannerOutputFiles).toEqual([
      {
        diagnosticPath:
          "clawscan-scanner-outputs/clawscan-artifact/scanner-results/skillspector.json",
        outputPath: "clawscan-artifact/scanner-results/skillspector.json",
        scanner: "skillspector",
        status: "copied",
      },
      {
        diagnosticPath: "clawscan-scanner-outputs/clawscan-artifact/scanner-results/virustotal.log",
        outputPath: "clawscan-artifact/scanner-results/virustotal.log",
        scanner: "virustotal",
        status: "copied",
      },
    ]);
  });
});
