/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { assertModerator, requireUserFromAction } from "./lib/access";
import {
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
  type SkillTemporalAbuseScore,
} from "./lib/publisherAbuseScoring";
import type { TemporalSkillCandidate } from "./publisherAbuse";
import {
  advanceScheduledTemporalCandidatesInternalHandler,
  getOrStartScheduledTemporalScanInternalHandler,
  markScheduledTemporalScanFailedInternalHandler,
  percentileIndex,
  pruneExpiredTemporalScanRowsInternalHandler,
  runScheduledTemporalPublisherAbuseScanInternalHandler,
  startPublisherAbuseSignalScanHandler,
  storeScheduledTemporalScanPageInternalHandler,
  temporalBenchmarkFromRun,
  valueAtGlobalIndex,
} from "./publisherAbuseTemporalScan";

vi.mock("./lib/access", () => ({
  assertModerator: vi.fn(),
  requireUserFromAction: vi.fn(),
}));

function temporalScore(overrides: Partial<SkillTemporalAbuseScore> = {}): SkillTemporalAbuseScore {
  return {
    spike: false,
    sustained: false,
    nearConversion: false,
    pressure: 0,
    recent7Downloads: 100,
    recent7Installs: 0,
    previous30Downloads: 100,
    baseline7Downloads: 100,
    spikeMultiplier: 1,
    recent30Downloads: 100,
    recent30Installs: 0,
    downloadInstallRatio30: 100,
    installDownloadRatio7: 0,
    installDownloadRatio30: 0,
    installDownloadExcessZScore7: 0,
    installDownloadExcessZScore30: 0,
    reasonCodes: [],
    ...overrides,
  };
}

function temporalCandidate(
  skillId: Id<"skills">,
  score: SkillTemporalAbuseScore = temporalScore(),
): TemporalSkillCandidate {
  return {
    ownerKey: "publisher:publishers:anysearch",
    ownerPublisherId: "publishers:anysearch" as Id<"publishers">,
    ownerUserId: "users:anysearch" as Id<"users">,
    handleSnapshot: "anysearch",
    skillId,
    slug: "anysearch",
    displayName: "AnySearch",
    totalDownloads: 10_000,
    totalInstalls: 4,
    temporalScore: score,
  };
}

function temporalRun(
  overrides: Partial<Doc<"publisherAbuseScoreRuns">> = {},
): Doc<"publisherAbuseScoreRuns"> {
  const now = Date.now();
  return {
    _id: "publisherAbuseScoreRuns:scheduled" as Id<"publisherAbuseScoreRuns">,
    _creationTime: 1,
    modelVersion: PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
    modelConfig: DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
    trigger: "cron",
    status: "running",
    phase: "collecting",
    startedAt: now,
    updatedAt: now,
    scannedPublishers: 0,
    scoredPublishers: 0,
    finalizedScores: 0,
    nominatedPublishers: 0,
    passCount: 0,
    reviewCount: 0,
    potentialBanCandidateCount: 0,
    sumLogPressure: 0,
    sumSquaredLogPressure: 0,
    temporalPipelineKind: "signals",
    temporalMode: "current",
    temporalScanComplete: false,
    temporalPipelinePhase: "collecting",
    temporalTodayDay: 100,
    temporalSampleSize: 0,
    temporalDownloadsSum: 0,
    temporalDownloadsProcessed: 0,
    temporalSpikeProcessed: 0,
    ...overrides,
  };
}

describe("scheduled temporal publisher abuse scan", () => {
  it("starts every signal check as a moderator-audited manual scan", async () => {
    const runId = "publisherAbuseScoreRuns:manual-signals" as Id<"publisherAbuseScoreRuns">;
    const actorUserId = "users:moderator" as Id<"users">;
    vi.mocked(requireUserFromAction).mockResolvedValue({
      userId: actorUserId,
      user: { _id: actorUserId, role: "moderator" },
    } as never);
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ runId, resumed: false })
      .mockResolvedValueOnce({ applied: true });
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(temporalRun({ _id: runId, trigger: "manual", actorUserId }))
      .mockResolvedValueOnce({
        benchmarkScores: [],
        candidates: [],
        cursor: "next-page",
        isDone: false,
        scannedSkills: 0,
      });
    const scheduler = { runAfter: vi.fn(async () => null) };

    await expect(
      startPublisherAbuseSignalScanHandler({
        runMutation,
        runQuery,
        scheduler,
      } as unknown as ActionCtx),
    ).resolves.toEqual({
      ok: true,
      runId,
      completed: false,
      phase: "collecting",
    });

    expect(assertModerator).toHaveBeenCalledWith(
      expect.objectContaining({ _id: actorUserId, role: "moderator" }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      trigger: "manual",
      actorUserId,
    });
  });

  it("does not start signal checks for non-moderators", async () => {
    const actorUserId = "users:viewer" as Id<"users">;
    vi.mocked(requireUserFromAction).mockResolvedValue({
      userId: actorUserId,
      user: { _id: actorUserId, role: "user" },
    } as never);
    vi.mocked(assertModerator).mockImplementationOnce(() => {
      throw new Error("Forbidden");
    });
    const runMutation = vi.fn();

    await expect(
      startPublisherAbuseSignalScanHandler({ runMutation } as unknown as ActionCtx),
    ).rejects.toThrow("Forbidden");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("records the moderator on a new manual signal scan", async () => {
    const actorUserId = "users:moderator" as Id<"users">;
    const runId = "publisherAbuseScoreRuns:manual-signals" as Id<"publisherAbuseScoreRuns">;
    const constraints: Record<string, unknown> = {};
    const q = {
      eq(field: string, value: unknown) {
        constraints[field] = value;
        return q;
      },
    };
    const insert = vi.fn(async () => runId);
    let queryCount = 0;
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn((indexName: string, build: (builder: typeof q) => unknown) => {
            queryCount += 1;
            if (queryCount === 1) {
              expect(indexName).toBe("by_temporal_pipeline_kind_and_status_and_updated_at");
              build(q);
            } else {
              expect(indexName).toBe("by_model_version_and_status_and_trigger_and_updated_at");
            }
            return {
              order: vi.fn(() => ({ first: vi.fn(async () => null) })),
            };
          }),
        })),
        insert,
      },
    };

    await expect(
      getOrStartScheduledTemporalScanInternalHandler(ctx as unknown as MutationCtx, {
        trigger: "manual",
        actorUserId,
      }),
    ).resolves.toEqual({ runId, resumed: false });

    expect(constraints).toEqual({
      temporalPipelineKind: "signals",
      status: "running",
    });
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns",
      expect.objectContaining({
        trigger: "manual",
        actorUserId,
        temporalPipelineKind: "signals",
      }),
    );
  });

  it("does not take over an active cron scan when a moderator requests a rescan", async () => {
    const actorUserId = "users:moderator" as Id<"users">;
    const existing = temporalRun({ trigger: "cron", actorUserId: undefined });
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ first: vi.fn(async () => existing) })),
          })),
        })),
        patch,
      },
    };

    await expect(
      getOrStartScheduledTemporalScanInternalHandler(ctx as unknown as MutationCtx, {
        trigger: "manual",
        actorUserId,
      }),
    ).resolves.toEqual({ runId: existing._id, resumed: true });

    expect(patch).not.toHaveBeenCalled();
  });

  it("does not launch a second worker for an already-running signal scan", async () => {
    const existing = temporalRun({ trigger: "cron" });
    const runMutation = vi.fn(async () => ({ runId: existing._id, resumed: true }));
    const runQuery = vi.fn(async () => existing);
    const scheduler = { runAfter: vi.fn(async () => null) };

    await expect(
      runScheduledTemporalPublisherAbuseScanInternalHandler(
        { runMutation, runQuery, scheduler } as unknown as ActionCtx,
        { trigger: "manual", actorUserId: "users:moderator" as Id<"users"> },
      ),
    ).resolves.toEqual({
      ok: true,
      runId: existing._id,
      completed: false,
      phase: "collecting",
      alreadyRunning: true,
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("reports an active scan that failed before the rescan state check", async () => {
    const failed = temporalRun({
      status: "failed",
      errorMessage: "source page failed",
    });
    const runMutation = vi.fn().mockResolvedValueOnce({ runId: failed._id, resumed: true });
    const runQuery = vi.fn(async () => failed);
    const scheduler = { runAfter: vi.fn(async () => null) };

    await expect(
      runScheduledTemporalPublisherAbuseScanInternalHandler(
        { runMutation, runQuery, scheduler } as unknown as ActionCtx,
        { trigger: "manual", actorUserId: "users:moderator" as Id<"users"> },
      ),
    ).rejects.toThrow("source page failed");

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not fail an active scan when its read-only state check errors", async () => {
    const existing = temporalRun();
    const runMutation = vi.fn(async () => ({ runId: existing._id, resumed: true }));
    const runQuery = vi.fn(async () => {
      throw new Error("transient state read failure");
    });

    await expect(
      runScheduledTemporalPublisherAbuseScanInternalHandler(
        {
          runMutation,
          runQuery,
          scheduler: { runAfter: vi.fn(async () => null) },
        } as unknown as ActionCtx,
        { trigger: "manual", actorUserId: "users:moderator" as Id<"users"> },
      ),
    ).rejects.toThrow("transient state read failure");

    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("uses nearest-rank percentile indexes across bounded pages", () => {
    expect(percentileIndex(100, 0.5)).toBe(49);
    expect(percentileIndex(100, 0.95)).toBe(94);
    expect(percentileIndex(100, 0.99)).toBe(98);
    expect(
      valueAtGlobalIndex({ values: [90, 91, 92, 93, 94], pageStart: 90, targetIndex: 94 }),
    ).toBe(94);
    expect(
      valueAtGlobalIndex({ values: [90, 91, 92, 93, 94], pageStart: 90, targetIndex: 89 }),
    ).toBeUndefined();
  });

  it("builds the exact platform benchmark from persisted rank values", () => {
    expect(
      temporalBenchmarkFromRun(
        temporalRun({
          temporalSampleSize: 100,
          temporalDownloadsSum: 18_000,
          temporalDownloadsMedian: 45,
          temporalDownloadsP95: 900,
          temporalDownloadsP99: 3_000,
          temporalSpikeP95: 4,
          temporalSpikeP99: 12,
        }),
      ),
    ).toEqual({
      scope: "all_active_skills",
      sampleSize: 100,
      downloads30dAverage: 180,
      downloads30dMedian: 45,
      downloads30dP95: 900,
      downloads30dP99: 3_000,
      spikeMultiplier7dP95: 4,
      spikeMultiplier7dP99: 12,
    });
  });

  it("persists one bounded source page and advances its durable cursor", async () => {
    const run = temporalRun();
    const insert = vi.fn(async () => "inserted");
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => run),
        insert,
        patch,
      },
    };
    const candidate = temporalCandidate("skills:anysearch" as Id<"skills">);

    await expect(
      storeScheduledTemporalScanPageInternalHandler(ctx as unknown as MutationCtx, {
        runId: run._id,
        expectedCursor: undefined,
        nextCursor: "next-page",
        isDone: false,
        benchmarkScores: [
          { recent30Downloads: 0, spikeMultiplier: 0 },
          { recent30Downloads: 100, spikeMultiplier: 1 },
        ],
        candidates: [candidate],
      }),
    ).resolves.toEqual({ applied: true });

    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseTemporalScanSamples",
      expect.objectContaining({ runId: run._id, recent30Downloads: 0 }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseTemporalScanCandidates",
      expect.objectContaining({ runId: run._id, skillId: candidate.skillId }),
    );
    expect(patch).toHaveBeenCalledWith(
      run._id,
      expect.objectContaining({
        temporalSourceCursor: "next-page",
        temporalSampleSize: 2,
        temporalDownloadsSum: 100,
        temporalPipelinePhase: "collecting",
      }),
    );
  });

  it("keeps source pages below the dense daily-stat read budget", async () => {
    const run = temporalRun();
    const runQuery = vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce({
      benchmarkScores: [],
      candidates: [],
      cursor: "next-page",
      isDone: false,
      scannedSkills: 0,
    });
    const runMutation = vi.fn(async () => ({ applied: true }));
    const scheduler = { runAfter: vi.fn(async () => null) };
    const handler = runScheduledTemporalPublisherAbuseScanInternalHandler as unknown as (
      ctx: {
        runQuery: typeof runQuery;
        runMutation: typeof runMutation;
        scheduler: typeof scheduler;
      },
      args: { runId?: Id<"publisherAbuseScoreRuns"> },
    ) => Promise<unknown>;

    await handler({ runQuery, runMutation, scheduler }, { runId: run._id });

    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ batchSize: 50 }),
    );
  });

  it("passes only percentile inputs to the persisted benchmark sample validator", async () => {
    const run = temporalRun();
    const fullScore = temporalScore({ recent30Downloads: 3_000, spikeMultiplier: 4 });
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({
        benchmarkScores: [fullScore],
        candidates: [],
        cursor: "next-page",
        isDone: false,
        scannedSkills: 1,
      });
    const runMutation = vi.fn(async (_target: unknown, _args: unknown) => ({ applied: true }));
    const scheduler = { runAfter: vi.fn(async () => null) };
    const handler = runScheduledTemporalPublisherAbuseScanInternalHandler as unknown as (
      ctx: {
        runQuery: typeof runQuery;
        runMutation: typeof runMutation;
        scheduler: typeof scheduler;
      },
      args: { runId?: Id<"publisherAbuseScoreRuns"> },
    ) => Promise<unknown>;

    await handler({ runQuery, runMutation, scheduler }, { runId: run._id });

    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      runId: run._id,
      expectedCursor: undefined,
      nextCursor: "next-page",
      isDone: false,
      benchmarkScores: [{ recent30Downloads: 3_000, spikeMultiplier: 4 }],
      candidates: [],
    });
  });

  it("marks a scheduled scan failed when a scan step throws", async () => {
    const run = temporalRun();
    const scanError = new Error("invalid benchmark payload");
    const runQuery = vi.fn().mockResolvedValueOnce(run).mockRejectedValueOnce(scanError);
    const runMutation = vi.fn(async (_target: unknown, _args: unknown) => ({ failed: true }));
    const scheduler = { runAfter: vi.fn(async () => null) };
    const handler = runScheduledTemporalPublisherAbuseScanInternalHandler as unknown as (
      ctx: {
        runQuery: typeof runQuery;
        runMutation: typeof runMutation;
        scheduler: typeof scheduler;
      },
      args: { runId?: Id<"publisherAbuseScoreRuns"> },
    ) => Promise<unknown>;

    await expect(handler({ runQuery, runMutation, scheduler }, { runId: run._id })).rejects.toThrow(
      "invalid benchmark payload",
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      runId: run._id,
      errorMessage: "invalid benchmark payload",
    });
  });

  it("persists a failed terminal state for an active scheduled scan", async () => {
    const run = temporalRun();
    const patch = vi.fn(async () => null);
    const ctx = { db: { get: vi.fn(async () => run), patch } };

    await expect(
      markScheduledTemporalScanFailedInternalHandler(ctx as unknown as MutationCtx, {
        runId: run._id,
        errorMessage: "invalid benchmark payload",
      }),
    ).resolves.toEqual({ failed: true });

    expect(patch).toHaveBeenCalledWith(
      run._id,
      expect.objectContaining({
        status: "failed",
        temporalScanComplete: false,
        errorMessage: "invalid benchmark payload",
      }),
    );
  });

  it("archives classified candidates with the completed full-platform benchmark", async () => {
    const benchmark = {
      scope: "all_active_skills" as const,
      sampleSize: 1_000,
      downloads30dAverage: 180,
      downloads30dMedian: 45,
      downloads30dP95: 900,
      downloads30dP99: 3_000,
      spikeMultiplier7dP95: 4,
      spikeMultiplier7dP99: 12,
    };
    const run = temporalRun({
      phase: "finalizing",
      temporalPipelinePhase: "classifying",
      temporalBenchmark: benchmark,
    });
    const candidate = temporalCandidate(
      "skills:anysearch" as Id<"skills">,
      temporalScore({ recent30Downloads: 3_370, recent30Installs: 4 }),
    );
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ candidates: [candidate], cursor: undefined, isDone: true });
    const runMutation = vi.fn(async () => ({ applied: true }));
    const scheduler = { runAfter: vi.fn(async () => null) };
    const handler = runScheduledTemporalPublisherAbuseScanInternalHandler as unknown as (
      ctx: {
        runQuery: typeof runQuery;
        runMutation: typeof runMutation;
        scheduler: typeof scheduler;
      },
      args: { runId?: Id<"publisherAbuseScoreRuns"> },
    ) => Promise<unknown>;

    await expect(
      handler({ runQuery, runMutation, scheduler }, { runId: run._id }),
    ).resolves.toEqual({
      ok: true,
      runId: run._id,
      completed: true,
    });

    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        runId: run._id,
        candidates: [
          expect.objectContaining({
            skillId: candidate.skillId,
            temporalScore: expect.objectContaining({
              sustained: true,
              downloads30dCohortBand: "p99",
            }),
          }),
        ],
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("does not archive or revive a scan that has already failed", async () => {
    const run = temporalRun({
      status: "failed",
      phase: "finalizing",
      temporalPipelinePhase: "classifying",
      temporalBenchmark: {
        scope: "all_active_skills",
        sampleSize: 100,
        downloads30dAverage: 10,
        downloads30dMedian: 5,
        downloads30dP95: 20,
        downloads30dP99: 30,
        spikeMultiplier7dP95: 2,
        spikeMultiplier7dP99: 3,
      },
    });
    const ctx = {
      db: {
        get: vi.fn(async () => run),
        query: vi.fn(() => {
          throw new Error("failed scans must not archive signals");
        }),
        insert: vi.fn(async () => {
          throw new Error("failed scans must not archive signals");
        }),
        patch: vi.fn(async () => {
          throw new Error("failed scans must not be revived");
        }),
      },
    };

    await expect(
      advanceScheduledTemporalCandidatesInternalHandler(ctx as unknown as MutationCtx, {
        runId: run._id,
        expectedCursor: undefined,
        nextCursor: undefined,
        isDone: true,
        candidates: [temporalCandidate("skills:anysearch" as Id<"skills">)],
      }),
    ).resolves.toEqual({ applied: false });
  });

  it("deletes expired working rows in bounded retention batches", async () => {
    const expiredSample = {
      _id: "publisherAbuseTemporalScanSamples:expired" as Id<"publisherAbuseTemporalScanSamples">,
    };
    const expiredCandidate = {
      _id: "publisherAbuseTemporalScanCandidates:expired" as Id<"publisherAbuseTemporalScanCandidates">,
    };
    const take = vi
      .fn()
      .mockResolvedValueOnce([expiredSample])
      .mockResolvedValueOnce([expiredCandidate]);
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take })),
        })),
        delete: vi.fn(async () => null),
      },
      scheduler,
    };

    await expect(
      pruneExpiredTemporalScanRowsInternalHandler(ctx as unknown as MutationCtx, { batchSize: 2 }),
    ).resolves.toEqual({ samplesDeleted: 1, candidatesDeleted: 1, hasMore: false });
    expect(ctx.db.delete).toHaveBeenCalledTimes(2);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });
});
