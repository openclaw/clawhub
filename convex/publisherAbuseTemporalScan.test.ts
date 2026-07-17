/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
  type SkillTemporalAbuseScore,
} from "./lib/publisherAbuseScoring";
import type { TemporalSkillCandidate } from "./publisherAbuse";
import {
  advanceScheduledTemporalCandidatesInternalHandler,
  percentileIndex,
  pruneExpiredTemporalScanRowsInternalHandler,
  runScheduledTemporalPublisherAbuseScanInternalHandler,
  storeScheduledTemporalScanPageInternalHandler,
  temporalBenchmarkFromRun,
  valueAtGlobalIndex,
} from "./publisherAbuseTemporalScan";

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
