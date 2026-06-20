import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import { assertModerator, requireUser, requireUserFromAction } from "./lib/access";
import { toDayKey } from "./lib/leaderboards";
import { hasOfficialPublisherRow } from "./lib/officialPublishers";
import {
  classifySkillTemporalAbuseScore,
  computeCurrentSkillTemporalAbuseScore,
  computeHistoricalSkillTemporalAbuseScore,
  computePublisherAbuseRawScore,
  labelForPublisherAbuseScore,
  computeTemporalAbuseCohortBenchmark,
  computeTemporalPublisherAbuseZScore,
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  isPublisherAbuseCheckEligible,
  labelForTemporalPublisherAbuse,
  PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
  summarizePublisherAbuseLogPressure,
  type PublisherAbuseInput,
  type PublisherAbuseLabel,
  type SkillTemporalAbuseScore,
  type TemporalAbuseCohortBenchmark,
} from "./lib/publisherAbuseScoring";
import { getSkillPublisherContribution } from "./lib/publisherStats";
import { readCanonicalStat } from "./lib/skillStats";

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_MAX_PAGES = 5;
const MAX_MAX_PAGES = 50;
const ACTION_CONTINUATION_DELAY_MS = 60_000;
const MAX_ACTIVE_SKILL_FALLBACK_SCAN = 500;
const MAX_ACTIVE_SKILL_FALLBACK_SCANS_PER_PAGE = 20;
const MAX_OWNER_NOMINATION_VERSION_SCAN = 20;
const MAX_REVIEW_DASHBOARD_SCAN_MULTIPLIER = 3;
const MAX_REVIEW_DASHBOARD_SCORE_SCAN_MULTIPLIER = 32;
const MAX_REVIEW_DASHBOARD_SCORE_SCAN = 2000;
const DEFAULT_TEMPORAL_BATCH_SIZE = 50;
const MAX_TEMPORAL_BATCH_SIZE = 100;
const DEFAULT_TEMPORAL_CANDIDATE_LIMIT = 1000;
const MAX_TEMPORAL_CANDIDATE_LIMIT = 8_000;
const DEFAULT_TEMPORAL_MAX_PAGES = 20;
const MAX_TEMPORAL_MAX_PAGES = 100;
const CURRENT_TEMPORAL_LOOKBACK_DAYS = 37;
const DEFAULT_BACKFILL_TEMPORAL_LOOKBACK_DAYS = 365;
const MAX_BACKFILL_TEMPORAL_LOOKBACK_DAYS = 730;
const MAX_TEMPORAL_DAILY_STAT_READS_PER_PAGE = 8_000;
const MAX_TEMPORAL_DRY_RUN_CANDIDATES = 50;
const MAX_TEMPORAL_EVIDENCE_SKILLS = 5;
const MAX_TEMPORAL_STALE_NOMINATION_CLEARS = 250;

type TriageStatus = Doc<"publisherAbuseReviewNominations">["status"];
type ScoreRun = Doc<"publisherAbuseScoreRuns">;
type ScoreDoc = Doc<"publisherAbuseScores">;
type RunPhase = ScoreRun["phase"];
type TemporalAbuseMode = "current" | "backfill";

type RunState = {
  runId: Id<"publisherAbuseScoreRuns">;
  status: ScoreRun["status"];
  phase: RunPhase;
};

type PageResult = RunState & {
  isDone: boolean;
  scanned?: number;
  finalized?: number;
  nominations?: number;
};

type PublisherMetricsDoc = Pick<
  Doc<"publishers">,
  | "_id"
  | "kind"
  | "handle"
  | "linkedUserId"
  | "deletedAt"
  | "deactivatedAt"
  | "publishedSkills"
  | "publishedPackages"
  | "totalInstalls"
  | "totalStars"
  | "totalDownloads"
  | "skillTotalInstalls"
  | "skillTotalStars"
  | "skillTotalDownloads"
>;

type PublisherAbuseExclusionPublisher = Pick<
  Doc<"publishers">,
  "_id" | "kind" | "deletedAt" | "deactivatedAt"
>;

type TemporalSkillCandidate = {
  ownerKey: string;
  ownerPublisherId?: Id<"publishers">;
  ownerUserId?: Id<"users">;
  handleSnapshot: string;
  skillId: Id<"skills">;
  slug: string;
  displayName: string;
  totalDownloads: number;
  totalInstalls: number;
  temporalScore: SkillTemporalAbuseScore;
};

type TemporalSkillCandidatesPage = {
  cursor?: string;
  isDone: boolean;
  scannedSkills: number;
  candidates: TemporalSkillCandidate[];
};

type TemporalPublisherAggregate = {
  ownerKey: string;
  ownerPublisherId?: Id<"publishers">;
  ownerUserId?: Id<"users">;
  handleSnapshot: string;
  highTemporalSkillCount: number;
  p99TemporalSkillCount: number;
  spikeSkillCount: number;
  sustainedSkillCount: number;
  maxTemporalPressure: number;
  totalDownloads: number;
  totalInstalls: number;
  reasonCodes: string[];
  evidence: TemporalSkillCandidate[];
};

const temporalCohortBandValidator = v.union(v.literal("p95"), v.literal("p99"));

const temporalAbuseCohortBenchmarkValidator = v.object({
  sampleSize: v.number(),
  downloads30dAverage: v.number(),
  downloads30dMedian: v.number(),
  downloads30dP95: v.number(),
  downloads30dP99: v.number(),
  spikeMultiplier7dP95: v.number(),
  spikeMultiplier7dP99: v.number(),
});

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

type PublisherSkillMetricsOptions =
  | {
      allowActiveSkillScan: false;
    }
  | {
      allowActiveSkillScan: true;
      allowMissingPublishedSkillCountScan: boolean;
      activeSkillFallbackBudget: ActiveSkillFallbackBudget;
    };

type ActiveSkillFallbackBudget = {
  remainingScans: number;
};

export const listReviewDashboard = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const limit = clampInt(args.limit ?? 150, 1, 250);
    const latestRun = await getLatestPublisherAbuseScoreRun(ctx);
    const scoreRankRunId = latestRun?.status === "completed" ? latestRun._id : undefined;
    const pendingPotentialBanCandidateItems = await getPendingPublisherAbuseReviewItemsForLabel(
      ctx,
      {
        status: "pending",
        label: "potential_ban_candidate",
        limit,
        latestCompletedRunId: scoreRankRunId,
      },
    );
    const pendingReviewItems = await getPendingPublisherAbuseReviewItemsForLabel(ctx, {
      status: "pending",
      label: "review",
      limit,
      latestCompletedRunId: scoreRankRunId,
    });
    const pendingItems = [...pendingPotentialBanCandidateItems, ...pendingReviewItems]
      .sort(comparePublisherAbuseReviewItemsByLastScoredAt)
      .slice(0, limit);
    const recentResolvedItems = await getRecentResolvedPublisherAbuseReviewItems(ctx, 30);

    return {
      latestRun: latestRun ? summarizePublisherAbuseRun(latestRun) : null,
      pendingItems,
      pendingPotentialBanCandidateItems,
      pendingReviewItems,
      recentResolvedItems,
    };
  },
});

export const getReviewNominationDetail = query({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const nomination = await ctx.db.get(args.nominationId);
    if (!nomination) return null;

    const item = await summarizePublisherAbuseReviewNomination(ctx, nomination);
    if (await isPublisherAbuseExcludedReviewItem(ctx, item)) return null;
    const scoreHistory = await ctx.db
      .query("publisherAbuseScores")
      .withIndex("by_owner_key_and_created_at", (q) => q.eq("ownerKey", nomination.ownerKey))
      .order("desc")
      .take(5);
    const latestScoreRun = item.latestScore ? await ctx.db.get(item.latestScore.runId) : null;
    const events = await ctx.db
      .query("publisherAbuseReviewEvents")
      .withIndex("by_nomination_and_created_at", (q) => q.eq("nominationId", nomination._id))
      .order("desc")
      .take(20);

    return {
      item,
      latestScoreRun: latestScoreRun ? summarizePublisherAbuseRun(latestScoreRun) : null,
      scoreHistory,
      events,
    };
  },
});

export const banPublisherAbuseOwner = mutation({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
    expectedLatestScoreId: v.id("publisherAbuseScores"),
    expectedUpdatedAt: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const nomination = await ctx.db.get(args.nominationId);
    if (!nomination) throw new Error("Publisher abuse nomination not found");
    requireFreshPublisherAbuseReviewNomination(nomination, args);
    requireActionablePublisherAbuseReviewNomination(nomination);
    if (!nomination.ownerUserId) {
      throw new Error("Cannot ban publisher abuse nomination without a linked user");
    }
    await requirePublisherAbuseNominationNotExcluded(ctx, nomination);

    throw new Error("Publisher abuse bans are disabled while the scoring model is flag-only.");
  },
});

function requireFreshPublisherAbuseReviewNomination(
  nomination: Doc<"publisherAbuseReviewNominations">,
  expected: { expectedLatestScoreId: Id<"publisherAbuseScores">; expectedUpdatedAt: number },
) {
  if (
    nomination.latestScoreId !== expected.expectedLatestScoreId ||
    nomination.updatedAt !== expected.expectedUpdatedAt
  ) {
    throw new Error("Publisher abuse nomination changed; refresh and try again");
  }
}

function requireActionablePublisherAbuseReviewNomination(
  nomination: Doc<"publisherAbuseReviewNominations">,
) {
  if (nomination.label !== "potential_ban_candidate") {
    throw new Error(
      "Only potential ban publisher abuse nominations can be manually resolved; review nominations are calibration signals.",
    );
  }
  if (nomination.status !== "pending") {
    throw new Error("Only pending publisher abuse nominations can be banned.");
  }
}

export const startPublisherAbuseScoreRun = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    ok: true;
    runId: Id<"publisherAbuseScoreRuns">;
    pages: number;
    isDone: boolean;
  }> => {
    const { userId, user } = await requireUserFromAction(ctx);
    assertModerator(user);
    return await ctx.runAction(internal.publisherAbuse.runPublisherAbuseScoreRunInternal, {
      trigger: "manual",
      actorUserId: userId,
    });
  },
});

export const getOrStartPublisherAbuseScoreRunInternal = internalMutation({
  args: {
    trigger: v.union(v.literal("cron"), v.literal("manual")),
    actorUserId: v.optional(v.id("users")),
    forceNew: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<RunState> => {
    if (!args.forceNew) {
      const activeRun = await getActivePublisherAbuseScoreRun(ctx);
      if (activeRun) {
        return {
          runId: activeRun._id,
          status: activeRun.status,
          phase: activeRun.phase,
        };
      }
    }

    const runId = await createPublisherAbuseScoreRun(ctx, {
      trigger: args.trigger,
      actorUserId: args.actorUserId,
    });
    return { runId, status: "running", phase: "collecting" };
  },
});

export const getPublisherAbuseScoreRunStateInternal = internalQuery({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
  },
  handler: async (ctx, args): Promise<RunState> => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Publisher abuse score run not found");
    return { runId: run._id, status: run.status, phase: run.phase };
  },
});

export const collectPublisherAbuseScoresPageInternal = internalMutation({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    batchSize: v.optional(v.number()),
  },
  handler: collectPublisherAbuseScoresPageInternalHandler,
});

export const finalizePublisherAbuseScoresPageInternal = internalMutation({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    batchSize: v.optional(v.number()),
  },
  handler: finalizePublisherAbuseScoresPageInternalHandler,
});

export const markPublisherAbuseScoreRunFailedInternal = internalMutation({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    errorMessage: v.string(),
  },
  handler: markPublisherAbuseScoreRunFailedInternalHandler,
});

export const runPublisherAbuseScoreRunInternal = internalAction({
  args: {
    runId: v.optional(v.id("publisherAbuseScoreRuns")),
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    forceNew: v.optional(v.boolean()),
    trigger: v.optional(v.union(v.literal("cron"), v.literal("manual"))),
    actorUserId: v.optional(v.id("users")),
  },
  handler: runPublisherAbuseScoreRunInternalHandler,
});

export const collectTemporalPublisherAbuseSkillCandidatesPageInternal = internalQuery({
  args: {
    mode: v.union(v.literal("current"), v.literal("backfill")),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    todayDay: v.optional(v.number()),
    lookbackDays: v.optional(v.number()),
  },
  handler: collectTemporalPublisherAbuseSkillCandidatesPageInternalHandler,
});

export const persistTemporalPublisherAbuseCandidatesInternal = internalMutation({
  args: {
    mode: v.union(v.literal("current"), v.literal("backfill")),
    trigger: v.union(v.literal("cron"), v.literal("manual")),
    actorUserId: v.optional(v.id("users")),
    candidates: v.array(temporalCandidateValidator),
    benchmark: temporalAbuseCohortBenchmarkValidator,
    scanComplete: v.boolean(),
  },
  handler: persistTemporalPublisherAbuseCandidatesInternalHandler,
});

export const runTemporalPublisherAbuseScanInternal = internalAction({
  args: {
    mode: v.optional(v.union(v.literal("current"), v.literal("backfill"))),
    dryRun: v.optional(v.boolean()),
    candidateLimit: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    todayDay: v.optional(v.number()),
    lookbackDays: v.optional(v.number()),
    trigger: v.optional(v.union(v.literal("cron"), v.literal("manual"))),
    actorUserId: v.optional(v.id("users")),
  },
  handler: runTemporalPublisherAbuseScanInternalHandler,
});

export async function collectPublisherAbuseScoresPageInternalHandler(
  ctx: MutationCtx,
  args: { runId: Id<"publisherAbuseScoreRuns">; batchSize?: number },
): Promise<PageResult> {
  const run = await requireRunningRun(ctx, args.runId);
  if (run.phase !== "collecting") {
    return {
      runId: run._id,
      status: run.status,
      phase: run.phase,
      isDone: run.phase === "completed",
    };
  }

  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const now = Date.now();
  const page = await ctx.db
    .query("publishers")
    .withIndex("by_active_kind_handle", (q) =>
      q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
    )
    .paginate({ cursor: run.collectCursor ?? null, numItems: batchSize });

  let sumLogPressure = 0;
  let sumSquaredLogPressure = 0;
  let scored = 0;
  const modelConfig = run.modelConfig;
  const activeSkillFallbackBudget: ActiveSkillFallbackBudget = {
    remainingScans: MAX_ACTIVE_SKILL_FALLBACK_SCANS_PER_PAGE,
  };
  const publisherSkillMetricsOptions: PublisherSkillMetricsOptions =
    run.trigger === "cron"
      ? {
          allowActiveSkillScan: true,
          allowMissingPublishedSkillCountScan: false,
          activeSkillFallbackBudget,
        }
      : {
          allowActiveSkillScan: true,
          allowMissingPublishedSkillCountScan: true,
          activeSkillFallbackBudget,
        };
  for (const publisher of page.page) {
    if (await isPublisherExcludedFromPublisherAbuse(ctx, publisher)) continue;
    const input = await publisherInputFromPublisher(ctx, publisher, publisherSkillMetricsOptions);
    if (!input) continue;
    const rawScore = computePublisherAbuseRawScore(input, modelConfig);
    await ctx.db.insert("publisherAbuseScores", {
      runId: run._id,
      ownerKey: rawScore.input.ownerKey,
      ownerPublisherId: publisher._id,
      ownerUserId: publisher.linkedUserId,
      handleSnapshot: rawScore.input.handleSnapshot,
      modelVersion: run.modelVersion,
      label: "pass",
      rank: 0,
      pressure: rawScore.pressure,
      logPressure: rawScore.logPressure,
      zScore: 0,
      publishedSkills: rawScore.publishedSkills,
      totalInstalls: rawScore.totalInstalls,
      totalStars: rawScore.totalStars,
      totalDownloads: rawScore.totalDownloads,
      installsPerSkill: rawScore.installsPerSkill,
      starsPerSkill: rawScore.starsPerSkill,
      downloadsPerSkill: rawScore.downloadsPerSkill,
      reasonCodes: rawScore.reasonCodes,
      createdAt: now,
    });
    if (rawScore.publishedSkills > 0) {
      sumLogPressure += rawScore.logPressure;
      sumSquaredLogPressure += rawScore.logPressure ** 2;
      scored += 1;
    }
  }

  const nextPhase: RunPhase = page.isDone ? "finalizing" : "collecting";
  await ctx.db.patch(run._id, {
    phase: nextPhase,
    collectCursor: page.isDone ? undefined : page.continueCursor,
    scannedPublishers: run.scannedPublishers + page.page.length,
    scoredPublishers: run.scoredPublishers + scored,
    sumLogPressure: run.sumLogPressure + sumLogPressure,
    sumSquaredLogPressure: run.sumSquaredLogPressure + sumSquaredLogPressure,
    updatedAt: now,
  });

  return {
    runId: run._id,
    status: "running",
    phase: nextPhase,
    isDone: false,
    scanned: page.page.length,
  };
}

export async function finalizePublisherAbuseScoresPageInternalHandler(
  ctx: MutationCtx,
  args: { runId: Id<"publisherAbuseScoreRuns">; batchSize?: number },
): Promise<PageResult> {
  const run = await requireRunningRun(ctx, args.runId);
  if (run.phase === "completed") {
    return { runId: run._id, status: run.status, phase: run.phase, isDone: true };
  }
  if (run.phase !== "finalizing") {
    return { runId: run._id, status: run.status, phase: run.phase, isDone: false };
  }

  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const now = Date.now();
  const cohortStats = summarizePublisherAbuseFinalizationCohort(run);
  const { meanLogPressure, stdDevLogPressure } = summarizePublisherAbuseLogPressure(
    cohortStats.sumLogPressure,
    cohortStats.sumSquaredLogPressure,
    cohortStats.scoredPublishers,
  );
  const safeStdDev = stdDevLogPressure === 0 ? 1 : stdDevLogPressure;
  const page = await ctx.db
    .query("publisherAbuseScores")
    .withIndex("by_run_and_pressure", (q) => q.eq("runId", run._id))
    .order("desc")
    .paginate({ cursor: run.finalizeCursor ?? null, numItems: batchSize });

  const labelCounts: Record<PublisherAbuseLabel, number> = {
    pass: 0,
    review: 0,
    potential_ban_candidate: 0,
  };
  let nominations = 0;
  let finalized = 0;
  let ranked = 0;
  const rankedScoresSoFar = run.passCount + run.reviewCount + run.potentialBanCandidateCount;
  const modelConfig = run.modelConfig;
  for (const score of page.page) {
    if (await isPublisherAbuseScoreExcluded(ctx, score)) {
      finalized += 1;
      continue;
    }
    const zScore = isPublisherAbuseCheckEligible(score, modelConfig)
      ? (score.logPressure - meanLogPressure) / safeStdDev
      : 0;
    const label = labelForPublisherAbuseScore(score, zScore, modelConfig);
    const rank = rankedScoresSoFar + ranked + 1;
    labelCounts[label] += 1;
    ranked += 1;
    finalized += 1;

    await ctx.db.patch(score._id, { zScore, label, rank });
    if (label !== "pass") {
      await upsertPublisherAbuseReviewNomination(ctx, {
        score: { ...score, zScore, label, rank },
        run,
        now,
      });
      nominations += 1;
    } else {
      await updateExistingPublisherAbuseReviewNominationForPass(ctx, {
        score: { ...score, zScore, label, rank },
        run,
        now,
      });
    }
  }

  const nextPhase: RunPhase = page.isDone ? "completed" : "finalizing";
  const nextStatus: ScoreRun["status"] = page.isDone ? "completed" : "running";
  await ctx.db.patch(run._id, {
    phase: nextPhase,
    status: nextStatus,
    finalizeCursor: page.isDone ? undefined : page.continueCursor,
    finalizedScores: run.finalizedScores + finalized,
    nominatedPublishers: run.nominatedPublishers + nominations,
    passCount: run.passCount + labelCounts.pass,
    reviewCount: run.reviewCount + labelCounts.review,
    potentialBanCandidateCount:
      run.potentialBanCandidateCount + labelCounts.potential_ban_candidate,
    meanLogPressure,
    stdDevLogPressure,
    completedAt: page.isDone ? now : undefined,
    updatedAt: now,
  });

  return {
    runId: run._id,
    status: nextStatus,
    phase: nextPhase,
    isDone: page.isDone,
    finalized,
    nominations,
  };
}

export async function markPublisherAbuseScoreRunFailedInternalHandler(
  ctx: MutationCtx,
  args: { runId: Id<"publisherAbuseScoreRuns">; errorMessage: string },
): Promise<RunState> {
  const run = await ctx.db.get(args.runId);
  if (!run) throw new Error("Publisher abuse score run not found");
  if (run.status !== "running") {
    return { runId: run._id, status: run.status, phase: run.phase };
  }

  const now = Date.now();
  await ctx.db.patch(run._id, {
    status: "failed",
    errorMessage: args.errorMessage,
    updatedAt: now,
  });
  return { runId: run._id, status: "failed", phase: run.phase };
}

export async function runPublisherAbuseScoreRunInternalHandler(
  ctx: ActionCtx,
  args: {
    runId?: Id<"publisherAbuseScoreRuns">;
    batchSize?: number;
    maxPages?: number;
    forceNew?: boolean;
    trigger?: "cron" | "manual";
    actorUserId?: Id<"users">;
  },
): Promise<{ ok: true; runId: Id<"publisherAbuseScoreRuns">; pages: number; isDone: boolean }> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxPages = clampInt(args.maxPages ?? DEFAULT_MAX_PAGES, 1, MAX_MAX_PAGES);
  let state: RunState = args.runId
    ? await ctx.runQuery(internal.publisherAbuse.getPublisherAbuseScoreRunStateInternal, {
        runId: args.runId,
      })
    : await ctx.runMutation(internal.publisherAbuse.getOrStartPublisherAbuseScoreRunInternal, {
        trigger: args.trigger ?? "cron",
        actorUserId: args.actorUserId,
        forceNew: args.forceNew,
      });
  let pages = 0;

  if (state.status !== "running") {
    return { ok: true, runId: state.runId, pages, isDone: true };
  }

  try {
    while (pages < maxPages) {
      let result: PageResult;
      if (state.phase === "collecting") {
        result = await ctx.runMutation(
          internal.publisherAbuse.collectPublisherAbuseScoresPageInternal,
          {
            runId: state.runId,
            batchSize,
          },
        );
      } else if (state.phase === "finalizing") {
        result = await ctx.runMutation(
          internal.publisherAbuse.finalizePublisherAbuseScoresPageInternal,
          {
            runId: state.runId,
            batchSize,
          },
        );
      } else {
        return { ok: true, runId: state.runId, pages, isDone: true };
      }

      pages += 1;
      state = { runId: result.runId, status: result.status, phase: result.phase };
      if (result.isDone && result.phase === "completed") {
        return { ok: true, runId: result.runId, pages, isDone: true };
      }
    }
  } catch (error) {
    await ctx.runMutation(internal.publisherAbuse.markPublisherAbuseScoreRunFailedInternal, {
      runId: state.runId,
      errorMessage: errorMessageFromUnknown(error),
    });
    throw error;
  }

  await ctx.scheduler.runAfter(
    ACTION_CONTINUATION_DELAY_MS,
    internal.publisherAbuse.runPublisherAbuseScoreRunInternal,
    {
      runId: state.runId,
      batchSize,
      maxPages,
      trigger: args.trigger ?? "cron",
    },
  );
  return { ok: true, runId: state.runId, pages, isDone: false };
}

export async function collectTemporalPublisherAbuseSkillCandidatesPageInternalHandler(
  ctx: QueryCtx,
  args: {
    mode: TemporalAbuseMode;
    cursor?: string;
    batchSize?: number;
    todayDay?: number;
    lookbackDays?: number;
  },
): Promise<TemporalSkillCandidatesPage> {
  const todayDay = args.todayDay ?? toDayKey(Date.now());
  const lookbackDays =
    args.mode === "backfill"
      ? clampInt(
          args.lookbackDays ?? DEFAULT_BACKFILL_TEMPORAL_LOOKBACK_DAYS,
          CURRENT_TEMPORAL_LOOKBACK_DAYS,
          MAX_BACKFILL_TEMPORAL_LOOKBACK_DAYS,
        )
      : CURRENT_TEMPORAL_LOOKBACK_DAYS;
  const batchSize = temporalBatchSizeForLookback(
    args.batchSize ?? DEFAULT_TEMPORAL_BATCH_SIZE,
    lookbackDays,
  );
  const startDay = todayDay - lookbackDays + 1;
  const page = await ctx.db
    .query("skills")
    .withIndex("by_active_stats_downloads", (q) => q.eq("softDeletedAt", undefined))
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

  const candidates: TemporalSkillCandidate[] = [];
  for (const skill of page.page) {
    if (!skill.ownerPublisherId) continue;
    const dailyStats = await ctx.db
      .query("skillDailyStats")
      .withIndex("by_skill_day", (q) =>
        q.eq("skillId", skill._id).gte("day", startDay).lte("day", todayDay),
      )
      .take(lookbackDays);
    const temporalScore =
      args.mode === "backfill"
        ? computeHistoricalSkillTemporalAbuseScore({ dailyStats })
        : computeCurrentSkillTemporalAbuseScore({ todayDay, dailyStats });

    const publisher = await ctx.db.get(skill.ownerPublisherId);
    if (!publisher || (await isPublisherExcludedFromPublisherAbuse(ctx, publisher))) continue;
    candidates.push({
      ownerKey: `publisher:${publisher._id}`,
      ownerPublisherId: publisher._id,
      ownerUserId: publisher.linkedUserId,
      handleSnapshot: publisher.handle,
      skillId: skill._id,
      slug: skill.slug,
      displayName: skill.displayName,
      totalDownloads: readCanonicalStat(skill, "downloads"),
      totalInstalls: readCanonicalStat(skill, "installsAllTime"),
      temporalScore,
    });
  }

  return {
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
    scannedSkills: page.page.length,
    candidates,
  };
}

export async function persistTemporalPublisherAbuseCandidatesInternalHandler(
  ctx: MutationCtx,
  args: {
    mode: TemporalAbuseMode;
    trigger: "cron" | "manual";
    actorUserId?: Id<"users">;
    candidates: TemporalSkillCandidate[];
    benchmark: TemporalAbuseCohortBenchmark;
    scanComplete: boolean;
  },
): Promise<{
  runId: Id<"publisherAbuseScoreRuns">;
  nominations: number;
  flaggedPublishers: number;
}> {
  const aggregates = aggregateTemporalPublisherCandidates(args.candidates);
  const runId = await createTemporalPublisherAbuseScoreRun(ctx, {
    trigger: args.trigger,
    actorUserId: args.actorUserId,
    benchmark: args.benchmark,
  });
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Temporal publisher abuse score run not found");

  const now = Date.now();
  let nominations = 0;
  let rank = 0;
  const sortedAggregates = [...aggregates].sort(
    (left, right) =>
      right.highTemporalSkillCount - left.highTemporalSkillCount ||
      right.maxTemporalPressure - left.maxTemporalPressure ||
      left.handleSnapshot.localeCompare(right.handleSnapshot),
  );
  for (const aggregate of sortedAggregates) {
    rank += 1;
    const label = labelForTemporalPublisherAbuse({
      highTemporalSkillCount: aggregate.highTemporalSkillCount,
      p99TemporalSkillCount: aggregate.p99TemporalSkillCount,
    });
    if (label === "pass") continue;
    const pressure = 1_000 + aggregate.highTemporalSkillCount * 100 + aggregate.maxTemporalPressure;
    const zScore = computeTemporalPublisherAbuseZScore({
      label,
      highTemporalSkillCount: aggregate.highTemporalSkillCount,
      maxTemporalPressure: aggregate.maxTemporalPressure,
    });
    const scoreData = {
      runId,
      ownerKey: aggregate.ownerKey,
      ownerPublisherId: aggregate.ownerPublisherId,
      ownerUserId: aggregate.ownerUserId,
      handleSnapshot: aggregate.handleSnapshot,
      modelVersion: PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
      label,
      rank,
      pressure,
      logPressure: Math.log10(Math.max(pressure, 1)),
      zScore,
      publishedSkills: aggregate.highTemporalSkillCount,
      totalInstalls: aggregate.totalInstalls,
      totalStars: 0,
      totalDownloads: aggregate.totalDownloads,
      installsPerSkill: aggregate.totalInstalls / Math.max(1, aggregate.highTemporalSkillCount),
      starsPerSkill: 0,
      downloadsPerSkill: aggregate.totalDownloads / Math.max(1, aggregate.highTemporalSkillCount),
      reasonCodes: aggregate.reasonCodes,
      temporalHighSkillCount: aggregate.highTemporalSkillCount,
      temporalSpikeSkillCount: aggregate.spikeSkillCount,
      temporalSustainedSkillCount: aggregate.sustainedSkillCount,
      temporalMaxPressure: aggregate.maxTemporalPressure,
      temporalBenchmark: args.benchmark,
      temporalEvidence: aggregate.evidence
        .sort((left, right) => right.temporalScore.pressure - left.temporalScore.pressure)
        .slice(0, MAX_TEMPORAL_EVIDENCE_SKILLS)
        .map(temporalEvidenceFromCandidate),
      createdAt: now,
    };
    const scoreId = await ctx.db.insert("publisherAbuseScores", scoreData);
    await upsertPublisherAbuseReviewNomination(ctx, {
      score: { _id: scoreId, _creationTime: now, ...scoreData } as ScoreDoc,
      run,
      now,
    });
    nominations += 1;
  }
  const clearedNominations =
    args.mode === "current" && args.scanComplete
      ? await clearStaleTemporalPublisherAbuseNominations(ctx, {
          run,
          activeOwnerKeys: new Set(sortedAggregates.map((aggregate) => aggregate.ownerKey)),
          startingRank: sortedAggregates.length,
          now,
        })
      : 0;

  await ctx.db.patch(runId, {
    status: "completed",
    phase: "completed",
    scannedPublishers: sortedAggregates.length + clearedNominations,
    scoredPublishers: sortedAggregates.length + clearedNominations,
    finalizedScores: sortedAggregates.length + clearedNominations,
    nominatedPublishers: nominations,
    passCount: clearedNominations,
    reviewCount: sortedAggregates.filter(
      (aggregate) =>
        labelForTemporalPublisherAbuse({
          highTemporalSkillCount: aggregate.highTemporalSkillCount,
          p99TemporalSkillCount: aggregate.p99TemporalSkillCount,
        }) === "review",
    ).length,
    potentialBanCandidateCount: sortedAggregates.filter(
      (aggregate) =>
        labelForTemporalPublisherAbuse({
          highTemporalSkillCount: aggregate.highTemporalSkillCount,
          p99TemporalSkillCount: aggregate.p99TemporalSkillCount,
        }) === "potential_ban_candidate",
    ).length,
    completedAt: now,
    updatedAt: now,
  });

  return { runId, nominations, flaggedPublishers: sortedAggregates.length };
}

export async function runTemporalPublisherAbuseScanInternalHandler(
  ctx: ActionCtx,
  args: {
    mode?: TemporalAbuseMode;
    dryRun?: boolean;
    candidateLimit?: number;
    batchSize?: number;
    maxPages?: number;
    todayDay?: number;
    lookbackDays?: number;
    trigger?: "cron" | "manual";
    actorUserId?: Id<"users">;
  },
): Promise<{
  ok: true;
  dryRun: boolean;
  mode: TemporalAbuseMode;
  scannedSkills: number;
  highTemporalSkills: number;
  flaggedPublishers: number;
  nominations: number;
  candidates?: TemporalSkillCandidate[];
  benchmark: TemporalAbuseCohortBenchmark;
}> {
  const mode = args.mode ?? "current";
  const dryRun = args.dryRun ?? false;
  const candidateLimit = clampInt(
    args.candidateLimit ?? DEFAULT_TEMPORAL_CANDIDATE_LIMIT,
    1,
    MAX_TEMPORAL_CANDIDATE_LIMIT,
  );
  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_TEMPORAL_BATCH_SIZE,
    1,
    MAX_TEMPORAL_BATCH_SIZE,
  );
  const maxPages = clampInt(args.maxPages ?? DEFAULT_TEMPORAL_MAX_PAGES, 1, MAX_TEMPORAL_MAX_PAGES);

  let cursor: string | undefined;
  let scannedSkills = 0;
  let pages = 0;
  let scanComplete = false;
  const candidates: TemporalSkillCandidate[] = [];
  while (pages < maxPages && scannedSkills < candidateLimit) {
    const result: TemporalSkillCandidatesPage = await ctx.runQuery(
      internal.publisherAbuse.collectTemporalPublisherAbuseSkillCandidatesPageInternal,
      {
        mode,
        cursor,
        batchSize: Math.min(batchSize, candidateLimit - scannedSkills),
        todayDay: args.todayDay,
        lookbackDays: args.lookbackDays,
      },
    );
    pages += 1;
    scannedSkills += result.scannedSkills;
    candidates.push(...result.candidates);
    cursor = result.cursor;
    if (result.isDone || !cursor) {
      scanComplete = true;
      break;
    }
  }

  const benchmark = computeTemporalAbuseCohortBenchmark(
    candidates.map((candidate) => candidate.temporalScore),
  );
  const highTemporalCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      temporalScore: classifySkillTemporalAbuseScore(candidate.temporalScore, benchmark),
    }))
    .filter(
      (candidate) =>
        candidate.temporalScore.spike ||
        candidate.temporalScore.sustained ||
        candidate.temporalScore.nearConversion,
    );

  const flaggedPublishers = aggregateTemporalPublisherCandidates(highTemporalCandidates).length;
  if (dryRun || (mode !== "current" && highTemporalCandidates.length === 0)) {
    return {
      ok: true,
      dryRun,
      mode,
      scannedSkills,
      highTemporalSkills: highTemporalCandidates.length,
      flaggedPublishers,
      nominations: 0,
      benchmark,
      ...(dryRun
        ? { candidates: highTemporalCandidates.slice(0, MAX_TEMPORAL_DRY_RUN_CANDIDATES) }
        : {}),
    };
  }

  const persisted: { nominations: number; flaggedPublishers: number } = await ctx.runMutation(
    internal.publisherAbuse.persistTemporalPublisherAbuseCandidatesInternal,
    {
      mode,
      trigger: args.trigger ?? "cron",
      actorUserId: args.actorUserId,
      candidates: highTemporalCandidates,
      benchmark,
      scanComplete,
    },
  );
  return {
    ok: true,
    dryRun,
    mode,
    scannedSkills,
    highTemporalSkills: highTemporalCandidates.length,
    flaggedPublishers: persisted.flaggedPublishers,
    nominations: persisted.nominations,
    benchmark,
  };
}

async function clearStaleTemporalPublisherAbuseNominations(
  ctx: Pick<MutationCtx, "db">,
  args: {
    run: ScoreRun;
    activeOwnerKeys: Set<string>;
    startingRank: number;
    now: number;
  },
) {
  let cleared = 0;
  for (const label of [
    "potential_ban_candidate",
    "review",
  ] satisfies PendingPublisherAbuseReviewLabel[]) {
    const nominations = await ctx.db
      .query("publisherAbuseReviewNominations")
      .withIndex("by_status_and_model_version_and_label_and_last_scored_at", (q) =>
        q
          .eq("status", "pending")
          .eq("modelVersion", PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION)
          .eq("label", label),
      )
      .order("desc")
      .take(MAX_TEMPORAL_STALE_NOMINATION_CLEARS - cleared);
    for (const nomination of nominations) {
      if (args.activeOwnerKeys.has(nomination.ownerKey)) continue;
      const scoreData = {
        runId: args.run._id,
        ownerKey: nomination.ownerKey,
        ownerPublisherId: nomination.ownerPublisherId,
        ownerUserId: nomination.ownerUserId,
        handleSnapshot: nomination.handleSnapshot,
        modelVersion: PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
        label: "pass" as const,
        rank: args.startingRank + cleared + 1,
        pressure: 0,
        logPressure: 0,
        zScore: 0,
        publishedSkills: 0,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 0,
        installsPerSkill: 0,
        starsPerSkill: 0,
        downloadsPerSkill: 0,
        reasonCodes: [],
        temporalHighSkillCount: 0,
        temporalSpikeSkillCount: 0,
        temporalSustainedSkillCount: 0,
        temporalMaxPressure: 0,
        temporalEvidence: [],
        createdAt: args.now,
      };
      const scoreId = await ctx.db.insert("publisherAbuseScores", scoreData);
      await updateExistingPublisherAbuseReviewNominationForPass(ctx, {
        score: { _id: scoreId, _creationTime: args.now, ...scoreData } as ScoreDoc,
        run: args.run,
        now: args.now,
      });
      cleared += 1;
      if (cleared >= MAX_TEMPORAL_STALE_NOMINATION_CLEARS) return cleared;
    }
  }
  return cleared;
}

async function createPublisherAbuseScoreRun(
  ctx: Pick<MutationCtx, "db">,
  args: {
    trigger: "cron" | "manual";
    actorUserId?: Id<"users">;
  },
) {
  const now = Date.now();
  return await ctx.db.insert("publisherAbuseScoreRuns", {
    modelVersion: DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.modelVersion,
    modelConfig: DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
    trigger: args.trigger,
    actorUserId: args.actorUserId,
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
  });
}

async function createTemporalPublisherAbuseScoreRun(
  ctx: Pick<MutationCtx, "db">,
  args: {
    trigger: "cron" | "manual";
    actorUserId?: Id<"users">;
    benchmark?: TemporalAbuseCohortBenchmark;
  },
) {
  const now = Date.now();
  return await ctx.db.insert("publisherAbuseScoreRuns", {
    modelVersion: PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
    modelConfig: DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
    trigger: args.trigger,
    actorUserId: args.actorUserId,
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
    temporalBenchmark: args.benchmark,
  });
}

function aggregateTemporalPublisherCandidates(candidates: TemporalSkillCandidate[]) {
  const byOwner = new Map<string, TemporalPublisherAggregate>();
  for (const candidate of candidates) {
    const existing = byOwner.get(candidate.ownerKey) ?? {
      ownerKey: candidate.ownerKey,
      ownerPublisherId: candidate.ownerPublisherId,
      ownerUserId: candidate.ownerUserId,
      handleSnapshot: candidate.handleSnapshot,
      highTemporalSkillCount: 0,
      p99TemporalSkillCount: 0,
      spikeSkillCount: 0,
      sustainedSkillCount: 0,
      maxTemporalPressure: 0,
      totalDownloads: 0,
      totalInstalls: 0,
      reasonCodes: [],
      evidence: [],
    };
    existing.highTemporalSkillCount += 1;
    if (
      candidate.temporalScore.downloads30dCohortBand === "p99" ||
      candidate.temporalScore.spikeMultiplierCohortBand === "p99"
    ) {
      existing.p99TemporalSkillCount += 1;
    }
    if (candidate.temporalScore.spike) existing.spikeSkillCount += 1;
    if (candidate.temporalScore.sustained) existing.sustainedSkillCount += 1;
    existing.maxTemporalPressure = Math.max(
      existing.maxTemporalPressure,
      candidate.temporalScore.pressure,
    );
    existing.totalDownloads += nonNegative(candidate.totalDownloads);
    existing.totalInstalls += nonNegative(candidate.totalInstalls);
    existing.reasonCodes = uniqueStrings([
      ...existing.reasonCodes,
      ...candidate.temporalScore.reasonCodes,
    ]);
    existing.evidence.push(candidate);
    byOwner.set(candidate.ownerKey, existing);
  }
  return [...byOwner.values()];
}

function temporalEvidenceFromCandidate(candidate: TemporalSkillCandidate) {
  return {
    skillId: candidate.skillId,
    slug: candidate.slug,
    displayName: candidate.displayName,
    spike: candidate.temporalScore.spike,
    sustained: candidate.temporalScore.sustained,
    nearConversion: candidate.temporalScore.nearConversion,
    pressure: candidate.temporalScore.pressure,
    recent7Downloads: candidate.temporalScore.recent7Downloads,
    recent7Installs: candidate.temporalScore.recent7Installs,
    previous30Downloads: candidate.temporalScore.previous30Downloads,
    baseline7Downloads: candidate.temporalScore.baseline7Downloads,
    spikeMultiplier: candidate.temporalScore.spikeMultiplier,
    recent30Downloads: candidate.temporalScore.recent30Downloads,
    recent30Installs: candidate.temporalScore.recent30Installs,
    downloadInstallRatio30: candidate.temporalScore.downloadInstallRatio30,
    downloads30dCohortBand: candidate.temporalScore.downloads30dCohortBand,
    spikeMultiplierCohortBand: candidate.temporalScore.spikeMultiplierCohortBand,
    downloads30dVsPeerP95: candidate.temporalScore.downloads30dVsPeerP95,
    spikeMultiplierVsPeerP95: candidate.temporalScore.spikeMultiplierVsPeerP95,
    installDownloadRatio7: candidate.temporalScore.installDownloadRatio7,
    installDownloadRatio30: candidate.temporalScore.installDownloadRatio30,
    installDownloadExcessZScore7: candidate.temporalScore.installDownloadExcessZScore7,
    installDownloadExcessZScore30: candidate.temporalScore.installDownloadExcessZScore30,
    spikeWindowStartDay: candidate.temporalScore.spikeWindowStartDay,
    spikeWindowEndDay: candidate.temporalScore.spikeWindowEndDay,
    sustainedWindowStartDay: candidate.temporalScore.sustainedWindowStartDay,
    sustainedWindowEndDay: candidate.temporalScore.sustainedWindowEndDay,
    nearConversionWindowStartDay: candidate.temporalScore.nearConversionWindowStartDay,
    nearConversionWindowEndDay: candidate.temporalScore.nearConversionWindowEndDay,
    reasonCodes: candidate.temporalScore.reasonCodes,
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function getActivePublisherAbuseScoreRun(ctx: Pick<MutationCtx, "db">) {
  return await ctx.db
    .query("publisherAbuseScoreRuns")
    .withIndex("by_status_and_updated_at", (q) => q.eq("status", "running"))
    .order("desc")
    .first();
}

async function requireRunningRun(
  ctx: Pick<MutationCtx, "db">,
  runId: Id<"publisherAbuseScoreRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Publisher abuse score run not found");
  if (run.status !== "running") {
    throw new Error(`Publisher abuse score run is ${run.status}`);
  }
  return run;
}

async function publisherInputFromPublisher(
  ctx: Pick<MutationCtx, "db">,
  publisher: PublisherMetricsDoc,
  options: PublisherSkillMetricsOptions,
): Promise<PublisherAbuseInput | null> {
  const publishedPackages =
    typeof publisher.publishedPackages === "number"
      ? nonNegative(publisher.publishedPackages)
      : undefined;
  const skillMetrics = await publisherSkillMetricsForScoring(
    ctx,
    publisher,
    publishedPackages,
    options,
  );
  if (!skillMetrics) return null;
  return {
    ownerKey: `publisher:${publisher._id}`,
    ownerPublisherId: publisher._id,
    ownerUserId: publisher.linkedUserId,
    handleSnapshot: publisher.handle,
    publishedSkills: skillMetrics.publishedSkills,
    totalInstalls: skillMetrics.totalInstalls,
    totalStars: skillMetrics.totalStars,
    totalDownloads: skillMetrics.totalDownloads,
  };
}

async function isPublisherExcludedFromPublisherAbuse(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  publisher: PublisherAbuseExclusionPublisher | null | undefined,
) {
  if (!publisher) return false;
  if (publisher.kind !== "user" && publisher.kind !== "org") return false;
  return await hasOfficialPublisherRow(ctx, publisher._id);
}

async function isPublisherAbuseExcludedReviewItem(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  item: PublisherAbuseReviewItem,
) {
  return await isPublisherExcludedFromPublisherAbuse(ctx, item.publisher);
}

async function isPublisherAbuseScoreExcluded(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  score: Pick<ScoreDoc, "ownerPublisherId">,
) {
  if (!score.ownerPublisherId) return false;
  const publisher = await ctx.db.get(score.ownerPublisherId);
  return await isPublisherExcludedFromPublisherAbuse(ctx, publisher);
}

async function requirePublisherAbuseNominationNotExcluded(
  ctx: Pick<MutationCtx, "db">,
  nomination: Doc<"publisherAbuseReviewNominations">,
) {
  if (!nomination.ownerPublisherId) return;
  const publisher = await ctx.db.get(nomination.ownerPublisherId);
  if (!(await isPublisherExcludedFromPublisherAbuse(ctx, publisher))) return;
  throw new Error("Official publisher abuse nominations cannot be acted on.");
}

function summarizePublisherAbuseFinalizationCohort(run: ScoreRun) {
  const scoredPublishers = Math.max(0, run.scoredPublishers);
  if (scoredPublishers === 0) {
    return { scoredPublishers, sumLogPressure: 0, sumSquaredLogPressure: 0 };
  }
  return {
    scoredPublishers,
    sumLogPressure: run.sumLogPressure,
    sumSquaredLogPressure: run.sumSquaredLogPressure,
  };
}

type SkillMetricsForScoring = Pick<
  PublisherAbuseInput,
  "publishedSkills" | "totalInstalls" | "totalStars" | "totalDownloads"
>;

async function publisherSkillMetricsForScoring(
  ctx: Pick<MutationCtx, "db">,
  publisher: PublisherMetricsDoc,
  publishedPackages: number | undefined,
  options: PublisherSkillMetricsOptions,
): Promise<SkillMetricsForScoring | null> {
  const hasPublishedSkillCount = typeof publisher.publishedSkills === "number";
  if (!hasPublishedSkillCount) {
    if (!options.allowActiveSkillScan) return null;
    if (!options.allowMissingPublishedSkillCountScan) return null;
    if (!consumeActiveSkillFallbackBudget(options.activeSkillFallbackBudget)) return null;
    return await computePublisherSkillMetricsForScoring(ctx, publisher._id);
  }

  const publishedSkills = nonNegative(publisher.publishedSkills);
  if (publishedSkills === 0) {
    return {
      publishedSkills,
      totalInstalls: 0,
      totalStars: 0,
      totalDownloads: 0,
    };
  }

  if (
    typeof publisher.skillTotalInstalls === "number" &&
    typeof publisher.skillTotalStars === "number" &&
    typeof publisher.skillTotalDownloads === "number"
  ) {
    return {
      publishedSkills,
      totalInstalls: nonNegative(publisher.skillTotalInstalls),
      totalStars: nonNegative(publisher.skillTotalStars),
      totalDownloads: nonNegative(publisher.skillTotalDownloads),
    };
  }

  const hasBaseEngagementTotals =
    typeof publisher.totalInstalls === "number" &&
    typeof publisher.totalStars === "number" &&
    typeof publisher.totalDownloads === "number";
  if (publishedPackages === 0 && hasBaseEngagementTotals) {
    return {
      publishedSkills,
      totalInstalls: nonNegative(publisher.totalInstalls),
      totalStars: nonNegative(publisher.totalStars),
      totalDownloads: nonNegative(publisher.totalDownloads),
    };
  }

  if (!options.allowActiveSkillScan) return null;
  if (!consumeActiveSkillFallbackBudget(options.activeSkillFallbackBudget)) return null;

  const metrics = await computePublisherSkillMetricsForScoring(ctx, publisher._id);
  if (!metrics) return null;
  return { ...metrics, publishedSkills };
}

async function computePublisherSkillMetricsForScoring(
  ctx: Pick<MutationCtx, "db">,
  publisherId: Id<"publishers">,
): Promise<SkillMetricsForScoring | null> {
  let publishedSkills = 0;
  let totalInstalls = 0;
  let totalStars = 0;
  let totalDownloads = 0;
  const skills = await ctx.db
    .query("skills")
    .withIndex("by_owner_publisher_active_updated", (q) =>
      q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
    )
    .take(MAX_ACTIVE_SKILL_FALLBACK_SCAN + 1);
  if (skills.length > MAX_ACTIVE_SKILL_FALLBACK_SCAN) return null;
  for (const skill of skills) {
    const contribution = getSkillPublisherContribution(skill);
    publishedSkills += contribution.publishedSkills;
    totalInstalls += contribution.skillTotalInstalls;
    totalStars += contribution.skillTotalStars;
    totalDownloads += contribution.skillTotalDownloads;
  }
  return { publishedSkills, totalInstalls, totalStars, totalDownloads };
}

function consumeActiveSkillFallbackBudget(budget: ActiveSkillFallbackBudget) {
  if (budget.remainingScans <= 0) return false;
  budget.remainingScans -= 1;
  return true;
}

async function upsertPublisherAbuseReviewNomination(
  ctx: Pick<MutationCtx, "db">,
  args: {
    score: ScoreDoc;
    run: ScoreRun;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_owner_key_and_model_version", (q) =>
      q.eq("ownerKey", args.score.ownerKey).eq("modelVersion", args.score.modelVersion),
    )
    .first();

  if (existing) {
    const shouldReopen =
      (isReopenableNominationStatus(existing.status) &&
        isPublisherAbuseLabelEscalation(existing.label, args.score.label)) ||
      (await isBannedNominationForActiveOwner(ctx, existing, args.score));
    await ctx.db.patch(existing._id, {
      latestScoreId: args.score._id,
      label: args.score.label,
      ownerPublisherId: args.score.ownerPublisherId,
      ownerUserId: args.score.ownerUserId,
      handleSnapshot: args.score.handleSnapshot,
      lastScoredAt: args.now,
      updatedAt: args.now,
      ...(shouldReopen
        ? {
            status: "pending" as const,
            reviewedByUserId: undefined,
            reviewedAt: undefined,
          }
        : {}),
    });
    await ctx.db.insert("publisherAbuseReviewEvents", {
      nominationId: existing._id,
      ownerKey: existing.ownerKey,
      runId: args.run._id,
      scoreId: args.score._id,
      eventType: "nomination_score_updated",
      previousLabel: existing.label,
      nextLabel: args.score.label,
      previousStatus: shouldReopen ? existing.status : undefined,
      nextStatus: shouldReopen ? "pending" : undefined,
      createdAt: args.now,
    });
    return existing._id;
  }

  const nominationId = await ctx.db.insert("publisherAbuseReviewNominations", {
    ownerKey: args.score.ownerKey,
    ownerPublisherId: args.score.ownerPublisherId,
    ownerUserId: args.score.ownerUserId,
    handleSnapshot: args.score.handleSnapshot,
    latestScoreId: args.score._id,
    modelVersion: args.score.modelVersion,
    label: args.score.label,
    status: "pending",
    openedAt: args.now,
    openedByRunId: args.run._id,
    lastScoredAt: args.now,
    updatedAt: args.now,
  });
  await ctx.db.insert("publisherAbuseReviewEvents", {
    nominationId,
    ownerKey: args.score.ownerKey,
    runId: args.run._id,
    scoreId: args.score._id,
    eventType: "nomination_opened",
    nextStatus: "pending",
    nextLabel: args.score.label,
    createdAt: args.now,
  });
  return nominationId;
}

async function updateExistingPublisherAbuseReviewNominationForPass(
  ctx: Pick<MutationCtx, "db">,
  args: {
    score: ScoreDoc;
    run: ScoreRun;
    now: number;
  },
) {
  if (!isAggregatePublisherAbuseModelVersion(args.score.modelVersion)) {
    const existing = await ctx.db
      .query("publisherAbuseReviewNominations")
      .withIndex("by_owner_key_and_model_version", (q) =>
        q.eq("ownerKey", args.score.ownerKey).eq("modelVersion", args.score.modelVersion),
      )
      .first();
    if (!existing) return null;
    await markPublisherAbuseReviewNominationAsPass(ctx, { ...args, existing });
    return existing._id;
  }

  const existingNominations = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_owner_key_and_model_version", (q) => q.eq("ownerKey", args.score.ownerKey))
    .take(MAX_OWNER_NOMINATION_VERSION_SCAN);

  let updatedNominationId: Id<"publisherAbuseReviewNominations"> | null = null;
  for (const existing of existingNominations) {
    if (!shouldClearPublisherAbuseReviewNominationForPass(existing, args.score.modelVersion)) {
      continue;
    }
    await markPublisherAbuseReviewNominationAsPass(ctx, { ...args, existing });
    updatedNominationId ??= existing._id;
  }
  return updatedNominationId;
}

function shouldClearPublisherAbuseReviewNominationForPass(
  nomination: Doc<"publisherAbuseReviewNominations">,
  currentModelVersion: string,
) {
  if (nomination.modelVersion === currentModelVersion) return true;
  return (
    nomination.status === "pending" &&
    nomination.label !== "pass" &&
    isAggregatePublisherAbuseModelVersion(nomination.modelVersion)
  );
}

function isAggregatePublisherAbuseModelVersion(modelVersion: string) {
  return modelVersion.startsWith("publisher-abuse-pressure.");
}

async function markPublisherAbuseReviewNominationAsPass(
  ctx: Pick<MutationCtx, "db">,
  args: {
    existing: Doc<"publisherAbuseReviewNominations">;
    score: ScoreDoc;
    run: ScoreRun;
    now: number;
  },
) {
  const { existing } = args;
  await ctx.db.patch(existing._id, {
    latestScoreId: args.score._id,
    label: "pass",
    ownerPublisherId: args.score.ownerPublisherId,
    ownerUserId: args.score.ownerUserId,
    handleSnapshot: args.score.handleSnapshot,
    lastScoredAt: args.now,
    updatedAt: args.now,
  });
  await ctx.db.insert("publisherAbuseReviewEvents", {
    nominationId: existing._id,
    ownerKey: existing.ownerKey,
    runId: args.run._id,
    scoreId: args.score._id,
    eventType: "nomination_score_updated",
    previousLabel: existing.label,
    nextLabel: "pass",
    createdAt: args.now,
  });
  return existing._id;
}

function isReopenableNominationStatus(status: TriageStatus) {
  return (
    status === "reviewed_no_action" ||
    status === "false_positive" ||
    status === "needs_policy_discussion" ||
    status === "candidate_for_future_action"
  );
}

async function isBannedNominationForActiveOwner(
  ctx: Pick<MutationCtx, "db">,
  nomination: Doc<"publisherAbuseReviewNominations">,
  score: ScoreDoc,
) {
  if (nomination.status !== "banned") return false;
  const ownerUserId = score.ownerUserId ?? nomination.ownerUserId;
  if (!ownerUserId) return false;
  const ownerUser = await ctx.db.get(ownerUserId);
  return Boolean(ownerUser && !ownerUser.deletedAt && !ownerUser.deactivatedAt);
}

function isPublisherAbuseLabelEscalation(
  previousLabel: PublisherAbuseLabel,
  nextLabel: PublisherAbuseLabel,
) {
  return publisherAbuseLabelSeverity(nextLabel) > publisherAbuseLabelSeverity(previousLabel);
}

type PublisherAbuseReviewItem = Awaited<ReturnType<typeof summarizePublisherAbuseReviewNomination>>;
type PendingPublisherAbuseReviewLabel = Exclude<PublisherAbuseLabel, "pass">;

async function getPendingPublisherAbuseReviewItemsForLabel(
  ctx: QueryCtx,
  args: {
    status: TriageStatus;
    label: PendingPublisherAbuseReviewLabel;
    limit: number;
    latestCompletedRunId: Id<"publisherAbuseScoreRuns"> | undefined;
  },
) {
  if (!args.latestCompletedRunId) {
    return await getPendingPublisherAbuseReviewItemsForLabelFromLastScoredAt(ctx, args);
  }

  const scoreRankItems = await getPendingPublisherAbuseReviewItemsForLabelFromScoreRank(ctx, {
    latestCompletedRunId: args.latestCompletedRunId,
    status: args.status,
    label: args.label,
    limit: args.limit,
  });
  if (scoreRankItems.length >= args.limit) return scoreRankItems;

  const lastScoredItems = await getPendingPublisherAbuseReviewItemsForLabelFromLastScoredAt(
    ctx,
    args,
  );
  return mergePublisherAbuseReviewItems(scoreRankItems, lastScoredItems, args.limit);
}

function mergePublisherAbuseReviewItems(
  primary: PublisherAbuseReviewItem[],
  fallback: PublisherAbuseReviewItem[],
  limit: number,
) {
  const items = [...primary];
  const seen = new Set(primary.map((item) => item.nomination._id));
  for (const item of fallback) {
    if (seen.has(item.nomination._id)) continue;
    items.push(item);
    seen.add(item.nomination._id);
    if (items.length >= limit) break;
  }
  return items;
}

function scoreRankScanLimit(limit: number) {
  return Math.min(
    limit * MAX_REVIEW_DASHBOARD_SCORE_SCAN_MULTIPLIER,
    MAX_REVIEW_DASHBOARD_SCORE_SCAN,
  );
}

async function getPendingPublisherAbuseReviewItemsForLabelFromScoreRank(
  ctx: QueryCtx,
  args: {
    latestCompletedRunId: Id<"publisherAbuseScoreRuns">;
    status: TriageStatus;
    label: PendingPublisherAbuseReviewLabel;
    limit: number;
  },
) {
  const items: PublisherAbuseReviewItem[] = [];
  const scores = await ctx.db
    .query("publisherAbuseScores")
    .withIndex("by_run_and_label_and_rank", (q) =>
      q.eq("runId", args.latestCompletedRunId).eq("label", args.label),
    )
    .order("asc")
    .take(scoreRankScanLimit(args.limit));

  for (const score of scores) {
    const nomination = await ctx.db
      .query("publisherAbuseReviewNominations")
      .withIndex("by_owner_key_and_model_version", (q) =>
        q.eq("ownerKey", score.ownerKey).eq("modelVersion", score.modelVersion),
      )
      .first();
    if (
      !nomination ||
      nomination.status !== args.status ||
      nomination.label !== args.label ||
      nomination.latestScoreId !== score._id
    ) {
      continue;
    }
    const item = await summarizePublisherAbuseReviewNomination(ctx, nomination);
    if (!(await isVisiblePublisherAbuseReviewItem(ctx, item))) continue;
    items.push(item);
    if (items.length >= args.limit) break;
  }
  return items;
}

async function getPendingPublisherAbuseReviewItemsForLabelFromLastScoredAt(
  ctx: QueryCtx,
  args: { status: TriageStatus; label: PendingPublisherAbuseReviewLabel; limit: number },
) {
  const items: PublisherAbuseReviewItem[] = [];
  const scanLimit = args.limit * MAX_REVIEW_DASHBOARD_SCAN_MULTIPLIER;
  const nominations = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_status_and_label_and_last_scored_at", (q) =>
      q.eq("status", args.status).eq("label", args.label),
    )
    .order("desc")
    .take(scanLimit);
  const pageItems = await summarizePublisherAbuseReviewNominations(ctx, nominations);
  for (const item of pageItems) {
    if (!(await isVisiblePublisherAbuseReviewItem(ctx, item))) continue;
    items.push(item);
    if (items.length >= args.limit) break;
  }
  return items;
}

async function getLatestPublisherAbuseScoreRun(ctx: QueryCtx) {
  return await ctx.db
    .query("publisherAbuseScoreRuns")
    .withIndex("by_model_version_and_started_at", (q) =>
      q.eq("modelVersion", DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.modelVersion),
    )
    .order("desc")
    .first();
}

async function getRecentResolvedPublisherAbuseReviewItems(ctx: QueryCtx, limit: number) {
  const resolvedStatuses: TriageStatus[] = [
    "banned",
    "reviewed_no_action",
    "false_positive",
    "needs_policy_discussion",
    "candidate_for_future_action",
  ];
  const nominations: Doc<"publisherAbuseReviewNominations">[] = [];
  for (const status of resolvedStatuses) {
    const page = await ctx.db
      .query("publisherAbuseReviewNominations")
      .withIndex("by_status_and_reviewed_at", (q) => q.eq("status", status))
      .order("desc")
      .take(limit * MAX_REVIEW_DASHBOARD_SCAN_MULTIPLIER);
    nominations.push(...page);
  }
  nominations.sort((left, right) => (right.reviewedAt ?? 0) - (left.reviewedAt ?? 0));
  return await summarizeVisiblePublisherAbuseReviewNominations(ctx, nominations, limit);
}

async function summarizePublisherAbuseReviewNominations(
  ctx: QueryCtx,
  nominations: Doc<"publisherAbuseReviewNominations">[],
) {
  const items = [];
  for (const nomination of nominations) {
    items.push(await summarizePublisherAbuseReviewNomination(ctx, nomination));
  }
  return items;
}

async function summarizeVisiblePublisherAbuseReviewNominations(
  ctx: QueryCtx,
  nominations: Doc<"publisherAbuseReviewNominations">[],
  limit?: number,
) {
  const items = [];
  for (const nomination of nominations) {
    const item = await summarizePublisherAbuseReviewNomination(ctx, nomination);
    if (await isVisiblePublisherAbuseReviewItem(ctx, item)) items.push(item);
    if (limit && items.length >= limit) break;
  }
  return items;
}

async function summarizePublisherAbuseReviewNomination(
  ctx: QueryCtx,
  nomination: Doc<"publisherAbuseReviewNominations">,
) {
  const score = await ctx.db.get(nomination.latestScoreId);
  const publisher = nomination.ownerPublisherId
    ? await ctx.db.get(nomination.ownerPublisherId)
    : null;
  const ownerUser = nomination.ownerUserId ? await ctx.db.get(nomination.ownerUserId) : null;
  const openedByRun = await ctx.db.get(nomination.openedByRunId);

  return {
    nomination,
    latestScore: score,
    publisher: publisher ? summarizePublisherForAbuseReview(publisher) : null,
    ownerUser: ownerUser ? summarizeUserForAbuseReview(ownerUser) : null,
    openedByRun: openedByRun ? summarizePublisherAbuseRun(openedByRun) : null,
  };
}

async function isVisiblePublisherAbuseReviewItem(ctx: QueryCtx, item: PublisherAbuseReviewItem) {
  return (
    item.nomination.label !== "pass" &&
    !item.ownerUser?.deletedAt &&
    !item.ownerUser?.deactivatedAt &&
    !item.publisher?.deletedAt &&
    !item.publisher?.deactivatedAt &&
    !(await isPublisherAbuseExcludedReviewItem(ctx, item))
  );
}

function comparePublisherAbuseReviewItemsByLastScoredAt(
  left: PublisherAbuseReviewItem,
  right: PublisherAbuseReviewItem,
) {
  if (left.nomination.lastScoredAt !== right.nomination.lastScoredAt) {
    return right.nomination.lastScoredAt - left.nomination.lastScoredAt;
  }
  return right.nomination._id.localeCompare(left.nomination._id);
}

function summarizePublisherAbuseRun(run: Doc<"publisherAbuseScoreRuns">) {
  const {
    actorUserId: _actorUserId,
    collectCursor: _collectCursor,
    finalizeCursor: _finalizeCursor,
    modelConfig: _modelConfig,
    sumLogPressure: _sumLogPressure,
    sumSquaredLogPressure: _sumSquaredLogPressure,
    ...summary
  } = run;
  return summary;
}

function summarizePublisherForAbuseReview(publisher: Doc<"publishers">) {
  return {
    _id: publisher._id,
    handle: publisher.handle,
    displayName: publisher.displayName,
    kind: publisher.kind,
    linkedUserId: publisher.linkedUserId,
    publishedSkills: publisher.publishedSkills,
    publishedPackages: publisher.publishedPackages,
    totalInstalls: publisher.totalInstalls,
    totalStars: publisher.totalStars,
    totalDownloads: publisher.totalDownloads,
    skillTotalInstalls: publisher.skillTotalInstalls,
    skillTotalStars: publisher.skillTotalStars,
    skillTotalDownloads: publisher.skillTotalDownloads,
    deletedAt: publisher.deletedAt,
    deactivatedAt: publisher.deactivatedAt,
  };
}

function summarizeUserForAbuseReview(user: Doc<"users">) {
  return {
    _id: user._id,
    handle: user.handle,
    name: user.name,
    displayName: user.displayName,
    role: user.role,
    image: user.image,
    deletedAt: user.deletedAt,
    deactivatedAt: user.deactivatedAt,
    banReason: user.banReason,
  };
}

function publisherAbuseLabelSeverity(label: PublisherAbuseLabel) {
  if (label === "potential_ban_candidate") return 2;
  if (label === "review") return 1;
  return 0;
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Publisher abuse score run failed";
}

function nonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function temporalBatchSizeForLookback(requestedBatchSize: number, lookbackDays: number) {
  const maxBatchForLookback = Math.max(
    1,
    Math.floor(MAX_TEMPORAL_DAILY_STAT_READS_PER_PAGE / Math.max(1, lookbackDays)),
  );
  return clampInt(requestedBatchSize, 1, Math.min(MAX_TEMPORAL_BATCH_SIZE, maxBatchForLookback));
}
