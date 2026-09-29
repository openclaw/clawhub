import { afterEach, describe, expect, it, vi } from "vitest";
import { hashSkillFiles } from "./lib/skills";
import {
  abandonClaimsInternal,
  attachCardAndSucceedJobInternal,
  claimSkillCardJobs,
  completeSkillCardJob,
  enqueueForVersionInternal,
  failJobInternal,
  prepareJobTargetInternal,
} from "./skillCards";

afterEach(() => vi.unstubAllEnvs());

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const prepareHandler = (
  prepareJobTargetInternal as unknown as WrappedHandler<{
    jobId: string;
    leaseToken: string;
    generationHash?: string;
  }>
)._handler;

const enqueueHandler = (
  enqueueForVersionInternal as unknown as WrappedHandler<
    { versionId: string; source: "scan"; priority?: number; requireMissingCard?: boolean },
    { ok: true; skipped?: string; jobId?: string; alreadyQueued?: boolean }
  >
)._handler;

const abandonHandler = (
  abandonClaimsInternal as unknown as WrappedHandler<
    { jobs: Array<{ jobId: string; leaseToken: string }>; error: string },
    { released: number }
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

const completeHandler = (
  completeSkillCardJob as unknown as WrappedHandler<
    {
      token: string;
      jobId: string;
      leaseToken: string;
      markdown: string;
      runId?: string;
    },
    { ok: true }
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
    get: vi.fn(),
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
      vtAnalysis: {
        status: "suspicious",
        verdict: "suspicious",
        checkedAt: 4,
      },
    });
    const skill = {
      _id: "skills:1",
      slug: "demo",
      displayName: "Demo",
      summary: "Demo skill",
      ownerUserId: "users:1",
      moderationVerdict: "malicious",
      moderationSummary: "Latest version should not leak into this card.",
    };
    const records: Record<string, unknown> = {
      [job._id]: job,
      [version._id]: version,
      "skills:1": skill,
      "users:1": { handle: "alice", displayName: "Alice" },
    };
    const ctx = {
      runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) =>
        "jobIds" in args
          ? { jobs: [job], contended: false }
          : prepareHandler(
              {
                db: completeDb({ get: vi.fn(async (id: string) => records[id] ?? null) }),
              },
              { jobId: job._id, leaseToken: job.leaseToken },
            ),
      ),
      runQuery: vi.fn(async () => ({ jobIds: [job._id], slots: [0], expiredJobIds: [] })),
      storage: { getUrl: vi.fn(async () => "https://storage.example/SKILL.md") },
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

  it("replans only explicitly uncommitted stale admissions", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
    const plan = { jobIds: ["skillCardGenerationJobs:1"], slots: [0], expiredJobIds: [] };
    const ctx = {
      runQuery: vi.fn(async () => plan),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ jobs: [], contended: true })
        .mockResolvedValueOnce({ jobs: [], contended: false }),
    };
    await expect(
      claimHandler(ctx, { token: "test-worker-token", workerId: "worker" }),
    ).resolves.toEqual([]);
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
  });

  it("never replans after a committed lease even when hydration fails", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
    const job = { _id: "skillCardGenerationJobs:1", leaseToken: "committed" };
    const ctx = {
      runQuery: vi.fn(async () => ({ jobIds: [job._id], slots: [0], expiredJobIds: [] })),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ jobs: [job], contended: false })
        .mockRejectedValueOnce(new Error("hydration failed"))
        .mockResolvedValueOnce({ released: 1 }),
    };
    await expect(
      claimHandler(ctx, { token: "test-worker-token", workerId: "worker" }),
    ).rejects.toThrow("hydration failed");
    expect(ctx.runMutation).toHaveBeenCalledTimes(3);
    expect(ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      jobs: [{ jobId: job._id, leaseToken: job.leaseToken }],
      error: "Skill Card input hydration failed",
    });
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it("reports bounded contention instead of a false empty queue", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
    const ctx = {
      runQuery: vi.fn(async () => ({
        jobIds: ["skillCardGenerationJobs:1"],
        slots: [0],
        expiredJobIds: [],
      })),
      runMutation: vi.fn(async () => ({ jobs: [], contended: true })),
    };
    await expect(
      claimHandler(ctx, { token: "test-worker-token", workerId: "worker" }),
    ).rejects.toMatchObject({
      data: { code: "SKILL_CARD_CLAIM_CONTENDED" },
    });
    expect(ctx.runMutation).toHaveBeenCalledTimes(64);
  });

  it("does not retry an ambiguous mutation error", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
    const ctx = {
      runQuery: vi.fn(async () => ({
        jobIds: ["skillCardGenerationJobs:1"],
        slots: [0],
        expiredJobIds: [],
      })),
      runMutation: vi.fn(async () => {
        throw new Error("request failed");
      }),
    };
    await expect(
      claimHandler(ctx, { token: "test-worker-token", workerId: "worker" }),
    ).rejects.toThrow("request failed");
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])(
    "abandons every undelivered lease when lookup %i fails",
    async (failureIndex) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
      const jobs = [0, 1, 2].map((index) => ({
        _id: `skillCardGenerationJobs:${index}`,
        leaseToken: `lease-${index}`,
        skillVersionId: `skillVersions:${index}`,
      }));
      const failure = new Error("lookup failed");
      const ctx = {
        runQuery: vi.fn(async () => ({
          jobIds: jobs.map((job) => job._id),
          slots: [0, 1, 2],
          expiredJobIds: [],
        })),
        runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
          if ("jobs" in args) return { released: 3 };
          if ("jobIds" in args) return { jobs, contended: false };
          const job = jobs.find((entry) => entry._id === args.jobId)!;
          if (job === jobs[failureIndex]) throw failure;
          return {
            skill: { slug: "demo", displayName: "Demo" },
            version: makeSettledVersion(),
            files: makeSettledVersion().files,
            evidence: {},
          };
        }),
        storage: { getUrl: vi.fn(async () => "https://storage.example/SKILL.md") },
      };
      await expect(
        claimHandler(ctx, { token: "test-worker-token", workerId: "worker" }),
      ).rejects.toBe(failure);
      expect(ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
        jobs: jobs.map((job) => ({ jobId: job._id, leaseToken: job.leaseToken })),
        error: "Skill Card input hydration failed",
      });
    },
  );

  it("preserves the hydration failure and reports ambiguous cleanup without its secrets", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
    const primary = new Error("primary lookup failure");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ctx = {
      runQuery: vi.fn().mockResolvedValueOnce({
        jobIds: ["skillCardGenerationJobs:1"],
        slots: [0],
        expiredJobIds: [],
      }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({
          jobs: [{ _id: "skillCardGenerationJobs:1", leaseToken: "private-lease" }],
          contended: false,
        })
        .mockRejectedValueOnce(primary)
        .mockRejectedValueOnce(new Error("https://private.example/?token=cleanup-secret")),
    };
    try {
      await expect(
        claimHandler(ctx, { token: "test-worker-token", workerId: "worker" }),
      ).rejects.toBe(primary);
      expect(log).toHaveBeenCalledWith("skill_card_claim_cleanup_failed", {
        jobIds: ["skillCardGenerationJobs:1"],
        outcome: "cleanup settlement unknown; leases recover through expiry",
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-lease|cleanup-secret|https:/);
    } finally {
      log.mockRestore();
    }
  });

  it("batch cleanup skips settled, missing, and newer owners and preserves retry policy", async () => {
    const rows = new Map<string, Record<string, unknown>>([
      [
        "owned",
        {
          _id: "owned",
          status: "running",
          leaseToken: "lease",
          claimSlot: 1,
          attempts: 1,
          nextRunAt: 0,
        },
      ],
      [
        "exhausted",
        {
          _id: "exhausted",
          status: "running",
          leaseToken: "lease",
          claimSlot: 2,
          attempts: 3,
          nextRunAt: 0,
        },
      ],
      ["settled", { _id: "settled", status: "queued", attempts: 1, nextRunAt: 123 }],
      [
        "new-owner",
        { _id: "new-owner", status: "running", leaseToken: "new", claimSlot: 3, attempts: 2 },
      ],
    ]);
    const patch = vi.fn(async (id: string, fields: Record<string, unknown>) => {
      Object.assign(rows.get(id)!, fields);
    });
    const ctx = {
      db: completeDb({ get: vi.fn(async (id: string) => rows.get(id) ?? null), patch }),
    };
    const before = Date.now();
    const result = await abandonHandler(ctx, {
      jobs: ["owned", "exhausted", "settled", "new-owner", "missing"].map((jobId) => ({
        jobId,
        leaseToken: "lease",
      })),
      error: "Skill Card input hydration failed",
    });
    expect(result).toEqual({ released: 2 });
    expect(rows.get("owned")).toMatchObject({
      status: "queued",
      attempts: 1,
      claimSlot: undefined,
      leaseToken: undefined,
    });
    expect(rows.get("owned")?.nextRunAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(rows.get("exhausted")).toMatchObject({
      status: "failed",
      attempts: 3,
      claimSlot: undefined,
    });
    expect(rows.get("settled")).toMatchObject({ status: "queued", attempts: 1, nextRunAt: 123 });
    expect(rows.get("new-owner")).toMatchObject({
      status: "running",
      leaseToken: "new",
      claimSlot: 3,
      attempts: 2,
    });
    expect(patch).toHaveBeenCalledTimes(2);
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

  it("bounds queued job lookup by version and status", async () => {
    const version = makeSettledVersion();
    const eq = vi.fn(function (this: unknown) {
      return this;
    });
    const collect = vi.fn(async () => []);
    const take = vi.fn(async () => []);
    const withIndex = vi.fn((_name: string, build: (q: { eq: typeof eq }) => unknown) => {
      build({ eq });
      return { collect, take };
    });
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => version),
        query: vi.fn(() => ({ withIndex })),
        insert: vi.fn(async () => "skillCardGenerationJobs:1"),
      }),
    };

    await enqueueHandler(ctx, {
      versionId: "skillVersions:1",
      source: "scan",
    });

    expect(withIndex).toHaveBeenCalledWith("by_skill_version_status", expect.any(Function));
    expect(eq).toHaveBeenCalledWith("skillVersionId", "skillVersions:1");
    expect(eq).toHaveBeenCalledWith("status", "queued");
    expect(take).toHaveBeenCalledWith(1);
  });

  it("queues a follow-up job when evidence changes during a running generation", async () => {
    const version = makeSettledVersion();
    const insert = vi.fn(async () => "skillCardGenerationJobs:2");
    const patch = vi.fn();
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => version),
        query: vi.fn(() => makeQueryWithCollect([])),
        insert,
        patch,
      }),
    };

    const result = await enqueueHandler(ctx, {
      versionId: "skillVersions:1",
      source: "scan",
    });

    expect(result).toMatchObject({
      ok: true,
      jobId: "skillCardGenerationJobs:2",
      alreadyQueued: false,
    });
    expect(patch).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      "skillCardGenerationJobs",
      expect.objectContaining({
        skillVersionId: "skillVersions:1",
        status: "queued",
        source: "scan",
      }),
    );
  });

  it("enqueues when ClawScan stores a final verdict with a generic completed status", async () => {
    const version = makeSettledVersion({
      llmAnalysis: {
        status: "completed",
        verdict: "benign",
        checkedAt: 2,
      },
    });
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
    expect(insert).toHaveBeenCalled();
  });

  it("generation failure is non-blocking and retryable", async () => {
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => ({
          _id: "skillCardGenerationJobs:1",
          leaseToken: "lease",
          status: "running",
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

  it("redacts worker failure details before persistence", async () => {
    const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => undefined);
    const ctx = {
      db: completeDb({
        get: vi.fn(async () => ({
          _id: "skillCardGenerationJobs:1",
          leaseToken: "lease",
          status: "running",
          attempts: 3,
          nextRunAt: 1,
        })),
        patch,
      }),
    };

    const result = await failHandler(ctx, {
      jobId: "skillCardGenerationJobs:1",
      leaseToken: "lease",
      error:
        "Download failed 403: https://signed.example.invalid/file?token=secret " +
        "Authorization: Bearer worker-secret OPENAI_API_KEY=openai-runtime-secret " +
        "path=artifacts/token=artifact-path-secret.json",
    });

    expect(result).toEqual({ ok: true, retry: false });
    expect(patch).toHaveBeenCalledWith(
      "skillCardGenerationJobs:1",
      expect.objectContaining({
        status: "failed",
        lastError: expect.any(String),
      }),
    );
    const patchPayload = patch.mock.calls[0]?.[1] as { lastError?: unknown } | undefined;
    const lastError = String(patchPayload?.lastError);
    expect(lastError).toContain("Download failed 403");
    expect(lastError).not.toContain("https://");
    expect(lastError).not.toContain("signed.example.invalid");
    expect(lastError).not.toContain("token=secret");
    expect(lastError).not.toContain("Authorization");
    expect(lastError).not.toContain("worker-secret");
    expect(lastError).not.toContain("openai-runtime-secret");
    expect(lastError).not.toContain("artifact-path-secret");
    expect(lastError).toContain("OPENAI_API_KEY=[redacted-secret]");
  });
});

describe("skillCards attach", () => {
  it("does not release a stale-input lease when deleting its new blob fails", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "test-worker-token");
    const job = {
      _id: "skillCardGenerationJobs:1",
      skillVersionId: "skillVersions:1",
      status: "running",
      leaseToken: "lease",
      generationHash: "1".repeat(64),
      inputHash: "old-inputs",
    };
    const records: Record<string, unknown> = {
      [job._id]: job,
      "skillVersions:1": makeSettledVersion(),
      "skills:1": { slug: "demo", displayName: "Demo", ownerUserId: "users:1" },
      "users:1": { handle: "publisher" },
    };
    const failure = new Error("storage delete failed");
    const storage = {
      store: vi.fn(async () => "_storage:new-card"),
      delete: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined),
    };
    const db = completeDb({ get: vi.fn(async (id: string) => records[id] ?? null) });
    await expect(
      completeHandler(
        {
          storage,
          runMutation: async (_ref: unknown, args: Parameters<typeof attachHandler>[1]) =>
            attachHandler({ db, storage }, args),
        },
        {
          token: "test-worker-token",
          jobId: job._id,
          leaseToken: "lease",
          markdown: "# Stale card\n",
        },
      ),
    ).rejects.toBe(failure);
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(db.patch).not.toHaveBeenCalled();
    expect(job.status).toBe("running");
    expect(job.leaseToken).toBe("lease");
  });

  it("rejects generated Skill Cards over the public reader size limit", async () => {
    const previousToken = process.env.SECURITY_SCAN_WORKER_TOKEN;
    process.env.SECURITY_SCAN_WORKER_TOKEN = "test-worker-token";
    const markdown = `${"x".repeat(200 * 1024)}x`;
    const store = vi.fn(async () => "_storage:card");
    const runMutation = vi.fn(async () => ({ ok: true }));

    await expect(
      completeHandler(
        {
          storage: { store },
          runMutation,
        },
        {
          token: "test-worker-token",
          jobId: "skillCardGenerationJobs:1",
          leaseToken: "lease",
          markdown,
        },
      ),
    ).rejects.toThrow(/200KB/);

    expect(store).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    process.env.SECURITY_SCAN_WORKER_TOKEN = previousToken;
  });

  it("replaces skill-card.md, preserves source and prior bundle fingerprints, and inserts current bundle fingerprint", async () => {
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
      status: "running",
    };
    const patch = vi.fn(async () => undefined);
    const delete_ = vi.fn(async () => undefined);
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
        delete: delete_,
        query: vi.fn(() =>
          makeQueryWithCollect([
            {
              _id: "skillVersionFingerprints:old-bundle",
              versionId: "skillVersions:1",
              fingerprint: "d".repeat(64),
              kind: "generated-bundle",
            },
          ]),
        ),
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
    expect(delete_).not.toHaveBeenCalled();
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
