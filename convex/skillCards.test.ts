import { describe, expect, it, vi } from "vitest";
import { hashSkillFiles } from "./lib/skills";
import {
  attachCardAndSucceedJobInternal,
  claimSkillCardJobs,
  enqueueForVersionInternal,
  failJobInternal,
} from "./skillCards";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const enqueueHandler = (
  enqueueForVersionInternal as unknown as WrappedHandler<
    { versionId: string; source: "scan"; priority?: number; requireMissingCard?: boolean },
    { ok: true; skipped?: string; jobId?: string; alreadyQueued?: boolean }
  >
)._handler;

const attachHandler = (
  attachCardAndSucceedJobInternal as unknown as WrappedHandler<
    {
      jobId: string;
      leaseToken: string;
      cardFile: {
        path: string;
        size: number;
        storageId: string;
        sha256: string;
        contentType?: string;
      };
      runId?: string;
    },
    { ok: true; bundleFingerprint: string }
  >
)._handler;

const failHandler = (
  failJobInternal as unknown as WrappedHandler<
    { jobId: string; leaseToken: string; error: string },
    { ok: true; retry: boolean }
  >
)._handler;

const claimHandler = (
  claimSkillCardJobs as unknown as WrappedHandler<
    { token: string; workerId: string; limit?: number; leaseMs?: number },
    Array<{ target: { evidence: Record<string, unknown> } }>
  >
)._handler;

function makeSettledVersion(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skillVersions:1",
    _creationTime: 1,
    skillId: "skills:1",
    version: "1.0.0",
    fingerprint: "source-fingerprint",
    changelog: "init",
    files: [
      {
        path: "SKILL.md",
        size: 12,
        storageId: "_storage:skill",
        sha256: "a".repeat(64),
        contentType: "text/markdown",
      },
    ],
    parsed: { frontmatter: {}, license: "MIT-0" },
    createdBy: "users:1",
    createdAt: 1,
    softDeletedAt: undefined,
    staticScan: {
      status: "clean",
      reasonCodes: [],
      findings: [],
      summary: "clean",
      engineVersion: "test",
      checkedAt: 1,
    },
    llmAnalysis: {
      status: "clean",
      checkedAt: 2,
    },
    ...overrides,
  };
}

function makeQueryWithCollect(items: unknown[]) {
  const collect = vi.fn(async () => items);
  const take = vi.fn(async () => items);
  const order = vi.fn(() => ({ take }));
  const withIndex = vi.fn((_name: string, build: (q: unknown) => unknown) => {
    const q: { eq: ReturnType<typeof vi.fn>; lte: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
      lte: vi.fn(),
    };
    q.eq.mockReturnValue(q);
    q.lte.mockReturnValue(q);
    build(q);
    return { collect, take, order };
  });
  return { withIndex, collect, take, order };
}

function completeDb<T extends Record<string, unknown>>(db: T) {
  return {
    delete: vi.fn(),
    insert: vi.fn(),
    normalizeId: vi.fn(() => null),
    patch: vi.fn(),
    query: vi.fn(() => makeQueryWithCollect([])),
    replace: vi.fn(),
    system: {},
    ...db,
  };
}

describe("skillCards queue", () => {
  it("passes ClawScan rollup evidence instead of raw scanner feeds", async () => {
    const previousToken = process.env.SECURITY_SCAN_WORKER_TOKEN;
    process.env.SECURITY_SCAN_WORKER_TOKEN = "test-worker-token";
    const job = {
      _id: "skillCardGenerationJobs:1",
      skillVersionId: "skillVersions:1",
      leaseToken: "lease",
      status: "running",
    };
    const version = makeSettledVersion({
      llmAnalysis: {
        status: "clean",
        verdict: "benign",
        confidence: "high",
        summary: "ClawScan found no suspicious behavior.",
        guidance: "Review generated files before running them.",
        findings: "No notable findings.",
        agenticRiskFindings: [
          {
            categoryId: "ASI06",
            categoryLabel: "Sensitive data protection",
            riskBucket: "sensitive_data_protection",
            status: "note",
            severity: "low",
            confidence: "medium",
            userImpact: "Logs could capture sensitive local context.",
            recommendation: "Redact secrets before writing learning entries.",
          },
        ],
        riskSummary: {
          abnormal_behavior_control: { status: "none", summary: "No abnormal behavior." },
          permission_boundary: { status: "none", summary: "No boundary concern." },
          sensitive_data_protection: {
            status: "note",
            summary: "Review logs for sensitive data.",
            highestSeverity: "low",
          },
        },
        model: "test-model",
        checkedAt: 2,
      },
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.raw_static"],
        findings: [
          {
            code: "suspicious.raw_static",
            severity: "warn",
            file: "SKILL.md",
            line: 1,
            message: "Raw static finding should not be passed to card evidence.",
            evidence: "raw scanner detail",
          },
        ],
        summary: "raw scanner detail",
        engineVersion: "test",
        checkedAt: 1,
      },
      depRegistryAnalysis: {
        status: "suspicious",
        results: [],
        notFoundPackages: ["leftpad"],
        unresolvedPackages: [],
        summary: "raw dependency detail",
        checkedAt: 3,
      },
      vtAnalysis: {
        status: "suspicious",
        verdict: "suspicious",
        checkedAt: 4,
      },
    });
    const ctx = {
      runMutation: vi.fn(async () => [job]),
      runQuery: vi.fn(async () => ({
        job,
        skill: {
          _id: "skills:1",
          slug: "demo",
          displayName: "Demo",
          summary: "Demo skill",
          capabilityTags: [],
          badges: null,
          ownerUserId: "users:1",
          ownerPublisherId: null,
          moderationVerdict: "clean",
          moderationSummary: "ClawScan found no suspicious behavior.",
          moderationReasonCodes: ["clean.llm_clean"],
          moderationEvidence: [],
          moderationEngineVersion: "test-engine",
          moderationEvaluatedAt: 5,
        },
        version,
        owner: { _id: "users:1", handle: "alice", displayName: "Alice" },
        publisher: null,
      })),
      storage: {
        getUrl: vi.fn(async () => "https://storage.example/SKILL.md"),
      },
    };

    try {
      const result = await claimHandler(ctx, {
        token: "test-worker-token",
        workerId: "worker",
        limit: 1,
      });

      const evidence = result[0]?.target.evidence;
      expect(evidence).not.toHaveProperty("scans");
      expect(evidence).toMatchObject({
        security: {
          source: "clawscan",
          verdict: "clean",
          summary: "ClawScan found no suspicious behavior.",
          guidance: "Review generated files before running them.",
          riskFindings: [
            {
              category: "Sensitive data protection",
              status: "note",
              severity: "low",
              confidence: "medium",
              userImpact: "Logs could capture sensitive local context.",
              recommendation: "Redact secrets before writing learning entries.",
            },
          ],
        },
      });
    } finally {
      if (previousToken === undefined) delete process.env.SECURITY_SCAN_WORKER_TOKEN;
      else process.env.SECURITY_SCAN_WORKER_TOKEN = previousToken;
    }
  });

  it("does not enqueue before static and ClawScan inputs settle", async () => {
    const version = makeSettledVersion({ llmAnalysis: undefined });
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => version),
        insert: vi.fn(),
      }),
    };

    const result = await enqueueHandler(ctx, {
      versionId: "skillVersions:1",
      source: "scan",
    });

    expect(result).toEqual({ ok: true, skipped: "scan-not-settled" });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("enqueues after static and ClawScan inputs settle", async () => {
    const version = makeSettledVersion();
    const insert = vi.fn(async () => "skillCardGenerationJobs:1");
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => version),
        query: vi.fn(() => makeQueryWithCollect([])),
        insert,
        patch: vi.fn(),
      }),
    };

    const result = await enqueueHandler(ctx, {
      versionId: "skillVersions:1",
      source: "scan",
    });

    expect(result).toMatchObject({
      ok: true,
      jobId: "skillCardGenerationJobs:1",
      alreadyQueued: false,
    });
    expect(insert).toHaveBeenCalledWith(
      "skillCardGenerationJobs",
      expect.objectContaining({
        skillVersionId: "skillVersions:1",
        status: "queued",
        source: "scan",
      }),
    );
  });

  it("generation failure is non-blocking and retryable", async () => {
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => ({
          _id: "skillCardGenerationJobs:1",
          leaseToken: "lease",
          attempts: 1,
          nextRunAt: 1,
        })),
        patch,
      }),
    };

    const result = await failHandler(ctx, {
      jobId: "skillCardGenerationJobs:1",
      leaseToken: "lease",
      error: "renderer failed",
    });

    expect(result).toEqual({ ok: true, retry: true });
    expect(patch).toHaveBeenCalledWith(
      "skillCardGenerationJobs:1",
      expect.objectContaining({
        status: "queued",
        lastError: "renderer failed",
      }),
    );
  });
});

describe("skillCards attach", () => {
  it("replaces skill-card.md, preserves source fingerprint, and inserts bundle fingerprint", async () => {
    const version = makeSettledVersion({
      files: [
        {
          path: "SKILL.md",
          size: 12,
          storageId: "_storage:skill",
          sha256: "a".repeat(64),
          contentType: "text/markdown",
        },
        {
          path: "skill-card.md",
          size: 9,
          storageId: "_storage:old-card",
          sha256: "b".repeat(64),
          contentType: "text/markdown",
        },
      ],
    });
    const job = {
      _id: "skillCardGenerationJobs:1",
      skillVersionId: "skillVersions:1",
      leaseToken: "lease",
    };
    const patch = vi.fn(async () => undefined);
    const insert = vi.fn(async () => "skillVersionFingerprints:1");
    const get = vi.fn(async (id: string) => {
      if (id === "skillCardGenerationJobs:1") return job;
      if (id === "skillVersions:1") return version;
      return null;
    });
    const ctx = {
      db: completeDb({
        get,
        patch,
        insert,
        query: vi.fn(() => makeQueryWithCollect([])),
      }),
    };
    const expectedBundleFingerprint = await hashSkillFiles([
      { path: "SKILL.md", sha256: "a".repeat(64) },
      { path: "skill-card.md", sha256: "c".repeat(64) },
    ]);

    const result = await attachHandler(ctx, {
      jobId: "skillCardGenerationJobs:1",
      leaseToken: "lease",
      cardFile: {
        path: "skill-card.md",
        size: 20,
        storageId: "_storage:new-card",
        sha256: "c".repeat(64),
        contentType: "text/markdown",
      },
    });

    expect(result.bundleFingerprint).toBe(expectedBundleFingerprint);
    expect(patch).toHaveBeenCalledWith(
      "skillVersions:1",
      expect.objectContaining({
        files: [
          expect.objectContaining({ path: "SKILL.md", sha256: "a".repeat(64) }),
          expect.objectContaining({ path: "skill-card.md", sha256: "c".repeat(64) }),
        ],
      }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "skillVersions:1",
      expect.objectContaining({ fingerprint: expect.anything() }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillVersionFingerprints",
      expect.objectContaining({
        skillId: "skills:1",
        versionId: "skillVersions:1",
        fingerprint: expectedBundleFingerprint,
        kind: "generated-bundle",
      }),
    );
  });
});
