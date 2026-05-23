import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, requireUser } from "./lib/access";
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
const QUEUE_INITIAL_CANDIDATE_MULTIPLIER = 4;
const MAX_QUEUE_FILTER_CANDIDATES = 1000;
const MAX_ACTIVE_SKILL_FALLBACK_SCAN = 500;
const MAX_MANUAL_ACTIVE_SKILL_FALLBACK_SCANS_PER_PAGE = 20;

const triageStatusValidator = v.union(
  v.literal("pending"),
  v.literal("reviewed_no_action"),
  v.literal("false_positive"),
  v.literal("needs_policy_discussion"),
  v.literal("candidate_for_future_action"),
);

const dryRunLabelValidator = v.union(
  v.literal("pass"),
  v.literal("review"),
  v.literal("potential_ban_candidate"),
);

const ALL_TRIAGE_STATUSES: TriageStatus[] = [
  "pending",
  "reviewed_no_action",
  "false_positive",
  "needs_policy_discussion",
  "candidate_for_future_action",
];
const ACTIONABLE_REVIEW_LABELS = ["review", "potential_ban_candidate"] as const;

const queueStatusFilterValidator = v.union(
  v.literal("unreviewed"),
  v.literal("reviewed"),
  v.literal("all"),
  v.literal("pending"),
  v.literal("reviewed_no_action"),
  v.literal("false_positive"),
  v.literal("needs_policy_discussion"),
  v.literal("candidate_for_future_action"),
);

type TriageStatus = Doc<"publisherAbuseReviewNominations">["status"];
type ScoreRun = Doc<"publisherAbuseScoreRuns">;
type ScoreDoc = Doc<"publisherAbuseScores">;
type NominationDoc = Doc<"publisherAbuseReviewNominations">;
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
      activeSkillFallbackBudget: ActiveSkillFallbackBudget;
    };

type ActiveSkillFallbackBudget = {
  remainingScans: number;
};

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
  },
  handler: runPublisherAbuseScoreRunInternalHandler,
});

export const startManualPublisherAbuseScoreRun = mutation({
  args: {
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: true; runId: Id<"publisherAbuseScoreRuns"> }> => {
    const { userId, user } = await requireUser(ctx);
    assertAdmin(user);

    const activeRun = await getActivePublisherAbuseScoreRun(ctx);
    if (activeRun) return { ok: true, runId: activeRun._id };

    const runId = await createPublisherAbuseScoreRun(ctx, {
      trigger: "manual",
      actorUserId: userId,
    });
    await ctx.scheduler.runAfter(0, internal.publisherAbuse.runPublisherAbuseScoreRunInternal, {
      runId,
      batchSize: args.batchSize,
      maxPages: args.maxPages,
      trigger: "manual",
    });
    return { ok: true, runId };
  },
});

export const listPublisherAbuseReviewQueue = query({
  args: {
    label: v.optional(v.union(v.literal("all"), dryRunLabelValidator)),
    status: v.optional(queueStatusFilterValidator),
    minSkillCount: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const limit = clampInt(args.limit ?? 50, 1, 100);
    const label = args.label ?? "all";
    const status = args.status ?? "unreviewed";
    const minSkillCount = Math.max(0, args.minSkillCount ?? 0);
    const search = args.search?.trim().toLowerCase() ?? "";
    const hasPostFilters = search.length > 0 || minSkillCount > 0;
    let candidateLimit = limit * QUEUE_INITIAL_CANDIDATE_MULTIPLIER;
    let eligibleItems: Array<{ nomination: NominationDoc; score: ScoreDoc | null }> = [];

    while (true) {
      const nominations = await listNominationsForQueue(ctx, {
        label,
        status,
        limit: candidateLimit,
      });
      const filtered = nominations.filter((nomination) =>
        matchesNominationSearch(nomination, search),
      );

      eligibleItems = [];
      for (const nomination of filtered) {
        const score = await ctx.db.get(nomination.latestScoreId);
        if (score && score.publishedSkills < minSkillCount) continue;
        eligibleItems.push({ nomination, score });
      }

      const hasMoreCandidates = nominations.length >= candidateLimit;
      if (!hasPostFilters || eligibleItems.length >= limit || !hasMoreCandidates) break;
      if (candidateLimit >= MAX_QUEUE_FILTER_CANDIDATES) break;
      candidateLimit = Math.min(candidateLimit * 2, MAX_QUEUE_FILTER_CANDIDATES);
    }

    const latestRun = await ctx.db
      .query("publisherAbuseScoreRuns")
      .withIndex("by_started_at")
      .order("desc")
      .first();

    return {
      latestRun: latestRun ? summarizeRunForQueue(latestRun) : null,
      items: eligibleItems.slice(0, limit),
      total: eligibleItems.length,
    };
  },
});

export const setPublisherAbuseReviewStatus = mutation({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
    status: triageStatusValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    assertAdmin(user);
    const nomination = await ctx.db.get(args.nominationId);
    if (!nomination) throw new Error("Nomination not found");

    const now = Date.now();
    const notes = normalizeNotes(args.notes);
    await ctx.db.patch(nomination._id, {
      status: args.status,
      reviewedByUserId: args.status === "pending" ? undefined : userId,
      reviewedAt: args.status === "pending" ? undefined : now,
      notes,
      updatedAt: now,
    });
    await ctx.db.insert("publisherAbuseReviewEvents", {
      nominationId: nomination._id,
      ownerKey: nomination.ownerKey,
      actorUserId: userId,
      eventType: "triage_status_changed",
      previousStatus: nomination.status,
      nextStatus: args.status,
      notes,
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher_abuse.triage_status.change",
      targetType: "publisher_abuse_nomination",
      targetId: nomination._id,
      metadata: {
        ownerKey: nomination.ownerKey,
        previousStatus: nomination.status,
        nextStatus: args.status,
        notes,
      },
      createdAt: now,
    });

    return { ok: true as const };
  },
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
    remainingScans: MAX_MANUAL_ACTIVE_SKILL_FALLBACK_SCANS_PER_PAGE,
  };
  const publisherSkillMetricsOptions: PublisherSkillMetricsOptions =
    run.trigger === "cron"
      ? { allowActiveSkillScan: false }
      : { allowActiveSkillScan: true, activeSkillFallbackBudget };
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
    if (!consumeActiveSkillFallbackBudget(options.activeSkillFallbackBudget)) return null;
    return await computePublisherSkillMetricsForScoring(ctx, publisher._id);
  }

  const publishedSkills = nonNegative(publisher.publishedSkills);
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

  if (publishedPackages === 0) {
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
      isReviewedNominationStatus(existing.status) &&
      isPublisherAbuseLabelEscalation(existing.label, args.score.label);
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

async function listNominationsForQueue(
  ctx: QueryCtx,
  args: {
    label: PublisherAbuseLabel | "all";
    status: TriageStatus | TriageStatus[] | "unreviewed" | "reviewed" | "all";
    limit: number;
  },
) {
  const statuses = statusesForQueueFilter(args.status);
  if (statuses.length === 0) {
    return await listNominationsForQueue(ctx, {
      label: args.label,
      status: ALL_TRIAGE_STATUSES,
      limit: args.limit,
    });
  }

  const rows: NominationDoc[] = [];
  for (const status of statuses) {
    if (args.label === "all") {
      for (const label of ACTIONABLE_REVIEW_LABELS) {
        const page = await ctx.db
          .query("publisherAbuseReviewNominations")
          .withIndex("by_status_and_label_and_last_scored_at", (q) =>
            q.eq("status", status).eq("label", label),
          )
          .order("desc")
          .take(args.limit);
        rows.push(...page);
      }
      continue;
    }
    const label = args.label;
    const page = await ctx.db
      .query("publisherAbuseReviewNominations")
      .withIndex("by_status_and_label_and_last_scored_at", (q) =>
        q.eq("status", status).eq("label", label),
      )
      .order("desc")
      .take(args.limit);
    rows.push(...page);
  }

  return dedupeNominations(rows)
    .filter((nomination) => args.label === "all" || nomination.label === args.label)
    .sort((left, right) => right.lastScoredAt - left.lastScoredAt)
    .slice(0, args.limit);
}

function statusesForQueueFilter(
  status: TriageStatus | TriageStatus[] | "unreviewed" | "reviewed" | "all",
): TriageStatus[] {
  if (Array.isArray(status)) return status;
  if (status === "all") return [];
  if (status === "unreviewed") {
    return ["pending", "needs_policy_discussion", "candidate_for_future_action"];
  }
  if (status === "reviewed") return ["reviewed_no_action", "false_positive"];
  return [status];
}

function isReviewedNominationStatus(status: TriageStatus) {
  return status === "reviewed_no_action" || status === "false_positive";
}

function isPublisherAbuseLabelEscalation(
  previousLabel: PublisherAbuseLabel,
  nextLabel: PublisherAbuseLabel,
) {
  return publisherAbuseLabelSeverity(nextLabel) > publisherAbuseLabelSeverity(previousLabel);
}

function publisherAbuseLabelSeverity(label: PublisherAbuseLabel) {
  if (label === "potential_ban_candidate") return 2;
  if (label === "review") return 1;
  return 0;
}

function matchesNominationSearch(nomination: NominationDoc, search: string) {
  if (!search) return true;
  return (
    nomination.handleSnapshot.toLowerCase().includes(search) ||
    nomination.ownerKey.toLowerCase().includes(search)
  );
}

function dedupeNominations(rows: NominationDoc[]) {
  const byId = new Map<Id<"publisherAbuseReviewNominations">, NominationDoc>();
  for (const row of rows) byId.set(row._id, row);
  return [...byId.values()];
}

function summarizeRunForQueue(run: ScoreRun) {
  return {
    _id: run._id,
    status: run.status,
    phase: run.phase,
    trigger: run.trigger,
    modelVersion: run.modelVersion,
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
  };
}

function normalizeNotes(notes: string | undefined) {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : undefined;
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
