import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { toDayKey } from "./lib/leaderboards";
import {
  classifySkillTemporalAbuseScore,
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
  type SkillTemporalAbuseScore,
  type TemporalAbuseCohortBenchmark,
} from "./lib/publisherAbuseScoring";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import {
  archiveTemporalPublisherAbuseSignals,
  type TemporalSkillCandidate,
} from "./publisherAbuse";

// Leave room for up to 37 daily-stat rows plus publisher exclusion reads per skill.
const SOURCE_PAGE_SIZE = 50;
const PERCENTILE_PAGE_SIZE = 500;
const CANDIDATE_PAGE_SIZE = 100;
const TEMPORAL_SCAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const temporalCohortBandValidator = v.union(v.literal("p95"), v.literal("p99"));
const temporalScoreValidator = v.object({
  spike: v.boolean(),
  sustained: v.boolean(),
  nearConversion: v.boolean(),
  pressure: v.number(),
  recent7Downloads: v.number(),
  recent7Installs: v.number(),
  previous30Downloads: v.number(),
  baseline7Downloads: v.number(),
  spikeMultiplier: v.number(),
  recent30Downloads: v.number(),
  recent30Installs: v.number(),
  downloadInstallRatio30: v.number(),
  downloads30dCohortBand: v.optional(temporalCohortBandValidator),
  spikeMultiplierCohortBand: v.optional(temporalCohortBandValidator),
  downloads30dVsPeerP95: v.optional(v.number()),
  spikeMultiplierVsPeerP95: v.optional(v.number()),
  installDownloadRatio7: v.number(),
  installDownloadRatio30: v.number(),
  installDownloadExcessZScore7: v.number(),
  installDownloadExcessZScore30: v.number(),
  spikeWindowStartDay: v.optional(v.number()),
  spikeWindowEndDay: v.optional(v.number()),
  sustainedWindowStartDay: v.optional(v.number()),
  sustainedWindowEndDay: v.optional(v.number()),
  nearConversionWindowStartDay: v.optional(v.number()),
  nearConversionWindowEndDay: v.optional(v.number()),
  reasonCodes: v.array(v.string()),
});

const temporalCandidateValidator = v.object({
  ownerKey: v.string(),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerUserId: v.optional(v.id("users")),
  handleSnapshot: v.string(),
  skillId: v.id("skills"),
  slug: v.string(),
  displayName: v.string(),
  totalDownloads: v.number(),
  totalInstalls: v.number(),
  temporalScore: temporalScoreValidator,
});

const temporalBenchmarkValidator = v.object({
  scope: v.optional(v.literal("all_active_skills")),
  sampleSize: v.number(),
  downloads30dAverage: v.number(),
  downloads30dMedian: v.number(),
  downloads30dP95: v.number(),
  downloads30dP99: v.number(),
  spikeMultiplier7dP95: v.number(),
  spikeMultiplier7dP99: v.number(),
});

type TemporalScanRun = Doc<"publisherAbuseScoreRuns">;
type PercentileMetric = "downloads" | "spike";

function isActiveScheduledTemporalRun(run: TemporalScanRun, now: number) {
  return run.status === "running" && now - run.startedAt < TEMPORAL_SCAN_RETENTION_MS;
}

export async function getOrStartScheduledTemporalScanInternalHandler(ctx: MutationCtx) {
  const now = Date.now();
  const existing = await ctx.db
    .query("publisherAbuseScoreRuns")
    .withIndex("by_model_version_and_status_and_trigger_and_updated_at", (q) =>
      q
        .eq("modelVersion", PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION)
        .eq("status", "running")
        .eq("trigger", "cron"),
    )
    .order("desc")
    .first();
  if (
    existing?.temporalPipelinePhase &&
    existing.temporalPipelinePhase !== "completed" &&
    now - existing.startedAt < TEMPORAL_SCAN_RETENTION_MS
  ) {
    return { runId: existing._id, resumed: true as const };
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "failed",
      errorMessage: "Scheduled temporal scan exceeded its seven-day working-state retention.",
      updatedAt: now,
    });
  }
  const runId = await ctx.db.insert("publisherAbuseScoreRuns", {
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
    temporalTodayDay: toDayKey(now),
    temporalSampleSize: 0,
    temporalDownloadsSum: 0,
    temporalDownloadsProcessed: 0,
    temporalSpikeProcessed: 0,
  });
  return { runId, resumed: false as const };
}

export const getOrStartScheduledTemporalScanInternal = internalMutation({
  args: {},
  handler: getOrStartScheduledTemporalScanInternalHandler,
});

export async function getScheduledTemporalScanStateInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { runId: Id<"publisherAbuseScoreRuns"> },
) {
  const run = await ctx.db.get(args.runId);
  if (!run || run.modelVersion !== PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION) {
    throw new Error("Scheduled temporal publisher abuse scan not found");
  }
  return run;
}

export const getScheduledTemporalScanStateInternal = internalQuery({
  args: { runId: v.id("publisherAbuseScoreRuns") },
  handler: getScheduledTemporalScanStateInternalHandler,
});

export async function storeScheduledTemporalScanPageInternalHandler(
  ctx: MutationCtx,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    expectedCursor?: string;
    nextCursor?: string;
    isDone: boolean;
    benchmarkScores: Pick<SkillTemporalAbuseScore, "recent30Downloads" | "spikeMultiplier">[];
    candidates: TemporalSkillCandidate[];
  },
) {
  const run = await getScheduledTemporalScanStateInternalHandler(ctx, { runId: args.runId });
  const now = Date.now();
  if (!isActiveScheduledTemporalRun(run, now) || run.temporalPipelinePhase !== "collecting") {
    return { applied: false as const };
  }
  if ((run.temporalSourceCursor ?? null) !== (args.expectedCursor ?? null)) {
    return { applied: false as const };
  }
  const expirationTime = run.startedAt + TEMPORAL_SCAN_RETENTION_MS;
  for (const score of args.benchmarkScores) {
    await ctx.db.insert("publisherAbuseTemporalScanSamples", {
      runId: run._id,
      recent30Downloads: Math.max(0, score.recent30Downloads),
      spikeMultiplier: Math.max(0, score.spikeMultiplier),
      expirationTime,
    });
  }
  for (const candidate of args.candidates) {
    await ctx.db.insert("publisherAbuseTemporalScanCandidates", {
      runId: run._id,
      ...candidate,
      expirationTime,
    });
  }
  await ctx.db.patch(run._id, {
    temporalSourceCursor: args.isDone ? undefined : args.nextCursor,
    temporalSampleSize: (run.temporalSampleSize ?? 0) + args.benchmarkScores.length,
    temporalDownloadsSum:
      (run.temporalDownloadsSum ?? 0) +
      args.benchmarkScores.reduce((sum, score) => sum + Math.max(0, score.recent30Downloads), 0),
    temporalPipelinePhase: args.isDone ? "downloads_percentiles" : "collecting",
    updatedAt: now,
  });
  return { applied: true as const };
}

export const storeScheduledTemporalScanPageInternal = internalMutation({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    expectedCursor: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    benchmarkScores: v.array(
      v.object({ recent30Downloads: v.number(), spikeMultiplier: v.number() }),
    ),
    candidates: v.array(temporalCandidateValidator),
  },
  handler: storeScheduledTemporalScanPageInternalHandler,
});

export async function readScheduledTemporalPercentilePageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    metric: PercentileMetric;
    cursor?: string;
    batchSize?: number;
  },
) {
  const batchSize = Math.max(1, Math.min(PERCENTILE_PAGE_SIZE, Math.trunc(args.batchSize ?? 500)));
  const page =
    args.metric === "downloads"
      ? await ctx.db
          .query("publisherAbuseTemporalScanSamples")
          .withIndex("by_run_id_and_recent30_downloads", (q) => q.eq("runId", args.runId))
          .order("asc")
          .paginate({ cursor: args.cursor ?? null, numItems: batchSize })
      : await ctx.db
          .query("publisherAbuseTemporalScanSamples")
          .withIndex("by_run_id_and_spike_multiplier", (q) => q.eq("runId", args.runId))
          .order("asc")
          .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
  return {
    values: page.page.map((sample) =>
      args.metric === "downloads" ? sample.recent30Downloads : sample.spikeMultiplier,
    ),
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

export const readScheduledTemporalPercentilePageInternal = internalQuery({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    metric: v.union(v.literal("downloads"), v.literal("spike")),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: readScheduledTemporalPercentilePageInternalHandler,
});

function percentileIndex(sampleSize: number, quantile: number) {
  if (sampleSize <= 0) return 0;
  return Math.max(0, Math.min(sampleSize - 1, Math.ceil(quantile * sampleSize) - 1));
}

function valueAtGlobalIndex(args: { values: number[]; pageStart: number; targetIndex: number }) {
  const localIndex = args.targetIndex - args.pageStart;
  return localIndex >= 0 && localIndex < args.values.length ? args.values[localIndex] : undefined;
}

export async function advanceScheduledTemporalPercentileInternalHandler(
  ctx: MutationCtx,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    phase: "downloads_percentiles" | "spike_percentiles";
    expectedCursor?: string;
    nextCursor?: string;
    isDone: boolean;
    processed: number;
    median?: number;
    p95?: number;
    p99?: number;
  },
) {
  const run = await getScheduledTemporalScanStateInternalHandler(ctx, { runId: args.runId });
  const now = Date.now();
  if (!isActiveScheduledTemporalRun(run, now) || run.temporalPipelinePhase !== args.phase) {
    return { applied: false as const };
  }
  const currentCursor =
    args.phase === "downloads_percentiles" ? run.temporalDownloadsCursor : run.temporalSpikeCursor;
  if ((currentCursor ?? null) !== (args.expectedCursor ?? null)) {
    return { applied: false as const };
  }
  if (args.phase === "downloads_percentiles") {
    await ctx.db.patch(run._id, {
      temporalDownloadsCursor: args.isDone ? undefined : args.nextCursor,
      temporalDownloadsProcessed: args.processed,
      temporalDownloadsMedian: args.median ?? run.temporalDownloadsMedian,
      temporalDownloadsP95: args.p95 ?? run.temporalDownloadsP95,
      temporalDownloadsP99: args.p99 ?? run.temporalDownloadsP99,
      temporalPipelinePhase: args.isDone ? "spike_percentiles" : args.phase,
      updatedAt: now,
    });
    return { applied: true as const };
  }
  const spikeP95 = args.p95 ?? run.temporalSpikeP95;
  const spikeP99 = args.p99 ?? run.temporalSpikeP99;
  const benchmark = args.isDone
    ? temporalBenchmarkFromRun({ ...run, temporalSpikeP95: spikeP95, temporalSpikeP99: spikeP99 })
    : undefined;
  await ctx.db.patch(run._id, {
    temporalSpikeCursor: args.isDone ? undefined : args.nextCursor,
    temporalSpikeProcessed: args.processed,
    temporalSpikeP95: spikeP95,
    temporalSpikeP99: spikeP99,
    temporalBenchmark: benchmark,
    temporalPipelinePhase: args.isDone ? "classifying" : args.phase,
    updatedAt: now,
  });
  return { applied: true as const };
}

export const advanceScheduledTemporalPercentileInternal = internalMutation({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    phase: v.union(v.literal("downloads_percentiles"), v.literal("spike_percentiles")),
    expectedCursor: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    processed: v.number(),
    median: v.optional(v.number()),
    p95: v.optional(v.number()),
    p99: v.optional(v.number()),
  },
  handler: advanceScheduledTemporalPercentileInternalHandler,
});

function temporalBenchmarkFromRun(run: TemporalScanRun): TemporalAbuseCohortBenchmark {
  const sampleSize = run.temporalSampleSize ?? 0;
  return {
    scope: "all_active_skills",
    sampleSize,
    downloads30dAverage: sampleSize > 0 ? (run.temporalDownloadsSum ?? 0) / sampleSize : 0,
    downloads30dMedian: run.temporalDownloadsMedian ?? 0,
    downloads30dP95: run.temporalDownloadsP95 ?? 0,
    downloads30dP99: run.temporalDownloadsP99 ?? 0,
    spikeMultiplier7dP95: run.temporalSpikeP95 ?? 0,
    spikeMultiplier7dP99: run.temporalSpikeP99 ?? 0,
  };
}

export async function readScheduledTemporalCandidatesPageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { runId: Id<"publisherAbuseScoreRuns">; cursor?: string; batchSize?: number },
) {
  const batchSize = Math.max(1, Math.min(CANDIDATE_PAGE_SIZE, Math.trunc(args.batchSize ?? 100)));
  const page = await ctx.db
    .query("publisherAbuseTemporalScanCandidates")
    .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
  return {
    candidates: page.page.map(({ expirationTime: _expirationTime, runId: _runId, ...candidate }) =>
      candidateFromScanRow(candidate),
    ),
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

function candidateFromScanRow(
  row: Omit<Doc<"publisherAbuseTemporalScanCandidates">, "expirationTime" | "runId">,
): TemporalSkillCandidate {
  return {
    ownerKey: row.ownerKey,
    ownerPublisherId: row.ownerPublisherId,
    ownerUserId: row.ownerUserId,
    handleSnapshot: row.handleSnapshot,
    skillId: row.skillId,
    slug: row.slug,
    displayName: row.displayName,
    totalDownloads: row.totalDownloads,
    totalInstalls: row.totalInstalls,
    temporalScore: row.temporalScore,
  };
}

export const readScheduledTemporalCandidatesPageInternal = internalQuery({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: readScheduledTemporalCandidatesPageInternalHandler,
});

export async function advanceScheduledTemporalCandidatesInternalHandler(
  ctx: MutationCtx,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    expectedCursor?: string;
    nextCursor?: string;
    isDone: boolean;
    candidates: TemporalSkillCandidate[];
  },
) {
  const run = await getScheduledTemporalScanStateInternalHandler(ctx, { runId: args.runId });
  const now = Date.now();
  if (!isActiveScheduledTemporalRun(run, now) || run.temporalPipelinePhase !== "classifying") {
    return { applied: false as const };
  }
  if ((run.temporalCandidateCursor ?? null) !== (args.expectedCursor ?? null)) {
    return { applied: false as const };
  }
  if (!run.temporalBenchmark) throw new Error("Temporal scan benchmark is missing");
  if (args.candidates.length > 0) {
    await archiveTemporalPublisherAbuseSignals(ctx, {
      runId: run._id,
      candidates: args.candidates,
      benchmark: run.temporalBenchmark,
      now,
    });
  }
  const finalizedScores = run.finalizedScores + args.candidates.length;
  await ctx.db.patch(run._id, {
    temporalCandidateCursor: args.isDone ? undefined : args.nextCursor,
    temporalPipelinePhase: args.isDone ? "completed" : "classifying",
    temporalScanComplete: args.isDone,
    status: args.isDone ? "completed" : "running",
    phase: args.isDone ? "completed" : "finalizing",
    completedAt: args.isDone ? now : undefined,
    finalizedScores,
    reviewCount: finalizedScores,
    updatedAt: now,
  });
  return { applied: true as const };
}

export const advanceScheduledTemporalCandidatesInternal = internalMutation({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    expectedCursor: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    candidates: v.array(temporalCandidateValidator),
  },
  handler: advanceScheduledTemporalCandidatesInternalHandler,
});

export async function failExpiredScheduledTemporalScanInternalHandler(
  ctx: MutationCtx,
  args: { runId: Id<"publisherAbuseScoreRuns"> },
) {
  const run = await getScheduledTemporalScanStateInternalHandler(ctx, { runId: args.runId });
  const now = Date.now();
  if (run.status !== "running" || now - run.startedAt < TEMPORAL_SCAN_RETENTION_MS) {
    return { failed: false as const };
  }
  await ctx.db.patch(run._id, {
    status: "failed",
    temporalScanComplete: false,
    errorMessage: "Scheduled temporal scan exceeded its seven-day working-state retention.",
    updatedAt: now,
  });
  return { failed: true as const };
}

export const failExpiredScheduledTemporalScanInternal = internalMutation({
  args: { runId: v.id("publisherAbuseScoreRuns") },
  handler: failExpiredScheduledTemporalScanInternalHandler,
});

type TemporalSourcePage = {
  cursor?: string;
  isDone: boolean;
  scannedSkills: number;
  benchmarkScores?: SkillTemporalAbuseScore[];
  candidates: TemporalSkillCandidate[];
};

type PercentilePage = { values: number[]; cursor?: string; isDone: boolean };
type CandidatePage = { candidates: TemporalSkillCandidate[]; cursor?: string; isDone: boolean };

export async function runScheduledTemporalPublisherAbuseScanInternalHandler(
  ctx: ActionCtx,
  args: { runId?: Id<"publisherAbuseScoreRuns"> },
) {
  const start = args.runId
    ? { runId: args.runId }
    : await ctx.runMutation(
        internal.publisherAbuseTemporalScan.getOrStartScheduledTemporalScanInternal,
        {},
      );
  const run: TemporalScanRun = await ctx.runQuery(
    internal.publisherAbuseTemporalScan.getScheduledTemporalScanStateInternal,
    { runId: start.runId },
  );
  if (run.status !== "running" || run.temporalPipelinePhase === "completed") {
    return { ok: true as const, runId: run._id, completed: true as const };
  }
  if (!isActiveScheduledTemporalRun(run, Date.now())) {
    await ctx.runMutation(
      internal.publisherAbuseTemporalScan.failExpiredScheduledTemporalScanInternal,
      { runId: run._id },
    );
    return {
      ok: false as const,
      runId: run._id,
      completed: false as const,
      expired: true as const,
    };
  }

  if (run.temporalPipelinePhase === "collecting") {
    const sourcePage: TemporalSourcePage = await ctx.runQuery(
      internal.publisherAbuse.collectTemporalPublisherAbuseSkillCandidatesPageInternal,
      {
        mode: "current",
        cursor: run.temporalSourceCursor,
        batchSize: SOURCE_PAGE_SIZE,
        todayDay: run.temporalTodayDay,
      },
    );
    await ctx.runMutation(
      internal.publisherAbuseTemporalScan.storeScheduledTemporalScanPageInternal,
      {
        runId: run._id,
        expectedCursor: run.temporalSourceCursor,
        nextCursor: sourcePage.cursor,
        isDone: sourcePage.isDone,
        benchmarkScores:
          sourcePage.benchmarkScores ??
          sourcePage.candidates.map(({ temporalScore }) => ({
            recent30Downloads: temporalScore.recent30Downloads,
            spikeMultiplier: temporalScore.spikeMultiplier,
          })),
        candidates: sourcePage.candidates,
      },
    );
  } else if (
    run.temporalPipelinePhase === "downloads_percentiles" ||
    run.temporalPipelinePhase === "spike_percentiles"
  ) {
    const metric: PercentileMetric =
      run.temporalPipelinePhase === "downloads_percentiles" ? "downloads" : "spike";
    const cursor = metric === "downloads" ? run.temporalDownloadsCursor : run.temporalSpikeCursor;
    const processed =
      metric === "downloads"
        ? (run.temporalDownloadsProcessed ?? 0)
        : (run.temporalSpikeProcessed ?? 0);
    const page: PercentilePage = await ctx.runQuery(
      internal.publisherAbuseTemporalScan.readScheduledTemporalPercentilePageInternal,
      { runId: run._id, metric, cursor, batchSize: PERCENTILE_PAGE_SIZE },
    );
    const sampleSize = run.temporalSampleSize ?? 0;
    const p95 = valueAtGlobalIndex({
      values: page.values,
      pageStart: processed,
      targetIndex: percentileIndex(sampleSize, 0.95),
    });
    const p99 = valueAtGlobalIndex({
      values: page.values,
      pageStart: processed,
      targetIndex: percentileIndex(sampleSize, 0.99),
    });
    const median =
      metric === "downloads"
        ? valueAtGlobalIndex({
            values: page.values,
            pageStart: processed,
            targetIndex: percentileIndex(sampleSize, 0.5),
          })
        : undefined;
    await ctx.runMutation(
      internal.publisherAbuseTemporalScan.advanceScheduledTemporalPercentileInternal,
      {
        runId: run._id,
        phase: run.temporalPipelinePhase,
        expectedCursor: cursor,
        nextCursor: page.cursor,
        isDone: page.isDone,
        processed: processed + page.values.length,
        median: sampleSize === 0 ? 0 : median,
        p95: sampleSize === 0 ? 0 : p95,
        p99: sampleSize === 0 ? 0 : p99,
      },
    );
  } else if (run.temporalPipelinePhase === "classifying") {
    if (!run.temporalBenchmark) throw new Error("Temporal scan benchmark is missing");
    const page: CandidatePage = await ctx.runQuery(
      internal.publisherAbuseTemporalScan.readScheduledTemporalCandidatesPageInternal,
      {
        runId: run._id,
        cursor: run.temporalCandidateCursor,
        batchSize: CANDIDATE_PAGE_SIZE,
      },
    );
    const highCandidates = page.candidates
      .map((candidate) => ({
        ...candidate,
        temporalScore: classifySkillTemporalAbuseScore(
          candidate.temporalScore,
          run.temporalBenchmark,
        ),
      }))
      .filter(
        ({ temporalScore }) =>
          temporalScore.spike || temporalScore.sustained || temporalScore.nearConversion,
      );
    await ctx.runMutation(
      internal.publisherAbuseTemporalScan.advanceScheduledTemporalCandidatesInternal,
      {
        runId: run._id,
        expectedCursor: run.temporalCandidateCursor,
        nextCursor: page.cursor,
        isDone: page.isDone,
        candidates: highCandidates,
      },
    );
    if (page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.publisherAbuse.notifyPublisherAbuseSignalChangesInternal,
        {},
      );
      return { ok: true as const, runId: run._id, completed: true as const };
    }
  }

  await ctx.scheduler.runAfter(
    0,
    internal.publisherAbuseTemporalScan.runScheduledTemporalPublisherAbuseScanInternal,
    { runId: run._id },
  );
  return {
    ok: true as const,
    runId: run._id,
    completed: false as const,
    phase: run.temporalPipelinePhase,
  };
}

export const runScheduledTemporalPublisherAbuseScanInternal = internalAction({
  args: { runId: v.optional(v.id("publisherAbuseScoreRuns")) },
  handler: runScheduledTemporalPublisherAbuseScanInternalHandler,
});

export async function pruneExpiredTemporalScanRowsInternalHandler(
  ctx: MutationCtx,
  args: { batchSize?: number },
) {
  const batchSize = Math.max(
    1,
    Math.min(
      RETENTION_STANDARD_BATCH_SIZE,
      Math.trunc(args.batchSize ?? RETENTION_STANDARD_BATCH_SIZE),
    ),
  );
  const now = Date.now();
  const [samples, candidates] = await Promise.all([
    ctx.db
      .query("publisherAbuseTemporalScanSamples")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize),
    ctx.db
      .query("publisherAbuseTemporalScanCandidates")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize),
  ]);
  for (const row of [...samples, ...candidates]) await ctx.db.delete(row._id);
  const hasMore = samples.length === batchSize || candidates.length === batchSize;
  if (hasMore) {
    await ctx.scheduler.runAfter(
      0,
      internal.publisherAbuseTemporalScan.pruneExpiredTemporalScanRowsInternal,
      { batchSize },
    );
  }
  return { samplesDeleted: samples.length, candidatesDeleted: candidates.length, hasMore };
}

export const pruneExpiredTemporalScanRowsInternal = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: pruneExpiredTemporalScanRowsInternalHandler,
});

export const temporalBenchmarkForScheduledScanInternal = internalQuery({
  args: { runId: v.id("publisherAbuseScoreRuns") },
  returns: v.union(temporalBenchmarkValidator, v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run?.temporalBenchmark ?? null;
  },
});

export { percentileIndex, temporalBenchmarkFromRun, valueAtGlobalIndex };
