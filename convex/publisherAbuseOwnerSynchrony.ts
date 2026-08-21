import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import {
  detectPublisherAbuseOwnerSynchrony,
  PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE,
  PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS,
} from "./lib/publisherAbuseOwnerSynchrony";
import { freshPublisherAbuseEvidenceCrossesRepeatThreshold } from "./lib/publisherAbuseSignalLifecycle";
import { getSkillPublisherContribution } from "./lib/publisherStats";
import { readCanonicalStat } from "./lib/skillStats";

const OWNER_KEY_PAGE_SIZE = 50;
const MAX_OWNER_TRAFFIC_SIGNALS = 100;
const MAX_OWNER_SYNCHRONY_SKILLS = 50;
const OWNER_SYNCHRONY_SIGNAL_TYPE = "owner_synchronized_download_trends" as const;
const OWNER_SYNCHRONY_REASON_CODES = [
  "multiple_skills_have_anomalous_downloads",
  "skills_share_synchronized_download_trends",
] as const;

type OwnerSynchronySkill = {
  skill: Doc<"skills">;
  dailyDownloads: number[];
  recent7Downloads: number;
  recent7Installs: number;
  recent30Downloads: number;
  recent30Installs: number;
};

type OwnerSynchronyCandidate = {
  ownerKey: string;
  ownerPublisherId: Id<"publishers">;
  ownerUserId?: Id<"users">;
  handleSnapshot: string;
  representativeSkillId: Id<"skills">;
  representativeSkillSlug: string;
  representativeSkillDisplayName: string;
  recent7Downloads: number;
  recent7Installs: number;
  recent30Downloads: number;
  recent30Installs: number;
  allTimeDownloads: number;
  allTimeInstalls: number;
  portfolioEvidence: {
    skillCount: number;
    publisherSkillCount: number;
    allPublisherSkills: boolean;
    skillSlugs: string[];
    correlationFloor: number;
    correlationMedian: number;
    peak7DownloadsMin: number;
    peak7DownloadsMax: number;
    catalogCoverage: number;
    windowStartDay: number;
    windowEndDay: number;
  };
};

const portfolioEvidenceValidator = v.object({
  skillCount: v.number(),
  publisherSkillCount: v.number(),
  allPublisherSkills: v.boolean(),
  skillSlugs: v.array(v.string()),
  correlationFloor: v.number(),
  correlationMedian: v.number(),
  peak7DownloadsMin: v.number(),
  peak7DownloadsMax: v.number(),
  catalogCoverage: v.number(),
  windowStartDay: v.number(),
  windowEndDay: v.number(),
});

const ownerSynchronyCandidateValidator = v.object({
  ownerKey: v.string(),
  ownerPublisherId: v.id("publishers"),
  ownerUserId: v.optional(v.id("users")),
  handleSnapshot: v.string(),
  representativeSkillId: v.id("skills"),
  representativeSkillSlug: v.string(),
  representativeSkillDisplayName: v.string(),
  recent7Downloads: v.number(),
  recent7Installs: v.number(),
  recent30Downloads: v.number(),
  recent30Installs: v.number(),
  allTimeDownloads: v.number(),
  allTimeInstalls: v.number(),
  portfolioEvidence: portfolioEvidenceValidator,
});

function isDownloadAnomalySignal(signal: Doc<"publisherAbuseSignals">) {
  return (
    signal.reviewStatus !== "dismissed" &&
    (signal.signalType === "sustained_downloads_flat_installs" ||
      signal.signalType === "download_spike_flat_installs" ||
      signal.signalType === "sustained_abnormal_download_days")
  );
}

function installDownloadRatio(downloads: number, installs: number) {
  if (downloads <= 0) return installs > 0 ? 1 : 0;
  return installs / downloads;
}

function sumSkillWindow(skills: OwnerSynchronySkill[], field: keyof OwnerSynchronySkill) {
  return skills.reduce((sum, skill) => {
    const value = skill[field];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
}

export async function readPublisherAbuseOwnerKeysPageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { cursor?: string },
) {
  const page = await ctx.db
    .query("publisherAbuseSignals")
    .withIndex("by_last_seen_at")
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: OWNER_KEY_PAGE_SIZE });
  return {
    ownerKeys: [
      ...new Set(page.page.filter(isDownloadAnomalySignal).map((signal) => signal.ownerKey)),
    ],
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

export const readPublisherAbuseOwnerKeysPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: readPublisherAbuseOwnerKeysPageInternalHandler,
});

export async function getPublisherAbuseOwnerSynchronyCandidateInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { ownerKey: string; todayDay: number },
): Promise<OwnerSynchronyCandidate | null> {
  const signals = await ctx.db
    .query("publisherAbuseSignals")
    .withIndex("by_owner_key_and_last_seen_at", (q) => q.eq("ownerKey", args.ownerKey))
    .order("desc")
    .take(MAX_OWNER_TRAFFIC_SIGNALS + 1);
  if (signals.length > MAX_OWNER_TRAFFIC_SIGNALS) return null;

  const uniqueSignals = new Map<Id<"skills">, Doc<"publisherAbuseSignals">>();
  for (const signal of signals) {
    if (isDownloadAnomalySignal(signal) && !uniqueSignals.has(signal.skillId)) {
      uniqueSignals.set(signal.skillId, signal);
    }
  }
  if (uniqueSignals.size < 2 || uniqueSignals.size > MAX_OWNER_SYNCHRONY_SKILLS) return null;

  const firstSignal = uniqueSignals.values().next().value;
  if (!firstSignal?.ownerPublisherId) return null;
  const publisher = await ctx.db.get(firstSignal.ownerPublisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
  const publisherSkillCount = Math.max(0, publisher.publishedSkills ?? 0);
  if (
    publisherSkillCount < 2 ||
    uniqueSignals.size / publisherSkillCount < PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE
  ) {
    return null;
  }

  const windowStartDay = args.todayDay - PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS + 1;
  const candidateSkills: OwnerSynchronySkill[] = [];
  for (const signal of uniqueSignals.values()) {
    const skill = await ctx.db.get(signal.skillId);
    if (
      !skill ||
      skill.ownerPublisherId !== publisher._id ||
      getSkillPublisherContribution(skill).publishedSkills === 0
    ) {
      continue;
    }
    const rows = await ctx.db
      .query("skillDailyStats")
      .withIndex("by_skill_day", (q) =>
        q.eq("skillId", skill._id).gte("day", windowStartDay).lte("day", args.todayDay),
      )
      .take(PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS);
    const rowsByDay = new Map(rows.map((row) => [row.day, row]));
    const dailyDownloads: number[] = [];
    const dailyInstalls: number[] = [];
    for (let day = windowStartDay; day <= args.todayDay; day += 1) {
      const row = rowsByDay.get(day);
      dailyDownloads.push(Math.max(0, row?.downloads ?? 0));
      dailyInstalls.push(Math.max(0, row?.installs ?? 0));
    }
    candidateSkills.push({
      skill,
      dailyDownloads,
      recent7Downloads: dailyDownloads.slice(-7).reduce((sum, value) => sum + value, 0),
      recent7Installs: dailyInstalls.slice(-7).reduce((sum, value) => sum + value, 0),
      recent30Downloads: dailyDownloads.slice(-30).reduce((sum, value) => sum + value, 0),
      recent30Installs: dailyInstalls.slice(-30).reduce((sum, value) => sum + value, 0),
    });
  }

  const evidence = detectPublisherAbuseOwnerSynchrony(
    candidateSkills.map(({ skill, dailyDownloads }) => ({
      skillId: skill._id,
      skillSlug: skill.slug,
      dailyDownloads,
    })),
    publisherSkillCount,
  );
  if (!evidence) return null;

  const evidenceSkillIds = new Set(evidence.skillIds);
  const synchronizedSkills = candidateSkills.filter((candidate) =>
    evidenceSkillIds.has(candidate.skill._id),
  );
  const representative = [...synchronizedSkills].sort((left, right) =>
    left.skill.slug.localeCompare(right.skill.slug),
  )[0];
  if (!representative) return null;
  return {
    ownerKey: args.ownerKey,
    ownerPublisherId: publisher._id,
    ownerUserId: publisher.linkedUserId ?? undefined,
    handleSnapshot: publisher.handle,
    representativeSkillId: representative.skill._id,
    representativeSkillSlug: representative.skill.slug,
    representativeSkillDisplayName: representative.skill.displayName,
    recent7Downloads: sumSkillWindow(synchronizedSkills, "recent7Downloads"),
    recent7Installs: sumSkillWindow(synchronizedSkills, "recent7Installs"),
    recent30Downloads: sumSkillWindow(synchronizedSkills, "recent30Downloads"),
    recent30Installs: sumSkillWindow(synchronizedSkills, "recent30Installs"),
    allTimeDownloads: synchronizedSkills.reduce(
      (sum, candidate) => sum + readCanonicalStat(candidate.skill, "downloads"),
      0,
    ),
    allTimeInstalls: synchronizedSkills.reduce(
      (sum, candidate) => sum + readCanonicalStat(candidate.skill, "installsAllTime"),
      0,
    ),
    portfolioEvidence: {
      skillCount: synchronizedSkills.length,
      publisherSkillCount,
      allPublisherSkills:
        publisherSkillCount > 0 && synchronizedSkills.length === publisherSkillCount,
      skillSlugs: evidence.skillSlugs,
      correlationFloor: evidence.correlationFloor,
      correlationMedian: evidence.correlationMedian,
      peak7DownloadsMin: evidence.peak7DownloadsMin,
      peak7DownloadsMax: evidence.peak7DownloadsMax,
      catalogCoverage: evidence.catalogCoverage,
      windowStartDay,
      windowEndDay: args.todayDay,
    },
  };
}

export const getPublisherAbuseOwnerSynchronyCandidateInternal = internalQuery({
  args: { ownerKey: v.string(), todayDay: v.number() },
  handler: getPublisherAbuseOwnerSynchronyCandidateInternalHandler,
});

export async function upsertPublisherAbuseOwnerSynchronySignalInternalHandler(
  ctx: MutationCtx,
  args: {
    runId?: Id<"publisherAbuseScoreRuns">;
    candidate: OwnerSynchronyCandidate;
    now: number;
  },
) {
  const { candidate } = args;
  const existing = await ctx.db
    .query("publisherAbuseSignals")
    .withIndex("by_owner_key_and_signal_type", (q) =>
      q.eq("ownerKey", candidate.ownerKey).eq("signalType", OWNER_SYNCHRONY_SIGNAL_TYPE),
    )
    .first();
  const snapshot = {
    signalType: OWNER_SYNCHRONY_SIGNAL_TYPE,
    ownerKey: candidate.ownerKey,
    ownerPublisherId: candidate.ownerPublisherId,
    ownerUserId: candidate.ownerUserId ?? null,
    handleSnapshot: candidate.handleSnapshot,
    skillId: candidate.representativeSkillId,
    skillSlug: candidate.representativeSkillSlug,
    skillDisplayName: candidate.representativeSkillDisplayName,
    ...(args.runId ? { latestRunId: args.runId } : {}),
    recent7Downloads: candidate.recent7Downloads,
    recent7Installs: candidate.recent7Installs,
    recent7InstallDownloadRatio: installDownloadRatio(
      candidate.recent7Downloads,
      candidate.recent7Installs,
    ),
    recent30Downloads: candidate.recent30Downloads,
    recent30Installs: candidate.recent30Installs,
    recent30InstallDownloadRatio: installDownloadRatio(
      candidate.recent30Downloads,
      candidate.recent30Installs,
    ),
    allTimeDownloads: candidate.allTimeDownloads,
    allTimeInstalls: candidate.allTimeInstalls,
    allTimeInstallDownloadRatio: installDownloadRatio(
      candidate.allTimeDownloads,
      candidate.allTimeInstalls,
    ),
    reasonCodes: [...OWNER_SYNCHRONY_REASON_CODES],
    portfolioEvidence: candidate.portfolioEvidence,
  };

  if (existing) {
    const previousStatus = existing.reviewStatus;
    const snoozeExpired =
      previousStatus === "snoozed" &&
      typeof existing.snoozedUntil === "number" &&
      existing.snoozedUntil <= args.now;
    const hasEvidenceCheckpoint =
      typeof existing.evidenceBaselineDownloads === "number" &&
      typeof existing.evidenceBaselineInstalls === "number";
    const evidenceBaselineDownloads =
      existing.evidenceBaselineDownloads ?? candidate.allTimeDownloads;
    const evidenceBaselineInstalls = existing.evidenceBaselineInstalls ?? candidate.allTimeInstalls;
    const freshDownloadsSinceSnooze = Math.max(
      0,
      candidate.allTimeDownloads - evidenceBaselineDownloads,
    );
    const freshInstallsSinceSnooze = Math.max(
      0,
      candidate.allTimeInstalls - evidenceBaselineInstalls,
    );
    const recurringAfterSnooze =
      snoozeExpired &&
      hasEvidenceCheckpoint &&
      freshPublisherAbuseEvidenceCrossesRepeatThreshold(OWNER_SYNCHRONY_SIGNAL_TYPE, {
        downloads: freshDownloadsSinceSnooze,
        installs: freshInstallsSinceSnooze,
      });
    const evidenceChanged =
      JSON.stringify(existing.portfolioEvidence?.skillSlugs ?? []) !==
        JSON.stringify(candidate.portfolioEvidence.skillSlugs) ||
      existing.portfolioEvidence?.allPublisherSkills !==
        candidate.portfolioEvidence.allPublisherSkills;
    const nextStatus = recurringAfterSnooze ? "open" : previousStatus;
    const shouldNotify = recurringAfterSnooze || (previousStatus === "open" && evidenceChanged);
    await ctx.db.patch(existing._id, {
      ...snapshot,
      reviewStatus: nextStatus,
      snoozedUntil: nextStatus === "snoozed" ? existing.snoozedUntil : undefined,
      evidenceAcknowledgedAt:
        previousStatus === "snoozed"
          ? (existing.evidenceAcknowledgedAt ?? args.now)
          : existing.evidenceAcknowledgedAt,
      evidenceBaselineDownloads:
        previousStatus === "snoozed"
          ? evidenceBaselineDownloads
          : existing.evidenceBaselineDownloads,
      evidenceBaselineInstalls:
        previousStatus === "snoozed" ? evidenceBaselineInstalls : existing.evidenceBaselineInstalls,
      freshDownloadsSinceSnooze:
        previousStatus === "snoozed"
          ? freshDownloadsSinceSnooze
          : existing.freshDownloadsSinceSnooze,
      freshInstallsSinceSnooze:
        previousStatus === "snoozed" ? freshInstallsSinceSnooze : existing.freshInstallsSinceSnooze,
      recurrenceCount: recurringAfterSnooze
        ? (existing.recurrenceCount ?? 0) + 1
        : existing.recurrenceCount,
      notificationBaselineDownloads: shouldNotify
        ? candidate.allTimeDownloads
        : (existing.notificationBaselineDownloads ?? existing.allTimeDownloads),
      notificationBaselineInstalls: shouldNotify
        ? candidate.allTimeInstalls
        : (existing.notificationBaselineInstalls ?? existing.allTimeInstalls),
      lastSeenAt: args.now,
      seenCount: existing.seenCount + 1,
      lastChangedAt: shouldNotify ? args.now : existing.lastChangedAt,
      needsNotification: shouldNotify ? true : (existing.needsNotification ?? false),
      notificationClaimedAt: shouldNotify ? undefined : existing.notificationClaimedAt,
      lastNotificationError: shouldNotify ? undefined : existing.lastNotificationError,
    });
    return {
      signalId: existing._id,
      created: false as const,
      changed: shouldNotify,
    };
  }

  const signalId = await ctx.db.insert("publisherAbuseSignals", {
    ...snapshot,
    firstSeenAt: args.now,
    lastSeenAt: args.now,
    seenCount: 1,
    reviewStatus: "open",
    notificationBaselineDownloads: candidate.allTimeDownloads,
    notificationBaselineInstalls: candidate.allTimeInstalls,
    lastChangedAt: args.now,
    needsNotification: true,
  });
  return {
    signalId,
    created: true as const,
    changed: true,
  };
}

export const upsertPublisherAbuseOwnerSynchronySignalInternal = internalMutation({
  args: {
    runId: v.optional(v.id("publisherAbuseScoreRuns")),
    candidate: ownerSynchronyCandidateValidator,
    now: v.number(),
  },
  handler: upsertPublisherAbuseOwnerSynchronySignalInternalHandler,
});

export async function runPublisherAbuseOwnerSynchronyScanInternalHandler(
  ctx: ActionCtx,
  args: {
    runId?: Id<"publisherAbuseScoreRuns">;
    cursor?: string;
    todayDay: number;
  },
) {
  const page: { ownerKeys: string[]; cursor?: string; isDone: boolean } = await ctx.runQuery(
    internal.publisherAbuseOwnerSynchrony.readPublisherAbuseOwnerKeysPageInternal,
    args.cursor ? { cursor: args.cursor } : {},
  );
  let matchedOwners = 0;
  for (const ownerKey of page.ownerKeys) {
    const candidate: OwnerSynchronyCandidate | null = await ctx.runQuery(
      internal.publisherAbuseOwnerSynchrony.getPublisherAbuseOwnerSynchronyCandidateInternal,
      { ownerKey, todayDay: args.todayDay },
    );
    if (!candidate) continue;
    matchedOwners += 1;
    await ctx.runMutation(
      internal.publisherAbuseOwnerSynchrony.upsertPublisherAbuseOwnerSynchronySignalInternal,
      {
        ...(args.runId ? { runId: args.runId } : {}),
        candidate,
        now: Date.now(),
      },
    );
  }

  if (!page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.publisherAbuseOwnerSynchrony.runPublisherAbuseOwnerSynchronyScanInternal,
      {
        ...(args.runId ? { runId: args.runId } : {}),
        cursor: page.cursor,
        todayDay: args.todayDay,
      },
    );
  } else {
    await ctx.scheduler.runAfter(
      0,
      internal.publisherAbuse.notifyPublisherAbuseSignalChangesInternal,
      {},
    );
  }
  return { matchedOwners, isDone: page.isDone };
}

export const runPublisherAbuseOwnerSynchronyScanInternal = internalAction({
  args: {
    runId: v.optional(v.id("publisherAbuseScoreRuns")),
    cursor: v.optional(v.string()),
    todayDay: v.number(),
  },
  handler: runPublisherAbuseOwnerSynchronyScanInternalHandler,
});
