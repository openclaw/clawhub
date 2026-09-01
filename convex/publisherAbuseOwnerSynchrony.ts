import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { isPublicSkillDoc } from "./lib/globalStats";
import {
  detectPublisherAbuseOwnerSynchrony,
  PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE,
  PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS,
} from "./lib/publisherAbuseOwnerSynchrony";

const OWNER_CANDIDATE_PAGE_SIZE = 50;
const OWNER_SKILL_COUNT_PAGE_SIZE = 100;
const MAX_OWNER_SYNCHRONY_CANDIDATES = 8_000;
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

type OwnerSynchronyCandidatePage = {
  candidates: Array<OwnerSynchronySkill & { ownerPublisherId: Id<"publishers"> }>;
  cursor?: string;
  isDone: boolean;
};

type OwnerSynchronyPublisher = {
  publisherId: Id<"publishers">;
  linkedUserId?: Id<"users">;
  handle: string;
  publishedSkills?: number;
};

type OwnerSkillCountPage = {
  publicSkillCount: number;
  cursor?: string;
  isDone: boolean;
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
  const candidate = await ctx.db
    .query("publisherAbuseTemporalScanCandidates")
    .withIndex("by_run_id_and_synchrony_eligible_and_owner_key", (q) => {
      const range = q.eq("runId", args.runId).eq("synchronyEligible", true);
      return args.cursor ? range.gt("ownerKey", args.cursor) : range;
    })
    .first();

  return {
    ownerKeys: candidate ? [candidate.ownerKey] : [],
    cursor: candidate?.ownerKey,
    isDone: candidate === null,
  };
}

export const readPublisherAbuseOwnerKeysPageInternal = internalQuery({
  args: { runId: v.id("publisherAbuseScoreRuns"), cursor: v.optional(v.string()) },
  handler: readPublisherAbuseOwnerKeysPageInternalHandler,
});

export async function readPublisherAbuseOwnerCandidatesPageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { runId: Id<"publisherAbuseScoreRuns">; ownerKey: string; cursor?: string },
): Promise<OwnerSynchronyCandidatePage> {
  const page = await ctx.db
    .query("publisherAbuseTemporalScanCandidates")
    .withIndex("by_run_id_and_synchrony_eligible_and_owner_key", (q) =>
      q.eq("runId", args.runId).eq("synchronyEligible", true).eq("ownerKey", args.ownerKey),
    )
    .paginate({ cursor: args.cursor ?? null, numItems: OWNER_CANDIDATE_PAGE_SIZE });

  return {
    candidates: page.page.flatMap((candidate) => {
      if (
        !candidate.ownerPublisherId ||
        candidate.synchronyDailyDownloads?.length !== PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS
      ) {
        return [];
      }
      return [
        {
          skillId: candidate.skillId,
          ownerPublisherId: candidate.ownerPublisherId,
          skillSlug: candidate.slug,
          skillDisplayName: candidate.displayName,
          dailyDownloads: candidate.synchronyDailyDownloads,
          recent7Downloads: candidate.temporalScore.recent7Downloads,
          recent7Installs: candidate.temporalScore.recent7Installs,
          recent30Downloads: candidate.temporalScore.recent30Downloads,
          recent30Installs: candidate.temporalScore.recent30Installs,
          allTimeDownloads: candidate.totalDownloads,
          allTimeInstalls: candidate.totalInstalls,
        },
      ];
    }),
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

export const readPublisherAbuseOwnerCandidatesPageInternal = internalQuery({
  args: {
    runId: v.id("publisherAbuseScoreRuns"),
    ownerKey: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: readPublisherAbuseOwnerCandidatesPageInternalHandler,
});

export async function readPublisherAbuseOwnerSkillCountPageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { ownerPublisherId: Id<"publishers">; cursor?: string },
): Promise<OwnerSkillCountPage> {
  const page = await ctx.db
    .query("skills")
    .withIndex("by_owner_publisher_active_updated", (q) =>
      q.eq("ownerPublisherId", args.ownerPublisherId).eq("softDeletedAt", undefined),
    )
    .paginate({ cursor: args.cursor ?? null, numItems: OWNER_SKILL_COUNT_PAGE_SIZE });

  return {
    publicSkillCount: page.page.filter(isPublicSkillDoc).length,
    cursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

export const readPublisherAbuseOwnerSkillCountPageInternal = internalQuery({
  args: { ownerPublisherId: v.id("publishers"), cursor: v.optional(v.string()) },
  handler: readPublisherAbuseOwnerSkillCountPageInternalHandler,
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
    publishedSkills:
      typeof publisher.publishedSkills === "number"
        ? Math.max(0, publisher.publishedSkills)
        : undefined,
  };
}

export const getPublisherAbuseOwnerSynchronyPublisherInternal = internalQuery({
  args: { ownerPublisherId: v.id("publishers") },
  handler: getPublisherAbuseOwnerSynchronyPublisherInternalHandler,
});

async function countLegacyPublisherPublicSkills(
  ctx: Pick<ActionCtx, "runQuery">,
  ownerPublisherId: Id<"publishers">,
  candidateCount: number,
) {
  const maxRelevantSkillCount = Math.floor(
    candidateCount / PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE,
  );
  const maxPages = Math.ceil(MAX_OWNER_SYNCHRONY_CANDIDATES / OWNER_SKILL_COUNT_PAGE_SIZE);
  let publicSkillCount = 0;
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page: OwnerSkillCountPage = await ctx.runQuery(
      internal.publisherAbuseOwnerSynchrony.readPublisherAbuseOwnerSkillCountPageInternal,
      cursor ? { ownerPublisherId, cursor } : { ownerPublisherId },
    );
    publicSkillCount += page.publicSkillCount;
    if (publicSkillCount > maxRelevantSkillCount) return null;
    if (page.isDone) return publicSkillCount;
    if (!page.cursor) throw new Error("Publisher skill count page did not return a cursor");
    cursor = page.cursor;
  }
  return null;
}

export async function getPublisherAbuseOwnerSynchronyCandidateInternalHandler(
  ctx: Pick<ActionCtx, "runQuery">,
  args: { runId: Id<"publisherAbuseScoreRuns">; ownerKey: string; todayDay: number },
): Promise<OwnerSynchronyCandidate | null> {
  const uniqueCandidates = new Map<
    Id<"skills">,
    OwnerSynchronySkill & { ownerPublisherId: Id<"publishers"> }
  >();
  let cursor: string | undefined;
  while (true) {
    const page: OwnerSynchronyCandidatePage = await ctx.runQuery(
      internal.publisherAbuseOwnerSynchrony.readPublisherAbuseOwnerCandidatesPageInternal,
      cursor
        ? { runId: args.runId, ownerKey: args.ownerKey, cursor }
        : { runId: args.runId, ownerKey: args.ownerKey },
    );
    for (const candidate of page.candidates) {
      if (!uniqueCandidates.has(candidate.skillId)) {
        if (uniqueCandidates.size >= MAX_OWNER_SYNCHRONY_CANDIDATES) {
          console.warn("[publisher-temporal-abuse-scan] skipped oversized synchrony publisher", {
            event: "publisher_temporal_abuse_synchrony_owner_skipped",
            runId: args.runId,
            ownerKey: args.ownerKey,
            candidateLimit: MAX_OWNER_SYNCHRONY_CANDIDATES,
          });
          return null;
        }
        uniqueCandidates.set(candidate.skillId, candidate);
      }
    }
    if (page.isDone) break;
    if (!page.cursor) throw new Error("Owner synchrony candidate page did not return a cursor");
    cursor = page.cursor;
  }

  if (uniqueCandidates.size < 2) return null;

  const ownerPublisherId = uniqueCandidates.values().next().value?.ownerPublisherId;
  if (!ownerPublisherId) return null;
  const publisher: OwnerSynchronyPublisher | null = await ctx.runQuery(
    internal.publisherAbuseOwnerSynchrony.getPublisherAbuseOwnerSynchronyPublisherInternal,
    { ownerPublisherId },
  );
  if (!publisher) return null;
  const publisherSkillCount =
    publisher.publishedSkills ??
    (await countLegacyPublisherPublicSkills(ctx, ownerPublisherId, uniqueCandidates.size));
  if (publisherSkillCount === null) return null;
  if (
    publisherSkillCount < 2 ||
    uniqueCandidates.size / publisherSkillCount <
      PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE
  ) {
    return null;
  }

  const windowStartDay = args.todayDay - PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS + 1;
  const candidateSkills: OwnerSynchronySkill[] = [...uniqueCandidates.values()].map(
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
