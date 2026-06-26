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
import { assertAdmin, assertModerator, requireUser, requireUserFromAction } from "./lib/access";
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
const MAX_BAN_REASON_LENGTH = 500;
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
const MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_SCAN = 100;
const MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_READS_PER_PAGE = 2_000;
const STAFF_PUBLISHER_MANAGER_ROLES = ["owner", "admin"] as const;
const FAILED_TEMPORAL_NOMINATION_CLEANUP_BATCH_SIZE = 100;
const DEFAULT_AUTOBAN_BATCH_SIZE = 1;
const MAX_AUTOBAN_BATCH_SIZE = 1;
const DEFAULT_AUTOBAN_MAX_PAGES = 50;
const MAX_AUTOBAN_MAX_PAGES = 250;
const PUBLISHER_ABUSE_AUTOBAN_WARNING_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHER_ABUSE_WARNING_PENDING_RETRY_MS = 60 * 60 * 1000;
const PUBLISHER_ABUSE_AUTOBAN_REASON = "publisher_abuse: potential ban candidate";
const TEMPORAL_AUTOBAN_SKIP_NOTE =
  "Autoban skipped: temporal publisher abuse signals require manual review.";
const MISSING_PUBLISHER_AUTOBAN_SKIP_NOTE =
  "Autoban skipped: nomination has no linked publisher row; manual review required.";
const INACTIVE_PUBLISHER_AUTOBAN_SKIP_NOTE = "Autoban skipped: publisher is inactive.";
const STALE_PUBLISHER_LINK_AUTOBAN_SKIP_NOTE =
  "Autoban skipped: publisher is not linked to the nominated user account; manual review required.";
const MISSING_WARNING_EMAIL_AUTOBAN_SKIP_NOTE =
  "Autoban warning skipped: linked user has no email address; manual review required.";
const FAILED_SCORE_RUN_AUTOBAN_SKIP_NOTE =
  "Autoban skipped: score run failed before completion; manual review required.";
const FAILED_TEMPORAL_RUN_NOMINATION_NOTE =
  "Publisher abuse temporal score run failed before completion; rerun required.";
const PUBLISHER_ABUSE_AUTOBAN_SETTING_KEY = "publisherAbuseAutobanEnabled" as const;
const FAILED_TEMPORAL_CLEANUP_LABELS = [
  "potential_ban_candidate",
  "review",
] satisfies PendingPublisherAbuseReviewLabel[];

type TriageStatus = Doc<"publisherAbuseReviewNominations">["status"];
type ScoreRun = Doc<"publisherAbuseScoreRuns">;
type ScoreDoc = Doc<"publisherAbuseScores">;
type RunPhase = ScoreRun["phase"];
type TemporalAbuseMode = "current" | "backfill";

type RunState = {
  runId: Id<"publisherAbuseScoreRuns">;
  status: ScoreRun["status"];
  phase: RunPhase;
  scannedPublishers?: number;
  finalizedScores?: number;
  temporalScanComplete?: boolean;
  temporalBenchmark?: TemporalAbuseCohortBenchmark;
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
  "_id" | "kind" | "linkedUserId" | "deletedAt" | "deactivatedAt"
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

type StaffPublisherManagerExclusionBudget = {
  remainingDocReads: number;
  userStaffCache: Map<Id<"users">, boolean>;
};

type PublisherAbuseAutobanUserResult =
  | {
      ok: false;
      reason:
        | "user_not_found"
        | "protected_role"
        | "missing_reason"
        | "reason_too_long"
        | "nomination_not_actionable";
    }
  | {
      ok: true;
      alreadyBanned: boolean;
      deletedSkills?: number;
      deletedSkillComments?: number;
      scheduledSkills?: boolean;
    };

type PublisherAbuseAutobanPageResult = {
  ok: true;
  processed: number;
  warned: number;
  banned: number;
  alreadyBanned: number;
  skipped: number;
  isDone: boolean;
  cursor?: string;
};

type PublisherAbuseAutobanRunResult = PublisherAbuseAutobanPageResult & {
  pages: number;
};

type PublisherAbuseAutobanEligibility =
  | { kind: "ready" }
  | { kind: "pending_run" }
  | { kind: "defer"; status: TriageStatus; notes: string };

type PublisherAbuseAutobanSettingDoc = Doc<"systemSettings">;

type PublisherAbuseWarningTarget = Pick<Doc<"users">, "_id" | "email" | "handle" | "role">;

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
    const auth = await requirePublisherAbuseDashboardUser(ctx);
    if (!auth) return emptyPublisherAbuseReviewDashboard();
    const { user } = auth;
    assertModerator(user);

    const limit = clampInt(args.limit ?? 150, 1, 250);
    const dashboardExclusionBudget = createStaffPublisherManagerExclusionBudget();
    const latestRun = await getLatestPublisherAbuseScoreRun(ctx);
    const scoreRankRunId = latestRun?.status === "completed" ? latestRun._id : undefined;
    const pendingPotentialBanCandidateItems = await getPendingPublisherAbuseReviewItemsForLabel(
      ctx,
      {
        status: "pending",
        label: "potential_ban_candidate",
        limit,
        latestCompletedRunId: scoreRankRunId,
        staffManagerExclusionBudget: dashboardExclusionBudget,
      },
    );
    const pendingReviewItems = await getPendingPublisherAbuseReviewItemsForLabel(ctx, {
      status: "pending",
      label: "review",
      limit,
      latestCompletedRunId: scoreRankRunId,
      staffManagerExclusionBudget: dashboardExclusionBudget,
    });
    const pendingItems = [...pendingPotentialBanCandidateItems, ...pendingReviewItems]
      .sort(comparePublisherAbuseReviewItemsByLastScoredAt)
      .slice(0, limit);
    const recentResolvedItems = await getRecentResolvedPublisherAbuseReviewItems(
      ctx,
      30,
      dashboardExclusionBudget,
    );

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
    const auth = await requirePublisherAbuseDashboardUser(ctx);
    if (!auth) return null;
    const { user } = auth;
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

export const getPublisherAbuseAutobanSetting = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requirePublisherAbuseDashboardUser(ctx);
    if (!auth) return summarizePublisherAbuseAutobanSetting(null);
    const { user } = auth;
    assertModerator(user);

    const setting = await getPublisherAbuseAutobanSettingDoc(ctx);
    return summarizePublisherAbuseAutobanSetting(setting);
  },
});

async function requirePublisherAbuseDashboardUser(ctx: QueryCtx) {
  try {
    return await requireUser(ctx);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return null;
    throw error;
  }
}

function emptyPublisherAbuseReviewDashboard() {
  return {
    latestRun: null,
    pendingItems: [],
    pendingPotentialBanCandidateItems: [],
    pendingReviewItems: [],
    recentResolvedItems: [],
  };
}

export const setPublisherAbuseAutobanEnabled = mutation({
  args: {
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const now = Date.now();
    const existing = await getPublisherAbuseAutobanSettingDoc(ctx);
    const previousEnabled = existing?.enabled ?? false;
    if (previousEnabled === args.enabled) {
      return summarizePublisherAbuseAutobanSetting(existing);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: now,
        updatedByUserId: user._id,
      });
    } else {
      await ctx.db.insert("systemSettings", {
        key: PUBLISHER_ABUSE_AUTOBAN_SETTING_KEY,
        enabled: args.enabled,
        updatedAt: now,
        updatedByUserId: user._id,
      });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "publisher_abuse.autoban_setting.set",
      targetType: "system",
      targetId: PUBLISHER_ABUSE_AUTOBAN_SETTING_KEY,
      metadata: {
        previousEnabled,
        nextEnabled: args.enabled,
      },
      createdAt: now,
    });

    return {
      enabled: args.enabled,
      updatedAt: now,
      updatedByUserId: user._id,
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
    const ownerUser = await ctx.db.get(nomination.ownerUserId);
    if (!ownerUser) throw new Error("Publisher abuse nomination owner not found");
    if (ownerUser.role === "admin" || ownerUser.role === "moderator") {
      throw new Error("Cannot ban staff accounts through publisher abuse workflow");
    }
    await requirePublisherAbuseNominationNotExcluded(ctx, nomination);
    await requirePublisherAbuseNominationStillTargetsLinkedUser(ctx, nomination);

    const reason = normalizeBanReason(args.reason);
    await ctx.runMutation(internal.users.banUserInternal, {
      actorUserId: user._id,
      targetUserId: nomination.ownerUserId,
      reason: publisherAbuseManualBanReason(reason),
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

export const autoBanPublisherAbuseCandidatesPageInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: autoBanPublisherAbuseCandidatesPageInternalHandler,
});

async function setPublisherAbuseReviewStatusWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    nomination: Doc<"publisherAbuseReviewNominations">;
    status: TriageStatus;
    notes: string | undefined;
    actorUserId?: Id<"users">;
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

async function getPublisherAbuseAutobanEligibility(
  ctx: Pick<MutationCtx, "db">,
  nomination: Doc<"publisherAbuseReviewNominations">,
  score: ScoreDoc | null,
): Promise<PublisherAbuseAutobanEligibility> {
  const scoredByRun = await ctx.db.get(score?.runId ?? nomination.openedByRunId);
  if (!scoredByRun) {
    return {
      kind: "defer",
      status: "needs_policy_discussion",
      notes: "Autoban skipped: score run no longer exists; manual review required.",
    };
  }
  if (scoredByRun.status === "failed") {
    return {
      kind: "defer",
      status: "candidate_for_future_action",
      notes: FAILED_SCORE_RUN_AUTOBAN_SKIP_NOTE,
    };
  }
  if (scoredByRun.modelVersion !== PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION) {
    return { kind: "ready" };
  }
  return {
    kind: "defer",
    status: "candidate_for_future_action",
    notes: TEMPORAL_AUTOBAN_SKIP_NOTE,
  };
}

function isPublisherAbuseWarningReadyForBan(
  nomination: Doc<"publisherAbuseReviewNominations">,
  score: ScoreDoc | null,
  now: number,
) {
  if (!nomination.warningSentAt || !nomination.warningExpiresAt || !nomination.warningScoreId) {
    return false;
  }
  if (nomination.warningExpiresAt > now) return false;
  if (nomination.latestScoreId === nomination.warningScoreId) return false;
  const confirmingScoreAt = score?.createdAt ?? nomination.lastScoredAt;
  return confirmingScoreAt > nomination.warningExpiresAt;
}

function isPublisherAbusePendingWarningRetryable(
  nomination: Doc<"publisherAbuseReviewNominations">,
  now: number,
) {
  return (
    typeof nomination.warningPendingAt === "number" &&
    nomination.warningPendingAt <= now - PUBLISHER_ABUSE_WARNING_PENDING_RETRY_MS
  );
}

async function warnPublisherAbuseAutobanCandidate(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    nomination: Doc<"publisherAbuseReviewNominations">;
    publisher: Doc<"publishers">;
    score: ScoreDoc | null;
    targetUser: PublisherAbuseWarningTarget;
    now: number;
  },
) {
  const to = args.targetUser.email?.trim();
  if (!to) throw new Error("Publisher abuse warning target has no email");

  const warningRunId = args.score?.runId ?? args.nomination.openedByRunId;
  await ctx.db.patch(args.nomination._id, {
    warningPendingAt: args.now,
    warningPendingScoreId: args.nomination.latestScoreId,
    warningPendingRunId: warningRunId,
    updatedAt: args.now,
  });
  await ctx.scheduler.runAfter(0, internal.emailsNode.sendPublisherAbuseWarningInternal, {
    nominationId: args.nomination._id,
    ownerKey: args.nomination.ownerKey,
    runId: warningRunId,
    scoreId: args.nomination.latestScoreId,
    userId: args.targetUser._id,
    to,
    handle: args.targetUser.handle,
    publisherHandle: args.publisher.handle,
    warningPendingAt: args.now,
    graceMs: PUBLISHER_ABUSE_AUTOBAN_WARNING_GRACE_MS,
    score: summarizePublisherAbuseWarningScore(args.nomination, args.score),
  });
}

function summarizePublisherAbuseWarningScore(
  nomination: Doc<"publisherAbuseReviewNominations">,
  score: ScoreDoc | null,
) {
  return {
    modelVersion: nomination.modelVersion,
    publishedSkills: score?.publishedSkills ?? 0,
    totalInstalls: score?.totalInstalls ?? 0,
    totalStars: score?.totalStars ?? 0,
    totalDownloads: score?.totalDownloads ?? 0,
    installsPerSkill: score?.installsPerSkill ?? 0,
    starsPerSkill: score?.starsPerSkill ?? 0,
    downloadsPerSkill: score?.downloadsPerSkill ?? 0,
    zScore: score?.zScore ?? 0,
    reasonCodes: score?.reasonCodes ?? [],
  };
}

export const recordPublisherAbuseWarningSentInternal = internalMutation({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
    ownerKey: v.string(),
    runId: v.id("publisherAbuseScoreRuns"),
    scoreId: v.id("publisherAbuseScores"),
    warningPendingAt: v.number(),
    warningSentAt: v.number(),
    deadlineAt: v.number(),
  },
  handler: async (ctx, args) => {
    const nomination = await ctx.db.get(args.nominationId);
    if (
      !nomination ||
      nomination.warningPendingScoreId !== args.scoreId ||
      nomination.warningPendingRunId !== args.runId ||
      nomination.warningPendingAt !== args.warningPendingAt ||
      nomination.warningSentAt
    ) {
      return { ok: false as const, reason: "stale_warning" as const };
    }

    if (nomination.status !== "pending" || nomination.label !== "potential_ban_candidate") {
      await clearPendingPublisherAbuseWarningFields(ctx, args.nominationId);
      return { ok: false as const, reason: "nomination_not_actionable" as const };
    }

    await ctx.db.patch(args.nominationId, {
      warningSentAt: args.warningSentAt,
      warningExpiresAt: args.deadlineAt,
      warningScoreId: args.scoreId,
      warningRunId: args.runId,
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("publisherAbuseReviewEvents", {
      nominationId: args.nominationId,
      ownerKey: args.ownerKey,
      runId: args.runId,
      scoreId: args.scoreId,
      eventType: "autoban_warning_sent",
      notes: "Publisher abuse warning email sent before automatic enforcement.",
      createdAt: args.warningSentAt,
    });
    return { ok: true as const };
  },
});

export const claimPublisherAbusePendingWarningInternal = internalMutation({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
    runId: v.id("publisherAbuseScoreRuns"),
    scoreId: v.id("publisherAbuseScores"),
    warningPendingAt: v.number(),
  },
  handler: async (ctx, args) => {
    const nomination = await ctx.db.get(args.nominationId);
    if (
      !nomination ||
      nomination.warningPendingScoreId !== args.scoreId ||
      nomination.warningPendingRunId !== args.runId ||
      nomination.warningPendingAt !== args.warningPendingAt ||
      nomination.warningSentAt
    ) {
      return { ok: false as const, reason: "stale_warning" as const };
    }

    if (nomination.status !== "pending" || nomination.label !== "potential_ban_candidate") {
      await clearPendingPublisherAbuseWarningFields(ctx, args.nominationId);
      return { ok: false as const, reason: "nomination_not_actionable" as const };
    }

    if (!(await getPublisherAbuseAutobanEnabled(ctx))) {
      await clearPendingPublisherAbuseWarningFields(ctx, args.nominationId);
      return { ok: false as const, reason: "autoban_disabled" as const };
    }

    if (!(await isPublisherAbusePendingWarningStillLinked(ctx, nomination))) {
      await clearPendingPublisherAbuseWarningFields(ctx, args.nominationId);
      return { ok: false as const, reason: "nomination_not_actionable" as const };
    }

    const warningRun = await ctx.db.get(args.runId);
    if (!warningRun || warningRun.status === "failed") {
      await clearPendingPublisherAbuseWarningFields(ctx, args.nominationId);
      return { ok: false as const, reason: "score_run_not_actionable" as const };
    }

    return { ok: true as const };
  },
});

export const clearPublisherAbusePendingWarningInternal = internalMutation({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
    runId: v.id("publisherAbuseScoreRuns"),
    scoreId: v.id("publisherAbuseScores"),
    warningPendingAt: v.number(),
  },
  handler: async (ctx, args) => {
    const nomination = await ctx.db.get(args.nominationId);
    if (
      !nomination ||
      nomination.warningPendingScoreId !== args.scoreId ||
      nomination.warningPendingRunId !== args.runId ||
      nomination.warningPendingAt !== args.warningPendingAt ||
      nomination.warningSentAt
    ) {
      return { ok: false as const, reason: "stale_warning" as const };
    }

    await ctx.db.patch(args.nominationId, {
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

async function clearPendingPublisherAbuseWarningFields(
  ctx: Pick<MutationCtx, "db">,
  nominationId: Id<"publisherAbuseReviewNominations">,
) {
  await ctx.db.patch(nominationId, {
    warningPendingAt: undefined,
    warningPendingScoreId: undefined,
    warningPendingRunId: undefined,
    updatedAt: Date.now(),
  });
}

async function isPublisherAbusePendingWarningStillLinked(
  ctx: Pick<MutationCtx, "db">,
  nomination: Doc<"publisherAbuseReviewNominations">,
) {
  if (!nomination.ownerPublisherId || !nomination.ownerUserId) return false;
  const publisher = await ctx.db.get(nomination.ownerPublisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return false;
  if (await isPublisherExcludedFromPublisherAbuse(ctx, publisher)) return false;
  if (publisher.linkedUserId !== nomination.ownerUserId) return false;
  const targetUser = await ctx.db.get(nomination.ownerUserId);
  if (!targetUser || targetUser.deletedAt || targetUser.deactivatedAt) return false;
  return targetUser.role !== "admin" && targetUser.role !== "moderator";
}

export async function autoBanPublisherAbuseCandidatesPageInternalHandler(
  ctx: MutationCtx,
  args: { batchSize?: number; cursor?: string },
): Promise<PublisherAbuseAutobanPageResult> {
  if (!(await getPublisherAbuseAutobanEnabled(ctx))) {
    return {
      ok: true,
      processed: 0,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    };
  }

  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_AUTOBAN_BATCH_SIZE,
    1,
    MAX_AUTOBAN_BATCH_SIZE,
  );
  const candidatePage = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_status_and_label_and_last_scored_at", (q) =>
      q.eq("status", "pending").eq("label", "potential_ban_candidate"),
    )
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

  let banned = 0;
  let warned = 0;
  let alreadyBanned = 0;
  let skipped = 0;
  for (const nomination of candidatePage.page) {
    const now = Date.now();
    const score = await ctx.db.get(nomination.latestScoreId);
    const eligibility = await getPublisherAbuseAutobanEligibility(ctx, nomination, score);
    if (eligibility.kind === "pending_run") {
      skipped += 1;
      continue;
    }
    if (eligibility.kind === "defer") {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: eligibility.status,
        notes: eligibility.notes,
        now,
      });
      skipped += 1;
      continue;
    }

    if (!nomination.ownerPublisherId) {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "needs_policy_discussion",
        notes: MISSING_PUBLISHER_AUTOBAN_SKIP_NOTE,
        now,
      });
      skipped += 1;
      continue;
    }

    const publisher = await ctx.db.get(nomination.ownerPublisherId);
    if (!publisher) {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "needs_policy_discussion",
        notes: MISSING_PUBLISHER_AUTOBAN_SKIP_NOTE,
        now,
      });
      skipped += 1;
      continue;
    }

    if (publisher.deletedAt || publisher.deactivatedAt) {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "reviewed_no_action",
        notes: INACTIVE_PUBLISHER_AUTOBAN_SKIP_NOTE,
        now,
      });
      skipped += 1;
      continue;
    }

    if (await isPublisherExcludedFromPublisherAbuse(ctx, publisher)) {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "reviewed_no_action",
        notes: "Autoban skipped: publisher is excluded from publisher abuse enforcement.",
        now,
      });
      skipped += 1;
      continue;
    }

    if (!nomination.ownerUserId || publisher.linkedUserId !== nomination.ownerUserId) {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "needs_policy_discussion",
        notes: nomination.ownerUserId
          ? STALE_PUBLISHER_LINK_AUTOBAN_SKIP_NOTE
          : "Autoban skipped: nomination has no linked user account.",
        now,
      });
      skipped += 1;
      continue;
    }

    const targetUser = await ctx.db.get(nomination.ownerUserId);
    if (!targetUser) {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "needs_policy_discussion",
        notes: "Autoban skipped: user_not_found.",
        now,
      });
      skipped += 1;
      continue;
    }

    if (targetUser.role === "admin" || targetUser.role === "moderator") {
      await setPublisherAbuseReviewStatusWithActor(ctx, {
        nomination,
        status: "needs_policy_discussion",
        notes: "Autoban skipped: staff accounts require manual review.",
        now,
      });
      skipped += 1;
      continue;
    }

    const linkedUserAlreadyInactive = Boolean(targetUser.deletedAt || targetUser.deactivatedAt);
    const warnedCandidateIsReadyForBan =
      linkedUserAlreadyInactive || isPublisherAbuseWarningReadyForBan(nomination, score, now);

    if (!warnedCandidateIsReadyForBan) {
      if (
        !nomination.warningSentAt &&
        (!nomination.warningPendingAt || isPublisherAbusePendingWarningRetryable(nomination, now))
      ) {
        if (!targetUser.email?.trim()) {
          await setPublisherAbuseReviewStatusWithActor(ctx, {
            nomination,
            status: "needs_policy_discussion",
            notes: MISSING_WARNING_EMAIL_AUTOBAN_SKIP_NOTE,
            now,
          });
          skipped += 1;
          continue;
        }
        await warnPublisherAbuseAutobanCandidate(ctx, {
          nomination,
          publisher,
          score,
          targetUser,
          now,
        });
        warned += 1;
      }
      continue;
    }

    const reason = publisherAbuseAutobanReason(nomination, score);
    const result: PublisherAbuseAutobanUserResult = await ctx.runMutation(
      internal.users.autobanPublisherAbuseOwnerInternal,
      {
        ownerUserId: nomination.ownerUserId,
        nominationId: nomination._id,
        scoreId: nomination.latestScoreId,
        reason,
      },
    );

    if (result.ok) {
      if (result.alreadyBanned) {
        alreadyBanned += 1;
      } else {
        banned += 1;
      }
      continue;
    }

    if (result.reason === "nomination_not_actionable") {
      skipped += 1;
      continue;
    }

    const notes =
      result.reason === "protected_role"
        ? "Autoban skipped: staff accounts require manual review."
        : `Autoban skipped: ${result.reason}.`;
    await setPublisherAbuseReviewStatusWithActor(ctx, {
      nomination,
      status: "needs_policy_discussion",
      notes,
      now: Date.now(),
    });
    skipped += 1;
  }

  return {
    ok: true,
    processed: candidatePage.page.length,
    warned,
    banned,
    alreadyBanned,
    skipped,
    isDone: candidatePage.isDone,
    ...(candidatePage.isDone ? {} : { cursor: candidatePage.continueCursor }),
  };
}

export async function processPublisherAbuseAutobansInternalHandler(
  ctx: ActionCtx,
  args: { batchSize?: number; maxPages?: number; cursor?: string },
): Promise<PublisherAbuseAutobanRunResult> {
  return await processPublisherAbuseAutobanPages(ctx, args);
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

export const getPublisherAbuseAutobanEnabledInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await getPublisherAbuseAutobanEnabled(ctx);
  },
});

async function getPublisherAbuseAutobanSettingDoc(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
): Promise<PublisherAbuseAutobanSettingDoc | null> {
  const settings = await ctx.db
    .query("systemSettings")
    .withIndex("by_key_and_updated_at", (q) => q.eq("key", PUBLISHER_ABUSE_AUTOBAN_SETTING_KEY))
    .order("desc")
    .take(1);
  return settings[0] ?? null;
}

async function getPublisherAbuseAutobanEnabled(ctx: Pick<QueryCtx | MutationCtx, "db">) {
  const setting = await getPublisherAbuseAutobanSettingDoc(ctx);
  return setting?.enabled ?? false;
}

function summarizePublisherAbuseAutobanSetting(setting: PublisherAbuseAutobanSettingDoc | null) {
  return {
    enabled: setting?.enabled ?? false,
    updatedAt: setting?.updatedAt ?? null,
    updatedByUserId: setting?.updatedByUserId ?? null,
  };
}

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
    return {
      runId: run._id,
      status: run.status,
      phase: run.phase,
      scannedPublishers: run.scannedPublishers,
      finalizedScores: run.finalizedScores,
      temporalScanComplete: run.temporalScanComplete,
      temporalBenchmark: run.temporalBenchmark,
    };
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
    cleanupLabel: v.optional(v.union(v.literal("potential_ban_candidate"), v.literal("review"))),
    cleanupCursor: v.optional(v.string()),
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
    runId: v.optional(v.id("publisherAbuseScoreRuns")),
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

export const processPublisherAbuseAutobansInternal = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: processPublisherAbuseAutobansInternalHandler,
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
  const staffManagerExclusionBudget = createStaffPublisherManagerExclusionBudget();
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
    if (await isPublisherExcludedFromPublisherAbuse(ctx, publisher, staffManagerExclusionBudget)) {
      continue;
    }
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
  const staffManagerExclusionBudget = createStaffPublisherManagerExclusionBudget();
  for (const score of page.page) {
    if (await isPublisherAbuseScoreExcluded(ctx, score, staffManagerExclusionBudget)) {
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
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    errorMessage: string;
    cleanupLabel?: PendingPublisherAbuseReviewLabel;
    cleanupCursor?: string;
  },
): Promise<RunState> {
  const run = await ctx.db.get(args.runId);
  if (!run) throw new Error("Publisher abuse score run not found");
  const now = Date.now();
  const nextStatus = run.status === "running" ? "failed" : run.status;
  if (run.status === "running") {
    await ctx.db.patch(run._id, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: now,
    });
  }

  const shouldCleanupFailedTemporalRun =
    run.modelVersion === PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION &&
    (run.status === "running" || Boolean(args.cleanupLabel) || Boolean(args.cleanupCursor));
  if (shouldCleanupFailedTemporalRun) {
    await cleanupFailedTemporalPublisherAbuseRunPage(ctx, {
      run,
      errorMessage: args.errorMessage,
      label: args.cleanupLabel ?? FAILED_TEMPORAL_CLEANUP_LABELS[0],
      cursor: args.cleanupCursor,
      now,
    });
  }

  return { runId: run._id, status: nextStatus, phase: run.phase };
}

async function cleanupFailedTemporalPublisherAbuseRunPage(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    run: Doc<"publisherAbuseScoreRuns">;
    errorMessage: string;
    label: PendingPublisherAbuseReviewLabel;
    cursor?: string;
    now: number;
  },
) {
  const page = await ctx.db
    .query("publisherAbuseScores")
    .withIndex("by_run_and_label_and_rank", (q) =>
      q.eq("runId", args.run._id).eq("label", args.label),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: FAILED_TEMPORAL_NOMINATION_CLEANUP_BATCH_SIZE,
    });

  for (const score of page.page) {
    const nomination = await ctx.db
      .query("publisherAbuseReviewNominations")
      .withIndex("by_owner_key_and_model_version", (q) =>
        q.eq("ownerKey", score.ownerKey).eq("modelVersion", score.modelVersion),
      )
      .first();
    if (!nomination || nomination.status !== "pending" || nomination.latestScoreId !== score._id) {
      continue;
    }

    await ctx.db.patch(nomination._id, {
      status: "candidate_for_future_action",
      reviewedByUserId: undefined,
      reviewedAt: args.now,
      notes: FAILED_TEMPORAL_RUN_NOMINATION_NOTE,
      warningSentAt: undefined,
      warningExpiresAt: undefined,
      warningScoreId: undefined,
      warningRunId: undefined,
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: args.now,
    });
    await ctx.db.insert("publisherAbuseReviewEvents", {
      nominationId: nomination._id,
      ownerKey: nomination.ownerKey,
      runId: args.run._id,
      scoreId: score._id,
      eventType: "triage_status_changed",
      previousStatus: nomination.status,
      nextStatus: "candidate_for_future_action",
      notes: FAILED_TEMPORAL_RUN_NOMINATION_NOTE,
      createdAt: args.now,
    });
  }

  if (!page.isDone) {
    await scheduleFailedTemporalPublisherAbuseRunCleanup(ctx, {
      runId: args.run._id,
      errorMessage: args.errorMessage,
      label: args.label,
      cursor: page.continueCursor,
    });
    return;
  }

  const nextLabel = nextFailedTemporalCleanupLabel(args.label);
  if (nextLabel) {
    await scheduleFailedTemporalPublisherAbuseRunCleanup(ctx, {
      runId: args.run._id,
      errorMessage: args.errorMessage,
      label: nextLabel,
    });
  }
}

async function scheduleFailedTemporalPublisherAbuseRunCleanup(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    errorMessage: string;
    label: PendingPublisherAbuseReviewLabel;
    cursor?: string;
  },
) {
  await ctx.scheduler.runAfter(
    0,
    internal.publisherAbuse.markPublisherAbuseScoreRunFailedInternal,
    {
      runId: args.runId,
      errorMessage: args.errorMessage,
      cleanupLabel: args.label,
      ...(args.cursor ? { cleanupCursor: args.cursor } : {}),
    },
  );
}

function nextFailedTemporalCleanupLabel(label: PendingPublisherAbuseReviewLabel) {
  const currentIndex = FAILED_TEMPORAL_CLEANUP_LABELS.indexOf(label);
  if (currentIndex < 0) return null;
  return FAILED_TEMPORAL_CLEANUP_LABELS[currentIndex + 1] ?? null;
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
    if (state.status === "completed") {
      await processPublisherAbuseAutobanPages(ctx, {});
    }
    return { ok: true, runId: state.runId, pages, isDone: true };
  }

  let completedRun:
    | {
        runId: Id<"publisherAbuseScoreRuns">;
        pages: number;
      }
    | undefined;
  let shouldProcessAutobans = false;
  try {
    while (pages < maxPages) {
      let result: PageResult;
      const phaseAtPageStart = state.phase;
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
      if (phaseAtPageStart === "finalizing" && (result.nominations ?? 0) > 0) {
        shouldProcessAutobans = true;
      }
      state = { runId: result.runId, status: result.status, phase: result.phase };
      if (result.isDone && result.phase === "completed") {
        completedRun = { runId: result.runId, pages };
        break;
      }
    }
  } catch (error) {
    await ctx.runMutation(internal.publisherAbuse.markPublisherAbuseScoreRunFailedInternal, {
      runId: state.runId,
      errorMessage: errorMessageFromUnknown(error),
    });
    throw error;
  }

  if (completedRun) {
    await processPublisherAbuseAutobanPages(ctx, {});
    return { ok: true, runId: completedRun.runId, pages: completedRun.pages, isDone: true };
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
  if (shouldProcessAutobans) {
    await processPublisherAbuseAutobanPages(ctx, {});
  }
  return { ok: true, runId: state.runId, pages, isDone: false };
}

async function processPublisherAbuseAutobanPages(
  ctx: Pick<ActionCtx, "runMutation" | "scheduler" | "runQuery">,
  args: { batchSize?: number; maxPages?: number; cursor?: string },
): Promise<PublisherAbuseAutobanRunResult> {
  const autobanEnabled: boolean = await ctx.runQuery(
    internal.publisherAbuse.getPublisherAbuseAutobanEnabledInternal,
    {},
  );
  if (!autobanEnabled) {
    return {
      ok: true,
      pages: 0,
      processed: 0,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    };
  }

  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_AUTOBAN_BATCH_SIZE,
    1,
    MAX_AUTOBAN_BATCH_SIZE,
  );
  const maxPages = clampInt(args.maxPages ?? DEFAULT_AUTOBAN_MAX_PAGES, 1, MAX_AUTOBAN_MAX_PAGES);
  let pages = 0;
  let processed = 0;
  let warned = 0;
  let banned = 0;
  let alreadyBanned = 0;
  let skipped = 0;
  let isDone = false;
  let cursor = args.cursor;

  while (pages < maxPages && !isDone) {
    const result: PublisherAbuseAutobanPageResult = await ctx.runMutation(
      internal.publisherAbuse.autoBanPublisherAbuseCandidatesPageInternal,
      cursor ? { batchSize, cursor } : { batchSize },
    );
    pages += 1;
    processed += result.processed;
    warned += result.warned;
    banned += result.banned;
    alreadyBanned += result.alreadyBanned;
    skipped += result.skipped;
    isDone = result.isDone;
    cursor = result.cursor;
  }

  if (!isDone) {
    await ctx.scheduler.runAfter(
      ACTION_CONTINUATION_DELAY_MS,
      internal.publisherAbuse.processPublisherAbuseAutobansInternal,
      cursor ? { batchSize, maxPages, cursor } : { batchSize, maxPages },
    );
  }

  return {
    ok: true,
    pages,
    processed,
    warned,
    banned,
    alreadyBanned,
    skipped,
    isDone,
  };
}

export async function collectTemporalPublisherAbuseSkillCandidatesPageInternalHandler(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
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
  const staffManagerExclusionBudget = createStaffPublisherManagerExclusionBudget();
  for (const skill of page.page) {
    if (!skill.ownerPublisherId) continue;
    const publisher = await ctx.db.get(skill.ownerPublisherId);
    if (
      !publisher ||
      (await isPublisherExcludedFromPublisherAbuse(ctx, publisher, staffManagerExclusionBudget))
    ) {
      continue;
    }

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
    runId?: Id<"publisherAbuseScoreRuns">;
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
  const runId =
    args.runId ??
    (await createTemporalPublisherAbuseScoreRun(ctx, {
      mode: args.mode,
      trigger: args.trigger,
      actorUserId: args.actorUserId,
      benchmark: args.benchmark,
    }));
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Temporal publisher abuse score run not found");
  const nominationRun = { ...run, temporalScanComplete: args.scanComplete } as ScoreRun;

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
    const result = await persistTemporalPublisherAbuseAggregate(ctx, {
      runId,
      nominationRun,
      aggregate,
      rank,
      benchmark: args.benchmark,
      now,
    });
    if (result.nominated) nominations += 1;
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
  const finalizedCount = sortedAggregates.length + clearedNominations;
  const scannedPublishers =
    Math.max(run.scannedPublishers, sortedAggregates.length) + clearedNominations;
  const scoredPublishers =
    Math.max(run.scoredPublishers, sortedAggregates.length) + clearedNominations;

  await ctx.db.patch(runId, {
    status: "completed",
    phase: "completed",
    temporalScanComplete: args.scanComplete,
    temporalBenchmark: args.benchmark,
    scannedPublishers,
    scoredPublishers,
    finalizedScores: finalizedCount,
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

async function persistTemporalPublisherAbuseAggregate(
  ctx: Pick<MutationCtx, "db">,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    nominationRun: ScoreRun;
    aggregate: TemporalPublisherAggregate;
    rank: number;
    benchmark: TemporalAbuseCohortBenchmark;
    now: number;
  },
) {
  const label = labelForTemporalPublisherAbuse({
    highTemporalSkillCount: args.aggregate.highTemporalSkillCount,
    p99TemporalSkillCount: args.aggregate.p99TemporalSkillCount,
  });
  if (label === "pass") return { nominated: false as const, label };

  const pressure =
    1_000 + args.aggregate.highTemporalSkillCount * 100 + args.aggregate.maxTemporalPressure;
  const zScore = computeTemporalPublisherAbuseZScore({
    label,
    highTemporalSkillCount: args.aggregate.highTemporalSkillCount,
    maxTemporalPressure: args.aggregate.maxTemporalPressure,
  });
  const scoreData = {
    runId: args.runId,
    ownerKey: args.aggregate.ownerKey,
    ownerPublisherId: args.aggregate.ownerPublisherId,
    ownerUserId: args.aggregate.ownerUserId,
    handleSnapshot: args.aggregate.handleSnapshot,
    modelVersion: PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
    label,
    rank: args.rank,
    pressure,
    logPressure: Math.log10(Math.max(pressure, 1)),
    zScore,
    publishedSkills: args.aggregate.highTemporalSkillCount,
    totalInstalls: args.aggregate.totalInstalls,
    totalStars: 0,
    totalDownloads: args.aggregate.totalDownloads,
    installsPerSkill:
      args.aggregate.totalInstalls / Math.max(1, args.aggregate.highTemporalSkillCount),
    starsPerSkill: 0,
    downloadsPerSkill:
      args.aggregate.totalDownloads / Math.max(1, args.aggregate.highTemporalSkillCount),
    reasonCodes: args.aggregate.reasonCodes,
    temporalHighSkillCount: args.aggregate.highTemporalSkillCount,
    temporalP99SkillCount: args.aggregate.p99TemporalSkillCount,
    temporalSpikeSkillCount: args.aggregate.spikeSkillCount,
    temporalSustainedSkillCount: args.aggregate.sustainedSkillCount,
    temporalMaxPressure: args.aggregate.maxTemporalPressure,
    temporalBenchmark: args.benchmark,
    temporalEvidence: args.aggregate.evidence
      .sort((left, right) => right.temporalScore.pressure - left.temporalScore.pressure)
      .slice(0, MAX_TEMPORAL_EVIDENCE_SKILLS)
      .map(temporalEvidenceFromCandidate),
    createdAt: args.now,
  };
  const scoreId = await ctx.db.insert("publisherAbuseScores", scoreData);
  await upsertPublisherAbuseReviewNomination(ctx, {
    score: { _id: scoreId, _creationTime: args.now, ...scoreData } as ScoreDoc,
    run: args.nominationRun,
    now: args.now,
  });
  return { nominated: true as const, label };
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
  const requestedCandidateLimit = clampInt(
    args.candidateLimit ?? DEFAULT_TEMPORAL_CANDIDATE_LIMIT,
    1,
    MAX_TEMPORAL_CANDIDATE_LIMIT,
  );
  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_TEMPORAL_BATCH_SIZE,
    1,
    MAX_TEMPORAL_BATCH_SIZE,
  );
  const requestedMaxPages = clampInt(
    args.maxPages ?? DEFAULT_TEMPORAL_MAX_PAGES,
    1,
    MAX_TEMPORAL_MAX_PAGES,
  );
  const candidateLimit = requestedCandidateLimit;
  const maxPages = requestedMaxPages;
  const todayDay = args.todayDay ?? toDayKey(Date.now());

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
        todayDay,
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
  if (dryRun || !scanComplete || (mode !== "current" && highTemporalCandidates.length === 0)) {
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

  return await finishTemporalPublisherAbuseScan(ctx, {
    mode,
    dryRun,
    candidates,
    scannedSkills,
    scanComplete,
    trigger: args.trigger ?? "cron",
    actorUserId: args.actorUserId,
  });
}

async function finishTemporalPublisherAbuseScan(
  ctx: Pick<ActionCtx, "runMutation" | "scheduler" | "runQuery">,
  args: {
    mode: TemporalAbuseMode;
    dryRun: boolean;
    candidates: TemporalSkillCandidate[];
    scannedSkills: number;
    scanComplete: boolean;
    trigger: "cron" | "manual";
    actorUserId?: Id<"users">;
  },
) {
  const benchmark = computeTemporalAbuseCohortBenchmark(
    args.candidates.map((candidate) => candidate.temporalScore),
  );
  const highTemporalCandidates = args.candidates
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
  const saved: { nominations: number; flaggedPublishers: number } = await ctx.runMutation(
    internal.publisherAbuse.persistTemporalPublisherAbuseCandidatesInternal,
    {
      mode: args.mode,
      trigger: args.trigger,
      actorUserId: args.actorUserId,
      candidates: highTemporalCandidates,
      benchmark,
      scanComplete: args.scanComplete,
    },
  );
  if (args.mode === "current" && args.scanComplete) {
    await processPublisherAbuseAutobanPages(ctx, {});
  }
  return {
    ok: true as const,
    dryRun: args.dryRun,
    mode: args.mode,
    scannedSkills: args.scannedSkills,
    highTemporalSkills: highTemporalCandidates.length,
    flaggedPublishers: saved.flaggedPublishers,
    nominations: saved.nominations,
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
      await insertTemporalPassScoreForStaleNomination(ctx, {
        nomination,
        run: args.run,
        rank: args.startingRank + cleared + 1,
        now: args.now,
      });
      cleared += 1;
      if (cleared >= MAX_TEMPORAL_STALE_NOMINATION_CLEARS) return cleared;
    }
  }
  return cleared;
}

async function insertTemporalPassScoreForStaleNomination(
  ctx: Pick<MutationCtx, "db">,
  args: {
    nomination: Doc<"publisherAbuseReviewNominations">;
    run: ScoreRun;
    rank: number;
    now: number;
  },
) {
  const scoreData = {
    runId: args.run._id,
    ownerKey: args.nomination.ownerKey,
    ownerPublisherId: args.nomination.ownerPublisherId,
    ownerUserId: args.nomination.ownerUserId,
    handleSnapshot: args.nomination.handleSnapshot,
    modelVersion: PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
    label: "pass" as const,
    rank: args.rank,
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
    mode: TemporalAbuseMode;
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
    temporalMode: args.mode,
    temporalScanComplete: false,
    temporalBenchmark: args.benchmark,
  });
}

function aggregateTemporalPublisherCandidates(candidates: TemporalSkillCandidate[]) {
  const byOwner = new Map<string, TemporalPublisherAggregate>();
  for (const candidate of candidates) {
    addTemporalPublisherAggregateCandidate(byOwner, candidate);
  }
  return [...byOwner.values()];
}

function addTemporalPublisherAggregateCandidate(
  byOwner: Map<string, TemporalPublisherAggregate>,
  candidate: TemporalSkillCandidate,
) {
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
  existing.evidence = [...existing.evidence, candidate]
    .sort((left, right) => right.temporalScore.pressure - left.temporalScore.pressure)
    .slice(0, MAX_TEMPORAL_EVIDENCE_SKILLS);
  byOwner.set(candidate.ownerKey, existing);
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
    .withIndex("by_model_version_and_status_and_updated_at", (q) =>
      q
        .eq("modelVersion", DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.modelVersion)
        .eq("status", "running"),
    )
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
  staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget,
) {
  if (!publisher) return false;
  if (publisher.kind !== "user" && publisher.kind !== "org") return false;
  if (await hasOfficialPublisherRow(ctx, publisher._id)) return true;
  if (publisher.linkedUserId) {
    const linkedUser = await ctx.db.get(publisher.linkedUserId);
    if (linkedUser?.role === "admin" || linkedUser?.role === "moderator") return true;
  }
  if (publisher.kind !== "org") return false;
  return await hasStaffPublisherManager(ctx, publisher._id, staffManagerExclusionBudget);
}

function createStaffPublisherManagerExclusionBudget(): StaffPublisherManagerExclusionBudget {
  return {
    remainingDocReads: MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_READS_PER_PAGE,
    userStaffCache: new Map(),
  };
}

async function hasStaffPublisherManager(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  publisherId: Id<"publishers">,
  budget?: StaffPublisherManagerExclusionBudget,
) {
  const scanBudget = budget ?? createStaffPublisherManagerExclusionBudget();
  for (const role of STAFF_PUBLISHER_MANAGER_ROLES) {
    let cursor: string | null = null;
    do {
      if (scanBudget.remainingDocReads <= 0) return true;
      const memberTakeLimit = Math.min(
        MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_SCAN,
        scanBudget.remainingDocReads,
      );
      const page = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher_and_role", (q) =>
          q.eq("publisherId", publisherId).eq("role", role),
        )
        .paginate({ cursor, numItems: memberTakeLimit });
      scanBudget.remainingDocReads -= page.page.length;

      for (const member of page.page) {
        const cached = scanBudget.userStaffCache.get(member.userId);
        if (cached !== undefined) {
          if (cached) return true;
          continue;
        }
        if (scanBudget.remainingDocReads <= 0) return true;
        scanBudget.remainingDocReads -= 1;
        const user = await ctx.db.get(member.userId);
        const isStaff = user?.role === "admin" || user?.role === "moderator";
        scanBudget.userStaffCache.set(member.userId, isStaff);
        if (isStaff) return true;
      }
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
  }
  return false;
}

async function isPublisherAbuseExcludedReviewItem(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  item: PublisherAbuseReviewItem,
  staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget,
) {
  return await isPublisherExcludedFromPublisherAbuse(
    ctx,
    item.publisher,
    staffManagerExclusionBudget,
  );
}

async function isPublisherAbuseScoreExcluded(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  score: Pick<ScoreDoc, "ownerPublisherId">,
  staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget,
) {
  if (!score.ownerPublisherId) return false;
  const publisher = await ctx.db.get(score.ownerPublisherId);
  return await isPublisherExcludedFromPublisherAbuse(ctx, publisher, staffManagerExclusionBudget);
}

async function requirePublisherAbuseNominationNotExcluded(
  ctx: Pick<MutationCtx, "db">,
  nomination: Doc<"publisherAbuseReviewNominations">,
) {
  if (!nomination.ownerPublisherId) return;
  const publisher = await ctx.db.get(nomination.ownerPublisherId);
  if (!(await isPublisherExcludedFromPublisherAbuse(ctx, publisher))) return;
  throw new Error("Excluded publisher abuse nominations cannot be acted on.");
}

async function requirePublisherAbuseNominationStillTargetsLinkedUser(
  ctx: Pick<MutationCtx, "db">,
  nomination: Doc<"publisherAbuseReviewNominations">,
) {
  if (!nomination.ownerPublisherId) return;
  const publisher = await ctx.db.get(nomination.ownerPublisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
    throw new Error("Cannot ban publisher abuse nomination for an inactive publisher");
  }
  if (publisher.linkedUserId !== nomination.ownerUserId) {
    throw new Error("Cannot ban publisher abuse nomination because the linked user changed");
  }
}

function publisherAbuseAutobanReason(
  nomination: Doc<"publisherAbuseReviewNominations">,
  score: ScoreDoc | null,
) {
  const reasons = score?.reasonCodes.length ? `: ${score.reasonCodes.slice(0, 5).join(", ")}` : "";
  return truncateText(
    `${PUBLISHER_ABUSE_AUTOBAN_REASON} (${nomination.modelVersion})${reasons}`,
    MAX_BAN_REASON_LENGTH,
  );
}

function publisherAbuseManualBanReason(reason: string | undefined) {
  if (!reason) return PUBLISHER_ABUSE_AUTOBAN_REASON;
  if (/\bpublisher[_\-\s]?abuse\b/i.test(reason)) return reason;
  return truncateText(`publisher_abuse: ${reason}`, MAX_BAN_REASON_LENGTH);
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
    const failedPressureRunAutobanDeferralReopen = isFailedPressureRunAutobanDeferral(
      existing,
      args.score,
      args.run,
    );
    const shouldReopen =
      (isReopenableNominationStatus(existing.status) &&
        (isPublisherAbuseLabelEscalation(existing.label, args.score.label) ||
          isDeferredNominationForCurrentTemporalRun(existing.status, args.run) ||
          failedPressureRunAutobanDeferralReopen)) ||
      (await isBannedNominationForActiveOwner(ctx, existing, args.score));
    const ownerUserChanged = existing.ownerUserId !== args.score.ownerUserId;
    const shouldClearWarning =
      (shouldReopen && !failedPressureRunAutobanDeferralReopen) ||
      ownerUserChanged ||
      args.score.label !== "potential_ban_candidate";
    await ctx.db.patch(existing._id, {
      latestScoreId: args.score._id,
      label: args.score.label,
      ownerPublisherId: args.score.ownerPublisherId,
      ownerUserId: args.score.ownerUserId,
      handleSnapshot: args.score.handleSnapshot,
      lastScoredAt: args.now,
      updatedAt: args.now,
      ...(shouldClearWarning
        ? {
            warningSentAt: undefined,
            warningExpiresAt: undefined,
            warningScoreId: undefined,
            warningRunId: undefined,
            warningPendingAt: undefined,
            warningPendingScoreId: undefined,
            warningPendingRunId: undefined,
          }
        : {}),
      ...(failedPressureRunAutobanDeferralReopen
        ? {
            warningPendingAt: undefined,
            warningPendingScoreId: undefined,
            warningPendingRunId: undefined,
          }
        : {}),
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
    await markStaleAggregatePublisherAbuseReviewNominationsAsPass(ctx, args);
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
  await markStaleAggregatePublisherAbuseReviewNominationsAsPass(ctx, args);
  return nominationId;
}

async function markStaleAggregatePublisherAbuseReviewNominationsAsPass(
  ctx: Pick<MutationCtx, "db">,
  args: {
    score: ScoreDoc;
    run: ScoreRun;
    now: number;
  },
) {
  if (!isAggregatePublisherAbuseModelVersion(args.score.modelVersion)) return null;

  const existingNominations = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_owner_key_and_model_version", (q) => q.eq("ownerKey", args.score.ownerKey))
    .take(MAX_OWNER_NOMINATION_VERSION_SCAN);

  let updatedNominationId: Id<"publisherAbuseReviewNominations"> | null = null;
  for (const existing of existingNominations) {
    if (
      !shouldClearStaleAggregatePublisherAbuseReviewNomination(existing, args.score.modelVersion)
    ) {
      continue;
    }
    await markPublisherAbuseReviewNominationAsPass(ctx, { ...args, existing });
    updatedNominationId ??= existing._id;
  }
  return updatedNominationId;
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
    if (
      existing.modelVersion !== args.score.modelVersion &&
      !shouldClearStaleAggregatePublisherAbuseReviewNomination(existing, args.score.modelVersion)
    ) {
      continue;
    }
    await markPublisherAbuseReviewNominationAsPass(ctx, { ...args, existing });
    updatedNominationId ??= existing._id;
  }
  return updatedNominationId;
}

function shouldClearStaleAggregatePublisherAbuseReviewNomination(
  nomination: Doc<"publisherAbuseReviewNominations">,
  currentModelVersion: string,
) {
  const nominationVersion = aggregatePublisherAbuseModelVersionNumber(nomination.modelVersion);
  const currentVersion = aggregatePublisherAbuseModelVersionNumber(currentModelVersion);
  return (
    nominationVersion !== null &&
    currentVersion !== null &&
    nominationVersion < currentVersion &&
    nomination.status === "pending" &&
    nomination.label !== "pass"
  );
}

function isAggregatePublisherAbuseModelVersion(modelVersion: string) {
  return modelVersion.startsWith("publisher-abuse-pressure.");
}

function aggregatePublisherAbuseModelVersionNumber(modelVersion: string) {
  const match = /^publisher-abuse-pressure\.v(\d+)$/.exec(modelVersion);
  const versionText = match?.[1];
  if (!versionText) return null;
  const version = Number(versionText);
  return Number.isSafeInteger(version) ? version : null;
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
    warningSentAt: undefined,
    warningExpiresAt: undefined,
    warningScoreId: undefined,
    warningRunId: undefined,
    warningPendingAt: undefined,
    warningPendingScoreId: undefined,
    warningPendingRunId: undefined,
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

function isDeferredNominationForCurrentTemporalRun(status: TriageStatus, run: ScoreRun) {
  return (
    status === "candidate_for_future_action" &&
    run.modelVersion === PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION &&
    run.temporalMode === "current" &&
    run.temporalScanComplete === true
  );
}

function isFailedPressureRunAutobanDeferral(
  nomination: Doc<"publisherAbuseReviewNominations">,
  score: ScoreDoc,
  run: ScoreRun,
) {
  return (
    nomination.status === "candidate_for_future_action" &&
    nomination.notes === FAILED_SCORE_RUN_AUTOBAN_SKIP_NOTE &&
    score.label === "potential_ban_candidate" &&
    run.modelVersion !== PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION &&
    run.status === "running" &&
    run.phase === "finalizing"
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
type PublisherAbuseReviewVisibilityOptions = {
  staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget;
  includeInactiveTargets?: boolean;
};

async function getPendingPublisherAbuseReviewItemsForLabel(
  ctx: QueryCtx,
  args: {
    status: TriageStatus;
    label: PendingPublisherAbuseReviewLabel;
    limit: number;
    latestCompletedRunId: Id<"publisherAbuseScoreRuns"> | undefined;
    staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget;
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
    staffManagerExclusionBudget: args.staffManagerExclusionBudget,
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
    staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget;
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
    if (
      !(await isVisiblePublisherAbuseReviewItem(ctx, item, {
        staffManagerExclusionBudget: args.staffManagerExclusionBudget,
      }))
    ) {
      continue;
    }
    items.push(item);
    if (items.length >= args.limit) break;
  }
  return items;
}

async function getPendingPublisherAbuseReviewItemsForLabelFromLastScoredAt(
  ctx: QueryCtx,
  args: {
    status: TriageStatus;
    label: PendingPublisherAbuseReviewLabel;
    limit: number;
    staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget;
  },
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
    if (
      !(await isVisiblePublisherAbuseReviewItem(ctx, item, {
        staffManagerExclusionBudget: args.staffManagerExclusionBudget,
      }))
    ) {
      continue;
    }
    items.push(item);
    if (items.length >= args.limit) break;
  }
  return items;
}

async function getLatestPublisherAbuseScoreRun(ctx: QueryCtx) {
  const pressureRun = await getLatestPublisherAbuseScoreRunForModel(
    ctx,
    DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.modelVersion,
  );
  const temporalRun = await getLatestPublisherAbuseScoreRunForModel(
    ctx,
    PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION,
  );
  if (!pressureRun) return temporalRun;
  if (!temporalRun) return pressureRun;
  return temporalRun.startedAt > pressureRun.startedAt ? temporalRun : pressureRun;
}

async function getLatestPublisherAbuseScoreRunForModel(ctx: QueryCtx, modelVersion: string) {
  return await ctx.db
    .query("publisherAbuseScoreRuns")
    .withIndex("by_model_version_and_started_at", (q) => q.eq("modelVersion", modelVersion))
    .order("desc")
    .first();
}

async function getRecentResolvedPublisherAbuseReviewItems(
  ctx: QueryCtx,
  limit: number,
  staffManagerExclusionBudget?: StaffPublisherManagerExclusionBudget,
) {
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
  return await summarizeVisiblePublisherAbuseReviewNominations(ctx, nominations, limit, {
    staffManagerExclusionBudget,
    includeInactiveTargets: true,
  });
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
  visibilityOptions: PublisherAbuseReviewVisibilityOptions = {},
) {
  const items = [];
  for (const nomination of nominations) {
    const item = await summarizePublisherAbuseReviewNomination(ctx, nomination);
    if (await isVisiblePublisherAbuseReviewItem(ctx, item, visibilityOptions)) {
      items.push(item);
    }
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

async function isVisiblePublisherAbuseReviewItem(
  ctx: QueryCtx,
  item: PublisherAbuseReviewItem,
  options: PublisherAbuseReviewVisibilityOptions = {},
) {
  const targetIsInactive =
    item.ownerUser?.deletedAt ||
    item.ownerUser?.deactivatedAt ||
    item.publisher?.deletedAt ||
    item.publisher?.deactivatedAt;

  return (
    item.nomination.label !== "pass" &&
    (options.includeInactiveTargets || !targetIsInactive) &&
    !(await isPublisherAbuseExcludedReviewItem(ctx, item, options.staffManagerExclusionBudget))
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

function normalizeBanReason(rawReason?: string) {
  const reason = rawReason?.trim();
  if (!reason) return undefined;
  return truncateText(reason, MAX_BAN_REASON_LENGTH);
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

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trimEnd();
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
