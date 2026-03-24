import { getAuthUserId } from "@convex-dev/auth/server";
import { getPage, type IndexKey, paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v, type Value } from "convex/values";
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
import { getSkillBadgeMap, getSkillBadgeMaps, isSkillHighlighted } from "./lib/badges";
import { scheduleNextBatchIfNeeded } from "./lib/batching";
import { generateChangelogPreview as buildChangelogPreview } from "./lib/changelog";
import { embeddingVisibilityFor } from "./lib/embeddingVisibility";
import {
  canHealSkillOwnershipByGitHubProviderAccountId,
  getGitHubProviderAccountId,
} from "./lib/githubIdentity";
import {
  adjustGlobalPublicSkillsCount,
  countPublicSkillsForGlobalStats,
  getPublicSkillVisibilityDelta,
  isPublicSkillDoc,
  readGlobalPublicSkillsCount,
} from "./lib/globalStats";
import {
  applyManualOverrideToSkillPatch,
  isManualOverrideReason,
  type ManualModerationOverride,
} from "./lib/manualOverrides";
import { deriveModerationFlags } from "./lib/moderation";
import { buildModerationSnapshot } from "./lib/moderationEngine";
import {
  legacyFlagsFromVerdict,
  summarizeReasonCodes,
  verdictFromCodes,
} from "./lib/moderationReasonCodes";
import {
  type HydratableSkill,
  type PublicPublisher,
  toPublicPublisher,
  toPublicSkill,
  toPublicUser,
} from "./lib/public";
import {
  ensurePersonalPublisherForUser,
  getOwnerPublisher,
  requirePublisherRole,
} from "./lib/publishers";
import {
  AUTO_HIDE_REPORT_THRESHOLD,
  MAX_ACTIVE_REPORTS_PER_USER,
  MAX_REPORT_REASON_LENGTH,
} from "./lib/reporting";
import {
  enforceReservedSlugCooldownForNewSkill,
  formatReservedSlugCooldownMessage,
  getLatestActiveReservedSlug,
  listActiveReservedSlugsForSlug,
  reserveSlugForHardDeleteFinalize,
  upsertReservedSlugForRightfulOwner,
} from "./lib/reservedSlugs";
import {
  fetchText,
  type PublishResult,
  publishVersionForUser,
  queueHighlightedWebhook,
} from "./lib/skillPublish";
import { getFrontmatterValue, hashSkillFiles } from "./lib/skills";
import { computeIsSuspicious, isSkillSuspicious } from "./lib/skillSafety";
import { digestToHydratableSkill, digestToOwnerInfo } from "./lib/skillSearchDigest";
import schema from "./schema";

export { publishVersionForUser } from "./lib/skillPublish";

type ReadmeResult = { path: string; text: string };
type FileTextResult = {
  path: string;
  text: string;
  size: number;
  sha256: string;
};
const PLATFORM_SKILL_LICENSE = "MIT-0" as const;

const MAX_DIFF_FILE_BYTES = 200 * 1024;
const MAX_LIST_LIMIT = 50;
const MAX_PUBLIC_LIST_LIMIT = 200;
const MAX_LIST_BULK_LIMIT = 200;
const MAX_LIST_TAKE = 1000;
const MAX_SKILL_CATALOG_SCAN_DOCUMENTS = 30_000;
const MAX_SKILL_CATALOG_SCAN_PAGES = 200;
const MAX_SKILL_CATALOG_SEARCH_PAGE_SIZE = 200;
const HARD_DELETE_BATCH_SIZE = 100;
const HARD_DELETE_VERSION_BATCH_SIZE = 10;
const HARD_DELETE_LEADERBOARD_BATCH_SIZE = 25;
const BAN_USER_SKILLS_BATCH_SIZE = 25;
const MAX_REPORT_REASON_SAMPLE = 5;
const RATE_LIMIT_HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_DAY_MS = 24 * RATE_LIMIT_HOUR_MS;
const SLUG_RESERVATION_DAYS = 90;
const SLUG_RESERVATION_MS = SLUG_RESERVATION_DAYS * RATE_LIMIT_DAY_MS;
const LOW_TRUST_ACCOUNT_AGE_MS = 30 * RATE_LIMIT_DAY_MS;
const MAX_MANUAL_OVERRIDE_NOTE_LENGTH = 1200;
const DEFAULT_STAFF_AUDIT_LOG_LIMIT = 10;
const MAX_STAFF_AUDIT_LOG_LIMIT = 50;
const USER_MODERATION_REASON = "user.moderation";
const SKILL_CATALOG_CURSOR_PREFIX = "skillcat:";

function buildStructuredModerationPatch(params: {
  staticScan?: Doc<"skillVersions">["staticScan"];
  vtStatus?: string;
  llmStatus?: string;
  sourceVersionId?: Id<"skillVersions">;
}): Pick<
  Doc<"skills">,
  | "moderationVerdict"
  | "moderationReasonCodes"
  | "moderationEvidence"
  | "moderationSummary"
  | "moderationEngineVersion"
  | "moderationEvaluatedAt"
  | "moderationSourceVersionId"
> {
  const snapshot = buildModerationSnapshot({
    staticScan: params.staticScan,
    vtStatus: params.vtStatus,
    llmStatus: params.llmStatus,
    sourceVersionId: params.sourceVersionId,
  });

  return {
    moderationVerdict: snapshot.verdict,
    moderationReasonCodes: snapshot.reasonCodes.length ? snapshot.reasonCodes : undefined,
    moderationEvidence: snapshot.evidence.length ? snapshot.evidence : undefined,
    moderationSummary: snapshot.summary,
    moderationEngineVersion: snapshot.engineVersion,
    moderationEvaluatedAt: snapshot.evaluatedAt,
    moderationSourceVersionId: params.sourceVersionId,
  };
}

type SkillModerationPatch = Partial<Doc<"skills">>;

function trimManualOverrideNote(note: string) {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new ConvexError("Audit note is required.");
  }
  if (trimmed.length > MAX_MANUAL_OVERRIDE_NOTE_LENGTH) {
    throw new ConvexError(
      `Audit note must be at most ${MAX_MANUAL_OVERRIDE_NOTE_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function normalizeAnalysisStatus(status: string | undefined) {
  return status?.trim().toLowerCase();
}

function resolveScannerModerationReason(params: {
  vtStatus?: string;
  llmStatus?: string;
  verdict?: Doc<"skills">["moderationVerdict"];
}) {
  const vtStatus = normalizeAnalysisStatus(params.vtStatus);
  const llmStatus = normalizeAnalysisStatus(params.llmStatus);

  if (vtStatus === "malicious") return "scanner.vt.malicious";
  if (llmStatus === "malicious") return "scanner.llm.malicious";
  if (vtStatus === "suspicious") return "scanner.vt.suspicious";
  if (llmStatus === "suspicious") return "scanner.llm.suspicious";
  if (vtStatus === "pending" || vtStatus === "loading" || vtStatus === "not_found") {
    return "scanner.vt.pending";
  }
  if (llmStatus === "pending" || llmStatus === "loading") return "scanner.llm.pending";
  if (vtStatus === "clean") return "scanner.vt.clean";
  if (llmStatus === "clean") return "scanner.llm.clean";
  if (params.verdict === "malicious") return "scanner.aggregate.malicious";
  if (params.verdict === "suspicious") return "scanner.aggregate.suspicious";
  return "scanner.aggregate.clean";
}

function buildScannerModerationPatchFromVersion(params: {
  owner: Doc<"users"> | null | undefined;
  version: Pick<Doc<"skillVersions">, "_id" | "staticScan" | "vtAnalysis" | "llmAnalysis">;
  now: number;
}): SkillModerationPatch {
  const structuredPatch = buildStructuredModerationPatch({
    staticScan: params.version.staticScan,
    vtStatus: params.version.vtAnalysis?.status,
    llmStatus: params.version.llmAnalysis?.status,
    sourceVersionId: params.version._id,
  });

  const sourceReasonCodes = structuredPatch.moderationReasonCodes ?? [];
  const sourceReason = resolveScannerModerationReason({
    vtStatus: params.version.vtAnalysis?.status,
    llmStatus: params.version.llmAnalysis?.status,
    verdict: structuredPatch.moderationVerdict,
  });
  const bypassSuspicious =
    structuredPatch.moderationVerdict === "suspicious" &&
    isPrivilegedOwnerForSuspiciousBypass(params.owner);
  const moderationReasonCodes = bypassSuspicious
    ? sourceReasonCodes.filter((code) => !code.startsWith("suspicious."))
    : sourceReasonCodes;
  const moderationVerdict = verdictFromCodes(moderationReasonCodes);
  const moderationFlags = legacyFlagsFromVerdict(moderationVerdict);
  const moderationReason = bypassSuspicious
    ? normalizeScannerSuspiciousReason(sourceReason)
    : sourceReason;
  const moderationStatus = moderationVerdict === "malicious" ? "hidden" : "active";

  return {
    moderationStatus,
    moderationReason,
    moderationFlags,
    moderationVerdict,
    moderationReasonCodes: moderationReasonCodes.length ? moderationReasonCodes : undefined,
    moderationEvidence: structuredPatch.moderationEvidence,
    moderationSummary: summarizeReasonCodes(moderationReasonCodes),
    moderationEngineVersion: structuredPatch.moderationEngineVersion,
    moderationEvaluatedAt: structuredPatch.moderationEvaluatedAt,
    moderationSourceVersionId: structuredPatch.moderationSourceVersionId,
    moderationNotes: undefined,
    isSuspicious: computeIsSuspicious({
      moderationFlags,
      moderationReason,
    }),
    hiddenAt: moderationStatus === "hidden" ? params.now : undefined,
    hiddenBy: undefined,
    lastReviewedAt: moderationStatus === "hidden" ? params.now : undefined,
    updatedAt: params.now,
  };
}

function buildPreservedSkillModerationPatch(skill: Doc<"skills">): SkillModerationPatch {
  return {
    moderationReasonCodes: skill.moderationReasonCodes,
    moderationEvidence: skill.moderationEvidence,
    moderationEngineVersion: skill.moderationEngineVersion,
    moderationSourceVersionId: skill.moderationSourceVersionId,
  };
}

function applySkillManualOverrideToSkillPatch(params: {
  skill: Pick<Doc<"skills">, "manualOverride">;
  basePatch: SkillModerationPatch;
  now: number;
}) {
  if (!params.skill.manualOverride) return params.basePatch;
  return applyManualOverrideToSkillPatch({
    basePatch: params.basePatch,
    override: params.skill.manualOverride,
    now: params.now,
  });
}

async function patchStructuredModerationFromVersion(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  version: Pick<Doc<"skillVersions">, "_id" | "staticScan" | "vtAnalysis" | "llmAnalysis">,
) {
  if (shouldPreserveExistingModerationLock(skill)) return;

  const now = Date.now();
  const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
  const basePatch = buildScannerModerationPatchFromVersion({
    owner,
    version,
    now,
  });
  const patch = applySkillManualOverrideToSkillPatch({
    skill,
    basePatch,
    now,
  });

  const nextSkill = { ...skill, ...patch };
  await ctx.db.patch(skill._id, {
    ...patch,
    updatedAt: now,
  });
  await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
}
const TRUSTED_PUBLISHER_SKILL_THRESHOLD = 10;
const LOW_TRUST_BURST_THRESHOLD_PER_HOUR = 8;
const OWNER_ACTIVITY_SCAN_LIMIT = 500;
const NEW_SKILL_RATE_LIMITS = {
  lowTrust: { perHour: 5, perDay: 20 },
  trusted: { perHour: 20, perDay: 80 },
} as const;

const SORT_INDEXES = {
  newest: "by_active_created",
  updated: "by_active_updated",
  name: "by_active_name",
  downloads: "by_active_stats_downloads",
  stars: "by_active_stats_stars",
  installs: "by_active_stats_installs_all_time",
} as const;

// Compound indexes on skillSearchDigest that filter isSuspicious at the index level.
const NONSUSPICIOUS_SORT_INDEXES = {
  newest: "by_nonsuspicious_created",
  updated: "by_nonsuspicious_updated",
  name: "by_nonsuspicious_name",
  downloads: "by_nonsuspicious_downloads",
  stars: "by_nonsuspicious_stars",
  installs: "by_nonsuspicious_installs",
} as const;

function isSkillVersionId(
  value: Id<"skillVersions"> | null | undefined,
): value is Id<"skillVersions"> {
  return typeof value === "string" && value.startsWith("skillVersions:");
}

function isUserId(value: Id<"users"> | null | undefined): value is Id<"users"> {
  return typeof value === "string" && value.startsWith("users:");
}

type OwnerTrustSignals = {
  isLowTrust: boolean;
  skillsLastHour: number;
  skillsLastDay: number;
};

function isPrivilegedOwnerForSuspiciousBypass(owner: Doc<"users"> | null | undefined) {
  if (!owner) return false;
  return owner.role === "admin" || owner.role === "moderator";
}

function stripSuspiciousFlag(flags: string[] | undefined) {
  if (!flags?.length) return undefined;
  const next = flags.filter((flag) => flag !== "flagged.suspicious");
  return next.length ? next : undefined;
}

function hasMalwareBlock(flags: string[] | undefined) {
  return flags?.includes("blocked.malware") ?? false;
}

function isScannerManagedReason(reason: string | undefined) {
  if (!reason) return false;
  return (
    reason === "pending.scan" || reason === "pending.scan.stale" || reason.startsWith("scanner.")
  );
}

function shouldPreserveExistingModerationLock(
  skill: Pick<Doc<"skills">, "moderationStatus" | "moderationReason">,
) {
  if (skill.moderationStatus !== "hidden") return false;
  if (isManualOverrideReason(skill.moderationReason)) return false;
  return !isScannerManagedReason(skill.moderationReason);
}

function buildManualOverrideRecord(params: {
  note: string;
  reviewerUserId: Id<"users">;
  updatedAt: number;
}): ManualModerationOverride {
  return {
    verdict: "clean",
    note: trimManualOverrideNote(params.note),
    reviewerUserId: params.reviewerUserId,
    updatedAt: params.updatedAt,
  };
}

function canApplySkillManualOverride(
  skill: Pick<Doc<"skills">, "moderationStatus" | "moderationReason" | "moderationFlags">,
) {
  if (hasMalwareBlock(skill.moderationFlags)) return false;
  if (shouldPreserveExistingModerationLock(skill)) return false;
  return isSkillSuspicious(skill) || isManualOverrideReason(skill.moderationReason);
}

function shouldSyncModerationFromLatestVersion(
  skill: Pick<
    Doc<"skills">,
    "manualOverride" | "moderationStatus" | "moderationReason" | "softDeletedAt"
  >,
) {
  if (skill.softDeletedAt) return false;
  if (skill.manualOverride) return true;
  if (skill.moderationStatus === "active") return true;
  if (skill.moderationStatus === "removed") return false;
  if (
    skill.moderationReason === "pending.scan" ||
    skill.moderationReason === "pending.scan.stale"
  ) {
    return true;
  }
  return (
    typeof skill.moderationReason === "string" && skill.moderationReason.startsWith("scanner.")
  );
}

async function syncSkillModerationFromLatestVersion(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  now: number,
) {
  const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
  const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
  const basePatch: SkillModerationPatch = latestVersion
    ? buildScannerModerationPatchFromVersion({
        owner,
        version: latestVersion,
        now,
      })
    : {
        moderationStatus: "active",
        moderationReason: undefined,
        moderationNotes: undefined,
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        moderationEvidence: undefined,
        moderationSummary: "No suspicious patterns detected.",
        moderationEngineVersion: undefined,
        moderationEvaluatedAt: now,
        moderationSourceVersionId: undefined,
        isSuspicious: false,
        hiddenAt: undefined,
        hiddenBy: undefined,
        lastReviewedAt: undefined,
        updatedAt: now,
      };

  const patch = applySkillManualOverrideToSkillPatch({
    skill,
    basePatch,
    now,
  });

  const nextSkill = { ...skill, ...patch };
  await ctx.db.patch(skill._id, patch);
  await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
}

function buildConflictingSkillUrl(
  skill: Doc<"skills">,
  owner: Doc<"users"> | Doc<"publishers"> | null | undefined,
) {
  if (!owner || owner.deletedAt || owner.deactivatedAt || !isPublicSkillDoc(skill)) return null;
  const ownerParam = owner.handle?.trim() || String(owner._id);
  if (!ownerParam) return null;
  return `/${encodeURIComponent(ownerParam)}/${encodeURIComponent(skill.slug)}`;
}

function buildSlugTakenErrorMessage(
  skill: Doc<"skills">,
  owner: Doc<"users"> | Doc<"publishers"> | null | undefined,
) {
  if (!owner || owner.deletedAt || owner.deactivatedAt) {
    return (
      "This slug is locked to a deleted or banned account. " +
      "If you believe you are the rightful owner, please contact security@openclaw.ai to reclaim it."
    );
  }
  const base = "Slug is already taken. Choose a different slug.";
  const url = buildConflictingSkillUrl(skill, owner);
  if (!url) return base;
  return `${base} Existing skill: ${url}`;
}

function buildAliasTakenErrorMessage(
  skill: Doc<"skills">,
  owner: Doc<"users"> | Doc<"publishers"> | null | undefined,
) {
  const base = "Slug redirects to an existing skill. Choose a different slug.";
  const url = buildConflictingSkillUrl(skill, owner);
  if (!url) return base;
  return `${base} Existing skill: ${url}`;
}

function normalizeSkillSlugKey(slug: string) {
  return slug.trim().toLowerCase();
}

function normalizeSkillSlugForWrite(slug: string) {
  const normalized = normalizeSkillSlugKey(slug);
  if (!normalized || !/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new ConvexError("Slug must be lowercase and url-safe");
  }
  return normalized;
}

async function getSkillSlugAliasBySlug(ctx: Pick<QueryCtx | MutationCtx, "db">, slug: string) {
  const normalizedSlug = normalizeSkillSlugKey(slug);
  return ctx.db
    .query("skillSlugAliases")
    .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
    .unique();
}

async function listSkillSlugAliasesForSkill(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  skillId: Id<"skills">,
) {
  return ctx.db
    .query("skillSlugAliases")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .collect();
}

async function resolveSkillBySlugOrAlias(ctx: Pick<QueryCtx | MutationCtx, "db">, slug: string) {
  const normalizedSlug = normalizeSkillSlugKey(slug);
  if (!normalizedSlug) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: null,
      skill: null,
      alias: null,
    };
  }

  const directSkill = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
    .unique();
  if (directSkill && !directSkill.softDeletedAt) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: directSkill.slug,
      skill: directSkill,
      alias: null,
    };
  }

  const alias = await getSkillSlugAliasBySlug(ctx, normalizedSlug);
  if (!alias) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: null,
      skill: null,
      alias: null,
    };
  }

  const skill = await ctx.db.get(alias.skillId);
  if (!skill || skill.softDeletedAt) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: null,
      skill: null,
      alias,
    };
  }

  return {
    requestedSlug: normalizedSlug,
    resolvedSlug: skill.slug,
    skill,
    alias,
  };
}

async function repointSkillRelationships(
  ctx: MutationCtx,
  params: {
    fromSkillId: Id<"skills">;
    toSkillId: Id<"skills">;
    toCanonicalSkillId: Id<"skills">;
    targetVersion: Doc<"skillVersions"> | null;
    now: number;
  },
) {
  const canonicalRefs = await ctx.db
    .query("skills")
    .withIndex("by_canonical", (q) => q.eq("canonicalSkillId", params.fromSkillId))
    .collect();
  for (const related of canonicalRefs) {
    await ctx.db.patch(related._id, {
      canonicalSkillId: params.toCanonicalSkillId,
      updatedAt: params.now,
    });
  }

  const forkRefs = await ctx.db
    .query("skills")
    .withIndex("by_fork_of", (q) => q.eq("forkOf.skillId", params.fromSkillId))
    .collect();
  for (const related of forkRefs) {
    await ctx.db.patch(related._id, {
      canonicalSkillId: params.toCanonicalSkillId,
      forkOf: related.forkOf
        ? {
            ...related.forkOf,
            skillId: params.toSkillId,
            version: params.targetVersion?.version ?? related.forkOf.version,
            at: params.now,
          }
        : {
            skillId: params.toSkillId,
            kind: "duplicate",
            version: params.targetVersion?.version,
            at: params.now,
          },
      updatedAt: params.now,
    });
  }
}

function normalizeScannerSuspiciousReason(reason: string | undefined) {
  if (!reason) return reason;
  if (!reason.startsWith("scanner.") || !reason.endsWith(".suspicious")) return reason;
  return `${reason.slice(0, -".suspicious".length)}.clean`;
}

async function adjustGlobalPublicCountForSkillChange(
  ctx: MutationCtx,
  previousSkill: Doc<"skills"> | null | undefined,
  nextSkill: Doc<"skills"> | null | undefined,
) {
  const delta = getPublicSkillVisibilityDelta(previousSkill, nextSkill);
  if (delta === 0) return;
  await adjustGlobalPublicSkillsCount(ctx, delta);
}

async function getOwnerTrustSignals(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<"users">,
  now: number,
): Promise<OwnerTrustSignals> {
  const ownerSkills = await ctx.db
    .query("skills")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", owner._id))
    .order("desc")
    .take(OWNER_ACTIVITY_SCAN_LIMIT);

  const hourThreshold = now - RATE_LIMIT_HOUR_MS;
  const dayThreshold = now - RATE_LIMIT_DAY_MS;
  let skillsLastHour = 0;
  let skillsLastDay = 0;

  for (const skill of ownerSkills) {
    if (skill.createdAt >= dayThreshold) {
      skillsLastDay += 1;
      if (skill.createdAt >= hourThreshold) {
        skillsLastHour += 1;
      }
    }
  }

  const accountCreatedAt = owner.createdAt ?? owner._creationTime;
  const accountAgeMs = Math.max(0, now - accountCreatedAt);
  const isLowTrust =
    accountAgeMs < LOW_TRUST_ACCOUNT_AGE_MS ||
    ownerSkills.length < TRUSTED_PUBLISHER_SKILL_THRESHOLD ||
    skillsLastHour >= LOW_TRUST_BURST_THRESHOLD_PER_HOUR;

  return { isLowTrust, skillsLastHour, skillsLastDay };
}

function enforceNewSkillRateLimit(signals: OwnerTrustSignals) {
  const limits = signals.isLowTrust
    ? NEW_SKILL_RATE_LIMITS.lowTrust
    : NEW_SKILL_RATE_LIMITS.trusted;
  if (signals.skillsLastHour >= limits.perHour) {
    throw new ConvexError(
      `Rate limit: max ${limits.perHour} new skills per hour. Please wait before publishing more.`,
    );
  }
  if (signals.skillsLastDay >= limits.perDay) {
    throw new ConvexError(
      `Rate limit: max ${limits.perDay} new skills per 24 hours. Please wait before publishing more.`,
    );
  }
}

const HARD_DELETE_PHASES = [
  "versions",
  "fingerprints",
  "embeddings",
  "comments",
  "commentReports",
  "reports",
  "stars",
  "badges",
  "dailyStats",
  "statEvents",
  "installs",
  "rootInstalls",
  "leaderboards",
  "canonical",
  "forks",
  "finalize",
] as const;

type HardDeletePhase = (typeof HARD_DELETE_PHASES)[number];

function isHardDeletePhase(value: string | undefined): value is HardDeletePhase {
  if (!value) return false;
  return (HARD_DELETE_PHASES as readonly string[]).includes(value);
}

async function scheduleHardDelete(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  actorUserId: Id<"users">,
  phase: HardDeletePhase,
) {
  await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
    skillId,
    actorUserId,
    phase,
  });
}

async function hardDeleteSkillStep(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  actorUserId: Id<"users">,
  phase: HardDeletePhase,
) {
  const now = Date.now();
  const patch: Partial<Doc<"skills">> = {};
  if (!skill.softDeletedAt) patch.softDeletedAt = now;
  if (skill.moderationStatus !== "removed") patch.moderationStatus = "removed";
  if (!skill.hiddenAt) patch.hiddenAt = now;
  if (!skill.hiddenBy) patch.hiddenBy = actorUserId;
  if (Object.keys(patch).length) {
    patch.lastReviewedAt = now;
    patch.updatedAt = now;
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
  }

  switch (phase) {
    case "versions": {
      const versions = await ctx.db
        .query("skillVersions")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_VERSION_BATCH_SIZE);
      for (const version of versions) {
        await ctx.db.delete(version._id);
      }
      if (versions.length === HARD_DELETE_VERSION_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "versions");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "fingerprints");
      return;
    }
    case "fingerprints": {
      const fingerprints = await ctx.db
        .query("skillVersionFingerprints")
        .withIndex("by_skill_fingerprint", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const fingerprint of fingerprints) {
        await ctx.db.delete(fingerprint._id);
      }
      if (fingerprints.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "fingerprints");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "embeddings");
      return;
    }
    case "embeddings": {
      const embeddings = await ctx.db
        .query("skillEmbeddings")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const embedding of embeddings) {
        await ctx.db.delete(embedding._id);
      }
      if (embeddings.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "embeddings");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "comments");
      return;
    }
    case "comments": {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const comment of comments) {
        await ctx.db.delete(comment._id);
      }
      if (comments.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "comments");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "commentReports");
      return;
    }
    case "commentReports": {
      const commentReports = await ctx.db
        .query("commentReports")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const report of commentReports) {
        await ctx.db.delete(report._id);
      }
      if (commentReports.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "commentReports");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "reports");
      return;
    }
    case "reports": {
      const reports = await ctx.db
        .query("skillReports")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const report of reports) {
        await ctx.db.delete(report._id);
      }
      if (reports.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "reports");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "stars");
      return;
    }
    case "stars": {
      const stars = await ctx.db
        .query("stars")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const star of stars) {
        await ctx.db.delete(star._id);
      }
      if (stars.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "stars");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "badges");
      return;
    }
    case "badges": {
      const badges = await ctx.db
        .query("skillBadges")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const badge of badges) {
        await ctx.db.delete(badge._id);
      }
      if (badges.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "badges");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "dailyStats");
      return;
    }
    case "dailyStats": {
      const dailyStats = await ctx.db
        .query("skillDailyStats")
        .withIndex("by_skill_day", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const stat of dailyStats) {
        await ctx.db.delete(stat._id);
      }
      if (dailyStats.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "dailyStats");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "statEvents");
      return;
    }
    case "statEvents": {
      const statEvents = await ctx.db
        .query("skillStatEvents")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const statEvent of statEvents) {
        await ctx.db.delete(statEvent._id);
      }
      if (statEvents.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "statEvents");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "installs");
      return;
    }
    case "installs": {
      const installs = await ctx.db
        .query("userSkillInstalls")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const install of installs) {
        await ctx.db.delete(install._id);
      }
      if (installs.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "installs");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "rootInstalls");
      return;
    }
    case "rootInstalls": {
      const rootInstalls = await ctx.db
        .query("userSkillRootInstalls")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const rootInstall of rootInstalls) {
        await ctx.db.delete(rootInstall._id);
      }
      if (rootInstalls.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "rootInstalls");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "leaderboards");
      return;
    }
    case "leaderboards": {
      const leaderboards = await ctx.db
        .query("skillLeaderboards")
        .take(HARD_DELETE_LEADERBOARD_BATCH_SIZE);
      for (const leaderboard of leaderboards) {
        const items = leaderboard.items.filter((item) => item.skillId !== skill._id);
        if (items.length !== leaderboard.items.length) {
          await ctx.db.patch(leaderboard._id, { items });
        }
      }
      if (leaderboards.length === HARD_DELETE_LEADERBOARD_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "leaderboards");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "canonical");
      return;
    }
    case "canonical": {
      const canonicalRefs = await ctx.db
        .query("skills")
        .withIndex("by_canonical", (q) => q.eq("canonicalSkillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const related of canonicalRefs) {
        await ctx.db.patch(related._id, {
          canonicalSkillId: undefined,
          updatedAt: now,
        });
      }
      if (canonicalRefs.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "canonical");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "forks");
      return;
    }
    case "forks": {
      const forkRefs = await ctx.db
        .query("skills")
        .withIndex("by_fork_of", (q) => q.eq("forkOf.skillId", skill._id))
        .take(HARD_DELETE_BATCH_SIZE);
      for (const related of forkRefs) {
        await ctx.db.patch(related._id, {
          forkOf: undefined,
          updatedAt: now,
        });
      }
      if (forkRefs.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, "forks");
        return;
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, "finalize");
      return;
    }
    case "finalize": {
      await reserveSlugForHardDeleteFinalize(ctx, {
        slug: skill.slug,
        originalOwnerUserId: skill.ownerUserId,
        deletedAt: now,
        expiresAt: now + SLUG_RESERVATION_MS,
      });

      await ctx.db.delete(skill._id);
      await ctx.db.insert("auditLogs", {
        actorUserId,
        action: "skill.hard_delete",
        targetType: "skill",
        targetId: skill._id,
        metadata: { slug: skill.slug },
        createdAt: now,
      });
      return;
    }
  }
}

type PublicSkillEntry = {
  skill: NonNullable<ReturnType<typeof toPublicSkill>>;
  latestVersion: PublicSkillListVersion | null;
  ownerHandle: string | null;
  owner: PublicPublisher | null;
};

type StaffSkillAuditLogEntry = Doc<"auditLogs"> & {
  actor: ReturnType<typeof toPublicUser> | null;
};

type PublicSkillListVersion = Pick<
  Doc<"skillVersions">,
  "_id" | "_creationTime" | "version" | "createdAt" | "changelog" | "changelogSource"
> & {
  parsed?: PublicSkillVersionParsed;
};

type PublicSkillVersionParsed = {
  license?: typeof PLATFORM_SKILL_LICENSE;
  clawdis?: {
    os?: string[];
    nix?: {
      plugin?: boolean;
      systems?: string[];
    };
  };
};

type PublicSkillVersion = {
  _id: Id<"skillVersions">;
  _creationTime?: number;
  skillId?: Id<"skills">;
  version: string;
  fingerprint?: string;
  changelog?: string;
  changelogSource?: Doc<"skillVersions">["changelogSource"];
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    contentType?: string;
  }>;
  parsed?: PublicSkillVersionParsed;
  createdBy?: Id<"users">;
  createdAt?: number;
  softDeletedAt?: number;
  sha256hash?: string;
  vtAnalysis?: Doc<"skillVersions">["vtAnalysis"];
  llmAnalysis?: Doc<"skillVersions">["llmAnalysis"];
  staticScan?: {
    status: NonNullable<Doc<"skillVersions">["staticScan"]>["status"];
    reasonCodes: NonNullable<Doc<"skillVersions">["staticScan"]>["reasonCodes"];
    findings: Array<{
      code: string;
      severity: "info" | "warn" | "critical";
      file: string;
      line: number;
      message: string;
      evidence: string;
    }>;
    summary: NonNullable<Doc<"skillVersions">["staticScan"]>["summary"];
    engineVersion: NonNullable<Doc<"skillVersions">["staticScan"]>["engineVersion"];
    checkedAt: NonNullable<Doc<"skillVersions">["staticScan"]>["checkedAt"];
  };
};

type ManagementSkillEntry = {
  skill: Doc<"skills">;
  latestVersion: Doc<"skillVersions"> | null;
  owner: Doc<"users"> | null;
};

type BadgeKind = Doc<"skillBadges">["kind"];

async function buildPublicSkillEntries(
  ctx: QueryCtx,
  skills: HydratableSkill[],
  opts?: {
    includeVersion?: boolean;
    preResolvedOwners?: Map<
      Id<"skills">,
      { ownerHandle: string | null; owner: PublicPublisher | null }
    >;
  },
) {
  const includeVersion = opts?.includeVersion ?? true;
  const ownerInfoCache = new Map<
    string,
    Promise<{
      ownerHandle: string | null;
      owner: PublicPublisher | null;
    }>
  >();

  const getOwnerInfo = (
    skillId: Id<"skills">,
    ownerUserId: Id<"users">,
    ownerPublisherId?: Id<"publishers"> | null,
  ) => {
    // Use pre-resolved owner from digest when available to avoid adding the
    // users table to the reactive read set (which causes thundering-herd
    // invalidation on every user-doc write).
    const preResolved = opts?.preResolvedOwners?.get(skillId);
    if (preResolved?.owner) return Promise.resolve(preResolved);

    const cacheKey = String(ownerPublisherId ?? ownerUserId);
    const cached = ownerInfoCache.get(cacheKey);
    if (cached) return cached;
    const ownerPromise = getOwnerPublisher(ctx, {
      ownerPublisherId,
      ownerUserId,
    }).then((ownerDoc) => {
      const publicOwner = toPublicPublisher(ownerDoc);
      if (!publicOwner) {
        return { ownerHandle: null, owner: null };
      }
      return {
        ownerHandle: publicOwner.handle ?? String(publicOwner._id),
        owner: publicOwner,
      };
    });
    ownerInfoCache.set(cacheKey, ownerPromise);
    return ownerPromise;
  };

  const entries = await Promise.all(
    skills.map(async (skill) => {
      // Use denormalized summary when available to avoid reading the full ~6KB version doc.
      const summary = skill.latestVersionSummary;
      const hasSummary = includeVersion && summary;
      const [latestVersionDoc, ownerInfo] = await Promise.all([
        includeVersion && !hasSummary && skill.latestVersionId
          ? ctx.db.get(skill.latestVersionId)
          : null,
        getOwnerInfo(skill._id, skill.ownerUserId, skill.ownerPublisherId),
      ]);
      const publicSkill = toPublicSkill(skill);
      if (!publicSkill || !ownerInfo.owner) return null;
      const latestVersion = hasSummary
        ? toPublicSkillListVersionFromSummary(summary!, skill.latestVersionId)
        : toPublicSkillListVersion(latestVersionDoc);
      return {
        skill: publicSkill,
        latestVersion,
        ownerHandle: ownerInfo.ownerHandle,
        owner: ownerInfo.owner,
      };
    }),
  );

  return entries.filter(Boolean) as PublicSkillEntry[];
}

async function filterSkillsByActiveOwner(ctx: Pick<QueryCtx, "db">, skills: Doc<"skills">[]) {
  const ownerCache = new Map<Id<"users">, Promise<Doc<"users"> | null>>();

  const getOwner = (ownerUserId: Id<"users">) => {
    const cached = ownerCache.get(ownerUserId);
    if (cached) return cached;
    const ownerPromise = ctx.db.get(ownerUserId);
    ownerCache.set(ownerUserId, ownerPromise);
    return ownerPromise;
  };

  const filtered = await Promise.all(
    skills.map(async (skill) => {
      const owner = await getOwner(skill.ownerUserId);
      if (!owner || owner.deletedAt || owner.deactivatedAt) return null;
      return skill;
    }),
  );

  return filtered.filter((skill): skill is Doc<"skills"> => skill !== null);
}

function toPublicSkillListVersion(
  version: Doc<"skillVersions"> | null,
): PublicSkillListVersion | null {
  if (!version) return null;
  return {
    _id: version._id,
    _creationTime: version._creationTime,
    version: version.version,
    createdAt: version.createdAt,
    changelog: version.changelog,
    changelogSource: version.changelogSource,
    parsed:
      version.parsed?.clawdis || version.parsed?.license
        ? {
            ...(version.parsed?.license ? { license: version.parsed.license } : {}),
            ...(version.parsed?.clawdis ? { clawdis: version.parsed.clawdis } : {}),
          }
        : undefined,
  };
}

function toPublicSkillVersion(
  version: Doc<"skillVersions"> | null | undefined,
): PublicSkillVersion | null {
  if (!version) return null;
  return {
    _id: version._id,
    _creationTime: version._creationTime,
    skillId: version.skillId,
    version: version.version,
    fingerprint: version.fingerprint,
    changelog: version.changelog,
    changelogSource: version.changelogSource,
    files: (version.files ?? []).map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      contentType: file.contentType,
    })),
    parsed: version.parsed
      ? {
          license: version.parsed.license,
          clawdis: version.parsed.clawdis,
        }
      : undefined,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    softDeletedAt: version.softDeletedAt,
    sha256hash: version.sha256hash,
    vtAnalysis: version.vtAnalysis,
    llmAnalysis: version.llmAnalysis,
    staticScan: version.staticScan
      ? {
          status: version.staticScan.status,
          reasonCodes: version.staticScan.reasonCodes,
          findings: (version.staticScan.findings ?? []).map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            file: finding.file,
            line: finding.line,
            message: finding.message,
            evidence: "",
          })),
          summary: version.staticScan.summary,
          engineVersion: version.staticScan.engineVersion,
          checkedAt: version.staticScan.checkedAt,
        }
      : undefined,
  };
}

function toPublicSkillListVersionFromSummary(
  summary: NonNullable<Doc<"skills">["latestVersionSummary"]>,
  latestVersionId: Id<"skillVersions"> | undefined,
): PublicSkillListVersion | null {
  if (!latestVersionId) return null;
  return {
    _id: latestVersionId,
    // Approximates _creationTime; both are set to `now` in the same transaction
    _creationTime: summary.createdAt,
    version: summary.version,
    createdAt: summary.createdAt,
    changelog: summary.changelog,
    changelogSource: summary.changelogSource,
    parsed: summary.clawdis ? { clawdis: summary.clawdis } : undefined,
  };
}

async function buildManagementSkillEntries(ctx: QueryCtx, skills: Doc<"skills">[]) {
  const ownerCache = new Map<Id<"users">, Promise<Doc<"users"> | null>>();
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  );

  const getOwner = (ownerUserId: Id<"users">) => {
    const cached = ownerCache.get(ownerUserId);
    if (cached) return cached;
    const ownerPromise = ctx.db.get(ownerUserId);
    ownerCache.set(ownerUserId, ownerPromise);
    return ownerPromise;
  };

  return Promise.all(
    skills.map(async (skill) => {
      const [latestVersion, owner] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        getOwner(skill.ownerUserId),
      ]);
      const badges = badgeMapBySkillId.get(skill._id) ?? {};
      return { skill: { ...skill, badges }, latestVersion, owner };
    }),
  ) satisfies Promise<ManagementSkillEntry[]>;
}

async function attachBadgesToSkills(ctx: QueryCtx, skills: Doc<"skills">[]) {
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  );
  return skills.map((skill) => ({
    ...skill,
    badges: badgeMapBySkillId.get(skill._id) ?? {},
  }));
}

async function loadHighlightedSkills(ctx: QueryCtx, limit: number) {
  const entries = await ctx.db
    .query("skillBadges")
    .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
    .order("desc")
    .take(MAX_LIST_TAKE);

  const skills: Doc<"skills">[] = [];
  for (const badge of entries) {
    const skill = await ctx.db.get(badge.skillId);
    if (!skill || skill.softDeletedAt) continue;
    skills.push(skill);
    if (skills.length >= limit) break;
  }

  return skills;
}

async function upsertSkillBadge(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  kind: BadgeKind,
  userId: Id<"users">,
  at: number,
) {
  const existing = await ctx.db
    .query("skillBadges")
    .withIndex("by_skill_kind", (q) => q.eq("skillId", skillId).eq("kind", kind))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { byUserId: userId, at });
  } else {
    await ctx.db.insert("skillBadges", {
      skillId,
      kind,
      byUserId: userId,
      at,
    });
  }
  // Keep denormalized badges field on skill doc in sync
  const skill = await ctx.db.get(skillId);
  if (skill) {
    await ctx.db.patch(skillId, {
      badges: {
        ...(skill.badges as Record<string, unknown> | undefined),
        [kind]: { byUserId: userId, at },
      },
    });
  }
}

async function removeSkillBadge(ctx: MutationCtx, skillId: Id<"skills">, kind: BadgeKind) {
  const existing = await ctx.db
    .query("skillBadges")
    .withIndex("by_skill_kind", (q) => q.eq("skillId", skillId).eq("kind", kind))
    .unique();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
  // Keep denormalized badges field on skill doc in sync
  const skill = await ctx.db.get(skillId);
  if (skill) {
    const { [kind]: _, ...remainingBadges } = (skill.badges ?? {}) as Record<string, unknown>;
    await ctx.db.patch(skillId, { badges: remainingBadges });
  }
}

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveSkillBySlugOrAlias(ctx, args.slug);
    const skill = resolved.skill;
    if (!skill) return null;

    const userId = await getAuthUserId(ctx);
    const ownerPublisher = await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    });
    const membership =
      userId && skill.ownerPublisherId
        ? await ctx.db
            .query("publisherMembers")
            .withIndex("by_publisher_user", (q) =>
              q.eq("publisherId", skill.ownerPublisherId!).eq("userId", userId),
            )
            .unique()
        : null;
    const isOwner = Boolean(userId && (userId === skill.ownerUserId || membership));

    const latestVersion = toPublicSkillVersion(
      skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null,
    );
    const owner = toPublicPublisher(ownerPublisher);
    if (!owner) return null;
    const badges = await getSkillBadgeMap(ctx, skill._id);

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null;
    const forkOfOwner = forkOfSkill
      ? await getOwnerPublisher(ctx, {
          ownerPublisherId: forkOfSkill.ownerPublisherId,
          ownerUserId: forkOfSkill.ownerUserId,
        })
      : null;

    const canonicalSkill = skill.canonicalSkillId ? await ctx.db.get(skill.canonicalSkillId) : null;
    const canonicalOwner = canonicalSkill
      ? await getOwnerPublisher(ctx, {
          ownerPublisherId: canonicalSkill.ownerPublisherId,
          ownerUserId: canonicalSkill.ownerUserId,
        })
      : null;

    const publicSkill = toPublicSkill({ ...skill, badges });

    // Determine moderation state
    const overrideActive = Boolean(skill.manualOverride);
    const isPendingScan =
      skill.moderationStatus === "hidden" && skill.moderationReason === "pending.scan";
    const isMalwareBlocked = skill.moderationFlags?.includes("blocked.malware") ?? false;
    const isSuspicious = skill.moderationFlags?.includes("flagged.suspicious") ?? false;
    const isHiddenByMod =
      skill.moderationStatus === "hidden" && !isPendingScan && !isMalwareBlocked;
    const isRemoved = skill.moderationStatus === "removed";

    // Non-owners can see malware-blocked skills (transparency), but not other hidden states
    // Owners can see all their moderated skills
    if (!publicSkill && !isOwner && !isMalwareBlocked) return null;

    // For owners viewing their moderated skill, construct the response manually
    const skillData = publicSkill ?? {
      _id: skill._id,
      _creationTime: skill._creationTime,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary,
      ownerUserId: skill.ownerUserId,
      canonicalSkillId: skill.canonicalSkillId,
      forkOf: skill.forkOf,
      latestVersionId: skill.latestVersionId,
      tags: skill.tags,
      badges,
      stats: skill.stats,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    };

    // Moderation info - visible to owners for all states, or anyone for flagged skills (transparency)
    const showModerationInfo = isOwner || isMalwareBlocked || isSuspicious || overrideActive;
    const publicModerationSummary =
      !isOwner && overrideActive && !isMalwareBlocked && !isSuspicious
        ? "Security findings were reviewed by staff and cleared for public use."
        : skill.moderationSummary;
    const moderationInfo = showModerationInfo
      ? {
          isPendingScan,
          isMalwareBlocked,
          isSuspicious,
          isHiddenByMod,
          isRemoved,
          overrideActive,
          verdict: skill.moderationVerdict,
          reasonCodes: skill.moderationReasonCodes,
          summary: publicModerationSummary,
          engineVersion: skill.moderationEngineVersion,
          updatedAt: skill.moderationEvaluatedAt,
          reason: isOwner ? skill.moderationReason : undefined,
        }
      : null;

    return {
      requestedSlug: resolved.requestedSlug,
      resolvedSlug: resolved.resolvedSlug,
      skill: skillData,
      latestVersion,
      owner,
      pendingReview: isOwner && isPendingScan,
      moderationInfo,
      forkOf: forkOfSkill
        ? {
            kind: skill.forkOf?.kind ?? "fork",
            version: skill.forkOf?.version ?? null,
            skill: {
              slug: forkOfSkill.slug,
              displayName: forkOfSkill.displayName,
            },
            owner: {
              handle: forkOfOwner?.handle ?? null,
              userId: forkOfOwner?.linkedUserId ?? null,
            },
          }
        : null,
      canonical: canonicalSkill
        ? {
            skill: {
              slug: canonicalSkill.slug,
              displayName: canonicalSkill.displayName,
            },
            owner: {
              handle: canonicalOwner?.handle ?? null,
              userId: canonicalOwner?.linkedUserId ?? null,
            },
          }
        : null,
    };
  },
});

export const checkSlugAvailability = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const slug = normalizeSkillSlugKey(args.slug);
    if (!slug) {
      return {
        available: false,
        reason: "taken" as const,
        message: "Slug is required.",
        url: null,
      };
    }

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!skill) {
      const alias = await getSkillSlugAliasBySlug(ctx, slug);
      if (alias) {
        const aliasedSkill = await ctx.db.get(alias.skillId);
        const owner = aliasedSkill ? await ctx.db.get(aliasedSkill.ownerUserId) : null;
        return {
          available: false,
          reason: "taken" as const,
          message: aliasedSkill
            ? buildAliasTakenErrorMessage(aliasedSkill, owner)
            : "Slug redirects to an existing skill. Choose a different slug.",
          url: aliasedSkill ? buildConflictingSkillUrl(aliasedSkill, owner) : null,
        };
      }

      const reservation = await getLatestActiveReservedSlug(ctx, slug);
      if (
        reservation &&
        reservation.expiresAt > Date.now() &&
        reservation.originalOwnerUserId !== userId
      ) {
        return {
          available: false,
          reason: "reserved" as const,
          message: formatReservedSlugCooldownMessage(slug, reservation.expiresAt),
          url: null,
        };
      }
      return {
        available: true,
        reason: "available" as const,
        message: null,
        url: null,
      };
    }

    if (userId && skill.ownerUserId === userId) {
      return {
        available: true,
        reason: "available" as const,
        message: null,
        url: null,
      };
    }

    const owner = await ctx.db.get(skill.ownerUserId);
    const url = buildConflictingSkillUrl(skill, owner);
    const slugTakenMessage = buildSlugTakenErrorMessage(skill, owner);

    // Check GitHub identity FIRST so healing works even when the previous
    // owner record is deleted/deactivated (e.g. duplicate Convex Auth user
    // where the old record was later banned).
    if (userId) {
      const [ownerProviderAccountId, callerProviderAccountId] = await Promise.all([
        getGitHubProviderAccountId(ctx, skill.ownerUserId),
        getGitHubProviderAccountId(ctx, userId),
      ]);

      if (
        canHealSkillOwnershipByGitHubProviderAccountId(
          ownerProviderAccountId,
          callerProviderAccountId,
        )
      ) {
        return {
          available: true,
          reason: "available" as const,
          message: null,
          url: null,
        };
      }
    }

    if (!owner || owner.deletedAt || owner.deactivatedAt) {
      return {
        available: false,
        reason: "taken" as const,
        message:
          "This slug is locked to a deleted or banned account. " +
          "If you believe you are the rightful owner, please contact security@openclaw.ai to reclaim it.",
        url: null,
      };
    }

    return {
      available: false,
      reason: "taken" as const,
      message: slugTakenMessage,
      url,
    };
  },
});

export const getBySlugForStaff = query({
  args: {
    slug: v.string(),
    auditLogLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const auditLogLimit = clampStaffAuditLogLimit(args.auditLogLimit);

    const resolved = await resolveSkillBySlugOrAlias(ctx, args.slug);
    const skill = resolved.skill;
    if (!skill) return null;

    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
    const owner = toPublicUser(await ctx.db.get(skill.ownerUserId));
    const badges = await getSkillBadgeMap(ctx, skill._id);
    const rawAuditLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_target_createdAt", (q) =>
        q.eq("targetType", "skill").eq("targetId", skill._id),
      )
      .order("desc")
      .take(auditLogLimit);

    const staffUserIds = new Set<Id<"users">>();
    if (skill.manualOverride?.reviewerUserId) {
      staffUserIds.add(skill.manualOverride.reviewerUserId);
    }
    for (const log of rawAuditLogs) {
      staffUserIds.add(log.actorUserId);
    }
    const publicUsers = await loadPublicUsersById(ctx, [...staffUserIds]);
    const overrideReviewer = skill.manualOverride?.reviewerUserId
      ? (publicUsers.get(skill.manualOverride.reviewerUserId) ?? null)
      : null;
    const auditLogs: StaffSkillAuditLogEntry[] = rawAuditLogs.map((log) => ({
      ...log,
      actor: publicUsers.get(log.actorUserId) ?? null,
    }));

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null;
    const forkOfOwner = forkOfSkill ? await ctx.db.get(forkOfSkill.ownerUserId) : null;

    const canonicalSkill = skill.canonicalSkillId ? await ctx.db.get(skill.canonicalSkillId) : null;
    const canonicalOwner = canonicalSkill ? await ctx.db.get(canonicalSkill.ownerUserId) : null;

    return {
      requestedSlug: resolved.requestedSlug,
      resolvedSlug: resolved.resolvedSlug,
      skill: { ...skill, badges },
      latestVersion,
      owner,
      overrideReviewer,
      auditLogs,
      forkOf: forkOfSkill
        ? {
            kind: skill.forkOf?.kind ?? "fork",
            version: skill.forkOf?.version ?? null,
            skill: {
              slug: forkOfSkill.slug,
              displayName: forkOfSkill.displayName,
            },
            owner: {
              handle: forkOfOwner?.handle ?? forkOfOwner?.name ?? null,
              userId: forkOfOwner?._id ?? null,
            },
          }
        : null,
      canonical: canonicalSkill
        ? {
            skill: {
              slug: canonicalSkill.slug,
              displayName: canonicalSkill.displayName,
            },
            owner: {
              handle: canonicalOwner?.handle ?? canonicalOwner?.name ?? null,
              userId: canonicalOwner?._id ?? null,
            },
          }
        : null,
    };
  },
});

function clampStaffAuditLogLimit(limit?: number) {
  if (!Number.isFinite(limit)) return DEFAULT_STAFF_AUDIT_LOG_LIMIT;
  return Math.min(
    Math.max(Math.trunc(limit ?? DEFAULT_STAFF_AUDIT_LOG_LIMIT), 1),
    MAX_STAFF_AUDIT_LOG_LIMIT,
  );
}

async function loadPublicUsersById(ctx: Pick<QueryCtx, "db">, userIds: Id<"users">[]) {
  const uniqueUserIds = [...new Set(userIds)];
  const entries = await Promise.all(
    uniqueUserIds.map(async (userId) => [userId, toPublicUser(await ctx.db.get(userId))] as const),
  );
  return new Map(entries);
}

export const getReservedSlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return getLatestActiveReservedSlug(ctx, args.slug);
  },
});

export const getSkillBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveSkillBySlugOrAlias(ctx, args.slug);
    return resolved.skill;
  },
});

export const getOwnerSkillActivityInternal = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 60, 1, 500);
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .take(limit);

    return skills.map((skill) => ({
      slug: skill.slug,
      summary: skill.summary,
      createdAt: skill.createdAt,
      latestVersionId: skill.latestVersionId,
    }));
  },
});

export const clearOwnerSuspiciousFlagsInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.ownerUserId);
    if (!owner || owner.deletedAt || owner.deactivatedAt) throw new Error("Owner not found");
    if (!isPrivilegedOwnerForSuspiciousBypass(owner)) {
      return {
        inspected: 0,
        updated: 0,
        skipped: "owner_not_privileged" as const,
      };
    }

    const limit = clampInt(args.limit ?? 500, 1, 5000);
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .take(limit);

    let updated = 0;
    const now = Date.now();

    for (const skill of skills) {
      const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? [];
      const hasSuspiciousFlag = existingFlags.includes("flagged.suspicious");
      const hasSuspiciousReason =
        skill.moderationReason?.startsWith("scanner.") &&
        skill.moderationReason.endsWith(".suspicious");
      if (!hasSuspiciousFlag && !hasSuspiciousReason) continue;

      const patch: Partial<Doc<"skills">> = { updatedAt: now };
      patch.moderationFlags = stripSuspiciousFlag(existingFlags);
      if (hasSuspiciousReason) {
        patch.moderationReason = normalizeScannerSuspiciousReason(skill.moderationReason);
      }
      if (
        (skill.moderationStatus ?? "active") === "hidden" &&
        hasSuspiciousReason &&
        !skill.softDeletedAt
      ) {
        patch.moderationStatus = "active";
      }
      patch.isSuspicious = computeIsSuspicious({
        moderationFlags: patch.moderationFlags,
        moderationReason: (patch.moderationReason ?? skill.moderationReason) as string | undefined,
      });

      const nextSkill = { ...skill, ...patch };
      await ctx.db.patch(skill._id, patch);
      await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
      updated += 1;
    }

    return { inspected: skills.length, updated };
  },
});

/**
 * Get quick stats without loading versions (fast).
 */
export const getQuickStatsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allSkills = await ctx.db.query("skills").collect();
    const active = allSkills.filter((s) => !s.softDeletedAt);

    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const skill of active) {
      const status = skill.moderationStatus ?? "active";
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      if (skill.moderationReason) {
        byReason[skill.moderationReason] = (byReason[skill.moderationReason] ?? 0) + 1;
      }
    }

    return { total: active.length, byStatus, byReason };
  },
});

/**
 * Get aggregate stats for all skills (for social posts, dashboards, etc.)
 */
/**
 * Paginated helper: counts stats for a batch of skills.
 * Returns partial counts + cursor for the next page.
 */
export const getStatsPageInternal = internalQuery({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const PAGE_SIZE = 500;
    const cursor = args.cursor ?? 0;

    const page = await ctx.db
      .query("skills")
      .filter((q) => q.gt(q.field("_creationTime"), cursor))
      .order("asc")
      .take(PAGE_SIZE);

    let total = 0;
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    const byFlags: Record<string, number> = {};
    const vtStats = {
      clean: 0,
      suspicious: 0,
      malicious: 0,
      pending: 0,
      noAnalysis: 0,
    };

    for (const skill of page) {
      if (skill.softDeletedAt) continue;
      total++;

      const status = skill.moderationStatus ?? "active";
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      if (skill.moderationReason) {
        byReason[skill.moderationReason] = (byReason[skill.moderationReason] ?? 0) + 1;
      }

      for (const flag of skill.moderationFlags ?? []) {
        byFlags[flag] = (byFlags[flag] ?? 0) + 1;
      }

      if (status === "active") {
        const reason = skill.moderationReason;
        if (!reason) {
          vtStats.noAnalysis++;
        } else if (reason === "scanner.vt.clean") {
          vtStats.clean++;
        } else if (reason === "scanner.vt.malicious") {
          vtStats.malicious++;
        } else if (reason === "scanner.vt.suspicious") {
          vtStats.suspicious++;
        } else if (reason === "scanner.vt.pending" || reason === "pending.scan") {
          vtStats.pending++;
        } else if (reason.startsWith("scanner.vt-rescan.")) {
          const suffix = reason.slice("scanner.vt-rescan.".length);
          if (suffix === "clean") vtStats.clean++;
          else if (suffix === "malicious") vtStats.malicious++;
          else if (suffix === "suspicious") vtStats.suspicious++;
          else vtStats.pending++;
        } else {
          vtStats.noAnalysis++;
        }
      }
    }

    const nextCursor = page.length > 0 ? page[page.length - 1]._creationTime : null;
    const done = page.length < PAGE_SIZE;

    return { total, byStatus, byReason, byFlags, vtStats, nextCursor, done };
  },
});

export const getHighlightedCountInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const badges = await ctx.db
      .query("skillBadges")
      .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
      .collect();
    return badges.length;
  },
});

/**
 * Get aggregate stats for all skills (for social posts, dashboards, etc.)
 * Uses an action to call paginated queries, avoiding the 16MB byte limit.
 */
type StatsResult = {
  total: number;
  highlighted: number;
  byStatus: Record<string, number>;
  byReason: Record<string, number>;
  byFlags: Record<string, number>;
  vtStats: {
    clean: number;
    suspicious: number;
    malicious: number;
    pending: number;
    noAnalysis: number;
  };
};

export const getStatsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<StatsResult> => {
    let total = 0;
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    const byFlags: Record<string, number> = {};
    const vtStats = {
      clean: 0,
      suspicious: 0,
      malicious: 0,
      pending: 0,
      noAnalysis: 0,
    };

    let cursor: number | undefined;
    let done = false;

    while (!done) {
      const page: {
        total: number;
        byStatus: Record<string, number>;
        byReason: Record<string, number>;
        byFlags: Record<string, number>;
        vtStats: {
          clean: number;
          suspicious: number;
          malicious: number;
          pending: number;
          noAnalysis: number;
        };
        nextCursor: number | null;
        done: boolean;
      } = await ctx.runQuery(internal.skills.getStatsPageInternal, { cursor });

      total += page.total;
      for (const [k, cnt] of Object.entries(page.byStatus)) {
        byStatus[k] = (byStatus[k] ?? 0) + cnt;
      }
      for (const [k, cnt] of Object.entries(page.byReason)) {
        byReason[k] = (byReason[k] ?? 0) + cnt;
      }
      for (const [k, cnt] of Object.entries(page.byFlags)) {
        byFlags[k] = (byFlags[k] ?? 0) + cnt;
      }
      vtStats.clean += page.vtStats.clean;
      vtStats.suspicious += page.vtStats.suspicious;
      vtStats.malicious += page.vtStats.malicious;
      vtStats.pending += page.vtStats.pending;
      vtStats.noAnalysis += page.vtStats.noAnalysis;

      done = page.done;
      if (page.nextCursor !== null) {
        cursor = page.nextCursor;
      }
    }

    const highlighted: number = await ctx.runQuery(internal.skills.getHighlightedCountInternal, {});

    return { total, highlighted, byStatus, byReason, byFlags, vtStats };
  },
});

export const list = query({
  args: {
    batch: v.optional(v.string()),
    ownerUserId: v.optional(v.id("users")),
    ownerPublisherId: v.optional(v.id("publishers")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_BULK_LIMIT);
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE);
    if (args.batch) {
      if (args.batch === "highlighted") {
        const skills = await loadHighlightedSkills(ctx, limit);
        const withBadges = await attachBadgesToSkills(ctx, skills);
        const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
        return visibleSkills
          .map((skill) => toPublicSkill(skill))
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
      }
      const entries = await ctx.db
        .query("skills")
        .withIndex("by_batch", (q) => q.eq("batch", args.batch))
        .order("desc")
        .take(takeLimit);
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit);
      const withBadges = await attachBadgesToSkills(ctx, filtered);
      const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
      return visibleSkills
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    }
    const ownerPublisherId = args.ownerPublisherId;
    if (ownerPublisherId) {
      const userId = await getAuthUserId(ctx);
      const ownerPublisher = await ctx.db.get(ownerPublisherId);
      const membership =
        userId &&
        (await ctx.db
          .query("publisherMembers")
          .withIndex("by_publisher_user", (q) =>
            q.eq("publisherId", ownerPublisherId).eq("userId", userId),
          )
          .unique());
      const isOwnDashboard = Boolean(
        membership || (userId && ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId === userId),
      );
      const scopedEntries = await ctx.db
        .query("skills")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", ownerPublisherId))
        .order("desc")
        .take(takeLimit);
      const legacyEntries =
        ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId
          ? await ctx.db
              .query("skills")
              .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerPublisher.linkedUserId!))
              .order("desc")
              .take(takeLimit)
          : [];
      const combined = [...scopedEntries, ...legacyEntries].filter(
        (skill, index, all) =>
          !skill.softDeletedAt &&
          (!skill.ownerPublisherId || skill.ownerPublisherId === ownerPublisherId) &&
          all.findIndex((candidate) => candidate._id === skill._id) === index,
      );
      const filtered = combined.slice(0, limit);
      const withBadges = await attachBadgesToSkills(ctx, filtered);

      if (isOwnDashboard) {
        return withBadges
          .map((skill) => {
            const publicSkill = toPublicSkill(skill);
            if (publicSkill) return publicSkill;
            const isPending =
              skill.moderationStatus === "hidden" && skill.moderationReason === "pending.scan";
            if (isPending) {
              const { badges } = skill;
              return {
                _id: skill._id,
                _creationTime: skill._creationTime,
                slug: skill.slug,
                displayName: skill.displayName,
                summary: skill.summary,
                ownerUserId: skill.ownerUserId,
                ownerPublisherId: skill.ownerPublisherId,
                canonicalSkillId: skill.canonicalSkillId,
                forkOf: skill.forkOf,
                latestVersionId: skill.latestVersionId,
                tags: skill.tags,
                badges,
                stats: skill.stats,
                createdAt: skill.createdAt,
                updatedAt: skill.updatedAt,
                pendingReview: true as const,
              };
            }
            return null;
          })
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
      }

      const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
      return visibleSkills
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    }
    const ownerUserId = args.ownerUserId;
    if (ownerUserId) {
      const userId = await getAuthUserId(ctx);
      const isOwnDashboard = Boolean(userId && userId === ownerUserId);
      const entries = await ctx.db
        .query("skills")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
        .order("desc")
        .take(takeLimit);
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit);
      const withBadges = await attachBadgesToSkills(ctx, filtered);

      if (isOwnDashboard) {
        // For owner's own dashboard, include pending skills
        return withBadges
          .map((skill) => {
            const publicSkill = toPublicSkill(skill);
            if (publicSkill) return publicSkill;
            // Include pending skills for owner
            const isPending =
              skill.moderationStatus === "hidden" && skill.moderationReason === "pending.scan";
            if (isPending) {
              // Use computed badges from attachBadgesToSkills, not stored skill.badges
              const { badges } = skill;
              return {
                _id: skill._id,
                _creationTime: skill._creationTime,
                slug: skill.slug,
                displayName: skill.displayName,
                summary: skill.summary,
                ownerUserId: skill.ownerUserId,
                canonicalSkillId: skill.canonicalSkillId,
                forkOf: skill.forkOf,
                latestVersionId: skill.latestVersionId,
                tags: skill.tags,
                badges,
                stats: skill.stats,
                createdAt: skill.createdAt,
                updatedAt: skill.updatedAt,
                pendingReview: true as const,
              };
            }
            return null;
          })
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
      }

      const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
      return visibleSkills
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    }
    const entries = await ctx.db.query("skills").order("desc").take(takeLimit);
    const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit);
    const withBadges = await attachBadgesToSkills(ctx, filtered);
    const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
    return visibleSkills
      .map((skill) => toPublicSkill(skill))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  },
});

export const listWithLatest = query({
  args: {
    batch: v.optional(v.string()),
    ownerUserId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_BULK_LIMIT);
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE);
    let entries: Doc<"skills">[] = [];
    if (args.batch) {
      if (args.batch === "highlighted") {
        entries = await loadHighlightedSkills(ctx, limit);
      } else {
        entries = await ctx.db
          .query("skills")
          .withIndex("by_batch", (q) => q.eq("batch", args.batch))
          .order("desc")
          .take(takeLimit);
      }
    } else if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId;
      entries = await ctx.db
        .query("skills")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
        .order("desc")
        .take(takeLimit);
    } else {
      entries = await ctx.db.query("skills").order("desc").take(takeLimit);
    }

    const filtered = await filterSkillsByActiveOwner(
      ctx,
      entries.filter((skill) => !skill.softDeletedAt),
    );
    const withBadges = await attachBadgesToSkills(ctx, filtered);
    const ordered =
      args.batch === "highlighted"
        ? [...withBadges].sort(
            (a, b) => (b.badges?.highlighted?.at ?? 0) - (a.badges?.highlighted?.at ?? 0),
          )
        : withBadges;
    const limited = ordered.slice(0, limit);
    const items = await Promise.all(
      limited.map(async (skill) => ({
        skill: toPublicSkill(skill),
        latestVersion: toPublicSkillVersion(
          skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null,
        ),
      })),
    );
    return items.filter(
      (
        item,
      ): item is {
        skill: NonNullable<ReturnType<typeof toPublicSkill>>;
        latestVersion: Doc<"skillVersions"> | null;
      } => Boolean(item.skill),
    );
  },
});

export const listHighlightedPublic = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 12, 1, MAX_PUBLIC_LIST_LIMIT);
    const skills = await loadHighlightedSkills(ctx, limit);
    return buildPublicSkillEntries(ctx, skills);
  },
});

export const listForManagement = query({
  args: {
    limit: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const limit = clampInt(args.limit ?? 50, 1, MAX_LIST_BULK_LIMIT);
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE);
    const entries = await ctx.db.query("skills").order("desc").take(takeLimit);
    const filtered = (
      args.includeDeleted ? entries : entries.filter((skill) => !skill.softDeletedAt)
    ).slice(0, limit);
    return buildManagementSkillEntries(ctx, filtered);
  },
});

export const listRecentVersions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_BULK_LIMIT);
    const versions = await ctx.db
      .query("skillVersions")
      .order("desc")
      .take(limit * 2);
    const entries = versions.filter((version) => !version.softDeletedAt).slice(0, limit);

    const results: Array<{
      version: Doc<"skillVersions">;
      skill: Doc<"skills"> | null;
      owner: Doc<"users"> | null;
    }> = [];

    for (const version of entries) {
      const skill = await ctx.db.get(version.skillId);
      if (!skill) {
        results.push({ version, skill: null, owner: null });
        continue;
      }
      const owner = await ctx.db.get(skill.ownerUserId);
      results.push({ version, skill, owner });
    }

    return results;
  },
});

export const listReportedSkills = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const limit = clampInt(args.limit ?? 25, 1, MAX_LIST_BULK_LIMIT);
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE);
    const entries = await ctx.db.query("skills").order("desc").take(takeLimit);
    const reported = entries
      .filter((skill) => (skill.reportCount ?? 0) > 0)
      .sort((a, b) => (b.lastReportedAt ?? 0) - (a.lastReportedAt ?? 0))
      .slice(0, limit);
    const managementEntries = await buildManagementSkillEntries(ctx, reported);
    const reporterCache = new Map<Id<"users">, Promise<Doc<"users"> | null>>();

    const getReporter = (reporterId: Id<"users">) => {
      const cached = reporterCache.get(reporterId);
      if (cached) return cached;
      const reporterPromise = ctx.db.get(reporterId);
      reporterCache.set(reporterId, reporterPromise);
      return reporterPromise;
    };

    return Promise.all(
      managementEntries.map(async (entry) => {
        const reports = await ctx.db
          .query("skillReports")
          .withIndex("by_skill_createdAt", (q) => q.eq("skillId", entry.skill._id))
          .order("desc")
          .take(MAX_REPORT_REASON_SAMPLE);
        const reportEntries = await Promise.all(
          reports.map(async (report) => {
            const reporter = await getReporter(report.userId);
            const reason = report.reason?.trim();
            return {
              reason: reason && reason.length > 0 ? reason : "No reason provided.",
              createdAt: report.createdAt,
              reporterHandle: reporter?.handle ?? reporter?.name ?? null,
              reporterId: report.userId,
            };
          }),
        );
        return { ...entry, reports: reportEntries };
      }),
    );
  },
});

export const listDuplicateCandidates = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_BULK_LIMIT);
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE);
    const skills = await ctx.db.query("skills").order("desc").take(takeLimit);
    const entries = skills.filter((skill) => !skill.softDeletedAt).slice(0, limit);

    const results: Array<{
      skill: Doc<"skills">;
      latestVersion: Doc<"skillVersions"> | null;
      fingerprint: string | null;
      matches: Array<{ skill: Doc<"skills">; owner: Doc<"users"> | null }>;
      owner: Doc<"users"> | null;
    }> = [];

    for (const skill of entries) {
      const latestVersion = isSkillVersionId(skill.latestVersionId)
        ? await ctx.db.get(skill.latestVersionId)
        : null;
      const fingerprint = latestVersion?.fingerprint ?? null;
      if (!fingerprint) continue;

      let matchedFingerprints: Doc<"skillVersionFingerprints">[] = [];
      try {
        matchedFingerprints = await ctx.db
          .query("skillVersionFingerprints")
          .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
          .take(10);
      } catch (error) {
        console.error("listDuplicateCandidates: fingerprint lookup failed", error);
        continue;
      }

      const matchEntries: Array<{
        skill: Doc<"skills">;
        owner: Doc<"users"> | null;
      }> = [];
      for (const match of matchedFingerprints) {
        if (match.skillId === skill._id) continue;
        const matchSkill = await ctx.db.get(match.skillId);
        if (!matchSkill || matchSkill.softDeletedAt) continue;
        const matchOwner = await ctx.db.get(matchSkill.ownerUserId);
        matchEntries.push({ skill: matchSkill, owner: matchOwner });
      }

      if (matchEntries.length === 0) continue;

      const owner = isUserId(skill.ownerUserId) ? await ctx.db.get(skill.ownerUserId) : null;
      results.push({
        skill,
        latestVersion,
        fingerprint,
        matches: matchEntries,
        owner,
      });
    }

    return results;
  },
});

async function countActiveReportsForUser(ctx: MutationCtx, userId: Id<"users">) {
  const reports = await ctx.db
    .query("skillReports")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  let count = 0;
  for (const report of reports) {
    const skill = await ctx.db.get(report.skillId);
    if (!skill) continue;
    if (skill.softDeletedAt) continue;
    if (skill.moderationStatus === "removed") continue;
    const owner = await ctx.db.get(skill.ownerUserId);
    if (!owner || owner.deletedAt || owner.deactivatedAt) continue;
    count += 1;
    if (count >= MAX_ACTIVE_REPORTS_PER_USER) break;
  }

  return count;
}

export const report = mutation({
  args: { skillId: v.id("skills"), reason: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.softDeletedAt || skill.moderationStatus === "removed") {
      throw new Error("Skill not found");
    }
    const reason = args.reason.trim();
    if (!reason) {
      throw new Error("Report reason required.");
    }

    const existing = await ctx.db
      .query("skillReports")
      .withIndex("by_skill_user", (q) => q.eq("skillId", args.skillId).eq("userId", userId))
      .unique();
    if (existing) return { ok: true as const, reported: false, alreadyReported: true };

    const activeReports = await countActiveReportsForUser(ctx, userId);
    if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
      throw new Error("Report limit reached. Please wait for moderation before reporting more.");
    }

    const now = Date.now();
    await ctx.db.insert("skillReports", {
      skillId: args.skillId,
      userId,
      reason: reason.slice(0, MAX_REPORT_REASON_LENGTH),
      createdAt: now,
    });

    const nextReportCount = (skill.reportCount ?? 0) + 1;
    const shouldAutoHide = nextReportCount > AUTO_HIDE_REPORT_THRESHOLD && !skill.softDeletedAt;
    const updates: Partial<Doc<"skills">> = {
      reportCount: nextReportCount,
      lastReportedAt: now,
      updatedAt: now,
    };
    if (shouldAutoHide) {
      Object.assign(updates, {
        softDeletedAt: now,
        moderationStatus: "hidden",
        moderationReason: "auto.reports",
        moderationNotes: "Auto-hidden after 4 unique reports.",
        isSuspicious: computeIsSuspicious({
          moderationFlags: skill.moderationFlags,
          moderationReason: "auto.reports",
        }),
        hiddenAt: now,
        lastReviewedAt: now,
      });
    }

    const nextSkill = { ...skill, ...updates };
    await ctx.db.patch(skill._id, updates);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    if (shouldAutoHide) {
      await setSkillEmbeddingsSoftDeleted(ctx, skill._id, true, now);

      await ctx.db.insert("auditLogs", {
        actorUserId: userId,
        action: "skill.auto_hide",
        targetType: "skill",
        targetId: skill._id,
        metadata: { reportCount: nextReportCount },
        createdAt: now,
      });
    }

    return { ok: true as const, reported: true, alreadyReported: false };
  },
});

/** @deprecated V1 is gutted — returns empty results with no DB reads. */
export const listPublicPage = query({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    nonSuspiciousOnly: v.optional(v.boolean()),
    sort: v.optional(
      v.union(
        v.literal("updated"),
        v.literal("downloads"),
        v.literal("stars"),
        v.literal("installsCurrent"),
        v.literal("installsAllTime"),
        v.literal("trending"),
      ),
    ),
  },
  handler: async () => {
    return { items: [], nextCursor: null };
  },
});

/** @deprecated V2 is gutted — returns empty results with no DB reads. */
export const listPublicPageV2 = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.optional(
      v.union(
        v.literal("newest"),
        v.literal("updated"),
        v.literal("downloads"),
        v.literal("installs"),
        v.literal("stars"),
        v.literal("name"),
      ),
    ),
    dir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async () => {
    return { page: [], isDone: true, continueCursor: "" };
  },
});

/** V3 — kept intact for remaining subscribers during migration to V4. */
export const listPublicPageV3 = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.optional(
      v.union(
        v.literal("newest"),
        v.literal("updated"),
        v.literal("downloads"),
        v.literal("installs"),
        v.literal("stars"),
        v.literal("name"),
      ),
    ),
    dir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "newest";
    const dir = args.dir ?? (sort === "name" ? "asc" : "desc");
    const { numItems, cursor: initialCursor } = normalizePublicListPagination(args.paginationOpts);

    const runPaginateBase = (cursor: string | null) =>
      ctx.db
        .query("skillSearchDigest")
        .withIndex(SORT_INDEXES[sort], (q) => q.eq("softDeletedAt", undefined))
        .order(dir)
        .paginate({ cursor, numItems });

    const runPaginateCompound = (cursor: string | null) =>
      ctx.db
        .query("skillSearchDigest")
        .withIndex(NONSUSPICIOUS_SORT_INDEXES[sort], (q) =>
          q.eq("softDeletedAt", undefined).eq("isSuspicious", false),
        )
        .order(dir)
        .paginate({ cursor, numItems });

    let result = await paginateWithStaleCursorRecovery(
      args.nonSuspiciousOnly ? runPaginateCompound : runPaginateBase,
      initialCursor,
    );

    if (
      args.nonSuspiciousOnly &&
      initialCursor === null &&
      result.page.length === 0 &&
      !result.isDone
    ) {
      result = await paginateWithStaleCursorRecovery(runPaginateBase, null);
    }

    const filteredPage = filterPublicSkillPage(result.page.map(digestToHydratableSkill), args);

    const filteredMap = new Map(filteredPage.map((s) => [s._id, s]));
    const items: PublicSkillEntry[] = [];
    for (const digest of result.page) {
      const hydratable = filteredMap.get(digest.skillId);
      if (!hydratable) continue;
      const publicSkill = toPublicSkill(hydratable);
      if (!publicSkill) continue;
      const ownerInfo = digestToOwnerInfo(digest);
      if (!ownerInfo?.owner) continue;
      const latestVersion = digest.latestVersionSummary
        ? toPublicSkillListVersionFromSummary(digest.latestVersionSummary, digest.latestVersionId)
        : null;
      items.push({
        skill: publicSkill,
        latestVersion,
        ownerHandle: ownerInfo.ownerHandle,
        owner: ownerInfo.owner,
      });
    }
    return { ...result, page: items };
  },
});

function encodeIndexKey(key: IndexKey): string {
  return JSON.stringify(key.map((val) => (val === undefined ? { __undef: 1 } : val)));
}
function decodeIndexKey(cursor: string): IndexKey | null {
  try {
    const arr = JSON.parse(cursor) as unknown[];
    if (!Array.isArray(arr)) return null;
    return arr.map((val) =>
      val !== null && typeof val === "object" && "__undef" in (val as Record<string, unknown>)
        ? undefined
        : (val as Value),
    );
  } catch {
    return null;
  }
}

/**
 * V4 of listPublicPage using convex-helpers `getPage()` for deterministic,
 * cacheable cursors. Two users requesting the same page produce identical
 * query args, enabling shared query caching across all users.
 */
export const listPublicPageV4 = query({
  args: {
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
    sort: v.optional(
      v.union(
        v.literal("newest"),
        v.literal("updated"),
        v.literal("downloads"),
        v.literal("installs"),
        v.literal("stars"),
        v.literal("name"),
      ),
    ),
    dir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "newest";
    const dir = args.dir ?? (sort === "name" ? "asc" : "desc");
    const numItems = clampInt(args.numItems ?? 25, 1, MAX_PUBLIC_LIST_LIMIT);

    // Highlighted skills use a completely different path: query skillBadges
    // by kind to find highlighted skill IDs, then look up their digests.
    // This avoids scanning thousands of rows in the sort index.
    if (args.highlightedOnly) {
      return fetchHighlightedPage(ctx, {
        sort,
        dir,
        numItems,
        nonSuspiciousOnly: args.nonSuspiciousOnly ?? false,
      });
    }

    const indexName = args.nonSuspiciousOnly
      ? NONSUSPICIOUS_SORT_INDEXES[sort]
      : SORT_INDEXES[sort];

    // Equality prefix constrains getPage to active (non-deleted) rows.
    // Without this, getPage walks the entire index including soft-deleted items.
    const eqPrefix: IndexKey = args.nonSuspiciousOnly ? [undefined, false] : [undefined];

    const decodedCursor = args.cursor ? decodeIndexKey(args.cursor) : null;
    const isFirstPage = !decodedCursor;
    const startIndexKey: IndexKey = decodedCursor ?? eqPrefix;

    const result = await getPage(ctx, {
      table: "skillSearchDigest",
      startIndexKey,
      startInclusive: isFirstPage,
      endIndexKey: eqPrefix,
      endInclusive: true,
      absoluteMaxRows: numItems,
      order: dir,
      index: indexName,
      schema,
    });

    // Build PublicSkillEntry[] from digests
    const items: PublicSkillEntry[] = [];
    for (const digest of result.page) {
      const hydratable = digestToHydratableSkill(digest);
      const publicSkill = toPublicSkill(hydratable);
      if (!publicSkill) continue;
      const ownerInfo = digestToOwnerInfo(digest);
      if (!ownerInfo?.owner) continue;
      const latestVersion = digest.latestVersionSummary
        ? toPublicSkillListVersionFromSummary(digest.latestVersionSummary, digest.latestVersionId)
        : null;
      items.push({
        skill: publicSkill,
        latestVersion,
        ownerHandle: ownerInfo.ownerHandle,
        owner: ownerInfo.owner,
      });
    }

    let nextCursor: string | null = null;
    if (result.hasMore && result.indexKeys.length > 0) {
      nextCursor = encodeIndexKey(result.indexKeys[result.indexKeys.length - 1]);
    }

    return { page: items, hasMore: result.hasMore, nextCursor };
  },
});

type PublicSkillCatalogItem = {
  name: string;
  displayName: string;
  family: "skill";
  runtimeId: null;
  channel: "official" | "community";
  isOfficial: boolean;
  summary: string | null;
  ownerHandle: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion: string | null;
  capabilityTags: string[];
  executesCode: false;
  verificationTier: null;
};

type SkillCatalogCursorState = {
  cursor: string | null;
  offset: number;
  pageSize: number | null;
  done: boolean;
};

function encodeSkillCatalogCursor(state: SkillCatalogCursorState) {
  if (state.done && state.offset === 0) return "";
  return `${SKILL_CATALOG_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

function decodeSkillCatalogCursor(raw: string | null | undefined): SkillCatalogCursorState {
  if (!raw) return { cursor: null, offset: 0, pageSize: null, done: false };
  if (!raw.startsWith(SKILL_CATALOG_CURSOR_PREFIX)) {
    return { cursor: raw, offset: 0, pageSize: null, done: false };
  }
  try {
    const parsed = JSON.parse(raw.slice(SKILL_CATALOG_CURSOR_PREFIX.length)) as Partial<SkillCatalogCursorState>;
    return {
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      offset: typeof parsed.offset === "number" && parsed.offset > 0 ? parsed.offset : 0,
      pageSize:
        typeof parsed.pageSize === "number" && parsed.pageSize > 0 ? parsed.pageSize : null,
      done: parsed.done === true,
    };
  } catch {
    return { cursor: null, offset: 0, pageSize: null, done: false };
  }
}

function isSkillCatalogOfficial(digest: Doc<"skillSearchDigest">) {
  return Boolean(digest.badges?.official);
}

function getSkillCatalogChannel(digest: Doc<"skillSearchDigest">): "official" | "community" {
  return isSkillCatalogOfficial(digest) ? "official" : "community";
}

function isVisibleSkillCatalogDigest(digest: Doc<"skillSearchDigest">) {
  const publicSkill = toPublicSkill(digestToHydratableSkill(digest));
  if (!publicSkill) return false;
  const ownerInfo = digestToOwnerInfo(digest);
  return Boolean(ownerInfo?.owner);
}

function skillCatalogMatchesFilters(
  digest: Doc<"skillSearchDigest">,
  args: {
    channel?: "official" | "community" | "private";
    isOfficial?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
  },
) {
  if (!isVisibleSkillCatalogDigest(digest)) return false;
  if (args.channel === "private") return false;
  if (args.capabilityTag) return false;
  if (args.executesCode === true) return false;
  const isOfficial = isSkillCatalogOfficial(digest);
  const channel = getSkillCatalogChannel(digest);
  if (typeof args.isOfficial === "boolean" && isOfficial !== args.isOfficial) return false;
  if (args.channel && channel !== args.channel) return false;
  return true;
}

function toPublicSkillCatalogItem(digest: Doc<"skillSearchDigest">): PublicSkillCatalogItem {
  const ownerInfo = digestToOwnerInfo(digest);
  return {
    name: digest.slug,
    displayName: digest.displayName,
    family: "skill",
    runtimeId: null,
    channel: getSkillCatalogChannel(digest),
    isOfficial: isSkillCatalogOfficial(digest),
    summary: digest.summary ?? null,
    ownerHandle: ownerInfo?.ownerHandle ?? null,
    createdAt: digest.createdAt,
    updatedAt: digest.updatedAt,
    latestVersion: digest.latestVersionSummary?.version ?? null,
    capabilityTags: [],
    executesCode: false,
    verificationTier: null,
  };
}

function scoreSkillCatalogResult(digest: Doc<"skillSearchDigest">, queryText: string) {
  const needle = queryText.toLowerCase();
  const slug = digest.slug.toLowerCase();
  const display = digest.displayName.toLowerCase();
  const summary = (digest.summary ?? "").toLowerCase();
  let score = 0;
  if (slug === needle) score += 200;
  else if (slug.startsWith(needle)) score += 120;
  else if (slug.includes(needle)) score += 80;

  if (display === needle) score += 150;
  else if (display.startsWith(needle)) score += 70;
  else if (display.includes(needle)) score += 40;

  if (summary.includes(needle)) score += 20;
  if (isSkillCatalogOfficial(digest)) score += 5;
  return score;
}

export const listPackageCatalogPage = query({
  args: {
    channel: v.optional(v.union(v.literal("official"), v.literal("community"), v.literal("private"))),
    isOfficial: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.channel === "private" || args.executesCode === true || args.capabilityTag) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const targetCount = args.paginationOpts.numItems;
    const collected: PublicSkillCatalogItem[] = [];
    const decodedCursor = decodeSkillCatalogCursor(args.paginationOpts.cursor);
    let cursor = decodedCursor.cursor;
    let offset = decodedCursor.offset;
    let pageSize = decodedCursor.pageSize;
    let done = decodedCursor.done;
    let loops = 0;
    let remainingScanBudget = MAX_SKILL_CATALOG_SCAN_DOCUMENTS;

    while (
      (offset > 0 || !done) &&
      collected.length < targetCount &&
      loops < MAX_SKILL_CATALOG_SCAN_PAGES &&
      remainingScanBudget > 0
    ) {
      loops += 1;
      const effectivePageSize = Math.min(
        remainingScanBudget,
        offset > 0 && pageSize ? Math.max(pageSize, offset + 1) : Math.max(targetCount * 3, targetCount),
      );
      if (effectivePageSize <= 0) break;
      remainingScanBudget -= effectivePageSize;
      const pageCursor = cursor;
      const page = await paginator(ctx.db, schema)
        .query("skillSearchDigest")
        .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
        .order("desc")
        .paginate({ cursor: pageCursor, numItems: effectivePageSize });

      for (let index = offset; index < page.page.length; index += 1) {
        const digest = page.page[index];
        if (!skillCatalogMatchesFilters(digest, args)) continue;
        collected.push(toPublicSkillCatalogItem(digest));
        if (collected.length >= targetCount) {
          const nextOffset = index + 1;
          if (nextOffset < page.page.length) {
            cursor = pageCursor;
            offset = nextOffset;
            pageSize = effectivePageSize;
            done = page.isDone;
          } else {
            cursor = page.continueCursor;
            offset = 0;
            pageSize = effectivePageSize;
            done = page.isDone;
          }
          return {
            page: collected,
            isDone: done && offset === 0,
            continueCursor: encodeSkillCatalogCursor({ cursor, offset, pageSize, done }),
          };
        }
      }

      done = page.isDone;
      cursor = page.continueCursor;
      offset = 0;
      pageSize = effectivePageSize;
    }

    return {
      page: collected,
      isDone: done,
      continueCursor: encodeSkillCatalogCursor({ cursor, offset, pageSize, done }),
    };
  },
});

export const searchPackageCatalogPublic = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    channel: v.optional(v.union(v.literal("official"), v.literal("community"), v.literal("private"))),
    isOfficial: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const queryText = args.query.trim().toLowerCase();
    if (!queryText) return [];
    if (args.channel === "private" || args.executesCode === true || args.capabilityTag) return [];

    const targetCount = Math.max(1, Math.min(args.limit ?? 20, 100));
    const matches: Array<{ score: number; package: PublicSkillCatalogItem }> = [];
    const seen = new Set<string>();

    const exactSkill = await resolveSkillBySlugOrAlias(ctx, queryText);
    if (exactSkill.skill) {
      const exactDigest = await ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", exactSkill.skill!._id))
        .unique();
      if (exactDigest && skillCatalogMatchesFilters(exactDigest, args)) {
        const exactScore = scoreSkillCatalogResult(exactDigest, queryText);
        if (exactScore > 0) {
          seen.add(exactDigest.skillId);
          matches.push({
            score: exactScore,
            package: toPublicSkillCatalogItem(exactDigest),
          });
        }
      }
    }

    if (matches.length < targetCount) {
      const pageSize = Math.min(MAX_SKILL_CATALOG_SEARCH_PAGE_SIZE, Math.max(targetCount * 5, 50));
      const page = await ctx.db
        .query("skillSearchDigest")
        .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
        .order("desc")
        .paginate({ cursor: null, numItems: pageSize });

      for (const digest of page.page) {
        if (!skillCatalogMatchesFilters(digest, args)) continue;
        const score = scoreSkillCatalogResult(digest, queryText);
        if (score <= 0 || seen.has(digest.skillId)) continue;
        seen.add(digest.skillId);
        matches.push({
          score,
          package: toPublicSkillCatalogItem(digest),
        });
      }
    }

    return matches
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
          b.package.updatedAt - a.package.updatedAt,
      )
      .slice(0, targetCount);
  },
});

type SortKey = keyof typeof SORT_INDEXES;

/** Fetch highlighted skills via the skillBadges index, then sort in JS. */
async function fetchHighlightedPage(
  ctx: QueryCtx,
  opts: {
    sort: SortKey;
    dir: "asc" | "desc";
    numItems: number;
    nonSuspiciousOnly: boolean;
  },
) {
  // Get all highlighted skill IDs from the skillBadges index (very few rows)
  const badges = await ctx.db
    .query("skillBadges")
    .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
    .order("desc")
    .take(MAX_LIST_TAKE);

  // Look up digests for each highlighted skill
  const digests: Doc<"skillSearchDigest">[] = [];
  for (const badge of badges) {
    const digest = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_skill", (q) => q.eq("skillId", badge.skillId))
      .unique();
    if (!digest || digest.softDeletedAt) continue;
    if (opts.nonSuspiciousOnly && digest.isSuspicious) continue;
    digests.push(digest);
  }

  // Sort in JS by the requested sort field
  const multiplier = opts.dir === "asc" ? 1 : -1;
  digests.sort((a, b) => {
    switch (opts.sort) {
      case "downloads":
        return ((a.statsDownloads ?? 0) - (b.statsDownloads ?? 0)) * multiplier;
      case "stars":
        return ((a.statsStars ?? 0) - (b.statsStars ?? 0)) * multiplier;
      case "installs":
        return ((a.statsInstallsAllTime ?? 0) - (b.statsInstallsAllTime ?? 0)) * multiplier;
      case "updated":
        return (a.updatedAt - b.updatedAt) * multiplier;
      case "name":
        return a.displayName.localeCompare(b.displayName) * multiplier;
      case "newest":
      default:
        return (a.createdAt - b.createdAt) * multiplier;
    }
  });

  const trimmed = digests.slice(0, opts.numItems);

  // Build PublicSkillEntry[]
  const items: PublicSkillEntry[] = [];
  for (const digest of trimmed) {
    const hydratable = digestToHydratableSkill(digest);
    const publicSkill = toPublicSkill(hydratable);
    if (!publicSkill) continue;
    const ownerInfo = digestToOwnerInfo(digest);
    if (!ownerInfo?.owner) continue;
    const latestVersion = digest.latestVersionSummary
      ? toPublicSkillListVersionFromSummary(digest.latestVersionSummary, digest.latestVersionId)
      : null;
    items.push({
      skill: publicSkill,
      latestVersion,
      ownerHandle: ownerInfo.ownerHandle,
      owner: ownerInfo.owner,
    });
  }

  // Highlighted skills are few enough to return in one page — no cursor needed
  return { page: items, hasMore: false, nextCursor: null };
}

function filterPublicSkillPage(
  page: HydratableSkill[],
  args: { highlightedOnly?: boolean; nonSuspiciousOnly?: boolean },
) {
  if (!args.nonSuspiciousOnly && !args.highlightedOnly) {
    return page;
  }
  return page.filter((skill) => {
    if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) return false;
    if (args.highlightedOnly && !isSkillHighlighted(skill)) return false;
    return true;
  });
}

function normalizePublicListPagination(paginationOpts: {
  cursor?: string | null;
  numItems: number;
}) {
  return {
    cursor: paginationOpts.cursor ?? null,
    numItems: clampInt(paginationOpts.numItems, 1, MAX_PUBLIC_LIST_LIMIT),
  };
}

async function paginateWithStaleCursorRecovery<T>(
  runPaginate: (
    cursor: string | null,
  ) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>,
  initialCursor: string | null,
) {
  try {
    return await runPaginate(initialCursor);
  } catch (error) {
    if (initialCursor && isStaleCursorError(error)) {
      // Return a synthetic empty page so usePaginatedQuery restarts cleanly.
      return { page: [] as T[], isDone: true, continueCursor: "" };
    }
    throw error;
  }
}

function isStaleCursorError(error: unknown) {
  const patterns = ["Failed to parse cursor", "cursor is from a different query"];
  const msg =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : "";
  return patterns.some((p) => msg.includes(p));
}

export const countPublicSkills = query({
  args: {},
  handler: async (ctx) => {
    const statsCount = await readGlobalPublicSkillsCount(ctx);
    if (typeof statsCount === "number") return statsCount;
    // Fallback for uninitialized/missing globalStats storage.
    return countPublicSkillsForGlobalStats(ctx);
  },
});

export const listVersions = query({
  args: { skillId: v.id("skills"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const authUserId = await getAuthUserId(ctx);
    const actor = authUserId ? await ctx.db.get(authUserId) : null;
    const isStaff = actor?.role === "admin" || actor?.role === "moderator";
    const versions = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill", (q) => q.eq("skillId", args.skillId))
      .order("desc")
      .take(limit);
    return versions
      .filter((version) => isStaff || !version.softDeletedAt)
      .map((version) => toPublicSkillVersion(version)!);
  },
});

export const listVersionsPage = query({
  args: {
    skillId: v.id("skills"),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_LIMIT);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill", (q) => q.eq("skillId", args.skillId))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    const items = page
      .filter((version) => !version.softDeletedAt)
      .map((version) => toPublicSkillVersion(version)!);
    return { items, nextCursor: isDone ? null : continueCursor };
  },
});

export const getVersionById = query({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args) => toPublicSkillVersion(await ctx.db.get(args.versionId)),
});

export const getVersionsByIdsInternal = internalQuery({
  args: { versionIds: v.array(v.id("skillVersions")) },
  handler: async (ctx, args) => {
    const versions = await Promise.all(args.versionIds.map((id) => ctx.db.get(id)));
    return versions.filter(
      (versionDoc): versionDoc is NonNullable<typeof versionDoc> => versionDoc !== null,
    );
  },
});

export const getVersionByIdInternal = internalQuery({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
});

export const getVersionBySkillAndVersionInternal = internalQuery({
  args: { skillId: v.id("skills"), version: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("skillVersions")
      .withIndex("by_skill_version", (q) =>
        q.eq("skillId", args.skillId).eq("version", args.version),
      )
      .unique();
  },
});

export const getSkillByIdInternal = internalQuery({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => ctx.db.get(args.skillId),
});

export const getPendingScanSkillsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    skipRecentMinutes: v.optional(v.number()),
    exhaustive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const exhaustive = args.exhaustive ?? false;
    const limit = exhaustive
      ? Math.max(1, Math.floor(args.limit ?? 10000))
      : clampInt(args.limit ?? 10, 1, 100);
    const skipRecentMinutes = exhaustive ? 0 : (args.skipRecentMinutes ?? 60);
    const skipThreshold = Date.now() - skipRecentMinutes * 60 * 1000;

    let allSkills: Doc<"skills">[] = [];
    if (exhaustive) {
      // Used by manual/backfill tooling where fairness matters more than query cost.
      allSkills = await ctx.db
        .query("skills")
        .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
        .collect();
    } else {
      // Mix "most recently updated" with "oldest created" slices so older pending
      // items don't starve behind high-churn records.
      const poolSize = Math.min(Math.max(limit * 20, 200), 1000);
      const [recentSkills, oldestSkills] = await Promise.all([
        ctx.db
          .query("skills")
          .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
          .order("desc")
          .take(poolSize),
        ctx.db
          .query("skills")
          .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
          .order("asc")
          .take(poolSize),
      ]);

      const deduped = new Map<Id<"skills">, Doc<"skills">>();
      for (const skill of [...recentSkills, ...oldestSkills]) {
        deduped.set(skill._id, skill);
      }
      allSkills = [...deduped.values()];
    }

    const candidates = allSkills.filter((skill) => {
      const reason = skill.moderationReason;
      if (skill.moderationStatus === "hidden" && reason === "pending.scan") return true;
      if (skill.moderationStatus === "hidden" && reason === "quality.low") return true;
      if (skill.moderationStatus === "active" && reason === "pending.scan") return true;
      if (skill.moderationStatus === "active" && reason === "scanner.vt.pending") return true;
      return (
        reason === "scanner.llm.clean" ||
        reason === "scanner.llm.suspicious" ||
        reason === "scanner.llm.malicious"
      );
    });

    // Filter out recently checked skills unless caller explicitly disables recency filtering.
    const skills =
      skipRecentMinutes <= 0
        ? candidates
        : candidates.filter((s) => !s.scanLastCheckedAt || s.scanLastCheckedAt < skipThreshold);

    // Shuffle and take the requested limit (Fisher-Yates)
    for (let i = skills.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [skills[i], skills[j]] = [skills[j], skills[i]];
    }
    const selected = skills.slice(0, limit);

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions"> | null;
      sha256hash: string | null;
      checkCount: number;
    }> = [];

    const FINAL_VT_STATUSES = new Set(["clean", "malicious", "suspicious"]);
    for (const skill of selected) {
      const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
      if (!version?.sha256hash) continue;
      const vtStatus = version.vtAnalysis?.status?.trim().toLowerCase();
      // Keep retrying unresolved VT results (pending/stale/error), but skip finalized outcomes.
      if (vtStatus && FINAL_VT_STATUSES.has(vtStatus)) continue;
      results.push({
        skillId: skill._id,
        versionId: version?._id ?? null,
        sha256hash: version?.sha256hash ?? null,
        checkCount: skill.scanCheckCount ?? 0,
      });
    }

    return results;
  },
});

/**
 * Health check query to monitor scan queue status
 */
export const getScanQueueHealthInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("skills")
      .withIndex("by_moderation", (q) =>
        q.eq("moderationStatus", "hidden").eq("moderationReason", "pending.scan"),
      )
      .collect();

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    let staleCount = 0;
    let veryStaleCount = 0;
    let oldestTimestamp = now;

    for (const skill of pending) {
      const createdAt = skill.createdAt ?? skill._creationTime;
      if (createdAt < oldestTimestamp) oldestTimestamp = createdAt;
      if (createdAt < oneHourAgo) staleCount++;
      if (createdAt < oneDayAgo) veryStaleCount++;
    }

    return {
      queueSize: pending.length,
      staleCount, // pending > 1 hour
      veryStaleCount, // pending > 24 hours
      oldestAgeMinutes: Math.round((now - oldestTimestamp) / 60000),
      healthy: pending.length < 50 && veryStaleCount === 0,
    };
  },
});

/**
 * Get active skills that have a version hash but no vtAnalysis cached.
 * Used to backfill VT results for skills approved before VT integration.
 */
export const getActiveSkillsMissingVTCacheInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const poolSize = limit * 2; // Take more to account for some having vtAnalysis

    // Skills waiting for VT + LLM-evaluated skills that still need VT cache
    const vtPending = await ctx.db
      .query("skills")
      .withIndex("by_moderation", (q) =>
        q.eq("moderationStatus", "active").eq("moderationReason", "scanner.vt.pending"),
      )
      .take(poolSize);
    const [llmClean, llmSuspicious, llmMalicious] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_moderation", (q) =>
          q.eq("moderationStatus", "active").eq("moderationReason", "scanner.llm.clean"),
        )
        .take(poolSize),
      ctx.db
        .query("skills")
        .withIndex("by_moderation", (q) =>
          q.eq("moderationStatus", "active").eq("moderationReason", "scanner.llm.suspicious"),
        )
        .take(poolSize),
      ctx.db
        .query("skills")
        .withIndex("by_moderation", (q) =>
          q.eq("moderationStatus", "active").eq("moderationReason", "scanner.llm.malicious"),
        )
        .take(poolSize),
    ]);
    const llmEvaluated = [...llmClean, ...llmSuspicious, ...llmMalicious];

    // Dedup across pools
    const seen = new Set<string>();
    const allSkills: typeof vtPending = [];
    for (const skill of [...vtPending, ...llmEvaluated]) {
      if (!seen.has(skill._id)) {
        seen.add(skill._id);
        allSkills.push(skill);
      }
    }

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      sha256hash: string;
      slug: string;
    }> = [];

    for (const skill of allSkills) {
      if (results.length >= limit) break;
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) continue;
      // Include if version has hash but no vtAnalysis
      if (version.sha256hash && !version.vtAnalysis) {
        results.push({
          skillId: skill._id,
          versionId: version._id,
          sha256hash: version.sha256hash,
          slug: skill.slug,
        });
      }
    }

    return results;
  },
});

/**
 * Get all active skills with VT analysis for daily re-scan.
 */
export const getAllActiveSkillsForRescanInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const activeSkills = await ctx.db
      .query("skills")
      .withIndex("by_moderation", (q) => q.eq("moderationStatus", "active"))
      .collect();

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      sha256hash: string;
      slug: string;
    }> = [];

    for (const skill of activeSkills) {
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version?.sha256hash) continue;

      results.push({
        skillId: skill._id,
        versionId: version._id,
        sha256hash: version.sha256hash,
        slug: skill.slug,
      });
    }

    return results;
  },
});

/**
 * Cursor-based batch query for daily rescan. Uses _creationTime for stable pagination.
 * Returns a batch of active skills with sha256hash, plus a cursor and done flag.
 */
export const getActiveSkillBatchForRescanInternal = internalQuery({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    const cursor = args.cursor ?? 0;

    // Use built-in by_creation_time index for stable cursor-based pagination
    const candidates = await ctx.db
      .query("skills")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", cursor))
      .order("asc")
      .take(batchSize * 3); // Over-fetch to account for filtering

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      sha256hash: string;
      slug: string;
      wasFlagged: boolean;
    }> = [];
    let nextCursor = cursor;

    for (const skill of candidates) {
      nextCursor = skill._creationTime;
      if (results.length >= batchSize) break;

      // Filter out soft-deleted and non-active
      if (skill.softDeletedAt) continue;
      if ((skill.moderationStatus ?? "active") !== "active") continue;
      if (!skill.latestVersionId) continue;

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version?.sha256hash) continue;

      results.push({
        skillId: skill._id,
        versionId: version._id,
        sha256hash: version.sha256hash,
        slug: skill.slug,
        wasFlagged:
          (skill.moderationFlags as string[] | undefined)?.includes("flagged.suspicious") ?? false,
      });
    }

    // Done when we got fewer candidates than our over-fetch limit
    const done = candidates.length < batchSize * 3;

    return { skills: results, nextCursor, done };
  },
});

/**
 * Get active skills whose latest version has no llmAnalysis.
 * Used for LLM evaluation backfill. Same cursor pattern as getActiveSkillBatchForRescanInternal.
 */
export const getActiveSkillBatchForLlmBackfillInternal = internalQuery({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 10;
    const cursor = args.cursor ?? 0;

    // Use built-in by_creation_time index for stable cursor-based pagination
    const candidates = await ctx.db
      .query("skills")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", cursor))
      .order("asc")
      .take(batchSize * 3);

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
    }> = [];
    let nextCursor = cursor;

    for (const skill of candidates) {
      nextCursor = skill._creationTime;
      if (results.length >= batchSize) break;

      if (skill.softDeletedAt) continue;
      if ((skill.moderationStatus ?? "active") !== "active") continue;
      if (!skill.latestVersionId) continue;

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) continue;
      // Re-evaluate all skills (full file content reading upgrade)
      // if (version.llmAnalysis && version.llmAnalysis.status !== 'error') continue

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
      });
    }

    const done = candidates.length < batchSize * 3;

    return { skills: results, nextCursor, done };
  },
});

/**
 * Get skills with stale moderationReason that have vtAnalysis cached.
 * Used to sync moderationReason with cached VT results.
 */
export const getSkillsWithStaleModerationReasonInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Over-fetch from each bucket since some will be filtered out (no vtAnalysis).
    const poolSize = limit * 2;
    // Find skills with pending-like moderationReason using indexed queries
    const [vtPending, pendingScan] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_moderation", (q) =>
          q.eq("moderationStatus", "active").eq("moderationReason", "scanner.vt.pending"),
        )
        .take(poolSize),
      ctx.db
        .query("skills")
        .withIndex("by_moderation", (q) =>
          q.eq("moderationStatus", "active").eq("moderationReason", "pending.scan"),
        )
        .take(poolSize),
    ]);

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
      currentReason: string;
      vtStatus: string | null;
      sha256hash: string | null;
    }> = [];

    for (const skill of [...vtPending, ...pendingScan]) {
      if (results.length >= limit) break;
      if (!skill.moderationReason) continue;
      if (!skill.latestVersionId) continue;

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version?.vtAnalysis?.status) continue; // Skip if no vtAnalysis

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
        currentReason: skill.moderationReason,
        vtStatus: version.vtAnalysis.status,
        sha256hash: version.sha256hash ?? null,
      });
    }

    return results;
  },
});

/**
 * Get skills with scanner.vt.pending that need reanalysis.
 * Returns skills regardless of whether they have vtAnalysis cached.
 */
export const getPendingVTSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const skills = await ctx.db
      .query("skills")
      .withIndex("by_moderation", (q) =>
        q.eq("moderationStatus", "active").eq("moderationReason", "scanner.vt.pending"),
      )
      .take(limit);

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
      sha256hash: string;
    }> = [];

    for (const skill of skills) {
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version?.sha256hash) continue;

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
        sha256hash: version.sha256hash,
      });
    }

    return results;
  },
});

/**
 * Emergency escalation by skillId for legacy rows without sha256hash.
 * Rebuilds the full moderation snapshot so legacy rows stay in sync with structured fields.
 */
export const escalateSkillByIdInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    moderationReason: v.string(),
    moderationFlags: v.array(v.string()),
    moderationStatus: v.union(v.literal("active"), v.literal("hidden")),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return;

    const now = Date.now();
    const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
    const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
    const normalizedReason = args.moderationReason.trim().toLowerCase();
    const reasonMatch = /^scanner\.(vt|llm)\.([^.]+)$/.exec(normalizedReason);
    const vtStatus = reasonMatch?.[1] === "vt" ? reasonMatch[2] : version?.vtAnalysis?.status;
    const llmStatus = reasonMatch?.[1] === "llm" ? reasonMatch[2] : version?.llmAnalysis?.status;
    const snapshot = buildModerationSnapshot({
      staticScan: version?.staticScan,
      vtStatus,
      llmStatus,
      sourceVersionId: version?._id,
    });
    const sourceReasonCodes = snapshot.reasonCodes;
    const sourceReason = resolveScannerModerationReason({
      vtStatus,
      llmStatus,
      verdict: snapshot.verdict,
    });
    const bypassSuspicious =
      snapshot.verdict === "suspicious" && isPrivilegedOwnerForSuspiciousBypass(owner);
    const moderationReasonCodes = bypassSuspicious
      ? sourceReasonCodes.filter((code) => !code.startsWith("suspicious."))
      : sourceReasonCodes;
    const moderationVerdict = verdictFromCodes(moderationReasonCodes);
    const moderationFlags = legacyFlagsFromVerdict(moderationVerdict);
    const moderationReason = bypassSuspicious
      ? normalizeScannerSuspiciousReason(sourceReason)
      : sourceReason;
    const moderationStatus = moderationVerdict === "malicious" ? "hidden" : args.moderationStatus;

    const basePatch: SkillModerationPatch = {
      moderationReason,
      moderationFlags,
      moderationStatus,
      moderationVerdict,
      moderationReasonCodes: moderationReasonCodes.length ? moderationReasonCodes : undefined,
      moderationEvidence: snapshot.evidence.length ? snapshot.evidence : undefined,
      moderationSummary: summarizeReasonCodes(moderationReasonCodes),
      moderationEngineVersion: snapshot.engineVersion,
      moderationEvaluatedAt: snapshot.evaluatedAt,
      moderationSourceVersionId: version?._id,
      moderationNotes: undefined,
      isSuspicious: computeIsSuspicious({
        moderationFlags,
        moderationReason,
      }),
      hiddenAt: moderationStatus === "hidden" ? now : undefined,
      hiddenBy: undefined,
      lastReviewedAt: moderationStatus === "hidden" ? now : undefined,
      updatedAt: now,
    };
    const patch = applySkillManualOverrideToSkillPatch({
      skill,
      basePatch,
      now,
    });
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
  },
});

/**
 * Update a skill's moderationReason.
 */
export const updateSkillModerationReasonInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    moderationReason: v.string(),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    await ctx.db.patch(args.skillId, {
      moderationReason: args.moderationReason,
      isSuspicious: computeIsSuspicious({
        moderationFlags: skill?.moderationFlags,
        moderationReason: args.moderationReason,
      }),
    });
  },
});

/**
 * Get skills with null moderationStatus that need to be normalized.
 */
export const getSkillsWithNullModerationStatusInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const skills = await ctx.db
      .query("skills")
      .filter((q) =>
        q.and(
          q.eq(q.field("moderationStatus"), undefined),
          q.eq(q.field("softDeletedAt"), undefined),
        ),
      )
      .take(limit);

    return skills.map((s) => ({
      skillId: s._id,
      slug: s.slug,
      moderationReason: s.moderationReason,
    }));
  },
});

/**
 * Set moderationStatus to 'active' for a skill.
 */
export const setSkillModerationStatusActiveInternal = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return;

    const patch: Partial<Doc<"skills">> = { moderationStatus: "active" };
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(args.skillId, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
  },
});

async function listSkillEmbeddingsForSkill(ctx: MutationCtx, skillId: Id<"skills">) {
  return ctx.db
    .query("skillEmbeddings")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .collect();
}

async function markSkillEmbeddingsDeleted(ctx: MutationCtx, skillId: Id<"skills">, now: number) {
  const embeddings = await listSkillEmbeddingsForSkill(ctx, skillId);
  for (const embedding of embeddings) {
    if (embedding.visibility === "deleted") continue;
    await ctx.db.patch(embedding._id, { visibility: "deleted", updatedAt: now });
  }
}

async function restoreSkillEmbeddingsVisibility(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  now: number,
) {
  const embeddings = await listSkillEmbeddingsForSkill(ctx, skillId);
  for (const embedding of embeddings) {
    const visibility = embeddingVisibilityFor(embedding.isLatest, embedding.isApproved);
    await ctx.db.patch(embedding._id, { visibility, updatedAt: now });
  }
}

async function setSkillEmbeddingsSoftDeleted(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  deleted: boolean,
  now: number,
) {
  if (deleted) {
    await markSkillEmbeddingsDeleted(ctx, skillId, now);
    return;
  }

  await restoreSkillEmbeddingsVisibility(ctx, skillId, now);
}

async function setSkillEmbeddingsLatestVersion(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  latestVersionId: Id<"skillVersions">,
  now: number,
) {
  const embeddings = await listSkillEmbeddingsForSkill(ctx, skillId);
  for (const embedding of embeddings) {
    const isLatest = embedding.versionId === latestVersionId;
    await ctx.db.patch(embedding._id, {
      isLatest,
      visibility: embeddingVisibilityFor(isLatest, embedding.isApproved),
      updatedAt: now,
    });
  }
}

async function setSkillEmbeddingsApproved(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  approved: boolean,
  now: number,
) {
  const embeddings = await listSkillEmbeddingsForSkill(ctx, skillId);
  for (const embedding of embeddings) {
    await ctx.db.patch(embedding._id, {
      isApproved: approved,
      visibility: embeddingVisibilityFor(embedding.isLatest, approved),
      updatedAt: now,
    });
  }
}

export const applyBanToOwnedSkillsBatchInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    bannedAt: v.number(),
    hiddenBy: v.optional(v.id("users")),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: BAN_USER_SKILLS_BATCH_SIZE,
      });

    let hiddenCount = 0;
    for (const skill of page) {
      if (skill.softDeletedAt) continue;

      // Only overwrite moderation fields for active skills. Keep existing hidden/removed
      // moderation reasons intact.
      const shouldMarkModeration = (skill.moderationStatus ?? "active") === "active";

      const patch: Partial<Doc<"skills">> = {
        softDeletedAt: args.bannedAt,
        updatedAt: args.bannedAt,
      };
      if (shouldMarkModeration) {
        patch.moderationStatus = "hidden";
        patch.moderationReason = "user.banned";
        patch.hiddenAt = args.bannedAt;
        patch.hiddenBy = args.hiddenBy;
        patch.lastReviewedAt = args.bannedAt;
        patch.isSuspicious = computeIsSuspicious({
          moderationFlags: skill.moderationFlags,
          moderationReason: "user.banned",
        });
        hiddenCount += 1;
      }

      const nextSkill = { ...skill, ...patch };
      await ctx.db.patch(skill._id, patch);
      await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
      await setSkillEmbeddingsSoftDeleted(ctx, skill._id, true, args.bannedAt);
    }

    scheduleNextBatchIfNeeded(
      ctx.scheduler,
      internal.skills.applyBanToOwnedSkillsBatchInternal,
      args,
      isDone,
      continueCursor,
    );

    return { ok: true as const, hiddenCount, scheduled: !isDone };
  },
});

export const applyUserModerationToOwnedSkillsBatchInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    hiddenAt: v.number(),
    hiddenBy: v.optional(v.id("users")),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: BAN_USER_SKILLS_BATCH_SIZE,
      });

    let hiddenCount = 0;
    for (const skill of page) {
      const nextReason =
        skill.moderationVerdict === "malicious" ? skill.moderationReason : USER_MODERATION_REASON;
      const nextStatus = "hidden";
      const patch: Partial<Doc<"skills">> = {
        moderationStatus: nextStatus,
        moderationReason: nextReason,
        hiddenAt: args.hiddenAt,
        hiddenBy: args.hiddenBy,
        lastReviewedAt: args.hiddenAt,
        updatedAt: args.hiddenAt,
        isSuspicious: computeIsSuspicious({
          moderationFlags: skill.moderationFlags,
          moderationReason: nextReason,
        }),
      };

      const nextSkill = { ...skill, ...patch };
      await ctx.db.patch(skill._id, patch);
      await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
      hiddenCount += 1;
    }

    scheduleNextBatchIfNeeded(
      ctx.scheduler,
      internal.skills.applyUserModerationToOwnedSkillsBatchInternal,
      args,
      isDone,
      continueCursor,
    );

    return { ok: true as const, hiddenCount, scheduled: !isDone };
  },
});

export const restoreOwnedSkillsForUnbanBatchInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    bannedAt: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: BAN_USER_SKILLS_BATCH_SIZE,
      });

    let restoredCount = 0;
    for (const skill of page) {
      if (
        !skill.softDeletedAt ||
        skill.softDeletedAt !== args.bannedAt ||
        skill.moderationReason !== "user.banned"
      ) {
        continue;
      }

      const patch: Partial<Doc<"skills">> = {
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "restored.unban",
        isSuspicious: computeIsSuspicious({
          moderationFlags: skill.moderationFlags,
          moderationReason: "restored.unban",
        }),
        hiddenAt: undefined,
        hiddenBy: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      };
      const nextSkill = { ...skill, ...patch };
      await ctx.db.patch(skill._id, patch);
      await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

      await setSkillEmbeddingsSoftDeleted(ctx, skill._id, false, now);
      restoredCount += 1;
    }

    scheduleNextBatchIfNeeded(
      ctx.scheduler,
      internal.skills.restoreOwnedSkillsForUnbanBatchInternal,
      args,
      isDone,
      continueCursor,
    );

    return { ok: true as const, restoredCount, scheduled: !isDone };
  },
});

/**
 * Get legacy skills that are active but still have "pending.scan" reason.
 * These need to be scanned through VT to get proper verdicts.
 */
export const getLegacyPendingScanSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1000;
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_moderation", (q) =>
        q.eq("moderationStatus", "active").eq("moderationReason", "pending.scan"),
      )
      .take(limit);

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
      hasHash: boolean;
    }> = [];

    for (const skill of skills) {
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      results.push({
        skillId: skill._id,
        versionId: version?._id ?? ("" as Id<"skillVersions">),
        slug: skill.slug,
        hasHash: Boolean(version?.sha256hash),
      });
    }

    return results;
  },
});

/**
 * Get active skills that bypassed VT entirely (null moderationReason).
 */
export const getUnscannedActiveSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1000;
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_moderation", (q) =>
        q.eq("moderationStatus", "active").eq("moderationReason", undefined),
      )
      .take(limit);

    const results: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
    }> = [];

    for (const skill of skills) {
      if (skill.softDeletedAt) continue;
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      results.push({
        skillId: skill._id,
        versionId: version?._id ?? ("" as Id<"skillVersions">),
        slug: skill.slug,
      });
    }

    return results;
  },
});

/**
 * Update scan tracking for a skill (called after each VT check)
 */
export const updateScanCheckInternal = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return;

    await ctx.db.patch(args.skillId, {
      scanLastCheckedAt: Date.now(),
      scanCheckCount: (skill.scanCheckCount ?? 0) + 1,
    });
  },
});

/**
 * Mark a skill as stale after too many failed scan checks
 * TODO: Setup webhook/notification when skills are marked stale for manual review
 */
export const markScanStaleInternal = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return;

    await ctx.db.patch(args.skillId, {
      moderationReason: "pending.scan.stale",
      isSuspicious: computeIsSuspicious({
        moderationFlags: skill.moderationFlags,
        moderationReason: "pending.scan.stale",
      }),
      updatedAt: Date.now(),
    });
  },
});

export const listVersionsInternal = internalQuery({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillVersions")
      .withIndex("by_skill", (q) => q.eq("skillId", args.skillId))
      .collect();
  },
});

export const updateVersionScanResultsInternal = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    sha256hash: v.optional(v.string()),
    vtAnalysis: v.optional(
      v.object({
        status: v.string(),
        verdict: v.optional(v.string()),
        analysis: v.optional(v.string()),
        source: v.optional(v.string()),
        checkedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return;

    const patch: Partial<Doc<"skillVersions">> = {};
    if (args.sha256hash !== undefined) {
      patch.sha256hash = args.sha256hash;
    }
    if (args.vtAnalysis !== undefined) {
      patch.vtAnalysis = args.vtAnalysis;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.versionId, patch);
    }
  },
});

export const updateVersionLlmAnalysisInternal = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    llmAnalysis: v.object({
      status: v.string(),
      verdict: v.optional(v.string()),
      confidence: v.optional(v.string()),
      summary: v.optional(v.string()),
      dimensions: v.optional(
        v.array(
          v.object({
            name: v.string(),
            label: v.string(),
            rating: v.string(),
            detail: v.string(),
          }),
        ),
      ),
      guidance: v.optional(v.string()),
      findings: v.optional(v.string()),
      model: v.optional(v.string()),
      checkedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return;
    const nextVersion = { ...version, llmAnalysis: args.llmAnalysis };
    await ctx.db.patch(args.versionId, { llmAnalysis: args.llmAnalysis });

    const skill = await ctx.db.get(version.skillId);
    if (!skill || skill.latestVersionId !== version._id) return;
    await patchStructuredModerationFromVersion(ctx, skill, nextVersion);
  },
});

export const approveSkillByHashInternal = internalMutation({
  args: {
    sha256hash: v.string(),
    scanner: v.string(),
    status: v.string(),
    moderationStatus: v.optional(v.union(v.literal("active"), v.literal("hidden"))),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query("skillVersions")
      .withIndex("by_sha256hash", (q) => q.eq("sha256hash", args.sha256hash))
      .unique();

    if (!version) throw new Error("Version not found for hash");

    // Update the skill's moderation status based on scan result
    const skill = await ctx.db.get(version.skillId);
    if (skill) {
      const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
      const isMalicious = args.status === "malicious";
      const isSuspicious = args.status === "suspicious";
      const isClean = !isMalicious && !isSuspicious;

      // Defense-in-depth: read existing flags to merge scanner results.
      // The stricter verdict always wins across scanners.
      const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? [];
      const existingReason: string | undefined = skill.moderationReason as string | undefined;
      const alreadyBlocked = existingFlags.includes("blocked.malware");
      const bypassSuspicious =
        isSuspicious && !alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner);

      // Determine new flags based on multi-scanner merge
      let newFlags: string[] | undefined;
      if (isMalicious || alreadyBlocked) {
        // Malicious from ANY scanner → blocked.malware (upgrade from suspicious)
        newFlags = ["blocked.malware"];
      } else if (isSuspicious && !bypassSuspicious) {
        // Suspicious from this scanner → flagged.suspicious
        newFlags = ["flagged.suspicious"];
      } else if (isClean) {
        // Clean from this scanner — only clear if no other scanner has flagged
        const otherScannerFlagged =
          existingReason?.startsWith("scanner.") &&
          !existingReason.startsWith(`scanner.${args.scanner}.`) &&
          !existingReason.endsWith(".clean") &&
          !existingReason.endsWith(".pending");
        newFlags = otherScannerFlagged ? existingFlags : undefined;
      }
      if (!alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner)) {
        newFlags = stripSuspiciousFlag(newFlags ?? existingFlags);
      }

      const now = Date.now();
      const qualityLocked = skill.moderationReason === "quality.low" && !isMalicious;
      const nextModerationReason = qualityLocked
        ? "quality.low"
        : bypassSuspicious
          ? `scanner.${args.scanner}.clean`
          : `scanner.${args.scanner}.${args.status}`;
      const nextModerationNotes = qualityLocked
        ? (skill.moderationNotes ??
          "Quality gate quarantine is still active. Manual moderation review required.")
        : undefined;
      const scanner = args.scanner.trim().toLowerCase();
      const snapshot = buildModerationSnapshot({
        staticScan: version.staticScan,
        vtStatus: scanner === "vt" ? args.status : version.vtAnalysis?.status,
        llmStatus: scanner === "llm" ? args.status : version.llmAnalysis?.status,
        sourceVersionId: version._id,
      });
      const nextReasonCodes =
        bypassSuspicious && !isMalicious
          ? snapshot.reasonCodes.filter((code) => !code.startsWith("suspicious."))
          : snapshot.reasonCodes;
      const nextVerdict = verdictFromCodes(nextReasonCodes);
      const nextLegacyFlags = legacyFlagsFromVerdict(nextVerdict);
      const nextModerationStatus =
        nextVerdict === "malicious" || qualityLocked ? "hidden" : "active";

      const basePatch: SkillModerationPatch = {
        moderationStatus: nextModerationStatus,
        moderationReason: nextModerationReason,
        moderationFlags: newFlags ?? nextLegacyFlags,
        moderationVerdict: nextVerdict,
        moderationReasonCodes: nextReasonCodes.length ? nextReasonCodes : undefined,
        moderationEvidence: snapshot.evidence.length ? snapshot.evidence : undefined,
        moderationSummary: summarizeReasonCodes(nextReasonCodes),
        moderationEngineVersion: snapshot.engineVersion,
        moderationEvaluatedAt: snapshot.evaluatedAt,
        moderationSourceVersionId: version._id,
        moderationNotes: nextModerationNotes,
        isSuspicious: computeIsSuspicious({
          moderationFlags: (newFlags ?? nextLegacyFlags) as string[] | undefined,
          moderationReason: nextModerationReason,
        }),
        hiddenAt: nextModerationStatus === "hidden" ? now : undefined,
        hiddenBy: undefined,
        lastReviewedAt: nextModerationStatus === "hidden" ? now : undefined,
        updatedAt: now,
      };
      const patch = applySkillManualOverrideToSkillPatch({
        skill,
        basePatch,
        now,
      });
      const nextSkill = { ...skill, ...patch };
      await ctx.db.patch(skill._id, patch);
      await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

      // Auto-ban authors of malicious skills (skips moderators/admins)
      if (isMalicious && skill.ownerUserId) {
        await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
          ownerUserId: skill.ownerUserId,
          sha256hash: args.sha256hash,
          slug: skill.slug,
        });
      }
    }

    return { ok: true, skillId: version.skillId, versionId: version._id };
  },
});

/**
 * Lighter VT-only escalation: adds moderation flags and hides/bans for malicious,
 * but never touches moderationReason (preserves the LLM verdict).
 */
export const escalateByVtInternal = internalMutation({
  args: {
    sha256hash: v.string(),
    status: v.union(v.literal("malicious"), v.literal("suspicious")),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query("skillVersions")
      .withIndex("by_sha256hash", (q) => q.eq("sha256hash", args.sha256hash))
      .unique();

    if (!version) throw new Error("Version not found for hash");

    const skill = await ctx.db.get(version.skillId);
    if (!skill) return;

    const isMalicious = args.status === "malicious";
    const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? [];
    const alreadyBlocked = existingFlags.includes("blocked.malware");
    const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
    const bypassSuspicious =
      !isMalicious && !alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner);

    // Determine new flags — stricter verdict always wins
    let newFlags: string[];
    if (isMalicious || alreadyBlocked) {
      newFlags = ["blocked.malware"];
    } else if (bypassSuspicious) {
      newFlags = stripSuspiciousFlag(existingFlags) ?? [];
    } else {
      newFlags = ["flagged.suspicious"];
    }

    const nextModerationFlags = newFlags.length ? newFlags : undefined;
    const snapshot = buildModerationSnapshot({
      staticScan: version.staticScan,
      vtStatus: args.status,
      llmStatus: version.llmAnalysis?.status,
      sourceVersionId: version._id,
    });
    const nextReasonCodes =
      bypassSuspicious && !isMalicious
        ? snapshot.reasonCodes.filter((code) => !code.startsWith("suspicious."))
        : snapshot.reasonCodes;
    const nextVerdict = verdictFromCodes(nextReasonCodes);
    const now = Date.now();
    const basePatch: SkillModerationPatch = {
      moderationFlags: nextModerationFlags,
      moderationVerdict: nextVerdict,
      moderationReasonCodes: nextReasonCodes.length ? nextReasonCodes : undefined,
      moderationEvidence: snapshot.evidence.length ? snapshot.evidence : undefined,
      moderationSummary: summarizeReasonCodes(nextReasonCodes),
      moderationEngineVersion: snapshot.engineVersion,
      moderationEvaluatedAt: snapshot.evaluatedAt,
      moderationSourceVersionId: version._id,
      updatedAt: now,
    };
    if (bypassSuspicious) {
      basePatch.moderationReason = normalizeScannerSuspiciousReason(
        skill.moderationReason as string | undefined,
      );
    }

    // Only hide for malicious — suspicious stays visible with a flag
    if (isMalicious) {
      basePatch.moderationStatus = "hidden";
    }

    basePatch.isSuspicious = computeIsSuspicious({
      moderationFlags: nextModerationFlags,
      moderationReason: (basePatch.moderationReason ?? skill.moderationReason) as
        | string
        | undefined,
    });

    const patch = applySkillManualOverrideToSkillPatch({
      skill,
      basePatch,
      now,
    });
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    // Auto-ban authors of malicious skills
    if (isMalicious && skill.ownerUserId) {
      await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
        ownerUserId: skill.ownerUserId,
        sha256hash: args.sha256hash,
        slug: skill.slug,
      });
    }

    return { ok: true, skillId: version.skillId, versionId: version._id };
  },
});

export const getVersionBySkillAndVersion = query({
  args: { skillId: v.id("skills"), version: v.string() },
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_version", (q) =>
        q.eq("skillId", args.skillId).eq("version", args.version),
      )
      .unique();
    return toPublicSkillVersion(version);
  },
});

export const publishVersion: ReturnType<typeof action> = action({
  args: {
    ownerHandle: v.optional(v.string()),
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    changelog: v.string(),
    acceptLicenseTerms: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    forkOf: v.optional(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<PublishResult> => {
    if (args.acceptLicenseTerms !== true) {
      throw new ConvexError("MIT-0 license terms must be accepted to publish skills");
    }
    const { userId } = await requireUserFromAction(ctx);
    const target = (await ctx.runMutation(internal.publishers.resolvePublishTargetForUserInternal, {
      actorUserId: userId,
      ownerHandle: args.ownerHandle,
      minimumRole: "publisher",
    })) as { publisherId: Id<"publishers"> };
    return publishVersionForUser(ctx, userId, args, {
      ownerPublisherId: target.publisherId,
    });
  },
});

export const generateChangelogPreview = action({
  args: {
    slug: v.string(),
    version: v.string(),
    readmeText: v.string(),
    filePaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireUserFromAction(ctx);
    const changelog = await buildChangelogPreview(ctx, {
      slug: args.slug.trim().toLowerCase(),
      version: args.version.trim(),
      readmeText: args.readmeText,
      filePaths: args.filePaths?.map((value) => value.trim()).filter(Boolean),
    });
    return { changelog, source: "auto" as const };
  },
});

async function canReadSkillVersionFiles(ctx: ActionCtx, version: Doc<"skillVersions">) {
  const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
    skillId: version.skillId,
  })) as Doc<"skills"> | null;
  if (!skill) return false;

  const authUserId = await getAuthUserId(ctx);
  if (authUserId) {
    if (authUserId === skill.ownerUserId && !skill.softDeletedAt && !version.softDeletedAt) {
      return true;
    }
    if (skill.ownerPublisherId && !skill.softDeletedAt && !version.softDeletedAt) {
      const memberRole = (await ctx.runQuery(internal.publishers.getMemberRoleInternal, {
        publisherId: skill.ownerPublisherId,
        userId: authUserId,
      })) as "owner" | "admin" | "publisher" | null;
      if (memberRole) {
        return true;
      }
    }
    const actor = (await ctx.runQuery(internal.users.getByIdInternal, {
      userId: authUserId,
    })) as Doc<"users"> | null;
    if (actor?.role === "admin" || actor?.role === "moderator") return true;
  }

  if (skill.softDeletedAt || version.softDeletedAt) return false;

  const isMalwareBlocked = skill.moderationFlags?.includes("blocked.malware") ?? false;
  return Boolean(toPublicSkill(skill) || isMalwareBlocked);
}

export const getReadme: ReturnType<typeof action> = action({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args): Promise<ReadmeResult> => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;
    if (!version) throw new ConvexError("Version not found");
    if (!(await canReadSkillVersionFiles(ctx, version))) {
      throw new ConvexError("Version not available");
    }
    const readmeFile = version.files.find(
      (file) => file.path.toLowerCase() === "skill.md" || file.path.toLowerCase() === "skills.md",
    );
    if (!readmeFile) throw new ConvexError("SKILL.md not found");
    const text = await fetchText(ctx, readmeFile.storageId);
    return { path: readmeFile.path, text };
  },
});

export const getFileText: ReturnType<typeof action> = action({
  args: { versionId: v.id("skillVersions"), path: v.string() },
  handler: async (ctx, args): Promise<FileTextResult> => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;
    if (!version) throw new ConvexError("Version not found");
    if (!(await canReadSkillVersionFiles(ctx, version))) {
      throw new ConvexError("Version not available");
    }

    const normalizedPath = args.path.trim();
    const normalizedLower = normalizedPath.toLowerCase();
    const file =
      version.files.find((entry) => entry.path === normalizedPath) ??
      version.files.find((entry) => entry.path.toLowerCase() === normalizedLower);
    if (!file) throw new ConvexError("File not found");
    if (file.size > MAX_DIFF_FILE_BYTES) {
      throw new ConvexError("File exceeds 200KB limit");
    }

    const text = await fetchText(ctx, file.storageId);
    return { path: file.path, text, size: file.size, sha256: file.sha256 };
  },
});

export const resolveVersionByHash = query({
  args: { slug: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    const hash = args.hash.trim().toLowerCase();
    if (!slug || !/^[a-f0-9]{64}$/.test(hash)) return null;

    const resolved = await resolveSkillBySlugOrAlias(ctx, slug);
    const skill = resolved.skill;
    if (!skill) return null;

    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;

    const fingerprintMatches = await ctx.db
      .query("skillVersionFingerprints")
      .withIndex("by_skill_fingerprint", (q) => q.eq("skillId", skill._id).eq("fingerprint", hash))
      .take(25);

    let match: { version: string } | null = null;
    if (fingerprintMatches.length > 0) {
      const newest = fingerprintMatches.reduce(
        (best, entry) => (entry.createdAt > best.createdAt ? entry : best),
        fingerprintMatches[0] as (typeof fingerprintMatches)[number],
      );
      const version = await ctx.db.get(newest.versionId);
      if (version && !version.softDeletedAt) {
        match = { version: version.version };
      }
    }

    if (!match) {
      const versions = await ctx.db
        .query("skillVersions")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .order("desc")
        .take(200);

      for (const version of versions) {
        if (version.softDeletedAt) continue;
        if (typeof version.fingerprint === "string" && version.fingerprint === hash) {
          match = { version: version.version };
          break;
        }

        const fingerprint = await hashSkillFiles(
          version.files.map((file) => ({
            path: file.path,
            sha256: file.sha256,
          })),
        );
        if (fingerprint === hash) {
          match = { version: version.version };
          break;
        }
      }
    }

    return {
      match,
      latestVersion: latestVersion ? { version: latestVersion.version } : null,
    };
  },
});

export const updateTags = mutation({
  args: {
    skillId: v.id("skills"),
    tags: v.array(v.object({ tag: v.string(), versionId: v.id("skillVersions") })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");
    if (skill.ownerUserId !== user._id) {
      assertModerator(user);
    }

    const nextTags = { ...skill.tags };
    for (const entry of args.tags) {
      nextTags[entry.tag] = entry.versionId;
    }

    const latestEntry = args.tags.find((entry) => entry.tag === "latest");
    const now = Date.now();
    const patch: Partial<Doc<"skills">> = {
      tags: nextTags,
      latestVersionId: latestEntry ? latestEntry.versionId : skill.latestVersionId,
      updatedAt: now,
    };

    // Keep latestVersionSummary in sync when the latest tag is repointed
    if (latestEntry && latestEntry.versionId !== skill.latestVersionId) {
      const version = await ctx.db.get(latestEntry.versionId);
      if (version) {
        patch.latestVersionSummary = {
          version: version.version,
          createdAt: version.createdAt,
          changelog: version.changelog,
          changelogSource: version.changelogSource,
          clawdis: version.parsed?.clawdis,
        };
      }
    }

    await ctx.db.patch(skill._id, patch);

    if (
      latestEntry &&
      latestEntry.versionId !== skill.latestVersionId &&
      shouldSyncModerationFromLatestVersion(skill)
    ) {
      await syncSkillModerationFromLatestVersion(
        ctx,
        { ...skill, latestVersionId: latestEntry.versionId },
        now,
      );
    }

    if (latestEntry) {
      await setSkillEmbeddingsLatestVersion(ctx, skill._id, latestEntry.versionId, now);
    }
  },
});

export const setRedactionApproved = mutation({
  args: { skillId: v.id("skills"), approved: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const now = Date.now();
    if (args.approved) {
      await upsertSkillBadge(ctx, skill._id, "redactionApproved", user._id, now);
    } else {
      await removeSkillBadge(ctx, skill._id, "redactionApproved");
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    });

    await setSkillEmbeddingsApproved(ctx, skill._id, args.approved, now);

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.approved ? "badge.set" : "badge.unset",
      targetType: "skill",
      targetId: skill._id,
      metadata: { badge: "redactionApproved", approved: args.approved },
      createdAt: now,
    });
  },
});

export const setBatch = mutation({
  args: { skillId: v.id("skills"), batch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");
    const existingBadges = await getSkillBadgeMap(ctx, skill._id);
    const previousHighlighted = isSkillHighlighted({ badges: existingBadges });
    const nextBatch = args.batch?.trim() || undefined;
    const nextHighlighted = nextBatch === "highlighted";
    const now = Date.now();

    if (nextHighlighted) {
      await upsertSkillBadge(ctx, skill._id, "highlighted", user._id, now);
    } else {
      await removeSkillBadge(ctx, skill._id, "highlighted");
    }

    await ctx.db.patch(skill._id, {
      batch: nextBatch,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "badge.highlighted",
      targetType: "skill",
      targetId: skill._id,
      metadata: { highlighted: nextHighlighted },
      createdAt: now,
    });

    if (nextHighlighted && !previousHighlighted) {
      void queueHighlightedWebhook(ctx, skill._id);
    }
  },
});

export const setSkillManualOverride = mutation({
  args: {
    skillId: v.id("skills"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new ConvexError("Skill not found");
    if (skill.softDeletedAt || skill.moderationStatus === "removed") {
      throw new ConvexError("Removed skills cannot be manually unflagged.");
    }
    if (!canApplySkillManualOverride(skill)) {
      throw new ConvexError("Skill is not currently suspicious.");
    }

    const now = Date.now();
    const manualOverride = buildManualOverrideRecord({
      note: args.note,
      reviewerUserId: user._id,
      updatedAt: now,
    });

    const patch = applyManualOverrideToSkillPatch({
      basePatch: buildPreservedSkillModerationPatch(skill),
      override: manualOverride,
      now,
    });

    await ctx.db.patch(skill._id, {
      manualOverride,
      ...patch,
    });
    const nextSkill = { ...skill, manualOverride, ...patch };
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "skill.manual_override.set",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        verdict: manualOverride.verdict,
        note: manualOverride.note,
        previousReason: skill.moderationReason ?? null,
        previousVerdict: skill.moderationVerdict ?? null,
      },
      createdAt: now,
    });

    return { ok: true, manualOverride };
  },
});

export const clearSkillManualOverride = mutation({
  args: {
    skillId: v.id("skills"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new ConvexError("Skill not found");
    if (!skill.manualOverride) {
      throw new ConvexError("Skill does not have a manual override.");
    }

    const now = Date.now();
    const note = trimManualOverrideNote(args.note);
    const previousOverride = skill.manualOverride;

    await ctx.db.patch(skill._id, {
      manualOverride: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "skill.manual_override.clear",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        note,
        previousVerdict: previousOverride.verdict,
        previousNote: previousOverride.note,
        previousReviewerUserId: previousOverride.reviewerUserId,
        previousUpdatedAt: previousOverride.updatedAt,
      },
      createdAt: now,
    });

    await syncSkillModerationFromLatestVersion(ctx, { ...skill, manualOverride: undefined }, now);

    return { ok: true };
  },
});

export const setSoftDeleted = mutation({
  args: { skillId: v.id("skills"), deleted: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const now = Date.now();
    const patch: Partial<Doc<"skills">> = {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? "hidden" : "active",
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? user._id : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    };
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    await setSkillEmbeddingsSoftDeleted(ctx, skill._id, args.deleted, now);

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.deleted ? "skill.delete" : "skill.undelete",
      targetType: "skill",
      targetId: skill._id,
      metadata: { slug: skill.slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    });
  },
});

export const changeOwner = mutation({
  args: { skillId: v.id("skills"), ownerUserId: v.id("users") },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const nextOwner = await ctx.db.get(args.ownerUserId);
    if (!nextOwner || nextOwner.deletedAt || nextOwner.deactivatedAt)
      throw new Error("User not found");

    if (skill.ownerUserId === args.ownerUserId) return;

    const now = Date.now();
    await ctx.db.patch(skill._id, {
      ownerUserId: args.ownerUserId,
      lastReviewedAt: now,
      updatedAt: now,
    });

    const embeddings = await listSkillEmbeddingsForSkill(ctx, skill._id);
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        ownerId: args.ownerUserId,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "skill.owner.change",
      targetType: "skill",
      targetId: skill._id,
      metadata: { from: skill.ownerUserId, to: args.ownerUserId },
      createdAt: now,
    });
  },
});

export const renameOwnedSkill = mutation({
  args: {
    slug: v.string(),
    newSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return renameOwnedSkillByActor(ctx, user._id, args.slug, args.newSlug);
  },
});

export const mergeOwnedSkillIntoCanonical = mutation({
  args: {
    sourceSlug: v.string(),
    targetSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return mergeOwnedSkillIntoCanonicalByActor(ctx, user._id, args.sourceSlug, args.targetSlug);
  },
});

export const renameOwnedSkillInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    newSlug: v.string(),
  },
  handler: async (ctx, args) => {
    return renameOwnedSkillByActor(ctx, args.actorUserId, args.slug, args.newSlug);
  },
});

export const mergeOwnedSkillIntoCanonicalInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    sourceSlug: v.string(),
    targetSlug: v.string(),
  },
  handler: async (ctx, args) => {
    return mergeOwnedSkillIntoCanonicalByActor(
      ctx,
      args.actorUserId,
      args.sourceSlug,
      args.targetSlug,
    );
  },
});

async function renameOwnedSkillByActor(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  sourceSlugArg: string,
  newSlugArg: string,
) {
  const user = await ctx.db.get(actorUserId);
  if (!user || user.deletedAt || user.deactivatedAt) {
    throw new ConvexError("Forbidden");
  }

  const now = Date.now();
  const sourceSlug = sourceSlugArg.trim().toLowerCase();
  const newSlug = newSlugArg.trim().toLowerCase();
  if (!sourceSlug) throw new ConvexError("Current slug required");
  if (!newSlug) throw new ConvexError("New slug required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(newSlug)) {
    throw new ConvexError("Invalid slug. Use lowercase letters, numbers, and hyphens only.");
  }

  const resolved = await resolveSkillBySlugOrAlias(ctx, sourceSlug);
  const skill = resolved.skill;
  if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");
  if (skill.ownerUserId !== actorUserId) throw new ConvexError("Forbidden");
  if (skill.slug === newSlug) {
    return { ok: true as const, slug: skill.slug, previousSlug: skill.slug };
  }

  const existingSkill = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", newSlug))
    .unique();
  if (existingSkill && existingSkill._id !== skill._id) {
    const owner = await ctx.db.get(existingSkill.ownerUserId);
    if (existingSkill.ownerUserId === actorUserId) {
      throw new ConvexError("Slug already belongs to one of your skills. Use merge instead.");
    }
    throw new ConvexError(buildSlugTakenErrorMessage(existingSkill, owner));
  }

  const existingAlias = await getSkillSlugAliasBySlug(ctx, newSlug);
  if (existingAlias && existingAlias.skillId !== skill._id) {
    const aliasSkill = await ctx.db.get(existingAlias.skillId);
    const owner = aliasSkill ? await ctx.db.get(aliasSkill.ownerUserId) : null;
    throw new ConvexError(
      aliasSkill
        ? buildAliasTakenErrorMessage(aliasSkill, owner)
        : "Slug redirects to an existing skill. Choose a different slug.",
    );
  }

  const reservation = await getLatestActiveReservedSlug(ctx, newSlug);
  if (
    reservation &&
    reservation.expiresAt > now &&
    reservation.originalOwnerUserId !== actorUserId
  ) {
    throw new ConvexError(formatReservedSlugCooldownMessage(newSlug, reservation.expiresAt));
  }

  if (existingAlias && existingAlias.skillId === skill._id) {
    await ctx.db.delete(existingAlias._id);
  }

  await ctx.db.patch(skill._id, {
    slug: newSlug,
    updatedAt: now,
  });
  await releaseActiveReservationsForSlug(ctx, newSlug, now);

  const previousAlias = await getSkillSlugAliasBySlug(ctx, skill.slug);
  if (previousAlias) {
    await ctx.db.patch(previousAlias._id, {
      skillId: skill._id,
      ownerUserId: actorUserId,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("skillSlugAliases", {
      slug: skill.slug,
      skillId: skill._id,
      ownerUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.db.insert("auditLogs", {
    actorUserId,
    action: "skill.slug.rename",
    targetType: "skill",
    targetId: skill._id,
    metadata: {
      from: skill.slug,
      to: newSlug,
    },
    createdAt: now,
  });

  return { ok: true as const, slug: newSlug, previousSlug: skill.slug };
}

async function mergeOwnedSkillIntoCanonicalByActor(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  sourceSlugArg: string,
  targetSlugArg: string,
) {
  const user = await ctx.db.get(actorUserId);
  if (!user || user.deletedAt || user.deactivatedAt) {
    throw new ConvexError("Forbidden");
  }

  const now = Date.now();
  const sourceSlug = sourceSlugArg.trim().toLowerCase();
  const targetSlug = targetSlugArg.trim().toLowerCase();
  if (!sourceSlug || !targetSlug) {
    throw new ConvexError("Source slug and target slug are required");
  }
  if (sourceSlug === targetSlug) {
    throw new ConvexError("Source and target must be different skills");
  }

  const source = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", sourceSlug))
    .unique();
  if (!source || source.softDeletedAt) throw new ConvexError("Source skill not found");

  const targetResolved = await resolveSkillBySlugOrAlias(ctx, targetSlug);
  const target = targetResolved.skill;
  if (!target || target.softDeletedAt) throw new ConvexError("Target skill not found");
  if (source._id === target._id) {
    throw new ConvexError("Source and target must be different skills");
  }
  if (source.ownerUserId !== actorUserId || target.ownerUserId !== actorUserId) {
    throw new ConvexError("Forbidden");
  }

  const targetLatestVersion = target.latestVersionId
    ? await ctx.db.get(target.latestVersionId)
    : null;
  const targetCanonicalSkillId = target.canonicalSkillId ?? target._id;

  const aliases = await listSkillSlugAliasesForSkill(ctx, source._id);
  for (const alias of aliases) {
    if (alias.slug === target.slug) {
      await ctx.db.delete(alias._id);
      continue;
    }
    await ctx.db.patch(alias._id, {
      skillId: target._id,
      ownerUserId: target.ownerUserId,
      updatedAt: now,
    });
  }

  const sourceAlias = await getSkillSlugAliasBySlug(ctx, source.slug);
  if (sourceAlias) {
    await ctx.db.patch(sourceAlias._id, {
      skillId: target._id,
      ownerUserId: target.ownerUserId,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("skillSlugAliases", {
      slug: source.slug,
      skillId: target._id,
      ownerUserId: target.ownerUserId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await repointSkillRelationships(ctx, {
    fromSkillId: source._id,
    toSkillId: target._id,
    toCanonicalSkillId: targetCanonicalSkillId,
    targetVersion: targetLatestVersion,
    now,
  });

  const patch: Partial<Doc<"skills">> = {
    canonicalSkillId: targetCanonicalSkillId,
    forkOf: {
      skillId: target._id,
      kind: "duplicate",
      version: targetLatestVersion?.version,
      at: now,
    },
    softDeletedAt: now,
    moderationStatus: "hidden",
    moderationReason: "owner.merged",
    hiddenAt: now,
    hiddenBy: actorUserId,
    lastReviewedAt: now,
    updatedAt: now,
  };
  const nextSkill = { ...source, ...patch };
  await ctx.db.patch(source._id, patch);
  await adjustGlobalPublicCountForSkillChange(ctx, source, nextSkill);
  await setSkillEmbeddingsSoftDeleted(ctx, source._id, true, now);

  await ctx.db.insert("auditLogs", {
    actorUserId,
    action: "skill.merge",
    targetType: "skill",
    targetId: source._id,
    metadata: {
      from: source.slug,
      to: target.slug,
      targetSkillId: target._id,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    sourceSlug: source.slug,
    targetSlug: target.slug,
  };
}

async function transferSkillOwnershipAndEmbeddings(
  ctx: MutationCtx,
  params: {
    skill: Doc<"skills">;
    ownerUserId: Id<"users">;
    now: number;
  },
) {
  if (params.skill.ownerUserId === params.ownerUserId) return;

  await ctx.db.patch(params.skill._id, {
    ownerUserId: params.ownerUserId,
    lastReviewedAt: params.now,
    updatedAt: params.now,
  });

  const embeddings = await listSkillEmbeddingsForSkill(ctx, params.skill._id);
  for (const embedding of embeddings) {
    await ctx.db.patch(embedding._id, {
      ownerId: params.ownerUserId,
      updatedAt: params.now,
    });
  }
}

async function releaseActiveReservationsForSlug(
  ctx: MutationCtx,
  slug: string,
  releasedAt: number,
) {
  const active = await listActiveReservedSlugsForSlug(ctx, slug);
  for (const reservation of active) {
    await ctx.db.patch(reservation._id, { releasedAt });
  }
}

/**
 * Admin-only: reclaim a squatted slug by hard-deleting the squatter's skill
 * and reserving the slug for the rightful owner.
 */
export const reclaimSlug = mutation({
  args: {
    slug: v.string(),
    rightfulOwnerUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Slug required");

    const rightfulOwner = await ctx.db.get(args.rightfulOwnerUserId);
    if (!rightfulOwner) throw new Error("Rightful owner not found");

    const now = Date.now();

    // Check if slug is currently occupied by someone else
    const existingSkill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (existingSkill) {
      if (existingSkill.ownerUserId === args.rightfulOwnerUserId) {
        return { ok: true as const, action: "already_owned" };
      }

      // Hard-delete the squatter's skill
      await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
        skillId: existingSkill._id,
        actorUserId: user._id,
      });

      await ctx.db.insert("auditLogs", {
        actorUserId: user._id,
        action: "slug.reclaim",
        targetType: "skill",
        targetId: existingSkill._id,
        metadata: {
          slug,
          squatterUserId: existingSkill.ownerUserId,
          rightfulOwnerUserId: args.rightfulOwnerUserId,
          reason: args.reason || undefined,
        },
        createdAt: now,
      });
    }

    await upsertReservedSlugForRightfulOwner(ctx, {
      slug,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      deletedAt: now,
      expiresAt: now + SLUG_RESERVATION_MS,
      reason: args.reason || "slug.reclaimed",
    });

    return {
      ok: true as const,
      action: existingSkill ? "reclaimed_from_squatter" : "reserved",
    };
  },
});

/**
 * Admin-only: reclaim slugs in bulk. Useful for recovering multiple squatted slugs at once.
 */
export const reclaimSlugInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    rightfulOwnerUserId: v.id("users"),
    reason: v.optional(v.string()),
    transferRootSlugOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Slug required");

    const now = Date.now();
    const transferRootSlugOnly = args.transferRootSlugOnly === true;

    const rightfulOwner = await ctx.db.get(args.rightfulOwnerUserId);
    if (!rightfulOwner || rightfulOwner.deletedAt || rightfulOwner.deactivatedAt) {
      throw new Error("Rightful owner not found");
    }

    const existingSkill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (transferRootSlugOnly) {
      if (!existingSkill) {
        await ctx.db.insert("auditLogs", {
          actorUserId: args.actorUserId,
          action: "slug.reclaim",
          targetType: "slug",
          targetId: slug,
          metadata: {
            slug,
            rightfulOwnerUserId: args.rightfulOwnerUserId,
            transferRootSlugOnly: true,
            action: "missing",
            reason: args.reason || undefined,
          },
          createdAt: now,
        });
        return { ok: true as const, action: "missing" as const };
      }

      if (existingSkill.ownerUserId === args.rightfulOwnerUserId) {
        await releaseActiveReservationsForSlug(ctx, slug, now);
        await ctx.db.insert("auditLogs", {
          actorUserId: args.actorUserId,
          action: "slug.reclaim",
          targetType: "slug",
          targetId: slug,
          metadata: {
            slug,
            rightfulOwnerUserId: args.rightfulOwnerUserId,
            transferRootSlugOnly: true,
            action: "already_owned",
            reason: args.reason || undefined,
          },
          createdAt: now,
        });
        return { ok: true as const, action: "already_owned" as const };
      }

      await transferSkillOwnershipAndEmbeddings(ctx, {
        skill: existingSkill,
        ownerUserId: args.rightfulOwnerUserId,
        now,
      });
      await releaseActiveReservationsForSlug(ctx, slug, now);

      await ctx.db.insert("auditLogs", {
        actorUserId: args.actorUserId,
        action: "slug.reclaim",
        targetType: "slug",
        targetId: slug,
        metadata: {
          slug,
          rightfulOwnerUserId: args.rightfulOwnerUserId,
          previousOwnerUserId: existingSkill.ownerUserId,
          hadSquatter: true,
          transferRootSlugOnly: true,
          action: "ownership_transferred",
          reason: args.reason || undefined,
        },
        createdAt: now,
      });
      return { ok: true as const, action: "ownership_transferred" as const };
    }

    if (existingSkill && existingSkill.ownerUserId !== args.rightfulOwnerUserId) {
      await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
        skillId: existingSkill._id,
        actorUserId: args.actorUserId,
      });
    }

    await upsertReservedSlugForRightfulOwner(ctx, {
      slug,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      deletedAt: now,
      expiresAt: now + SLUG_RESERVATION_MS,
      reason: args.reason || "slug.reclaimed",
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "slug.reclaim",
      targetType: "slug",
      targetId: slug,
      metadata: {
        slug,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        hadSquatter: Boolean(
          existingSkill && existingSkill.ownerUserId !== args.rightfulOwnerUserId,
        ),
        reason: args.reason || undefined,
      },
      createdAt: now,
    });

    return { ok: true as const };
  },
});

export const setDuplicate = mutation({
  args: { skillId: v.id("skills"), canonicalSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const now = Date.now();
    const canonicalSlug = args.canonicalSlug?.trim().toLowerCase();

    if (!canonicalSlug) {
      await ctx.db.patch(skill._id, {
        canonicalSkillId: undefined,
        forkOf: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("auditLogs", {
        actorUserId: user._id,
        action: "skill.duplicate.clear",
        targetType: "skill",
        targetId: skill._id,
        metadata: { canonicalSlug: null },
        createdAt: now,
      });
      return;
    }

    const canonical = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", canonicalSlug))
      .unique();
    if (!canonical) throw new Error("Canonical skill not found");
    if (canonical._id === skill._id) throw new Error("Cannot duplicate a skill onto itself");

    const canonicalVersion = canonical.latestVersionId
      ? await ctx.db.get(canonical.latestVersionId)
      : null;

    await ctx.db.patch(skill._id, {
      canonicalSkillId: canonical._id,
      forkOf: {
        skillId: canonical._id,
        kind: "duplicate",
        version: canonicalVersion?.version,
        at: now,
      },
      lastReviewedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "skill.duplicate.set",
      targetType: "skill",
      targetId: skill._id,
      metadata: { canonicalSlug },
      createdAt: now,
    });
  },
});

export const setOfficialBadge = mutation({
  args: { skillId: v.id("skills"), official: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const now = Date.now();
    if (args.official) {
      await upsertSkillBadge(ctx, skill._id, "official", user._id, now);
    } else {
      await removeSkillBadge(ctx, skill._id, "official");
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.official ? "badge.official.set" : "badge.official.unset",
      targetType: "skill",
      targetId: skill._id,
      metadata: { official: args.official },
      createdAt: now,
    });
  },
});

export const setDeprecatedBadge = mutation({
  args: { skillId: v.id("skills"), deprecated: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const now = Date.now();
    if (args.deprecated) {
      await upsertSkillBadge(ctx, skill._id, "deprecated", user._id, now);
    } else {
      await removeSkillBadge(ctx, skill._id, "deprecated");
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.deprecated ? "badge.deprecated.set" : "badge.deprecated.unset",
      targetType: "skill",
      targetId: skill._id,
      metadata: { deprecated: args.deprecated },
      createdAt: now,
    });
  },
});

export const hardDelete = mutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");
    await hardDeleteSkillStep(ctx, skill, user._id, "versions");
  },
});

export const hardDeleteInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    actorUserId: v.id("users"),
    phase: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return;
    const phase = isHardDeletePhase(args.phase) ? args.phase : "versions";
    await hardDeleteSkillStep(ctx, skill, actor._id, phase);
  },
});

export const insertVersion = internalMutation({
  args: {
    userId: v.id("users"),
    ownerPublisherId: v.optional(v.id("publishers")),
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    changelog: v.string(),
    changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
    tags: v.optional(v.array(v.string())),
    fingerprint: v.string(),
    bypassNewSkillRateLimit: v.optional(v.boolean()),
    forkOf: v.optional(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    parsed: v.object({
      frontmatter: v.record(v.string(), v.any()),
      metadata: v.optional(v.any()),
      clawdis: v.optional(v.any()),
      license: v.optional(v.literal(PLATFORM_SKILL_LICENSE)),
    }),
    summary: v.optional(v.string()),
    qualityAssessment: v.optional(
      v.object({
        decision: v.union(v.literal("pass"), v.literal("quarantine"), v.literal("reject")),
        score: v.number(),
        reason: v.string(),
        trustTier: v.union(v.literal("low"), v.literal("medium"), v.literal("trusted")),
        similarRecentCount: v.number(),
        signals: v.object({
          bodyChars: v.number(),
          bodyWords: v.number(),
          uniqueWordRatio: v.number(),
          headingCount: v.number(),
          bulletCount: v.number(),
          templateMarkerHits: v.number(),
          genericSummary: v.boolean(),
          cjkChars: v.optional(v.number()),
        }),
      }),
    ),
    staticScan: v.object({
      status: v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
      reasonCodes: v.array(v.string()),
      findings: v.array(
        v.object({
          code: v.string(),
          severity: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
          file: v.string(),
          line: v.number(),
          message: v.string(),
          evidence: v.string(),
        }),
      ),
      summary: v.string(),
      engineVersion: v.string(),
      checkedAt: v.number(),
    }),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = args.userId;
    const slug = normalizeSkillSlugForWrite(args.slug);
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");
    const personalPublisher = await ensurePersonalPublisherForUser(ctx, user);
    if (!personalPublisher) throw new ConvexError("Personal publisher not found");
    const ownerPublisherId = args.ownerPublisherId ?? personalPublisher._id;
    if (ownerPublisherId !== personalPublisher._id) {
      await requirePublisherRole(ctx, {
        publisherId: ownerPublisherId,
        userId,
        allowed: ["publisher"],
      });
    }

    const now = Date.now();

    let skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!skill) {
      const alias = await getSkillSlugAliasBySlug(ctx, slug);
      if (alias) {
        const aliasedSkill = await ctx.db.get(alias.skillId);
        const owner = aliasedSkill
          ? await getOwnerPublisher(ctx, {
              ownerPublisherId: aliasedSkill.ownerPublisherId,
              ownerUserId: aliasedSkill.ownerUserId,
            })
          : null;
        throw new ConvexError(
          aliasedSkill
            ? buildAliasTakenErrorMessage(aliasedSkill, owner)
            : "Slug redirects to an existing skill. Choose a different slug.",
        );
      }
    }

    if (skill && skill.ownerPublisherId && skill.ownerPublisherId !== ownerPublisherId) {
      const owner = await getOwnerPublisher(ctx, {
        ownerPublisherId: skill.ownerPublisherId,
        ownerUserId: skill.ownerUserId,
      });
      throw new ConvexError(buildSlugTakenErrorMessage(skill, owner));
    }

    if (skill && !skill.ownerPublisherId && skill.ownerUserId !== userId) {
      // Fallback: Convex Auth can create duplicate `users` records. Heal ownership ONLY
      // when the underlying GitHub identity matches (authAccounts.providerAccountId).
      const owner = await getOwnerPublisher(ctx, {
        ownerPublisherId: skill.ownerPublisherId,
        ownerUserId: skill.ownerUserId,
      });
      const slugTakenMessage = buildSlugTakenErrorMessage(skill, owner);

      // Check GitHub identity FIRST so ownership healing works even when the
      // previous owner record is deleted/deactivated (e.g. duplicate Convex Auth
      // user where the old record was later banned).
      const [ownerProviderAccountId, callerProviderAccountId] = await Promise.all([
        getGitHubProviderAccountId(ctx, skill.ownerUserId),
        getGitHubProviderAccountId(ctx, userId),
      ]);

      if (
        canHealSkillOwnershipByGitHubProviderAccountId(
          ownerProviderAccountId,
          callerProviderAccountId,
        )
      ) {
        await ctx.db.patch(skill._id, {
          ownerUserId: userId,
          ownerPublisherId,
          updatedAt: now,
        });
        skill = { ...skill, ownerUserId: userId, ownerPublisherId };
      } else {
        throw new ConvexError(slugTakenMessage);
      }
    } else if (skill && !skill.ownerPublisherId) {
      await ctx.db.patch(skill._id, {
        ownerPublisherId,
        updatedAt: now,
      });
      skill = { ...skill, ownerPublisherId };
    }

    const qualityAssessment = args.qualityAssessment;
    const isQualityQuarantine = qualityAssessment?.decision === "quarantine";

    // Trusted publishers (and moderators/admins) bypass auto-hide for pending scans.
    // Keep moderationReason as pending.scan so the VT poller keeps working.
    const isTrustedPublisher = Boolean(
      user.trustedPublisher || user.role === "admin" || user.role === "moderator",
    );
    const staticSnapshot = buildModerationSnapshot({
      staticScan: args.staticScan,
    });
    const isPublisherUnderModeration = Boolean(user.requiresModerationAt);
    const isStaticMalicious = staticSnapshot.verdict === "malicious";
    const initialModerationStatus =
      isStaticMalicious ||
      isPublisherUnderModeration ||
      !(isTrustedPublisher && !isQualityQuarantine)
        ? "hidden"
        : "active";

    const moderationReason = isStaticMalicious
      ? "scanner.static.malicious"
      : isQualityQuarantine
        ? "quality.low"
        : isPublisherUnderModeration
          ? USER_MODERATION_REASON
          : "pending.scan";
    const moderationNotes = isStaticMalicious
      ? "Auto-hidden by static malware detection. Manual moderation review required."
      : isQualityQuarantine
        ? `Auto-quarantined by quality gate (score=${qualityAssessment.score}, tier=${qualityAssessment.trustTier}, similar=${qualityAssessment.similarRecentCount}).`
        : isPublisherUnderModeration
          ? (user.requiresModerationReason ??
            "Publisher is currently under manual moderation review.")
          : undefined;

    const qualityRecord = qualityAssessment
      ? {
          score: qualityAssessment.score,
          decision: qualityAssessment.decision,
          trustTier: qualityAssessment.trustTier,
          similarRecentCount: qualityAssessment.similarRecentCount,
          reason: qualityAssessment.reason,
          signals: qualityAssessment.signals,
          evaluatedAt: now,
        }
      : undefined;

    if (!skill) {
      // Anti-squatting: enforce reserved slug cooldown.
      await enforceReservedSlugCooldownForNewSkill(ctx, {
        slug,
        userId,
        now,
      });

      if (!args.bypassNewSkillRateLimit) {
        const ownerTrustSignals = await getOwnerTrustSignals(ctx, user, now);
        enforceNewSkillRateLimit(ownerTrustSignals);
      }

      const forkOfSlug = args.forkOf?.slug.trim().toLowerCase() || "";
      const forkOfVersion = args.forkOf?.version?.trim() || undefined;

      let canonicalSkillId: Id<"skills"> | undefined;
      let forkOf:
        | {
            skillId: Id<"skills">;
            kind: "fork" | "duplicate";
            version?: string;
            at: number;
          }
        | undefined;

      if (forkOfSlug) {
        const upstream = await ctx.db
          .query("skills")
          .withIndex("by_slug", (q) => q.eq("slug", forkOfSlug))
          .unique();
        if (!upstream || upstream.softDeletedAt) throw new Error("Upstream skill not found");
        canonicalSkillId = upstream.canonicalSkillId ?? upstream._id;
        forkOf = {
          skillId: upstream._id,
          kind: "fork",
          version: forkOfVersion,
          at: now,
        };
      } else {
        const match = await findCanonicalSkillForFingerprint(ctx, args.fingerprint);
        if (match) {
          canonicalSkillId = match.canonicalSkillId ?? match._id;
          forkOf = {
            skillId: match._id,
            kind: "duplicate",
            at: now,
          };
        }
      }

      const summary = args.summary ?? getFrontmatterValue(args.parsed.frontmatter, "description");
      const summaryValue = summary ?? undefined;
      const derivedFlags = deriveModerationFlags({
        skill: {
          slug,
          displayName: args.displayName,
          summary: summaryValue,
        },
        parsed: args.parsed,
        files: args.files,
      });
      const newSkillFlags = Array.from(
        new Set([...(derivedFlags ?? []), ...(staticSnapshot.legacyFlags ?? [])]),
      );
      const skillId = await ctx.db.insert("skills", {
        slug,
        displayName: args.displayName,
        summary: summaryValue,
        ownerUserId: userId,
        ownerPublisherId,
        canonicalSkillId,
        forkOf,
        latestVersionId: undefined,
        tags: {},
        softDeletedAt: undefined,
        badges: {
          redactionApproved: undefined,
          highlighted: undefined,
          official: undefined,
          deprecated: undefined,
        },
        moderationStatus: initialModerationStatus,
        moderationReason,
        moderationNotes,
        moderationVerdict: staticSnapshot.verdict,
        moderationReasonCodes: staticSnapshot.reasonCodes.length
          ? staticSnapshot.reasonCodes
          : undefined,
        moderationEvidence: staticSnapshot.evidence.length ? staticSnapshot.evidence : undefined,
        moderationSummary: staticSnapshot.summary,
        moderationEngineVersion: staticSnapshot.engineVersion,
        moderationEvaluatedAt: staticSnapshot.evaluatedAt,
        moderationSourceVersionId: undefined,
        quality: qualityRecord,
        moderationFlags: newSkillFlags.length ? newSkillFlags : undefined,
        isSuspicious: computeIsSuspicious({
          moderationFlags: newSkillFlags.length ? newSkillFlags : undefined,
          moderationReason: moderationReason,
        }),
        reportCount: 0,
        lastReportedAt: undefined,
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        stats: {
          downloads: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          stars: 0,
          versions: 0,
          comments: 0,
        },
        createdAt: now,
        updatedAt: now,
      });
      skill = await ctx.db.get(skillId);
      if (skill) {
        // Digest sync is handled after the version patch below (line ~4222),
        // which captures the final state including latestVersionId and tags.
        await adjustGlobalPublicCountForSkillChange(ctx, null, skill);
      }
    }

    if (!skill) throw new Error("Skill creation failed");

    const existingVersion = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_version", (q) => q.eq("skillId", skill._id).eq("version", args.version))
      .unique();
    if (existingVersion) {
      throw new ConvexError("Version already exists");
    }

    const versionId = await ctx.db.insert("skillVersions", {
      skillId: skill._id,
      version: args.version,
      fingerprint: args.fingerprint,
      changelog: args.changelog,
      changelogSource: args.changelogSource,
      files: args.files,
      parsed: args.parsed,
      staticScan: args.staticScan,
      createdBy: userId,
      createdAt: now,
      softDeletedAt: undefined,
    });

    const nextTags: Record<string, Id<"skillVersions">> = { ...skill.tags };
    nextTags.latest = versionId;
    for (const tag of args.tags ?? []) {
      nextTags[tag] = versionId;
    }

    const latestBefore = skill.latestVersionId;

    const nextSummary =
      args.summary ?? getFrontmatterValue(args.parsed.frontmatter, "description") ?? skill.summary;
    const derivedFlags = deriveModerationFlags({
      skill: {
        slug: skill.slug,
        displayName: args.displayName,
        summary: nextSummary ?? undefined,
      },
      parsed: args.parsed,
      files: args.files,
    });
    const moderationSnapshot = buildModerationSnapshot({
      staticScan: args.staticScan,
      sourceVersionId: versionId,
    });
    const nextFlags = Array.from(
      new Set([...(derivedFlags ?? []), ...(moderationSnapshot.legacyFlags ?? [])]),
    );
    const basePatch: SkillModerationPatch = {
      displayName: args.displayName,
      summary: nextSummary ?? undefined,
      ownerPublisherId: skill.ownerPublisherId ?? ownerPublisherId,
      latestVersionId: versionId,
      latestVersionSummary: {
        version: args.version,
        createdAt: now,
        changelog: args.changelog,
        changelogSource: args.changelogSource,
        clawdis: args.parsed.clawdis,
      },
      tags: nextTags,
      stats: { ...skill.stats, versions: skill.stats.versions + 1 },
      softDeletedAt: undefined,
      moderationStatus: initialModerationStatus,
      moderationReason,
      moderationNotes,
      moderationVerdict: moderationSnapshot.verdict,
      moderationReasonCodes: moderationSnapshot.reasonCodes.length
        ? moderationSnapshot.reasonCodes
        : undefined,
      moderationEvidence: moderationSnapshot.evidence.length
        ? moderationSnapshot.evidence
        : undefined,
      moderationSummary: moderationSnapshot.summary,
      moderationEngineVersion: moderationSnapshot.engineVersion,
      moderationEvaluatedAt: moderationSnapshot.evaluatedAt,
      moderationSourceVersionId: versionId,
      quality: qualityRecord ?? skill.quality,
      moderationFlags: nextFlags.length ? nextFlags : undefined,
      isSuspicious: computeIsSuspicious({
        moderationFlags: nextFlags.length ? nextFlags : undefined,
        moderationReason: moderationReason,
      }),
      updatedAt: now,
    };
    const patch = applySkillManualOverrideToSkillPatch({
      skill,
      basePatch,
      now,
    });
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    if (moderationSnapshot.verdict === "malicious" && skill.ownerUserId) {
      await ctx.scheduler.runAfter(0, internal.users.placeUserUnderModerationInternal, {
        ownerUserId: skill.ownerUserId,
        slug: skill.slug,
        reason:
          moderationSnapshot.reasonCodes.find((code) => code.startsWith("malicious.")) ??
          "malicious.static_scan",
      });
    }

    const badgeMap = await getSkillBadgeMap(ctx, skill._id);
    const isApproved = Boolean(badgeMap.redactionApproved);

    const embeddingId = await ctx.db.insert("skillEmbeddings", {
      skillId: skill._id,
      versionId,
      ownerId: userId,
      embedding: args.embedding,
      isLatest: true,
      isApproved,
      visibility: embeddingVisibilityFor(true, isApproved),
      updatedAt: now,
    });
    // Lightweight lookup so search hydration can skip reading the 12KB embedding doc
    await ctx.db.insert("embeddingSkillMap", {
      embeddingId,
      skillId: skill._id,
    });

    if (latestBefore) {
      const previousEmbedding = await ctx.db
        .query("skillEmbeddings")
        .withIndex("by_version", (q) => q.eq("versionId", latestBefore))
        .unique();
      if (previousEmbedding) {
        await ctx.db.patch(previousEmbedding._id, {
          isLatest: false,
          visibility: embeddingVisibilityFor(false, previousEmbedding.isApproved),
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("skillVersionFingerprints", {
      skillId: skill._id,
      versionId,
      fingerprint: args.fingerprint,
      createdAt: now,
    });

    return { skillId: skill._id, versionId, embeddingId };
  },
});

export const setSkillSoftDeletedInternal = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    deleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Slug required");

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill) throw new Error("Skill not found");

    if (skill.ownerUserId !== args.userId) {
      assertModerator(user);
    }

    const now = Date.now();
    const patch: Partial<Doc<"skills">> = {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? "hidden" : "active",
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? args.userId : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    };
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    await setSkillEmbeddingsSoftDeleted(ctx, skill._id, args.deleted, now);

    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      action: args.deleted ? "skill.delete" : "skill.undelete",
      targetType: "skill",
      targetId: skill._id,
      metadata: { slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    });

    return { ok: true as const };
  },
});

function clampInt(value: number, min: number, max: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, rounded));
}

async function findCanonicalSkillForFingerprint(
  ctx: { db: MutationCtx["db"] },
  fingerprint: string,
) {
  const matches = await ctx.db
    .query("skillVersionFingerprints")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
    .take(25);

  for (const entry of matches) {
    const skill = await ctx.db.get(entry.skillId);
    if (!skill || skill.softDeletedAt) continue;
    return skill;
  }

  return null;
}
