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

const OWNER_KEY_PAGE_SIZE = 50;
const OWNER_SIGNAL_PAGE_SIZE = 50;
const OWNER_SYNCHRONY_SIGNAL_TYPE = "owner_synchronized_download_trends" as const;
const OWNER_SYNCHRONY_REASON_CODES = [
  "multiple_skills_have_anomalous_downloads",
  "skills_share_synchronized_download_trends",
] as const;

type OwnerSynchronySkill = {
  skillId: Id<"skills">;
  skillSlug: string;
  skillDisplayName: string;
  dailyDownloads: number[];
  recent7Downloads: number;
  recent7Installs: number;
  recent30Downloads: number;
  recent30Installs: number;
  allTimeDownloads: number;
  allTimeInstalls: number;
};

type OwnerSynchronySignalPage = {
  signals: Array<OwnerSynchronySkill & { ownerPublisherId: Id<"publishers"> }>;
  cursor?: string;
  isDone: boolean;
};

type OwnerSynchronyPublisher = {
  publisherId: Id<"publishers">;
  linkedUserId?: Id<"users">;
  handle: string;
  publishedSkills: number;
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
    signal.signalType === "sustained_downloads_flat_installs" ||
    signal.signalType === "download_spike_flat_installs" ||
    signal.signalType === "sustained_abnormal_download_days"
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
  args: { runId: Id<"publisherAbuseScoreRuns">; cursor?: string },
) {
  const page = await ctx.db
    .query("publisherAbuseSignals")
    .withIndex("by_latest_run_id_and_last_seen_at", (q) => q.eq("latestRunId", args.runId))
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: OWNER_KEY_PAGE_SIZE });

  const anomalySignals = page.page.filter(isDownloadAnomalySignal);
  const pageOwnerKeys = [...new Set(anomalySignals.map((signal) => signal.ownerKey))];
  const ownerKeys: string[] = [];
  for (const ownerKey of pageOwnerKeys) {
    const canonicalSignal = await ctx.db
      .query("publisherAbuseSignals")
      .withIndex("by_owner_key_and_latest_run_id_and_last_seen_at", (q) =>
        q.eq("ownerKey", ownerKey).eq("latestRunId", args.runId),
      )
      .order("desc")
      .filter((q) =>
        q.or(
          q.eq(q.field("signalType"), "sustained_downloads_flat_installs"),
          q.eq(q.field("signalType"), "download_spike_flat_installs"),
          q.eq(q.field("signalType"), "sustained_abnormal_download_days"),
        ),
      )
      .first();

    // Classification is complete before synchrony starts, so this representative
    // stays stable for the run and emits the owner on exactly one source page.
    if (canonicalSignal && anomalySignals.some((signal) => signal._id === canonicalSignal._id)) {
      ownerKeys.push(ownerKey);
    }
  }

  return {
    ownerKeys,
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

export const readPublisherAbuseOwnerKeysPageInternal = internalQuery({
  args: { runId: v.id("publisherAbuseScoreRuns"), cursor: v.optional(v.string()) },
  handler: readPublisherAbuseOwnerKeysPageInternalHandler,
});

export async function readPublisherAbuseOwnerSignalsPageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { runId: Id<"publisherAbuseScoreRuns">; ownerKey: string; cursor?: string },
): Promise<OwnerSynchronySignalPage> {
  const page = await ctx.db
    .query("publisherAbuseSignals")
    .withIndex("by_owner_key_and_latest_run_id_and_last_seen_at", (q) =>
      q.eq("ownerKey", args.ownerKey).eq("latestRunId", args.runId),
    )
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: OWNER_SIGNAL_PAGE_SIZE });

  return {
    signals: page.page.flatMap((signal) => {
      if (
        !isDownloadAnomalySignal(signal) ||
        signal.ownerPublisherId === null ||
        signal.synchronyDailyDownloads?.length !== PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS
      ) {
        return [];
      }
      return [
        {
          skillId: signal.skillId,
          ownerPublisherId: signal.ownerPublisherId,
          skillSlug: signal.skillSlug,
          skillDisplayName: signal.skillDisplayName,
          dailyDownloads: signal.synchronyDailyDownloads,
          recent7Downloads: signal.recent7Downloads,
          recent7Installs: signal.recent7Installs,
          recent30Downloads: signal.recent30Downloads,
          recent30Installs: signal.recent30Installs,
          allTimeDownloads: signal.allTimeDownloads,
          allTimeInstalls: signal.allTimeInstalls,
        },
      ];
    }),
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

export const readPublisherAbuseOwnerSignalsPageInternal = internalQuery({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    ownerKey: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: readPublisherAbuseOwnerSignalsPageInternalHandler,
});

export async function getPublisherAbuseOwnerSynchronyPublisherInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { ownerPublisherId: Id<"publishers"> },
): Promise<OwnerSynchronyPublisher | null> {
  const publisher = await ctx.db.get(args.ownerPublisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
  return {
    publisherId: publisher._id,
    linkedUserId: publisher.linkedUserId ?? undefined,
    handle: publisher.handle,
    publishedSkills: Math.max(0, publisher.publishedSkills ?? 0),
  };
}

export const getPublisherAbuseOwnerSynchronyPublisherInternal = internalQuery({
  args: { ownerPublisherId: v.id("publishers") },
  handler: getPublisherAbuseOwnerSynchronyPublisherInternalHandler,
});

export async function getPublisherAbuseOwnerSynchronyCandidateInternalHandler(
  ctx: Pick<ActionCtx, "runQuery">,
  args: { runId: Id<"publisherAbuseScoreRuns">; ownerKey: string; todayDay: number },
): Promise<OwnerSynchronyCandidate | null> {
  const uniqueSignals = new Map<
    Id<"skills">,
    OwnerSynchronySkill & { ownerPublisherId: Id<"publishers"> }
  >();
  let cursor: string | undefined;
  while (true) {
    const page: OwnerSynchronySignalPage = await ctx.runQuery(
      internal.publisherAbuseOwnerSynchrony.readPublisherAbuseOwnerSignalsPageInternal,
      cursor
        ? { runId: args.runId, ownerKey: args.ownerKey, cursor }
        : { runId: args.runId, ownerKey: args.ownerKey },
    );
    for (const signal of page.signals) {
      if (!uniqueSignals.has(signal.skillId)) {
        uniqueSignals.set(signal.skillId, signal);
      }
    }
    if (page.isDone) break;
    if (!page.cursor) throw new Error("Owner synchrony signal page did not return a cursor");
    cursor = page.cursor;
  }

  if (uniqueSignals.size < 2) return null;

  const ownerPublisherId = uniqueSignals.values().next().value?.ownerPublisherId;
  if (!ownerPublisherId) return null;
  const publisher: OwnerSynchronyPublisher | null = await ctx.runQuery(
    internal.publisherAbuseOwnerSynchrony.getPublisherAbuseOwnerSynchronyPublisherInternal,
    { ownerPublisherId },
  );
  if (!publisher) return null;
  const publisherSkillCount = publisher.publishedSkills;
  if (
    publisherSkillCount < 2 ||
    uniqueSignals.size / publisherSkillCount < PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE
  ) {
    return null;
  }

  const windowStartDay = args.todayDay - PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS + 1;
  const candidateSkills: OwnerSynchronySkill[] = [...uniqueSignals.values()].map(
    ({ ownerPublisherId: _ownerPublisherId, ...skill }) => skill,
  );

  const evidence = detectPublisherAbuseOwnerSynchrony(
    candidateSkills.map(({ skillId, skillSlug, dailyDownloads }) => ({
      skillId,
      skillSlug,
      dailyDownloads,
    })),
    publisherSkillCount,
  );
  if (!evidence) return null;

  const evidenceSkillIds = new Set(evidence.skillIds);
  const synchronizedSkills = candidateSkills.filter((candidate) =>
    evidenceSkillIds.has(candidate.skillId),
  );
  const representative = [...synchronizedSkills].sort((left, right) =>
    left.skillSlug.localeCompare(right.skillSlug),
  )[0];
  if (!representative) return null;
  return {
    ownerKey: args.ownerKey,
    ownerPublisherId: publisher.publisherId,
    ownerUserId: publisher.linkedUserId,
    handleSnapshot: publisher.handle,
    representativeSkillId: representative.skillId,
    representativeSkillSlug: representative.skillSlug,
    representativeSkillDisplayName: representative.skillDisplayName,
    recent7Downloads: sumSkillWindow(synchronizedSkills, "recent7Downloads"),
    recent7Installs: sumSkillWindow(synchronizedSkills, "recent7Installs"),
    recent30Downloads: sumSkillWindow(synchronizedSkills, "recent30Downloads"),
    recent30Installs: sumSkillWindow(synchronizedSkills, "recent30Installs"),
    allTimeDownloads: sumSkillWindow(synchronizedSkills, "allTimeDownloads"),
    allTimeInstalls: sumSkillWindow(synchronizedSkills, "allTimeInstalls"),
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
    if (args.runId && existing.latestRunId === args.runId) {
      return {
        signalId: existing._id,
        created: false as const,
        changed: false as const,
        alreadyRecorded: true as const,
      };
    }
    await ctx.db.patch(existing._id, {
      ...snapshot,
      lastSeenAt: args.now,
      seenCount: existing.seenCount + 1,
    });
    return {
      signalId: existing._id,
      created: false as const,
      changed: false as const,
      alreadyRecorded: false as const,
    };
  }

  const signalId = await ctx.db.insert("publisherAbuseSignals", {
    ...snapshot,
    firstSeenAt: args.now,
    lastSeenAt: args.now,
    seenCount: 1,
  });
  return {
    signalId,
    created: true as const,
    changed: true,
    alreadyRecorded: false as const,
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
    runId: Id<"publisherAbuseScoreRuns">;
    cursor?: string;
    todayDay: number;
  },
) {
  const page = await scanPublisherAbuseOwnerSynchronyPage(ctx, args);
  if (!page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.publisherAbuseOwnerSynchrony.runPublisherAbuseOwnerSynchronyScanInternal,
      {
        runId: args.runId,
        cursor: page.cursor,
        todayDay: args.todayDay,
      },
    );
  }
  return { matchedOwners: page.matchedOwners, isDone: page.isDone };
}

export async function scanPublisherAbuseOwnerSynchronyPage(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  args: {
    runId: Id<"publisherAbuseScoreRuns">;
    cursor?: string;
    todayDay: number;
  },
) {
  const page: { ownerKeys: string[]; cursor?: string; isDone: boolean } = await ctx.runQuery(
    internal.publisherAbuseOwnerSynchrony.readPublisherAbuseOwnerKeysPageInternal,
    args.cursor ? { runId: args.runId, cursor: args.cursor } : { runId: args.runId },
  );
  let matchedOwners = 0;
  for (const ownerKey of page.ownerKeys) {
    const candidate = await getPublisherAbuseOwnerSynchronyCandidateInternalHandler(ctx, {
      runId: args.runId,
      ownerKey,
      todayDay: args.todayDay,
    });
    if (!candidate) continue;
    matchedOwners += 1;
    await ctx.runMutation(
      internal.publisherAbuseOwnerSynchrony.upsertPublisherAbuseOwnerSynchronySignalInternal,
      {
        runId: args.runId,
        candidate,
        now: Date.now(),
      },
    );
  }

  return { matchedOwners, cursor: page.cursor, isDone: page.isDone };
}

export const runPublisherAbuseOwnerSynchronyScanInternal = internalAction({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    cursor: v.optional(v.string()),
    todayDay: v.number(),
  },
  handler: runPublisherAbuseOwnerSynchronyScanInternalHandler,
});
