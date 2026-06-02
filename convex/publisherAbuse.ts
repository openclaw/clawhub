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
import {
  computePublisherAbuseRawScore,
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  labelForPublisherAbuseZScore,
  summarizePublisherAbuseLogPressure,
  type PublisherAbuseInput,
  type PublisherAbuseLabel,
} from "./lib/publisherAbuseScoring";
import { getSkillPublisherContribution } from "./lib/publisherStats";

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_MAX_PAGES = 5;
const MAX_MAX_PAGES = 50;
const ACTION_CONTINUATION_DELAY_MS = 60_000;
const MAX_ACTIVE_SKILL_FALLBACK_SCAN = 500;
const MAX_ACTIVE_SKILL_FALLBACK_SCANS_PER_PAGE = 20;
const MAX_REVIEW_DASHBOARD_SCAN_MULTIPLIER = 3;
const MAX_REVIEW_DASHBOARD_SCORE_SCAN_MULTIPLIER = 32;
const MAX_REVIEW_DASHBOARD_SCORE_SCAN = 2000;
const MAX_BAN_REASON_LENGTH = 500;

type TriageStatus = Doc<"publisherAbuseReviewNominations">["status"];
type ScoreRun = Doc<"publisherAbuseScoreRuns">;
type ScoreDoc = Doc<"publisherAbuseScores">;
type RunPhase = ScoreRun["phase"];

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
  | "handle"
  | "linkedUserId"
  | "publishedSkills"
  | "publishedPackages"
  | "totalInstalls"
  | "totalStars"
  | "totalDownloads"
  | "skillTotalInstalls"
  | "skillTotalStars"
  | "skillTotalDownloads"
>;

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
      scoreHistory: scoreHistory.map(summarizePublisherAbuseScore),
      events: events.map(summarizePublisherAbuseReviewEvent),
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

    const reason = normalizeBanReason(args.reason);
    await ctx.runMutation(internal.users.banUserInternal, {
      actorUserId: user._id,
      targetUserId: nomination.ownerUserId,
      reason,
    });

    const now = Date.now();
    await setPublisherAbuseReviewStatusWithActor(ctx, {
      nomination,
      status: "banned",
      notes: reason,
      actorUserId: user._id,
      now,
    });

    return { ok: true, status: "banned" as const };
  },
});

async function setPublisherAbuseReviewStatusWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    nomination: Doc<"publisherAbuseReviewNominations">;
    status: TriageStatus;
    notes: string | undefined;
    actorUserId: Id<"users">;
    now: number;
  },
) {
  await ctx.db.patch(args.nomination._id, {
    status: args.status,
    reviewedByUserId: args.status === "pending" ? undefined : args.actorUserId,
    reviewedAt: args.status === "pending" ? undefined : args.now,
    notes: args.notes,
    updatedAt: args.now,
  });
  await ctx.db.insert("publisherAbuseReviewEvents", {
    nominationId: args.nomination._id,
    ownerKey: args.nomination.ownerKey,
    actorUserId: args.actorUserId,
    scoreId: args.nomination.latestScoreId,
    eventType: "triage_status_changed",
    previousStatus: args.nomination.status,
    nextStatus: args.status,
    notes: args.notes,
    createdAt: args.now,
  });
}

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
  const { meanLogPressure, stdDevLogPressure } = summarizePublisherAbuseLogPressure(
    run.sumLogPressure,
    run.sumSquaredLogPressure,
    run.scoredPublishers,
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
  const modelConfig = run.modelConfig;
  for (const score of page.page) {
    const zScore = (score.logPressure - meanLogPressure) / safeStdDev;
    const label = labelForPublisherAbuseZScore(zScore, modelConfig);
    const rank = run.finalizedScores + finalized + 1;
    labelCounts[label] += 1;
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
  const existing = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_owner_key_and_model_version", (q) =>
      q.eq("ownerKey", args.score.ownerKey).eq("modelVersion", args.score.modelVersion),
    )
    .first();

  if (!existing) return null;

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
    if (!isVisiblePublisherAbuseReviewItem(item)) continue;
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
    if (!isVisiblePublisherAbuseReviewItem(item)) continue;
    items.push(item);
    if (items.length >= args.limit) break;
  }
  return items;
}

async function getLatestPublisherAbuseScoreRun(ctx: QueryCtx) {
  return await ctx.db
    .query("publisherAbuseScoreRuns")
    .withIndex("by_started_at")
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
      .take(limit);
    nominations.push(...page);
  }
  nominations.sort((left, right) => (right.reviewedAt ?? 0) - (left.reviewedAt ?? 0));
  return await summarizePublisherAbuseReviewNominations(ctx, nominations.slice(0, limit));
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
    nomination: summarizePublisherAbuseNomination(nomination),
    latestScore: score ? summarizePublisherAbuseScore(score) : null,
    publisher: publisher ? summarizePublisherForAbuseReview(publisher) : null,
    ownerUser: ownerUser ? summarizeUserForAbuseReview(ownerUser) : null,
    openedByRun: openedByRun ? summarizePublisherAbuseRun(openedByRun) : null,
  };
}

function isVisiblePublisherAbuseReviewItem(item: PublisherAbuseReviewItem) {
  return (
    item.nomination.label !== "pass" &&
    !item.ownerUser?.deletedAt &&
    !item.ownerUser?.deactivatedAt &&
    !item.publisher?.deletedAt &&
    !item.publisher?.deactivatedAt
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

function summarizePublisherAbuseNomination(nomination: Doc<"publisherAbuseReviewNominations">) {
  return {
    _id: nomination._id,
    ownerKey: nomination.ownerKey,
    ownerPublisherId: nomination.ownerPublisherId,
    ownerUserId: nomination.ownerUserId,
    handleSnapshot: nomination.handleSnapshot,
    latestScoreId: nomination.latestScoreId,
    modelVersion: nomination.modelVersion,
    label: nomination.label,
    status: nomination.status,
    openedAt: nomination.openedAt,
    openedByRunId: nomination.openedByRunId,
    lastScoredAt: nomination.lastScoredAt,
    reviewedByUserId: nomination.reviewedByUserId,
    reviewedAt: nomination.reviewedAt,
    notes: nomination.notes,
    updatedAt: nomination.updatedAt,
  };
}

function summarizePublisherAbuseScore(score: Doc<"publisherAbuseScores">) {
  return {
    _id: score._id,
    runId: score.runId,
    ownerKey: score.ownerKey,
    ownerPublisherId: score.ownerPublisherId,
    ownerUserId: score.ownerUserId,
    handleSnapshot: score.handleSnapshot,
    modelVersion: score.modelVersion,
    label: score.label,
    rank: score.rank,
    pressure: score.pressure,
    logPressure: score.logPressure,
    zScore: score.zScore,
    publishedSkills: score.publishedSkills,
    totalInstalls: score.totalInstalls,
    totalStars: score.totalStars,
    totalDownloads: score.totalDownloads,
    installsPerSkill: score.installsPerSkill,
    starsPerSkill: score.starsPerSkill,
    downloadsPerSkill: score.downloadsPerSkill,
    reasonCodes: score.reasonCodes,
    createdAt: score.createdAt,
  };
}

function summarizePublisherAbuseRun(run: Doc<"publisherAbuseScoreRuns">) {
  return {
    _id: run._id,
    modelVersion: run.modelVersion,
    trigger: run.trigger,
    status: run.status,
    phase: run.phase,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
    scannedPublishers: run.scannedPublishers,
    scoredPublishers: run.scoredPublishers,
    finalizedScores: run.finalizedScores,
    nominatedPublishers: run.nominatedPublishers,
    passCount: run.passCount,
    reviewCount: run.reviewCount,
    potentialBanCandidateCount: run.potentialBanCandidateCount,
    meanLogPressure: run.meanLogPressure,
    stdDevLogPressure: run.stdDevLogPressure,
    errorMessage: run.errorMessage,
  };
}

function summarizePublisherAbuseReviewEvent(event: Doc<"publisherAbuseReviewEvents">) {
  return {
    _id: event._id,
    nominationId: event.nominationId,
    ownerKey: event.ownerKey,
    actorUserId: event.actorUserId,
    runId: event.runId,
    scoreId: event.scoreId,
    eventType: event.eventType,
    previousStatus: event.previousStatus,
    nextStatus: event.nextStatus,
    previousLabel: event.previousLabel,
    nextLabel: event.nextLabel,
    notes: event.notes,
    createdAt: event.createdAt,
  };
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

function normalizeBanReason(rawReason?: string) {
  const reason = rawReason?.trim();
  if (!reason) return undefined;
  return reason.slice(0, MAX_BAN_REASON_LENGTH);
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
