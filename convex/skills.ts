import { getAuthUserId } from "@convex-dev/auth/server";
import { normalizeTextContentType } from "clawhub-schema";
import { getPage, type IndexKey, paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v, type Value } from "convex/values";
import semver from "semver";
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
import {
  assertAdmin,
  assertModerator,
  getOptionalActiveAuthUserId,
  getOptionalActiveAuthUserIdFromAction,
  requireUser,
  requireUserFromAction,
} from "./lib/access";
import {
  assertArtifactAppealFinalAction,
  assertArtifactAppealTransition,
  assertArtifactReportFinalAction,
  assertArtifactReportTransition,
  readArtifactReportStatus,
  appendSkillModerationEventLog,
} from "./lib/artifactModeration";
import { getSkillBadgeMap, getSkillBadgeMaps, isSkillHighlighted } from "./lib/badges";
import { scheduleNextBatchIfNeeded } from "./lib/batching";
import { generateChangelogPreview as buildChangelogPreview } from "./lib/changelog";
import { normalizeClawScanNoteForWrite } from "./lib/clawScanNote";
import { mergeDepRegistryFinding } from "./lib/depRegistryScan";
import { embeddingVisibilityFor } from "./lib/embeddingVisibility";
import {
  canHealSkillOwnershipByGitHubProviderAccountId,
  getGitHubProviderAccountId,
} from "./lib/githubIdentity";
import {
  adjustGlobalPublicSkillsCount,
  getPublicSkillVisibilityDelta,
  isPublicSkillDoc,
  readGlobalPublicSkillsCount,
} from "./lib/globalStats";
import {
  TRENDING_LEADERBOARD_KIND,
  TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND,
} from "./lib/leaderboards";
import {
  applyManualOverrideToSkillPatch,
  isManualOverrideReason,
  type ManualModerationOverride,
} from "./lib/manualOverrides";
import { deriveModerationFlags } from "./lib/moderation";
import { buildModerationSnapshot } from "./lib/moderationEngine";
import {
  legacyFlagsFromVerdict,
  MODERATION_ENGINE_VERSION,
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
  assertCanManageOwnedResource,
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  getOwnerPublisher,
  getPersonalPublisherForUserOrFallback,
  getPublisherByHandle,
  getPublisherMembership,
  isPublisherActive,
  isPublisherRoleAllowed,
  normalizePublisherHandle,
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
import { matchesAllTokens, matchesExploratoryTokenPrefixes, tokenize } from "./lib/searchText";
import { SKILL_CAPABILITY_TAGS } from "./lib/skillCapabilityTags";
import { normalizeSkillIconValue } from "./lib/skillIcon";
import {
  fetchText,
  type PublishResult,
  publishVersionForUser,
  queueHighlightedWebhook,
} from "./lib/skillPublish";
import { getFrontmatterValue, hashSkillFiles } from "./lib/skills";
import { computeIsSuspicious, isSkillReviewFlagged, isSkillSuspicious } from "./lib/skillSafety";
import {
  digestToHydratableSkill,
  digestToOwnerInfo,
  extractDigestFields,
  upsertSkillSearchDigest,
} from "./lib/skillSearchDigest";
import { assertValidSkillSlug, normalizeSkillSlug } from "./lib/skillSlugValidator";
import { readCanonicalStat } from "./lib/skillStats";
import { runStaticPublishScan } from "./lib/staticPublishScan";
import { adjustUserSkillStatsForSkillChange } from "./lib/userSkillStats";
import schema from "./schema";

const MAX_OWNER_SUMMARY_LENGTH = 500;

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
const MAX_SKILL_CATALOG_SCAN_DOCUMENTS = 500;
const MAX_SKILL_CATALOG_SCAN_PAGES = 6;
const MAX_SKILL_CATALOG_SEARCH_PAGE_SIZE = 200;
const HARD_DELETE_BATCH_SIZE = 100;
const HARD_DELETE_VERSION_BATCH_SIZE = 10;
const HARD_DELETE_LEADERBOARD_BATCH_SIZE = 25;
const BAN_USER_SKILLS_BATCH_SIZE = 25;
const MAX_REPORT_REASON_SAMPLE = 5;
const MAX_APPEAL_MESSAGE_LENGTH = 2_000;
const RATE_LIMIT_HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_DAY_MS = 24 * RATE_LIMIT_HOUR_MS;
const SLUG_RESERVATION_DAYS = 90;
const SLUG_RESERVATION_MS = SLUG_RESERVATION_DAYS * RATE_LIMIT_DAY_MS;
const UNPUBLISHED_SLUG_RESERVATION_DAYS = 30;
const UNPUBLISHED_SLUG_RESERVATION_MS = UNPUBLISHED_SLUG_RESERVATION_DAYS * RATE_LIMIT_DAY_MS;
const MAX_SKILL_SLUG_ALIASES_PER_SKILL = 5;
const MAX_SKILL_SLUG_ALIASES_PER_OWNER = 25;
const LOW_TRUST_ACCOUNT_AGE_MS = 30 * RATE_LIMIT_DAY_MS;
const MAX_MANUAL_OVERRIDE_NOTE_LENGTH = 1200;
const DEFAULT_STAFF_AUDIT_LOG_LIMIT = 10;
const MAX_STAFF_AUDIT_LOG_LIMIT = 50;
const USER_MODERATION_REASON = "user.moderation";
const SKILL_CATALOG_CURSOR_PREFIX = "skillcat:";
const SKILL_CAPABILITY_TAG_SET = new Set<string>(SKILL_CAPABILITY_TAGS);

const vtEngineStatsValidator = v.object({
  malicious: v.optional(v.number()),
  suspicious: v.optional(v.number()),
  undetected: v.optional(v.number()),
  harmless: v.optional(v.number()),
});

const vtAnalysisValidator = v.object({
  status: v.string(),
  verdict: v.optional(v.string()),
  analysis: v.optional(v.string()),
  source: v.optional(v.string()),
  scanner: v.optional(v.string()),
  engineStats: v.optional(vtEngineStatsValidator),
  checkedAt: v.number(),
});

const depRegistryStatusValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("error"),
);

const depRegistryValidator = v.union(v.literal("pypi"), v.literal("npm"), v.literal("cargo"));

const depRegistryAnalysisValidator = v.object({
  status: depRegistryStatusValidator,
  results: v.array(
    v.object({
      name: v.string(),
      registry: depRegistryValidator,
      source: v.string(),
      exists: v.boolean(),
      httpStatus: v.optional(v.number()),
    }),
  ),
  notFoundPackages: v.array(v.string()),
  unresolvedPackages: v.array(v.string()),
  summary: v.string(),
  checkedAt: v.number(),
});

function buildStructuredModerationPatch(params: {
  staticScan?: Doc<"skillVersions">["staticScan"];
  vtAnalysis?: Doc<"skillVersions">["vtAnalysis"];
  llmAnalysis?: Doc<"skillVersions">["llmAnalysis"];
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
    vtAnalysis: params.vtAnalysis,
    vtStatus: params.vtStatus,
    llmStatus: params.llmStatus,
    llmAnalysis: params.llmAnalysis,
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

function hasReviewReasonCode(codes: readonly string[] | undefined) {
  return (codes ?? []).some((code) => code.startsWith("review."));
}

function isObviousJunkSkill(
  skill: Pick<Doc<"skills">, "slug" | "displayName" | "summary" | "isSuspicious">,
) {
  if (!skill.isSuspicious) return false;
  const slug = skill.slug.trim().toLowerCase();
  const displayName = skill.displayName.trim().toLowerCase();
  const summary = (skill.summary ?? "").trim().toLowerCase();
  if (
    /^(?:test-skill|testskill|dummy-skill|placeholder-skill|untitled-skill)(?:-[0-9a-z]+)?$/.test(
      slug,
    )
  ) {
    return true;
  }
  if (slug === "skill-tester" && displayName === "skill tester" && summary === "skill tester") {
    return true;
  }
  return (
    (displayName === "test skill" ||
      displayName === "demo skill" ||
      displayName === "dummy skill" ||
      displayName === "placeholder skill" ||
      displayName === "untitled skill") &&
    (!summary || summary === "test" || summary === "demo" || summary === "todo")
  );
}

function resolveScannerModerationReason(params: {
  vtStatus?: string;
  llmStatus?: string;
  verdict?: Doc<"skills">["moderationVerdict"];
}) {
  const vtStatus = normalizeAnalysisStatus(params.vtStatus);
  const llmStatus = normalizeAnalysisStatus(params.llmStatus);

  if (params.verdict === "clean" && (vtStatus === "suspicious" || llmStatus === "suspicious")) {
    return "scanner.aggregate.clean";
  }
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

function scannerStatusFromReasonCodes(params: {
  scanner: "vt" | "llm";
  status?: string;
  reasonCodes: readonly string[];
}) {
  const scanner = params.scanner;
  if (params.reasonCodes.includes(`malicious.${scanner}_malicious`)) return "malicious";
  if (params.reasonCodes.includes(`suspicious.${scanner}_suspicious`)) return "suspicious";

  const status = normalizeAnalysisStatus(params.status);
  return status === "malicious" || status === "suspicious" ? undefined : status;
}

function buildScannerModerationPatchFromVersion(params: {
  owner: Doc<"users"> | null | undefined;
  version: Pick<Doc<"skillVersions">, "_id" | "staticScan" | "vtAnalysis" | "llmAnalysis">;
  now: number;
}): SkillModerationPatch {
  const structuredPatch = buildStructuredModerationPatch({
    staticScan: params.version.staticScan,
    vtAnalysis: params.version.vtAnalysis,
    llmAnalysis: params.version.llmAnalysis,
    vtStatus: params.version.vtAnalysis?.status,
    llmStatus: params.version.llmAnalysis?.status,
    sourceVersionId: params.version._id,
  });

  const sourceReasonCodes = structuredPatch.moderationReasonCodes ?? [];
  const vtStatusForReason = scannerStatusFromReasonCodes({
    scanner: "vt",
    status: params.version.vtAnalysis?.status,
    reasonCodes: sourceReasonCodes,
  });
  const rawVtStatus = normalizeAnalysisStatus(params.version.vtAnalysis?.status);
  const llmStatusForReason =
    !vtStatusForReason &&
    (rawVtStatus === "malicious" || rawVtStatus === "suspicious") &&
    normalizeAnalysisStatus(params.version.llmAnalysis?.status) === "clean"
      ? undefined
      : params.version.llmAnalysis?.status;
  const sourceReason = resolveScannerModerationReason({
    vtStatus: vtStatusForReason,
    llmStatus: llmStatusForReason,
    verdict: structuredPatch.moderationVerdict,
  });
  const bypassSuspicious =
    structuredPatch.moderationVerdict === "suspicious" &&
    isPrivilegedOwnerForSuspiciousBypass(params.owner);
  const moderationReasonCodes = bypassSuspicious
    ? sourceReasonCodes.filter((code) => !code.startsWith("suspicious."))
    : sourceReasonCodes;
  const moderationVerdict = verdictFromCodes(moderationReasonCodes);
  const isReviewOnlyVerdict =
    moderationVerdict === "clean" && hasReviewReasonCode(moderationReasonCodes);
  const moderationFlags = isReviewOnlyVerdict
    ? ["flagged.review"]
    : legacyFlagsFromVerdict(moderationVerdict);
  const moderationReason = bypassSuspicious
    ? normalizeScannerSuspiciousReason(sourceReason)
    : isReviewOnlyVerdict
      ? "scanner.llm.review"
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
const MAX_FILTERED_PUBLIC_LIST_SCAN_PAGES = 12;
const MAX_FILTERED_PUBLIC_LIST_SCAN_ROWS = 500;

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

function shouldBackfillLatestSkillModeration(
  skill: Pick<
    Doc<"skills">,
    | "latestVersionId"
    | "manualOverride"
    | "moderationStatus"
    | "moderationReason"
    | "moderationSourceVersionId"
    | "softDeletedAt"
  >,
) {
  if (skill.manualOverride) return false;
  if (!shouldSyncModerationFromLatestVersion(skill)) return false;
  if (!skill.latestVersionId) return false;
  if (skill.moderationSourceVersionId === skill.latestVersionId) return false;
  return isScannerManagedReason(skill.moderationReason as string | undefined);
}

function shouldForceBackfillLatestSkillModeration(
  skill: Pick<
    Doc<"skills">,
    "latestVersionId" | "manualOverride" | "moderationStatus" | "moderationReason" | "softDeletedAt"
  >,
) {
  if (skill.manualOverride) return false;
  if (!shouldSyncModerationFromLatestVersion(skill)) return false;
  if (!skill.latestVersionId) return false;
  return isScannerManagedReason(skill.moderationReason as string | undefined);
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

function buildConflictingSkillUrl(skill: Doc<"skills">, owner: SkillOwnerRef) {
  if (!owner || owner.deletedAt || owner.deactivatedAt || !isPublicSkillDoc(skill)) return null;
  const ownerParam = owner.handle?.trim() || String(owner._id);
  if (!ownerParam) return null;
  return `/${encodeURIComponent(ownerParam)}/${encodeURIComponent(skill.slug)}`;
}

function buildSlugTakenErrorMessage(skill: Doc<"skills">, owner: SkillOwnerRef) {
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

function buildAliasTakenErrorMessage(skill: Doc<"skills">, owner: SkillOwnerRef) {
  const base = "Slug redirects to an existing skill. Choose a different slug.";
  const url = buildConflictingSkillUrl(skill, owner);
  if (!url) return base;
  return `${base} Existing skill: ${url}`;
}

function formatUnpublishedSlugReservationMessage(slug: string, expiresAt: number) {
  return (
    `Slug "${slug}" is reserved by an unpublished skill until ` +
    `${new Date(expiresAt).toISOString()}. Publish or restore it before then to keep the slug; ` +
    "after that another publisher can claim it."
  );
}

function getUnpublishedSlugReservationExpiresAt(
  skill: Pick<
    Doc<"skills">,
    "softDeletedAt" | "hiddenBy" | "ownerUserId" | "unpublishedSlugReservedUntil"
  >,
) {
  if (!skill.softDeletedAt) return null;
  if (skill.hiddenBy !== skill.ownerUserId) return null;
  if (typeof skill.unpublishedSlugReservedUntil === "number") {
    return skill.unpublishedSlugReservedUntil;
  }
  return skill.softDeletedAt + UNPUBLISHED_SLUG_RESERVATION_MS;
}

function buildReleasedUnpublishedSkillSlug(skill: Pick<Doc<"skills">, "_id">, attempt = 0) {
  const idPart = String(skill._id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = attempt > 0 ? `_${attempt}` : "";
  // The double-underscore namespace is intentionally not user-claimable by
  // the public slug validator, so released hidden rows cannot squat on public
  // slug space after their unpublished reservation expires.
  return `__unpublished_${idPart || "skill"}${suffix}`;
}

function normalizeSkillSlugKey(slug: string) {
  // Read-path normalization: lowercase + trim only. Intentionally lenient so
  // that legacy rows (pre-validator) remain lookup-able. Write paths must
  // use `normalizeSkillSlugForWrite` / `assertValidSkillSlug` instead.
  return normalizeSkillSlug(slug);
}

function slugValidationAvailabilityFailure(error: unknown) {
  const message =
    error instanceof ConvexError && typeof error.data === "string" ? error.data : "Invalid slug.";
  return {
    available: false,
    reason: /reserved|protected/i.test(message) ? ("reserved" as const) : ("taken" as const),
    message,
    url: null,
  };
}

type SkillOwnerRef =
  | {
      _id: Id<"users"> | Id<"publishers">;
      handle?: string | null;
      deletedAt?: number | null;
      deactivatedAt?: number | null;
    }
  | null
  | undefined;

function normalizeSkillSlugForWrite(slug: string) {
  // Write-path: full validation (length, pattern, reserved words,
  // no consecutive hyphens). See `lib/skillSlugValidator.ts`.
  return assertValidSkillSlug(slug);
}

async function getSkillSlugAliasBySlug(ctx: Pick<QueryCtx | MutationCtx, "db">, slug: string) {
  const normalizedSlug = normalizeSkillSlugKey(slug);
  return ctx.db
    .query("skillSlugAliases")
    .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
    .unique();
}

async function resolveRequestedAvailabilityPublisher(
  ctx: Pick<QueryCtx, "db">,
  ownerHandle: string | undefined,
) {
  const requestedHandle = normalizePublisherHandle(ownerHandle);
  if (!requestedHandle) {
    return { requestedHandle, requestedPublisher: null };
  }

  const materializedPublisher = await getPublisherByHandle(ctx, requestedHandle);
  if (materializedPublisher) {
    return { requestedHandle, requestedPublisher: materializedPublisher };
  }

  const user = await getActiveUserByHandleOrPersonalPublisher(ctx, requestedHandle);
  const fallbackPublisher = user ? await getPersonalPublisherForUserOrFallback(ctx, user) : null;
  return {
    requestedHandle,
    requestedPublisher:
      fallbackPublisher?.handle === requestedHandle ? fallbackPublisher : materializedPublisher,
  };
}

async function getSkillBySlugForAvailabilityPublisher(
  ctx: Pick<QueryCtx, "db">,
  slug: string,
  publisher: Doc<"publishers">,
) {
  const scopedSkills = await ctx.db
    .query("skills")
    .withIndex("by_owner_publisher_slug", (q) =>
      q.eq("ownerPublisherId", publisher._id).eq("slug", slug),
    )
    .take(2);
  if (scopedSkills[0]) return scopedSkills[0];

  const linkedUserId = publisher.linkedUserId;
  if (publisher.kind !== "user" || !linkedUserId) return null;

  const legacySkills = await ctx.db
    .query("skills")
    .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", linkedUserId).eq("slug", slug))
    .take(2);
  return (
    legacySkills.find(
      (skill) => !skill.ownerPublisherId || skill.ownerPublisherId === publisher._id,
    ) ?? null
  );
}

async function getUnscopedSkillBySlugForAvailability(ctx: Pick<QueryCtx, "db">, slug: string) {
  const skills = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .take(2);
  return {
    skill: skills.length === 1 ? skills[0] : null,
    ambiguous: skills.length > 1,
  };
}

async function getUnscopedSkillSlugAliasBySlugForAvailability(
  ctx: Pick<QueryCtx, "db">,
  slug: string,
) {
  const aliases = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .take(2);
  return {
    alias: aliases.length === 1 ? aliases[0] : null,
    ambiguous: aliases.length > 1,
  };
}

async function getSkillSlugAliasBySlugForAvailabilityPublisher(
  ctx: Pick<QueryCtx, "db">,
  slug: string,
  publisher: Doc<"publishers">,
) {
  const scopedAliases = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_owner_publisher_slug", (q) =>
      q.eq("ownerPublisherId", publisher._id).eq("slug", slug),
    )
    .take(2);
  if (scopedAliases[0]) return scopedAliases[0];

  if (publisher.kind !== "user" || !publisher.linkedUserId) return null;
  const linkedUserId = publisher.linkedUserId;

  const legacyAliases = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", linkedUserId).eq("slug", slug))
    .take(2);
  return (
    legacyAliases.find(
      (alias) => !alias.ownerPublisherId || alias.ownerPublisherId === publisher._id,
    ) ?? null
  );
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

function sameSkillSlugAliasOwner(
  alias: Pick<Doc<"skillSlugAliases">, "ownerUserId" | "ownerPublisherId">,
  ownerUserId: Id<"users">,
  ownerPublisherId: Id<"publishers"> | undefined,
) {
  return (
    alias.ownerUserId === ownerUserId &&
    (alias.ownerPublisherId ?? null) === (ownerPublisherId ?? null)
  );
}

async function countSkillSlugAliasesForOwnerQuota(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  ownerUserId: Id<"users">,
  ownerPublisherId: Id<"publishers"> | undefined,
) {
  if (ownerPublisherId) {
    const aliases = await ctx.db
      .query("skillSlugAliases")
      .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", ownerPublisherId))
      .take(MAX_SKILL_SLUG_ALIASES_PER_OWNER + 1);
    return aliases.length;
  }

  const aliases = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .take(MAX_SKILL_SLUG_ALIASES_PER_OWNER + 1);
  return aliases.length;
}

async function assertSkillSlugAliasQuota(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  params: {
    targetSkillId: Id<"skills">;
    ownerUserId: Id<"users">;
    ownerPublisherId: Id<"publishers"> | undefined;
    currentSkillAliasCount?: number;
    addedSkillAliases: number;
    removedSkillAliases?: number;
    addedOwnerAliases: number;
    removedOwnerAliases?: number;
  },
) {
  const addedSkillAliases = Math.max(0, params.addedSkillAliases);
  const removedSkillAliases = Math.max(0, params.removedSkillAliases ?? 0);
  const addedOwnerAliases = Math.max(0, params.addedOwnerAliases);
  const removedOwnerAliases = Math.max(0, params.removedOwnerAliases ?? 0);

  const currentSkillAliasCount =
    params.currentSkillAliasCount ??
    (await listSkillSlugAliasesForSkill(ctx, params.targetSkillId)).length;
  const nextSkillAliasCount =
    Math.max(0, currentSkillAliasCount - removedSkillAliases) + addedSkillAliases;
  if (nextSkillAliasCount > MAX_SKILL_SLUG_ALIASES_PER_SKILL) {
    throw new ConvexError(
      "Too many historical slugs are already reserved for this skill. " +
        `A skill can keep at most ${MAX_SKILL_SLUG_ALIASES_PER_SKILL} old slug redirects. ` +
        "Contact support@openclaw.ai if this is a legitimate migration.",
    );
  }

  if (addedOwnerAliases === 0 && removedOwnerAliases === 0) return;

  const currentOwnerAliasCount = await countSkillSlugAliasesForOwnerQuota(
    ctx,
    params.ownerUserId,
    params.ownerPublisherId,
  );
  const nextOwnerAliasCount =
    Math.max(0, currentOwnerAliasCount - removedOwnerAliases) + addedOwnerAliases;
  if (nextOwnerAliasCount > MAX_SKILL_SLUG_ALIASES_PER_OWNER) {
    throw new ConvexError(
      "Too many historical slugs are already reserved by this owner. " +
        `An owner can keep at most ${MAX_SKILL_SLUG_ALIASES_PER_OWNER} old slug redirects. ` +
        "Contact support@openclaw.ai if this is a legitimate migration.",
    );
  }
}

async function releaseExpiredUnpublishedSkillSlug(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  now: number,
  actorUserId: Id<"users">,
) {
  const reservedUntil = getUnpublishedSlugReservationExpiresAt(skill);
  if (reservedUntil === null || reservedUntil > now) return false;

  let releasedSlug: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = buildReleasedUnpublishedSkillSlug(skill, attempt);
    const [conflictingSkills, conflictingAliases] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", candidate))
        .take(1),
      ctx.db
        .query("skillSlugAliases")
        .withIndex("by_slug", (q) => q.eq("slug", candidate))
        .take(1),
    ]);
    const conflictingSkill = conflictingSkills.find(
      (candidateSkill) => candidateSkill._id !== skill._id,
    );
    if (!conflictingSkill && conflictingAliases.length === 0) {
      releasedSlug = candidate;
      break;
    }
  }
  if (!releasedSlug) {
    throw new ConvexError("Unable to release expired unpublished slug without a slug collision.");
  }

  await ctx.db.patch(skill._id, {
    slug: releasedSlug,
    unpublishedOriginalSlug: skill.unpublishedOriginalSlug ?? skill.slug,
    unpublishedSlugReservedUntil: undefined,
    unpublishedSlugReleasedAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId,
    action: "skill.slug.unpublished_release",
    targetType: "skill",
    targetId: skill._id,
    metadata: {
      from: skill.slug,
      to: releasedSlug,
      previousOwnerUserId: skill.ownerUserId,
      reservedUntil,
    },
    createdAt: now,
  });
  return true;
}

async function resolveSkillBySlugOrAlias(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  slug: string,
  options: { includeSoftDeleted?: boolean } = {},
) {
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
  if (directSkill && (options.includeSoftDeleted || !directSkill.softDeletedAt)) {
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
  if (!skill || (!options.includeSoftDeleted && skill.softDeletedAt)) {
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
  if (!reason.startsWith("scanner.")) return reason;
  if (reason.endsWith(".suspicious")) {
    return `${reason.slice(0, -".suspicious".length)}.clean`;
  }
  if (reason.endsWith(".malicious")) {
    return `${reason.slice(0, -".malicious".length)}.clean`;
  }
  return reason;
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
    await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);
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

async function loadPublicSkillReference(ctx: QueryCtx, skillId: Id<"skills"> | null | undefined) {
  if (!skillId) return null;
  const skill = await ctx.db.get(skillId);
  if (!isPublicSkillDoc(skill)) return null;

  const owner = toPublicPublisher(
    await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    }),
  );
  if (!owner) return null;

  return { skill, owner };
}

type PublicSkillListVersion = Pick<
  Doc<"skillVersions">,
  "_id" | "_creationTime" | "version" | "createdAt" | "changelog" | "changelogSource"
> & {
  parsed?: PublicSkillVersionParsed;
};

type PublicSkillVersionParsed = {
  license?: typeof PLATFORM_SKILL_LICENSE;
  description?: string;
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
  capabilityTags?: string[];
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
  clawScanNote?: string;
};

type ManagementSkillEntry = {
  skill: Doc<"skills">;
  latestVersion: Doc<"skillVersions"> | null;
  owner: Doc<"users"> | null;
};

type DashboardSkillListItem = {
  _id: Id<"skills">;
  _creationTime: number;
  slug: string;
  displayName: string;
  summary?: string;
  ownerUserId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  canonicalSkillId?: Id<"skills">;
  forkOf?: Doc<"skills">["forkOf"];
  latestVersionId?: Id<"skillVersions">;
  tags: Doc<"skills">["tags"];
  capabilityTags?: string[];
  badges: Doc<"skills">["badges"];
  stats: Doc<"skills">["stats"];
  moderationStatus?: Doc<"skills">["moderationStatus"];
  moderationReason?: string;
  moderationVerdict?: Doc<"skills">["moderationVerdict"];
  moderationFlags?: string[];
  isSuspicious?: boolean;
  pendingReview?: true;
  qualityDecision?: NonNullable<Doc<"skills">["quality"]>["decision"];
  latestVersion: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  } | null;
  createdAt: number;
  updatedAt: number;
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
  const description = version.parsed?.frontmatter
    ? getFrontmatterValue(version.parsed.frontmatter, "description")?.trim()
    : undefined;
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
      contentType: normalizeTextContentType(file.path, file.contentType),
    })),
    parsed: version.parsed
      ? {
          license: version.parsed.license,
          ...(description ? { description } : {}),
          clawdis: version.parsed.clawdis,
        }
      : undefined,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    softDeletedAt: version.softDeletedAt,
    capabilityTags: version.capabilityTags,
    sha256hash: version.sha256hash,
    vtAnalysis: version.vtAnalysis,
    llmAnalysis: version.llmAnalysis,
    clawScanNote: version.clawScanNote,
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

async function toDashboardSkillListItem(
  ctx: QueryCtx,
  skill: Doc<"skills"> & { badges?: Doc<"skills">["badges"] },
): Promise<DashboardSkillListItem> {
  const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
  const stats = {
    ...skill.stats,
    downloads: readCanonicalStat(skill, "downloads"),
    stars: readCanonicalStat(skill, "stars"),
    installsCurrent: readCanonicalStat(skill, "installsCurrent"),
    installsAllTime: readCanonicalStat(skill, "installsAllTime"),
  };

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
    capabilityTags: skill.capabilityTags,
    badges: skill.badges,
    stats,
    moderationStatus: skill.moderationStatus,
    moderationReason: skill.moderationReason,
    moderationVerdict: skill.moderationVerdict,
    moderationFlags: skill.moderationFlags,
    isSuspicious: skill.isSuspicious,
    pendingReview:
      skill.moderationStatus === "hidden" &&
      (skill.moderationReason === "pending.scan" || skill.moderationReason === "pending.scan.stale")
        ? true
        : undefined,
    qualityDecision: skill.quality?.decision,
    latestVersion:
      latestVersion && !latestVersion.softDeletedAt
        ? {
            version: latestVersion.version,
            createdAt: latestVersion.createdAt,
            vtStatus: latestVersion.vtAnalysis?.status ?? null,
            llmStatus: latestVersion.llmAnalysis?.status ?? null,
            staticScanStatus: latestVersion.staticScan?.status ?? null,
          }
        : null,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
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

    const userId = await getOptionalActiveAuthUserId(ctx);
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

    const forkOf = await loadPublicSkillReference(ctx, skill.forkOf?.skillId);
    const canonical = await loadPublicSkillReference(ctx, skill.canonicalSkillId);

    const publicSkill = toPublicSkill({ ...skill, badges });

    // Determine moderation state
    const overrideActive = Boolean(skill.manualOverride);
    const isPendingScan =
      skill.moderationStatus === "hidden" && skill.moderationReason === "pending.scan";
    const isMalwareBlocked = skill.moderationFlags?.includes("blocked.malware") ?? false;
    const isSuspicious = skill.moderationFlags?.includes("flagged.suspicious") ?? false;
    const isReviewFlagged = isSkillReviewFlagged(skill);
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
    const responseSkillData = {
      ...skillData,
      canonicalSkillId: canonical ? skillData.canonicalSkillId : undefined,
      forkOf: forkOf ? skillData.forkOf : undefined,
    };

    // Moderation info - visible to owners for all states, or anyone for flagged skills (transparency)
    const showModerationInfo =
      isOwner || isMalwareBlocked || isSuspicious || isReviewFlagged || overrideActive;
    const publicModerationSummary =
      !isOwner && overrideActive && !isMalwareBlocked && !isSuspicious
        ? "Security findings were reviewed by moderators and cleared for public use."
        : skill.moderationSummary;
    const moderationInfo = showModerationInfo
      ? {
          isPendingScan,
          isMalwareBlocked,
          isSuspicious,
          isReviewFlagged,
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
      skill: responseSkillData,
      latestVersion,
      owner,
      pendingReview: isOwner && isPendingScan,
      moderationInfo,
      forkOf: forkOf
        ? {
            kind: skill.forkOf?.kind ?? "fork",
            version: skill.forkOf?.version ?? null,
            skill: {
              slug: forkOf.skill.slug,
              displayName: forkOf.skill.displayName,
            },
            owner: {
              handle: forkOf.owner.handle ?? null,
              userId: forkOf.owner.linkedUserId ?? null,
            },
          }
        : null,
      canonical: canonical
        ? {
            skill: {
              slug: canonical.skill.slug,
              displayName: canonical.skill.displayName,
            },
            owner: {
              handle: canonical.owner.handle ?? null,
              userId: canonical.owner.linkedUserId ?? null,
            },
          }
        : null,
    };
  },
});

export const checkSlugAvailability = query({
  args: { slug: v.string(), ownerHandle: v.optional(v.string()) },
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

    const { requestedHandle, requestedPublisher } = await resolveRequestedAvailabilityPublisher(
      ctx,
      args.ownerHandle,
    );
    const unscopedSkillResult = await getUnscopedSkillBySlugForAvailability(ctx, slug);
    const scopedSkill = requestedPublisher
      ? await getSkillBySlugForAvailabilityPublisher(ctx, slug, requestedPublisher)
      : null;
    const skill = scopedSkill ?? unscopedSkillResult.skill;

    if (!scopedSkill && unscopedSkillResult.ambiguous) {
      return {
        available: false,
        reason: "taken" as const,
        message: "Slug is already used by multiple publishers. Choose a specific owner.",
        url: null,
      };
    }

    if (!skill) {
      const scopedAlias = requestedPublisher
        ? await getSkillSlugAliasBySlugForAvailabilityPublisher(ctx, slug, requestedPublisher)
        : null;
      const unscopedAliasResult = scopedAlias
        ? null
        : await getUnscopedSkillSlugAliasBySlugForAvailability(ctx, slug);
      if (!scopedAlias && unscopedAliasResult?.ambiguous) {
        return {
          available: false,
          reason: "taken" as const,
          message: "Slug redirects to skills under multiple publishers. Choose a specific owner.",
          url: null,
        };
      }
      const alias = scopedAlias ?? unscopedAliasResult?.alias;
      if (alias) {
        const aliasedSkill = await ctx.db.get(alias.skillId);
        const owner = aliasedSkill
          ? await getOwnerPublisher(ctx, {
              ownerPublisherId: aliasedSkill.ownerPublisherId,
              ownerUserId: aliasedSkill.ownerUserId,
            })
          : null;
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
      try {
        assertValidSkillSlug(slug);
      } catch (error) {
        return slugValidationAvailabilityFailure(error);
      }
      return {
        available: true,
        reason: "available" as const,
        message: null,
        url: null,
      };
    }

    const unpublishedReservationExpiresAt = getUnpublishedSlugReservationExpiresAt(skill);
    if (
      skill.softDeletedAt &&
      unpublishedReservationExpiresAt !== null &&
      (!userId || skill.ownerUserId !== userId)
    ) {
      if (unpublishedReservationExpiresAt <= Date.now()) {
        try {
          assertValidSkillSlug(slug);
        } catch (error) {
          return slugValidationAvailabilityFailure(error);
        }
        return {
          available: true,
          reason: "available" as const,
          message: null,
          url: null,
        };
      }
      return {
        available: false,
        reason: "reserved" as const,
        message: formatUnpublishedSlugReservationMessage(slug, unpublishedReservationExpiresAt),
        url: null,
      };
    }

    const requestedPublisherMatchesSkill = requestedPublisher
      ? skill.ownerPublisherId
        ? requestedPublisher._id === skill.ownerPublisherId
        : requestedPublisher.kind === "user" &&
          requestedPublisher.linkedUserId === skill.ownerUserId
      : !requestedHandle;

    if (userId && skill.ownerUserId === userId && requestedPublisherMatchesSkill) {
      return {
        available: true,
        reason: "available" as const,
        message: null,
        url: null,
      };
    }
    if (userId && skill.ownerPublisherId && requestedPublisherMatchesSkill) {
      const membership = await getPublisherMembership(ctx, skill.ownerPublisherId, userId);
      if (membership && isPublisherRoleAllowed(membership.role, ["publisher"])) {
        return {
          available: true,
          reason: "available" as const,
          message: null,
          url: null,
        };
      }
    }

    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    });
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
    const ownerPublisher = await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    });
    const owner = toPublicPublisher(ownerPublisher);
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
      const userId = await getOptionalActiveAuthUserId(ctx);
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
        membership ||
        (userId && ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId === userId),
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
        return await Promise.all(
          withBadges.map(async (skill) => await toDashboardSkillListItem(ctx, skill)),
        );
      }

      const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
      return visibleSkills
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    }
    const ownerUserId = args.ownerUserId;
    if (ownerUserId) {
      const userId = await getOptionalActiveAuthUserId(ctx);
      const isOwnDashboard = Boolean(userId && userId === ownerUserId);
      const entries = await ctx.db
        .query("skills")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
        .order("desc")
        .take(takeLimit);
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit);
      const withBadges = await attachBadgesToSkills(ctx, filtered);

      if (isOwnDashboard) {
        return await Promise.all(
          withBadges.map(async (skill) => await toDashboardSkillListItem(ctx, skill)),
        );
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

async function mapDashboardSkillPage(
  ctx: QueryCtx,
  skills: Doc<"skills">[],
  isOwnDashboard: boolean,
) {
  const withBadges = await attachBadgesToSkills(ctx, skills);

  if (isOwnDashboard) {
    return await Promise.all(
      withBadges.map(async (skill) => await toDashboardSkillListItem(ctx, skill)),
    );
  }

  const visibleSkills = await filterSkillsByActiveOwner(ctx, withBadges);
  return visibleSkills
    .map((skill) => toPublicSkill(skill))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
}

export const listDashboardPaginated = query({
  args: {
    ownerUserId: v.optional(v.id("users")),
    ownerPublisherId: v.optional(v.id("publishers")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const ownerPublisherId = args.ownerPublisherId;
    if (ownerPublisherId) {
      const userId = await getOptionalActiveAuthUserId(ctx);
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
        membership ||
        (userId && ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId === userId),
      );

      const result =
        isOwnDashboard && ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId
          ? await ctx.db
              .query("skills")
              .withIndex("by_owner_active_updated", (q) =>
                q.eq("ownerUserId", ownerPublisher.linkedUserId!).eq("softDeletedAt", undefined),
              )
              .order("desc")
              .paginate(args.paginationOpts)
          : await ctx.db
              .query("skills")
              .withIndex("by_owner_publisher_active_updated", (q) =>
                q.eq("ownerPublisherId", ownerPublisherId).eq("softDeletedAt", undefined),
              )
              .order("desc")
              .paginate(args.paginationOpts);
      const page = await mapDashboardSkillPage(ctx, result.page, isOwnDashboard);
      return { ...result, page };
    }

    const ownerUserId = args.ownerUserId;
    if (ownerUserId) {
      const userId = await getOptionalActiveAuthUserId(ctx);
      const isOwnDashboard = Boolean(userId && userId === ownerUserId);
      const result = await ctx.db
        .query("skills")
        .withIndex("by_owner_active_updated", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("softDeletedAt", undefined),
        )
        .order("desc")
        .paginate(args.paginationOpts);
      const page = await mapDashboardSkillPage(ctx, result.page, isOwnDashboard);
      return { ...result, page };
    }

    return { page: [], isDone: true as const, continueCursor: "" };
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
    if (report.status && report.status !== "open") continue;
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
    const reportId = await ctx.db.insert("skillReports", {
      skillId: args.skillId,
      ...(skill.latestVersionId ? { skillVersionId: skill.latestVersionId } : {}),
      userId,
      reason: reason.slice(0, MAX_REPORT_REASON_LENGTH),
      status: "open",
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
        unpublishedSlugReservedUntil: undefined,
        unpublishedSlugReleasedAt: undefined,
        unpublishedOriginalSlug: undefined,
      });
    }

    const nextSkill = { ...skill, ...updates };
    await ctx.db.patch(skill._id, updates);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
    await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);

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

    await appendSkillModerationEventLog(ctx, {
      kind: "report",
      reportId,
      actorUserId: userId,
      action: "skill.report.submit",
      timelineMetadata: { skillId: skill._id, reportCount: nextReportCount },
      auditAction: "skill.report",
      auditTargetType: "skill",
      auditTargetId: skill._id,
      auditMetadata: { reportId, slug: skill.slug, reportCount: nextReportCount },
      createdAt: now,
    });

    return { ok: true as const, reported: true, alreadyReported: false, reportId };
  },
});

export const reportSkillForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    reason: v.string(),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

    const resolved = await resolveSkillBySlugOrAlias(ctx, args.slug);
    const skill = resolved.skill;
    if (!skill || skill.softDeletedAt || skill.moderationStatus === "removed") {
      throw new ConvexError("Skill not found");
    }
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Report reason required.");

    const version = args.version?.trim();
    const skillVersion = version
      ? await ctx.db
          .query("skillVersions")
          .withIndex("by_skill_version", (q) => q.eq("skillId", skill._id).eq("version", version))
          .unique()
      : skill.latestVersionId
        ? await ctx.db.get(skill.latestVersionId)
        : null;
    if (version && (!skillVersion || skillVersion.softDeletedAt)) {
      throw new ConvexError("Skill version not found");
    }

    const existing = await ctx.db
      .query("skillReports")
      .withIndex("by_skill_user", (q) => q.eq("skillId", skill._id).eq("userId", actor._id))
      .unique();
    if (existing) {
      if ((existing.status ?? "open") !== "open") {
        const activeReports = await countActiveReportsForUser(ctx, actor._id);
        if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
          throw new ConvexError(
            "Report limit reached. Please wait for moderation before reporting more.",
          );
        }
        const now = Date.now();
        await ctx.db.patch(existing._id, {
          ...(skillVersion
            ? { skillVersionId: skillVersion._id, version: skillVersion.version }
            : {}),
          reason: reason.slice(0, MAX_REPORT_REASON_LENGTH),
          status: "open",
          triagedAt: undefined,
          triagedBy: undefined,
          triageNote: undefined,
          createdAt: now,
        });
        const nextReportCount = (skill.reportCount ?? 0) + 1;
        await ctx.db.patch(skill._id, {
          reportCount: nextReportCount,
          lastReportedAt: now,
          updatedAt: now,
        });
        await appendSkillModerationEventLog(ctx, {
          kind: "report",
          reportId: existing._id,
          actorUserId: actor._id,
          action: "skill.report.reopen",
          timelineMetadata: { skillId: skill._id, reportCount: nextReportCount },
          auditAction: "skill.report.reopen",
          auditTargetType: "skill",
          auditTargetId: skill._id,
          auditMetadata: {
            reportId: existing._id,
            slug: skill.slug,
            version: skillVersion?.version ?? version ?? null,
            reportCount: nextReportCount,
          },
          createdAt: now,
        });
        return {
          ok: true as const,
          reported: true,
          alreadyReported: false,
          reportId: existing._id,
          skillId: skill._id,
          reportCount: nextReportCount,
        };
      }
      return {
        ok: true as const,
        reported: false,
        alreadyReported: true,
        reportId: existing._id,
        skillId: skill._id,
        reportCount: skill.reportCount ?? 0,
      };
    }

    const activeReports = await countActiveReportsForUser(ctx, actor._id);
    if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
      throw new ConvexError(
        "Report limit reached. Please wait for moderation before reporting more.",
      );
    }

    const now = Date.now();
    const reportId = await ctx.db.insert("skillReports", {
      skillId: skill._id,
      ...(skillVersion ? { skillVersionId: skillVersion._id, version: skillVersion.version } : {}),
      userId: actor._id,
      reason: reason.slice(0, MAX_REPORT_REASON_LENGTH),
      status: "open",
      createdAt: now,
    });
    const nextReportCount = (skill.reportCount ?? 0) + 1;
    await ctx.db.patch(skill._id, {
      reportCount: nextReportCount,
      lastReportedAt: now,
      updatedAt: now,
    });
    await appendSkillModerationEventLog(ctx, {
      kind: "report",
      reportId,
      actorUserId: actor._id,
      action: "skill.report.submit",
      timelineMetadata: { skillId: skill._id, reportCount: nextReportCount },
      auditAction: "skill.report",
      auditTargetType: "skill",
      auditTargetId: skill._id,
      auditMetadata: {
        reportId,
        slug: skill.slug,
        version: skillVersion?.version ?? version ?? null,
        reportCount: nextReportCount,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      reported: true,
      alreadyReported: false,
      reportId,
      skillId: skill._id,
      reportCount: nextReportCount,
    };
  },
});

type SkillReportStatus = "open" | "confirmed" | "dismissed";
type SkillAppealStatus = "open" | "accepted" | "rejected";
type SkillReportFinalAction = "none" | "hide";
type SkillAppealFinalAction = "none" | "restore";

type SkillReportListItem = {
  reportId: Id<"skillReports">;
  skillId: Id<"skills">;
  skillVersionId?: Id<"skillVersions"> | null;
  slug: string;
  displayName: string;
  version?: string | null;
  reason?: string | null;
  status: SkillReportStatus;
  createdAt: number;
  reporter: {
    userId: Id<"users">;
    handle?: string | null;
    displayName?: string | null;
  };
  triagedAt?: number | null;
  triagedBy?: Id<"users"> | null;
  triageNote?: string | null;
  actionTaken?: SkillReportFinalAction | null;
};

type SkillAppealListItem = {
  appealId: Id<"skillAppeals">;
  skillId: Id<"skills">;
  skillVersionId?: Id<"skillVersions"> | null;
  slug: string;
  displayName: string;
  version?: string | null;
  message: string;
  status: SkillAppealStatus;
  createdAt: number;
  submitter: {
    userId: Id<"users">;
    handle?: string | null;
    displayName?: string | null;
  };
  resolvedAt?: number | null;
  resolvedBy?: Id<"users"> | null;
  resolutionNote?: string | null;
  actionTaken?: SkillAppealFinalAction | null;
};

function toSkillReportListItem(
  skillReport: Doc<"skillReports">,
  skill: Doc<"skills">,
  reporter: Doc<"users"> | null,
): SkillReportListItem {
  return {
    reportId: skillReport._id,
    skillId: skill._id,
    skillVersionId: skillReport.skillVersionId ?? null,
    slug: skill.slug,
    displayName: skill.displayName,
    version: skillReport.version ?? null,
    reason: skillReport.reason ?? null,
    status: readArtifactReportStatus(skillReport.status),
    createdAt: skillReport.createdAt,
    reporter: {
      userId: skillReport.userId,
      handle: reporter?.handle ?? null,
      displayName: reporter?.displayName ?? reporter?.name ?? null,
    },
    triagedAt: skillReport.triagedAt ?? null,
    triagedBy: skillReport.triagedBy ?? null,
    triageNote: skillReport.triageNote ?? null,
    actionTaken: skillReport.actionTaken ?? null,
  };
}

function toSkillAppealListItem(
  appeal: Doc<"skillAppeals">,
  skill: Doc<"skills">,
  submitter: Doc<"users"> | null,
): SkillAppealListItem {
  return {
    appealId: appeal._id,
    skillId: skill._id,
    skillVersionId: appeal.skillVersionId ?? null,
    slug: skill.slug,
    displayName: skill.displayName,
    version: appeal.version ?? null,
    message: appeal.message,
    status: appeal.status,
    createdAt: appeal.createdAt,
    submitter: {
      userId: appeal.userId,
      handle: submitter?.handle ?? null,
      displayName: submitter?.displayName ?? submitter?.name ?? null,
    },
    resolvedAt: appeal.resolvedAt ?? null,
    resolvedBy: appeal.resolvedBy ?? null,
    resolutionNote: appeal.resolutionNote ?? null,
    actionTaken: appeal.actionTaken ?? null,
  };
}

async function applySkillReportFinalAction(
  ctx: MutationCtx,
  params: {
    actorUserId: Id<"users">;
    skill: Doc<"skills">;
    action: SkillReportFinalAction;
    note: string;
    reportId: Id<"skillReports">;
    now: number;
  },
) {
  if (params.action === "none") return;

  const patch: Partial<Doc<"skills">> = {
    softDeletedAt: params.now,
    moderationStatus: "hidden",
    moderationReason: "manual.report",
    moderationNotes: trimManualOverrideNote(params.note),
    hiddenAt: params.now,
    hiddenBy: params.actorUserId,
    unpublishedSlugReservedUntil: undefined,
    unpublishedSlugReleasedAt: undefined,
    unpublishedOriginalSlug: undefined,
    lastReviewedAt: params.now,
    updatedAt: params.now,
  };
  const nextSkill = { ...params.skill, ...patch };
  await ctx.db.patch(params.skill._id, patch);
  await adjustGlobalPublicCountForSkillChange(ctx, params.skill, nextSkill);
  await setSkillEmbeddingsSoftDeleted(ctx, params.skill._id, true, params.now);

  await ctx.db.insert("auditLogs", {
    actorUserId: params.actorUserId,
    action: "skill.report.final_action",
    targetType: "skill",
    targetId: params.skill._id,
    metadata: {
      slug: params.skill.slug,
      reportId: params.reportId,
      finalAction: params.action,
      reason: patch.moderationNotes,
    },
    createdAt: params.now,
  });
}

async function applySkillAppealFinalAction(
  ctx: MutationCtx,
  params: {
    actorUserId: Id<"users">;
    skill: Doc<"skills">;
    action: SkillAppealFinalAction;
    note: string;
    appealId: Id<"skillAppeals">;
    now: number;
  },
) {
  if (params.action === "none") return;

  const manualOverride = buildManualOverrideRecord({
    note: params.note,
    reviewerUserId: params.actorUserId,
    updatedAt: params.now,
  });
  const moderationPatch = applyManualOverrideToSkillPatch({
    basePatch: buildPreservedSkillModerationPatch(params.skill),
    override: manualOverride,
    now: params.now,
  });
  const patch: Partial<Doc<"skills">> = {
    ...moderationPatch,
    manualOverride,
    softDeletedAt: undefined,
    moderationStatus: "active",
    hiddenAt: undefined,
    hiddenBy: undefined,
    lastReviewedAt: params.now,
    updatedAt: params.now,
  };
  const nextSkill = { ...params.skill, ...patch };
  await ctx.db.patch(params.skill._id, patch);
  await adjustGlobalPublicCountForSkillChange(ctx, params.skill, nextSkill);
  await setSkillEmbeddingsSoftDeleted(ctx, params.skill._id, false, params.now);

  await ctx.db.insert("auditLogs", {
    actorUserId: params.actorUserId,
    action: "skill.appeal.final_action",
    targetType: "skill",
    targetId: params.skill._id,
    metadata: {
      slug: params.skill.slug,
      appealId: params.appealId,
      finalAction: params.action,
      reason: manualOverride.note,
    },
    createdAt: params.now,
  });
}

async function canUserAppealSkill(ctx: MutationCtx, skill: Doc<"skills">, userId: Id<"users">) {
  if (skill.ownerUserId === userId) return true;
  if (!skill.ownerPublisherId) return false;
  const member = await ctx.db
    .query("publisherMembers")
    .withIndex("by_publisher_user", (q) =>
      q.eq("publisherId", skill.ownerPublisherId!).eq("userId", userId),
    )
    .unique();
  return Boolean(member);
}

async function getActiveSkillVersionForAppeal(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  version: string | undefined,
) {
  if (version?.trim()) {
    const skillVersion = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_version", (q) => q.eq("skillId", skill._id).eq("version", version))
      .unique();
    if (!skillVersion || skillVersion.softDeletedAt)
      throw new ConvexError("Skill version not found");
    return skillVersion;
  }
  return skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
}

// Deprecated compatibility path. First-class appeal intake is no longer exposed
// in the CLI/docs; keep this route backed until legacy clients age out.
export const submitSkillAppealForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

    const resolved = await resolveSkillBySlugOrAlias(ctx, args.slug, {
      includeSoftDeleted: true,
    });
    const skill = resolved.skill;
    if (!skill) throw new ConvexError("Skill not found");
    if (!(await canUserAppealSkill(ctx, skill, actor._id))) throw new ConvexError("Unauthorized");

    const isAppealable =
      skill.softDeletedAt ||
      skill.moderationStatus === "hidden" ||
      skill.moderationStatus === "removed" ||
      skill.moderationVerdict === "suspicious" ||
      skill.moderationVerdict === "malicious" ||
      (skill.moderationReasonCodes?.length ?? 0) > 0 ||
      (skill.moderationFlags?.length ?? 0) > 0;
    if (!isAppealable) throw new ConvexError("Skill is not in an appealable state");

    const message = args.message.trim();
    if (!message) throw new ConvexError("Appeal message required.");
    const version = args.version?.trim();
    const skillVersion = await getActiveSkillVersionForAppeal(ctx, skill, version);

    const existingOpenAppeal = await ctx.db
      .query("skillAppeals")
      .withIndex("by_skill_status_createdAt", (q) =>
        q.eq("skillId", skill._id).eq("status", "open"),
      )
      .order("desc")
      .first();
    if (existingOpenAppeal) {
      return {
        ok: true as const,
        submitted: false,
        alreadyOpen: true,
        appealId: existingOpenAppeal._id,
        skillId: skill._id,
        status: existingOpenAppeal.status,
      };
    }

    const now = Date.now();
    const appealId = await ctx.db.insert("skillAppeals", {
      skillId: skill._id,
      ...(skillVersion ? { skillVersionId: skillVersion._id, version: skillVersion.version } : {}),
      userId: actor._id,
      message: message.slice(0, MAX_APPEAL_MESSAGE_LENGTH),
      status: "open",
      createdAt: now,
    });

    await appendSkillModerationEventLog(ctx, {
      kind: "appeal",
      appealId,
      actorUserId: actor._id,
      action: "skill.appeal.submit",
      timelineMetadata: {
        skillId: skill._id,
        slug: skill.slug,
        moderationStatus: skill.moderationStatus ?? "active",
        moderationVerdict: skill.moderationVerdict ?? null,
      },
      auditAction: "skill.appeal.submit",
      auditTargetType: "skillAppeal",
      auditTargetId: appealId,
      auditMetadata: {
        skillId: skill._id,
        slug: skill.slug,
        version: skillVersion?.version ?? null,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      submitted: true,
      alreadyOpen: false,
      appealId,
      skillId: skill._id,
      status: "open" as const,
    };
  },
});

export const listSkillReportsInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("confirmed"), v.literal("dismissed"), v.literal("all")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertModerator(actor);

    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 25), 100));
    const status = args.status ?? "open";
    const reportQuery =
      status === "all" || status === "open"
        ? ctx.db.query("skillReports").withIndex("by_createdAt", (q) => q)
        : ctx.db
            .query("skillReports")
            .withIndex("by_status_createdAt", (q) => q.eq("status", status));
    const page = await reportQuery.order("desc").paginate({
      cursor: args.cursor ?? null,
      numItems: limit,
    });

    const items: SkillReportListItem[] = [];
    for (const skillReport of page.page) {
      if (status === "open" && (skillReport.status ?? "open") !== "open") continue;
      const skill = await ctx.db.get(skillReport.skillId);
      if (!skill) continue;
      const reporter = await ctx.db.get(skillReport.userId);
      items.push(toSkillReportListItem(skillReport, skill, reporter));
    }

    return { items, nextCursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});

export const triageSkillReportForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    reportId: v.id("skillReports"),
    status: v.union(v.literal("open"), v.literal("confirmed"), v.literal("dismissed")),
    note: v.optional(v.string()),
    finalAction: v.optional(v.union(v.literal("none"), v.literal("hide"))),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertModerator(actor);

    const skillReport = await ctx.db.get(args.reportId);
    if (!skillReport) throw new ConvexError("Skill report not found");
    const skill = await ctx.db.get(skillReport.skillId);
    if (!skill) throw new ConvexError("Skill report not found");

    const now = Date.now();
    const previousStatus = readArtifactReportStatus(skillReport.status);
    const nextStatus = args.status;
    assertArtifactReportTransition(previousStatus, nextStatus);
    const wasOpen = previousStatus === "open";
    const willBeOpen = nextStatus === "open";
    const note = args.note?.trim();
    if (!willBeOpen && !note) throw new ConvexError("Review note required.");
    const finalAction = args.finalAction ?? "none";
    assertArtifactReportFinalAction(nextStatus, finalAction, ["hide"]);

    await ctx.db.patch(skillReport._id, {
      status: nextStatus,
      triagedAt: willBeOpen ? undefined : now,
      triagedBy: willBeOpen ? undefined : actor._id,
      triageNote: willBeOpen ? undefined : note?.slice(0, MAX_REPORT_REASON_LENGTH),
      actionTaken: willBeOpen ? undefined : finalAction,
    });

    let reportCount = skill.reportCount ?? 0;
    if (wasOpen && !willBeOpen) reportCount = Math.max(0, reportCount - 1);
    if (!wasOpen && willBeOpen) reportCount += 1;
    if (reportCount !== (skill.reportCount ?? 0)) {
      await ctx.db.patch(skill._id, {
        reportCount,
        ...(willBeOpen ? { lastReportedAt: now } : {}),
        updatedAt: now,
      });
    }

    await applySkillReportFinalAction(ctx, {
      actorUserId: actor._id,
      skill,
      action: finalAction,
      note: note ?? "",
      reportId: skillReport._id,
      now,
    });

    await appendSkillModerationEventLog(ctx, {
      kind: "report",
      reportId: skillReport._id,
      actorUserId: actor._id,
      action: "skill.report.triage",
      timelineMetadata: { skillId: skill._id, status: args.status, finalAction },
      auditAction: "skill.report.triage",
      auditTargetType: "skillReport",
      auditTargetId: skillReport._id,
      auditMetadata: {
        skillId: skill._id,
        slug: skill.slug,
        status: args.status,
        finalAction,
        reportCount,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      reportId: skillReport._id,
      skillId: skill._id,
      status: args.status,
      reportCount,
      actionTaken: finalAction,
    };
  },
});

export const listSkillAppealsInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("accepted"), v.literal("rejected"), v.literal("all")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertModerator(actor);

    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 25), 100));
    const status = args.status ?? "open";
    const appealQuery =
      status === "all"
        ? ctx.db.query("skillAppeals").withIndex("by_createdAt", (q) => q)
        : ctx.db
            .query("skillAppeals")
            .withIndex("by_status_createdAt", (q) => q.eq("status", status));
    const page = await appealQuery.order("desc").paginate({
      cursor: args.cursor ?? null,
      numItems: limit,
    });

    const items: SkillAppealListItem[] = [];
    for (const appeal of page.page) {
      const skill = await ctx.db.get(appeal.skillId);
      if (!skill) continue;
      const submitter = await ctx.db.get(appeal.userId);
      items.push(toSkillAppealListItem(appeal, skill, submitter));
    }

    return { items, nextCursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});

export const resolveSkillAppealForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    appealId: v.id("skillAppeals"),
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("rejected")),
    note: v.optional(v.string()),
    finalAction: v.optional(v.union(v.literal("none"), v.literal("restore"))),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertModerator(actor);

    const appeal = await ctx.db.get(args.appealId);
    if (!appeal) throw new ConvexError("Skill appeal not found");
    const skill = await ctx.db.get(appeal.skillId);
    if (!skill) throw new ConvexError("Skill appeal not found");

    const note = args.note?.trim();
    const isOpen = args.status === "open";
    assertArtifactAppealTransition(appeal.status, args.status);
    if (!isOpen && !note) throw new ConvexError("Resolution note required.");
    const finalAction = args.finalAction ?? "none";
    assertArtifactAppealFinalAction(args.status, finalAction, ["restore"]);
    const now = Date.now();

    await ctx.db.patch(appeal._id, {
      status: args.status,
      resolvedAt: isOpen ? undefined : now,
      resolvedBy: isOpen ? undefined : actor._id,
      resolutionNote: isOpen ? undefined : note?.slice(0, MAX_APPEAL_MESSAGE_LENGTH),
      actionTaken: isOpen ? undefined : finalAction,
    });

    await applySkillAppealFinalAction(ctx, {
      actorUserId: actor._id,
      skill,
      action: finalAction,
      note: note ?? "",
      appealId: appeal._id,
      now,
    });

    await appendSkillModerationEventLog(ctx, {
      kind: "appeal",
      appealId: appeal._id,
      actorUserId: actor._id,
      action: "skill.appeal.resolve",
      timelineMetadata: { skillId: skill._id, status: args.status, finalAction },
      auditAction: "skill.appeal.resolve",
      auditTargetType: "skillAppeal",
      auditTargetId: appeal._id,
      auditMetadata: { skillId: skill._id, slug: skill.slug, status: args.status, finalAction },
      createdAt: now,
    });

    return {
      ok: true as const,
      appealId: appeal._id,
      skillId: skill._id,
      status: args.status,
      actionTaken: finalAction,
    };
  },
});

export const listSkillModerationEventLogsInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    kind: v.union(v.literal("report"), v.literal("appeal")),
    reportId: v.optional(v.id("skillReports")),
    appealId: v.optional(v.id("skillAppeals")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertModerator(actor);

    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 50), 100));
    if (args.kind === "report") {
      if (!args.reportId) throw new ConvexError("reportId required");
      return await ctx.db
        .query("skillModerationEventLogs")
        .withIndex("by_report_createdAt", (q) => q.eq("reportId", args.reportId))
        .order("asc")
        .take(limit);
    }
    if (!args.appealId) throw new ConvexError("appealId required");
    return await ctx.db
      .query("skillModerationEventLogs")
      .withIndex("by_appeal_createdAt", (q) => q.eq("appealId", args.appealId))
      .order("asc")
      .take(limit);
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

type PublicListSort = keyof typeof SORT_INDEXES;

const SORT_INDEX_FIELD_COUNTS: Record<PublicListSort, number> = {
  newest: 2,
  updated: 2,
  name: 2,
  downloads: 3,
  stars: 3,
  installs: 3,
};

const NONSUSPICIOUS_SORT_INDEX_FIELD_COUNTS: Record<PublicListSort, number> = {
  newest: 3,
  updated: 3,
  name: 3,
  downloads: 4,
  stars: 4,
  installs: 4,
};

function encodeIndexKeyValue(val: Value | undefined): Value {
  return val === undefined ? { __undef: 1 } : val;
}

function decodeIndexKeyValue(val: unknown): Value | undefined {
  if (val !== null && typeof val === "object" && "__undef" in (val as Record<string, unknown>)) {
    return undefined;
  }
  return val as Value;
}

function encodeIndexKey(indexName: string, key: IndexKey): string {
  return JSON.stringify({
    v: 1,
    index: indexName,
    key: key.map(encodeIndexKeyValue),
  });
}

function indexKeyStartsWithPrefix(key: IndexKey, prefix: IndexKey): boolean {
  if (key.length < prefix.length) return false;
  return prefix.every((value, index) => key[index] === value);
}

function decodePublicListCursor({
  cursor,
  indexName,
  maxIndexKeyLength,
  eqPrefix,
}: {
  cursor?: string;
  indexName: string;
  maxIndexKeyLength: number;
  eqPrefix: IndexKey;
}): IndexKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed !== null &&
          typeof parsed === "object" &&
          (parsed as { v?: unknown }).v === 1 &&
          (parsed as { index?: unknown }).index === indexName &&
          Array.isArray((parsed as { key?: unknown }).key)
        ? (parsed as { key: unknown[] }).key
        : null;
    if (!Array.isArray(arr)) return null;
    const key = arr.map(decodeIndexKeyValue);
    if (key.length > maxIndexKeyLength) return null;
    if (!indexKeyStartsWithPrefix(key, eqPrefix)) return null;
    return key;
  } catch {
    return null;
  }
}

function getPublicListCursorKey({
  cursor,
  sort,
  nonSuspiciousOnly,
  indexName,
  eqPrefix,
}: {
  cursor?: string;
  sort: PublicListSort;
  nonSuspiciousOnly: boolean;
  indexName: string;
  eqPrefix: IndexKey;
}): IndexKey | null {
  const fieldCounts = nonSuspiciousOnly
    ? NONSUSPICIOUS_SORT_INDEX_FIELD_COUNTS
    : SORT_INDEX_FIELD_COUNTS;
  return decodePublicListCursor({
    cursor,
    indexName,
    maxIndexKeyLength: fieldCounts[sort],
    eqPrefix,
  });
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
    capabilityTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.capabilityTag && !isKnownSkillCapabilityTag(args.capabilityTag)) {
      return { page: [], hasMore: false, nextCursor: null };
    }
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
        capabilityTag: args.capabilityTag,
        nonSuspiciousOnly: args.nonSuspiciousOnly ?? false,
      });
    }

    const indexName = args.nonSuspiciousOnly
      ? NONSUSPICIOUS_SORT_INDEXES[sort]
      : SORT_INDEXES[sort];

    // Equality prefix constrains getPage to active (non-deleted) rows.
    // Without this, getPage walks the entire index including soft-deleted items.
    const eqPrefix: IndexKey = args.nonSuspiciousOnly ? [undefined, false] : [undefined];

    const decodedCursor = getPublicListCursorKey({
      cursor: args.cursor,
      sort,
      nonSuspiciousOnly: args.nonSuspiciousOnly ?? false,
      indexName,
      eqPrefix,
    });
    const isFirstPage = !decodedCursor;
    const startIndexKey: IndexKey = decodedCursor ?? eqPrefix;

    if (!args.capabilityTag) {
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

      const items = result.page
        .map((digest) => buildPublicSkillEntryFromDigest(digest))
        .filter((item): item is PublicSkillEntry => item !== null);
      let nextCursor: string | null = null;
      if (result.hasMore && result.indexKeys.length > 0) {
        nextCursor = encodeIndexKey(indexName, result.indexKeys[result.indexKeys.length - 1]);
      }

      return { page: items, hasMore: result.hasMore, nextCursor };
    }

    const items: PublicSkillEntry[] = [];
    let scanCursor = startIndexKey;
    let scanInclusive = isFirstPage;
    let hasMore = false;
    let nextCursor: string | null = null;
    let remainingRows = Math.max(
      numItems,
      Math.min(MAX_FILTERED_PUBLIC_LIST_SCAN_ROWS, numItems * 12),
    );

    for (let pageCount = 0; pageCount < MAX_FILTERED_PUBLIC_LIST_SCAN_PAGES; pageCount += 1) {
      if (remainingRows <= 0) break;
      const batchSize = Math.min(remainingRows, Math.max(numItems * 3, numItems));
      const result = await getPage(ctx, {
        table: "skillSearchDigest",
        startIndexKey: scanCursor,
        startInclusive: scanInclusive,
        endIndexKey: eqPrefix,
        endInclusive: true,
        absoluteMaxRows: batchSize,
        order: dir,
        index: indexName,
        schema,
      });
      remainingRows -= batchSize;
      if (result.indexKeys.length === 0) {
        hasMore = false;
        nextCursor = null;
        break;
      }

      for (let index = 0; index < result.page.length; index += 1) {
        const digest = result.page[index];
        const cursor = result.indexKeys[index];
        if ((digest.capabilityTags ?? []).includes(args.capabilityTag)) {
          const item = buildPublicSkillEntryFromDigest(digest);
          if (item) items.push(item);
        }
        if (items.length >= numItems) {
          hasMore = result.hasMore || index < result.page.length - 1;
          nextCursor = hasMore ? encodeIndexKey(indexName, cursor) : null;
          return { page: items, hasMore, nextCursor };
        }
      }

      if (!result.hasMore) {
        hasMore = false;
        nextCursor = null;
        break;
      }

      scanCursor = result.indexKeys[result.indexKeys.length - 1];
      scanInclusive = false;
      hasMore = true;
      nextCursor = encodeIndexKey(indexName, scanCursor);
    }

    // Guard: never signal more pages when the scan budget is exhausted
    // without finding any items — that would cause the client's
    // IntersectionObserver auto-load to loop on empty responses.
    if (items.length === 0) {
      hasMore = false;
      nextCursor = null;
    }

    return { page: items, hasMore, nextCursor };
  },
});

export const listPublicTrendingPage = query({
  args: {
    limit: v.optional(v.number()),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 25, 1, MAX_PUBLIC_LIST_LIMIT);
    const kind = args.nonSuspiciousOnly
      ? TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND
      : TRENDING_LEADERBOARD_KIND;
    const leaderboard = await ctx.db
      .query("skillLeaderboards")
      .withIndex("by_kind", (q) => q.eq("kind", kind))
      .order("desc")
      .first();

    if (!leaderboard) return { items: [], nextCursor: null };

    const items: PublicSkillEntry[] = [];
    for (const entry of leaderboard.items) {
      const digest = await ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", entry.skillId))
        .unique();
      if (!digest) continue;
      if (args.nonSuspiciousOnly && digest.isSuspicious) continue;
      const item = buildPublicSkillEntryFromDigest(digest);
      if (!item) continue;
      items.push(item);
      if (items.length >= limit) break;
    }

    return { items, nextCursor: null };
  },
});

export const listAuditPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { numItems, cursor } = normalizePublicListPagination(args.paginationOpts);
    const result = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_active_stats_downloads", (q) => q.eq("softDeletedAt", undefined))
      .order("desc")
      .paginate({ cursor, numItems });

    const page = [];
    for (const digest of result.page) {
      const entry = buildPublicSkillEntryFromDigest(digest);
      if (!entry) continue;
      const latestVersion = digest.latestVersionId
        ? await ctx.db.get(digest.latestVersionId)
        : null;
      page.push({
        kind: "skill" as const,
        skill: entry.skill,
        ownerHandle: entry.ownerHandle,
        owner: entry.owner,
        latestVersion: latestVersion
          ? {
              version: latestVersion.version,
              createdAt: latestVersion.createdAt,
              vtAnalysis: latestVersion.vtAnalysis,
              llmAnalysis: latestVersion.llmAnalysis,
              staticScan: latestVersion.staticScan
                ? {
                    status: latestVersion.staticScan.status,
                    reasonCodes: latestVersion.staticScan.reasonCodes,
                    findings: (latestVersion.staticScan.findings ?? []).map((finding) => ({
                      code: finding.code,
                      severity: finding.severity,
                      file: finding.file,
                      line: finding.line,
                      message: finding.message,
                      evidence: "",
                    })),
                    summary: latestVersion.staticScan.summary,
                    engineVersion: latestVersion.staticScan.engineVersion,
                    checkedAt: latestVersion.staticScan.checkedAt,
                  }
                : null,
            }
          : null,
      });
    }

    return result.isDone
      ? { page, hasMore: false, nextCursor: null }
      : { page, hasMore: true, nextCursor: result.continueCursor };
  },
});

function buildPublicSkillEntryFromDigest(
  digest: Doc<"skillSearchDigest">,
): PublicSkillEntry | null {
  const hydratable = digestToHydratableSkill(digest);
  const publicSkill = toPublicSkill(hydratable);
  if (!publicSkill) return null;
  const ownerInfo = digestToOwnerInfo(digest);
  if (!ownerInfo?.owner) return null;
  const latestVersion = digest.latestVersionSummary
    ? toPublicSkillListVersionFromSummary(digest.latestVersionSummary, digest.latestVersionId)
    : null;
  return {
    skill: publicSkill,
    latestVersion,
    ownerHandle: ownerInfo.ownerHandle,
    owner: ownerInfo.owner,
  };
}

function buildPublicSkillApiListEntryFromDigest(digest: Doc<"skillSearchDigest">) {
  const publicSkill = toPublicSkill(digestToHydratableSkill(digest));
  if (!publicSkill) return null;
  const ownerInfo = digestToOwnerInfo(digest);
  if (!ownerInfo?.owner) return null;
  const latestVersion =
    digest.latestVersionSummary && digest.latestVersionId
      ? toPublicSkillListVersionFromSummary(digest.latestVersionSummary, digest.latestVersionId)
      : null;

  return {
    skill: {
      _id: publicSkill._id,
      slug: publicSkill.slug,
      displayName: publicSkill.displayName,
      summary: publicSkill.summary,
      tags: publicSkill.tags,
      stats: publicSkill.stats,
      createdAt: publicSkill.createdAt,
      updatedAt: publicSkill.updatedAt,
      latestVersionId: publicSkill.latestVersionId,
    },
    latestVersion,
  };
}

export const listPublicApiPageV1 = query({
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
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "newest";
    const dir = args.dir ?? (sort === "name" ? "asc" : "desc");
    const numItems = clampInt(args.numItems ?? 25, 1, MAX_PUBLIC_LIST_LIMIT);
    const indexName = args.nonSuspiciousOnly
      ? NONSUSPICIOUS_SORT_INDEXES[sort]
      : SORT_INDEXES[sort];
    const eqPrefix: IndexKey = args.nonSuspiciousOnly ? [undefined, false] : [undefined];
    const decodedCursor = getPublicListCursorKey({
      cursor: args.cursor,
      sort,
      nonSuspiciousOnly: args.nonSuspiciousOnly ?? false,
      indexName,
      eqPrefix,
    });
    const isFirstPage = !decodedCursor;
    const result = await getPage(ctx, {
      table: "skillSearchDigest",
      startIndexKey: decodedCursor ?? eqPrefix,
      startInclusive: isFirstPage,
      endIndexKey: eqPrefix,
      endInclusive: true,
      absoluteMaxRows: numItems,
      order: dir,
      index: indexName,
      schema,
    });
    const items = result.page
      .map((digest) => buildPublicSkillApiListEntryFromDigest(digest))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const nextCursor =
      result.hasMore && result.indexKeys.length > 0
        ? encodeIndexKey(indexName, result.indexKeys[result.indexKeys.length - 1])
        : null;
    return { items, nextCursor };
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
    const parsed = JSON.parse(
      raw.slice(SKILL_CATALOG_CURSOR_PREFIX.length),
    ) as Partial<SkillCatalogCursorState>;
    return {
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      offset: typeof parsed.offset === "number" && parsed.offset > 0 ? parsed.offset : 0,
      pageSize: typeof parsed.pageSize === "number" && parsed.pageSize > 0 ? parsed.pageSize : null,
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
    highlightedOnly?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
  },
) {
  if (!isVisibleSkillCatalogDigest(digest)) return false;
  if (args.channel === "private") return false;
  if (args.executesCode === true) return false;
  const isOfficial = isSkillCatalogOfficial(digest);
  const channel = getSkillCatalogChannel(digest);
  if (typeof args.isOfficial === "boolean" && isOfficial !== args.isOfficial) return false;
  if (args.highlightedOnly && !isSkillHighlighted(digest)) return false;
  if (args.channel && channel !== args.channel) return false;
  if (args.capabilityTag && !(digest.capabilityTags ?? []).includes(args.capabilityTag))
    return false;
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
    capabilityTags: digest.capabilityTags ?? [],
    executesCode: false,
    verificationTier: null,
  };
}

const EXPLORATORY_SKILL_CATALOG_SEARCH_MIN_TOKEN_LENGTH = 3;

type SkillCatalogSearchMatch = {
  rankTier: number;
  score: number;
};

function skillCatalogSearchMatch(
  digest: Doc<"skillSearchDigest">,
  queryText: string,
): SkillCatalogSearchMatch | null {
  const needle = queryText.toLowerCase();
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return null;
  const slug = digest.slug.toLowerCase();
  const display = digest.displayName.toLowerCase();
  const slugTokens = tokenize(slug);
  const displayTokens = tokenize(display);
  let score = 0;
  let rankTier = Number.POSITIVE_INFINITY;

  const setMatch = (tier: number, boost: number) => {
    score += boost;
    rankTier = Math.min(rankTier, tier);
  };

  if (slug === needle) setMatch(0, 200);
  else if (slug.startsWith(needle)) setMatch(1, 120);
  else if (slug.includes(needle)) setMatch(1, 80);

  if (display === needle) setMatch(0, 150);
  else if (display.startsWith(needle)) setMatch(1, 70);
  else if (display.includes(needle)) setMatch(1, 40);

  if (matchesAllTokens(queryTokens, [...slugTokens, ...displayTokens], (a, b) => a === b)) {
    setMatch(1, 65);
  } else if (
    matchesAllTokens(queryTokens, [...slugTokens, ...displayTokens], (a, b) => a.startsWith(b))
  ) {
    setMatch(1, 35);
  }

  if (
    matchesExploratoryTokenPrefixes(
      queryTokens,
      digest.capabilityTags ?? [],
      EXPLORATORY_SKILL_CATALOG_SEARCH_MIN_TOKEN_LENGTH,
    )
  ) {
    setMatch(2, 12);
  }
  if (
    matchesExploratoryTokenPrefixes(
      queryTokens,
      [digest.summary],
      EXPLORATORY_SKILL_CATALOG_SEARCH_MIN_TOKEN_LENGTH,
    )
  ) {
    setMatch(3, 20);
  }
  if (!Number.isFinite(rankTier)) return null;
  return { rankTier, score };
}

function compareSkillCatalogSearchMatches<
  T extends SkillCatalogSearchMatch & {
    package: Pick<PublicSkillCatalogItem, "isOfficial" | "updatedAt">;
  },
>(a: T, b: T) {
  return (
    a.rankTier - b.rankTier ||
    b.score - a.score ||
    Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
    b.package.updatedAt - a.package.updatedAt
  );
}

function isKnownSkillCapabilityTag(tag: string | undefined) {
  return typeof tag === "string" && SKILL_CAPABILITY_TAG_SET.has(tag);
}

export const listPackageCatalogPage = query({
  args: {
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.capabilityTag && !isKnownSkillCapabilityTag(args.capabilityTag)) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    if (args.channel === "private" || args.executesCode === true) {
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
        250,
        offset > 0 && pageSize
          ? Math.max(pageSize, offset + 1)
          : Math.max(targetCount * 3, targetCount),
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

type SkillPackageCatalogSearchArgs = {
  query: string;
  limit?: number;
  channel?: "official" | "community" | "private";
  isOfficial?: boolean;
  highlightedOnly?: boolean;
  executesCode?: boolean;
  capabilityTag?: string;
};

async function searchPackageCatalogImpl(ctx: QueryCtx, args: SkillPackageCatalogSearchArgs) {
  const queryText = args.query.trim().toLowerCase();
  if (!queryText) return [];
  if (args.capabilityTag && !isKnownSkillCapabilityTag(args.capabilityTag)) return [];
  if (args.channel === "private" || args.executesCode === true) return [];

  const targetCount = Math.max(1, Math.min(args.limit ?? 20, 100));
  const matches: Array<SkillCatalogSearchMatch & { package: PublicSkillCatalogItem }> = [];
  const seen = new Set<string>();

  const exactSkill = await resolveSkillBySlugOrAlias(ctx, queryText);
  if (exactSkill.skill) {
    const exactDigest = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_skill", (q) => q.eq("skillId", exactSkill.skill!._id))
      .unique();
    if (exactDigest && skillCatalogMatchesFilters(exactDigest, args)) {
      const match = skillCatalogSearchMatch(exactDigest, queryText);
      if (match) {
        seen.add(exactDigest.skillId);
        matches.push({
          ...match,
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
      const match = skillCatalogSearchMatch(digest, queryText);
      if (!match || seen.has(digest.skillId)) continue;
      seen.add(digest.skillId);
      matches.push({
        ...match,
        package: toPublicSkillCatalogItem(digest),
      });
    }
  }

  return matches.sort(compareSkillCatalogSearchMatches).slice(0, targetCount);
}

function toPublicSkillCatalogSearchEntry(
  entry: SkillCatalogSearchMatch & { package: PublicSkillCatalogItem },
) {
  return {
    score: entry.score,
    package: entry.package,
  };
}

export const searchPackageCatalogPublic = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return (await searchPackageCatalogImpl(ctx, args)).map(toPublicSkillCatalogSearchEntry);
  },
});

export const searchPackageCatalogForHttpInternal = internalQuery({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await searchPackageCatalogImpl(ctx, args);
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
    capabilityTag?: string;
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
    if (opts.capabilityTag && !(digest.capabilityTags ?? []).includes(opts.capabilityTag)) continue;
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
  const items = trimmed
    .map((digest) => buildPublicSkillEntryFromDigest(digest))
    .filter((item): item is PublicSkillEntry => item !== null);

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
    return statsCount ?? 0;
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
    const batchSize = clampInt(args.batchSize ?? 10, 1, 50);
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

const suspiciousSkillLlmRescanBucketValidator = v.union(
  v.literal("all"),
  v.literal("llm-only"),
  v.literal("vt-only"),
  v.literal("both"),
);

function skillHasReasonCode(
  skill: Pick<Doc<"skills">, "moderationReason" | "moderationReasonCodes">,
  code: string,
) {
  return (skill.moderationReasonCodes ?? []).includes(code);
}

function skillHasScannerSuspiciousReason(
  skill: Pick<Doc<"skills">, "moderationReason" | "moderationReasonCodes">,
  scanner: "llm" | "vt",
) {
  return (
    skillHasReasonCode(skill, `suspicious.${scanner}_suspicious`) ||
    skill.moderationReason === `scanner.${scanner}.suspicious`
  );
}

/**
 * Targeted LLM rescan batches for suspicious latest skill versions.
 * Uses the suspicious index, then filters bucket membership in-page.
 */
export const getSuspiciousSkillBatchForLlmRescanInternal = internalQuery({
  args: {
    bucket: suspiciousSkillLlmRescanBucketValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 1, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .withIndex("by_nonsuspicious_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("isSuspicious", true),
      )
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const skills: Array<{
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
      reasonCodes: string[];
    }> = [];

    for (const skill of page) {
      if (!skill.latestVersionId) continue;
      if (skill.moderationVerdict === "malicious") continue;
      if ((skill.moderationReasonCodes ?? []).some((code) => code.startsWith("malicious."))) {
        continue;
      }
      if ((skill.moderationFlags ?? []).includes("blocked.malware")) continue;

      const hasLlmSuspicious = skillHasScannerSuspiciousReason(skill, "llm");
      const hasVtSuspicious = skillHasScannerSuspiciousReason(skill, "vt");
      const matches =
        args.bucket === "all" ||
        (args.bucket === "llm-only" && hasLlmSuspicious && !hasVtSuspicious) ||
        (args.bucket === "vt-only" && hasVtSuspicious && !hasLlmSuspicious) ||
        (args.bucket === "both" && hasLlmSuspicious && hasVtSuspicious);
      if (!matches) continue;

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) continue;
      skills.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
        reasonCodes: skill.moderationReasonCodes ?? [],
      });
    }

    return {
      skills,
      examined: page.length,
      continueCursor,
      isDone,
    };
  },
});

export const getSuspiciousSkillCountPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 200, 1, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .withIndex("by_nonsuspicious_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("isSuspicious", true),
      )
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let malicious = 0;
    let blocked = 0;
    let noLatestVersion = 0;
    let rescanable = 0;
    let llmOnly = 0;
    let vtOnly = 0;
    let both = 0;
    let noScannerReason = 0;

    for (const skill of page) {
      const hasMaliciousCode =
        skill.moderationVerdict === "malicious" ||
        (skill.moderationReasonCodes ?? []).some((code) => code.startsWith("malicious."));
      if (hasMaliciousCode) {
        malicious++;
        continue;
      }
      if ((skill.moderationFlags ?? []).includes("blocked.malware")) {
        blocked++;
        continue;
      }
      if (!skill.latestVersionId) {
        noLatestVersion++;
        continue;
      }

      rescanable++;
      const hasLlmSuspicious = skillHasScannerSuspiciousReason(skill, "llm");
      const hasVtSuspicious = skillHasScannerSuspiciousReason(skill, "vt");
      if (hasLlmSuspicious && hasVtSuspicious) {
        both++;
      } else if (hasLlmSuspicious) {
        llmOnly++;
      } else if (hasVtSuspicious) {
        vtOnly++;
      } else {
        noScannerReason++;
      }
    }

    return {
      examined: page.length,
      suspicious: page.length,
      malicious,
      blocked,
      noLatestVersion,
      rescanable,
      llmOnly,
      vtOnly,
      both,
      noScannerReason,
      continueCursor,
      isDone,
    };
  },
});

export const hideObviousJunkSuspiciousSkillsInternal = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    maxToHide: v.optional(v.number()),
    accExamined: v.optional(v.number()),
    accMatched: v.optional(v.number()),
    accHidden: v.optional(v.number()),
    examples: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 200, 1, 200);
    const dryRun = args.dryRun ?? false;
    const maxToHide =
      args.maxToHide === undefined ? Number.POSITIVE_INFINITY : Math.max(0, args.maxToHide);
    const now = Date.now();
    let accExamined = args.accExamined ?? 0;
    let accMatched = args.accMatched ?? 0;
    let accHidden = args.accHidden ?? 0;
    const examples = [...(args.examples ?? [])];

    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .withIndex("by_nonsuspicious_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("isSuspicious", true),
      )
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    for (const skill of page) {
      accExamined++;
      if (!isObviousJunkSkill(skill)) continue;
      accMatched++;
      if (examples.length < 25) examples.push(skill.slug);
      if (dryRun || accHidden >= maxToHide) continue;

      await ctx.db.patch(skill._id, {
        softDeletedAt: now,
        moderationStatus: "hidden",
        moderationReason: "cleanup.obvious_junk",
        moderationNotes: "Auto-hidden obvious test or placeholder skill during ClawScan cleanup.",
        hiddenAt: now,
        hiddenBy: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      });
      accHidden++;
    }

    const hitLimit = accHidden >= maxToHide;
    if (!isDone && !hitLimit && !dryRun) {
      await ctx.scheduler.runAfter(0, internal.skills.hideObviousJunkSuspiciousSkillsInternal, {
        cursor: continueCursor,
        batchSize,
        dryRun,
        maxToHide,
        accExamined,
        accMatched,
        accHidden,
        examples,
      });
    }

    return {
      status: dryRun ? "dry_run" : hitLimit ? "limit_reached" : isDone ? "complete" : "continuing",
      examined: accExamined,
      matched: accMatched,
      hidden: accHidden,
      examples,
      cursor: continueCursor,
      done: isDone,
    };
  },
});

/**
 * Get active latest skill versions whose static scan is missing or uses an older engine version.
 * Used to backfill new static rules onto already-published skills.
 */
export const getActiveSkillBatchForStaticScanBackfillInternal = internalQuery({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 25;
    const cursor = args.cursor ?? 0;

    const candidates = await ctx.db
      .query("skills")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", cursor))
      .order("asc")
      .take(batchSize * 4);

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
      if (version.staticScan?.engineVersion === MODERATION_ENGINE_VERSION) continue;

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
      });
    }

    const done = candidates.length < batchSize * 4;
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

export const updateSkillVersionStaticScanInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
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
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.skillId !== args.skillId)
      return { ok: true as const, skipped: "missing" as const };

    await ctx.db.patch(version._id, {
      staticScan: args.staticScan,
    });
    const updatedVersion = { ...version, staticScan: args.staticScan };

    const skill = await ctx.db.get(args.skillId);
    if (!skill) return { ok: true as const, skipped: "missing" as const };
    if (skill.latestVersionId !== version._id) {
      return { ok: true as const, skipped: "not_latest" as const };
    }

    const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
    const now = Date.now();
    const basePatch = buildScannerModerationPatchFromVersion({
      owner,
      version: updatedVersion,
      now,
    });
    const patch = applySkillManualOverrideToSkillPatch({
      skill,
      basePatch: {
        ...basePatch,
        updatedAt: now,
      },
      now,
    });
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);

    if (patch.moderationVerdict === "malicious" && skill.ownerUserId) {
      const trigger =
        patch.moderationReasonCodes?.find((code) => code.startsWith("malicious.")) ??
        "static.malicious";
      await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
        ownerUserId: skill.ownerUserId,
        slug: skill.slug,
        ...(updatedVersion.sha256hash ? { sha256hash: updatedVersion.sha256hash } : {}),
        trigger,
      });
    }

    return { ok: true as const, status: args.staticScan.status };
  },
});

export const updateVersionDepRegistryAnalysisInternal = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    depRegistryAnalysis: depRegistryAnalysisValidator,
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return { ok: true as const, skipped: "missing" as const };

    const staticScan = mergeDepRegistryFinding({
      staticScan: version.staticScan,
      analysis: args.depRegistryAnalysis,
      statusFromCodes: verdictFromCodes,
      summarizeCodes: summarizeReasonCodes,
    });
    const versionPatch = {
      depRegistryAnalysis: args.depRegistryAnalysis,
      depRegistryScanStatus: args.depRegistryAnalysis.status,
      staticScan,
    };

    await ctx.db.patch(version._id, versionPatch);
    const updatedVersion = { ...version, ...versionPatch };

    const skill = await ctx.db.get(version.skillId);
    if (!skill) return { ok: true as const, skipped: "missing_skill" as const };
    if (skill.latestVersionId !== version._id) {
      return { ok: true as const, skipped: "not_latest" as const };
    }

    await patchStructuredModerationFromVersion(ctx, skill, updatedVersion);
    return { ok: true as const, status: args.depRegistryAnalysis.status };
  },
});

export const scanSkillVersionStaticallyInternal: ReturnType<typeof internalAction> = internalAction(
  {
    args: {
      skillId: v.id("skills"),
      versionId: v.id("skillVersions"),
    },
    handler: async (ctx, args) => {
      const [skill, version] = await Promise.all([
        ctx.runQuery(internal.skills.getSkillByIdInternal, { skillId: args.skillId }),
        ctx.runQuery(internal.skills.getVersionByIdInternal, { versionId: args.versionId }),
      ]);

      if (!skill || !version) {
        return { ok: true as const, skipped: "missing" as const };
      }

      const staticScan = await runStaticPublishScan(ctx, {
        slug: skill.slug,
        displayName: skill.displayName,
        summary: skill.summary ?? undefined,
        frontmatter: version.parsed?.frontmatter ?? {},
        metadata: version.parsed?.metadata,
        files: version.files,
      });

      return await ctx.runMutation(internal.skills.updateSkillVersionStaticScanInternal, {
        skillId: skill._id,
        versionId: version._id,
        staticScan,
      });
    },
  },
);

export const backfillSkillStaticScansInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    rescanned: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? 25, 100));
    const batch = await ctx.runQuery(
      internal.skills.getActiveSkillBatchForStaticScanBackfillInternal,
      {
        cursor: args.cursor,
        batchSize,
      },
    );

    let rescanned = args.rescanned ?? 0;
    for (const skill of batch.skills) {
      await ctx.scheduler.runAfter(0, internal.skills.scanSkillVersionStaticallyInternal, {
        skillId: skill.skillId,
        versionId: skill.versionId,
      });
      rescanned += 1;
    }

    if (!batch.done) {
      await ctx.scheduler.runAfter(0, internal.skills.backfillSkillStaticScansInternal, {
        cursor: batch.nextCursor,
        batchSize,
        rescanned,
      });
    }

    return {
      rescanned,
      nextCursor: batch.nextCursor,
      done: batch.done,
    };
  },
});

export const backfillSkillStaticScans: ReturnType<typeof action> = action({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertAdmin(user);
    return await ctx.runAction(internal.skills.backfillSkillStaticScansInternal, {
      batchSize: args.batchSize,
    });
  },
});

export const updateLatestClawScanNoteAndRequestRescan = mutation({
  args: {
    skillId: v.id("skills"),
    clawScanNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.softDeletedAt || !skill.latestVersionId) {
      throw new ConvexError("Skill not found");
    }

    const version = await ctx.db.get(skill.latestVersionId);
    if (!version || version.softDeletedAt) throw new ConvexError("Skill version not found");

    await assertCanManageOwnedResource(ctx, {
      actor: user,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      allowPlatformModerator: true,
    });

    const now = Date.now();
    const previousNote = version.clawScanNote?.trim() || undefined;
    const nextNote = normalizeClawScanNoteForWrite(args.clawScanNote);
    await ctx.db.patch(version._id, {
      clawScanNote: nextNote ?? "",
      clawScanNoteUpdatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "skill.clawscan_note.update",
      targetType: "skillVersion",
      targetId: version._id,
      metadata: {
        skillId: skill._id,
        slug: skill.slug,
        version: version.version,
        hadPreviousNote: Boolean(previousNote),
        hasNextNote: Boolean(nextNote),
        previousLength: previousNote?.length ?? 0,
        nextLength: nextNote?.length ?? 0,
      },
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.securityScan.enqueueSkillVersionScanInternal, {
      versionId: version._id,
      source: "clawscan-note",
      waitForVtMs: 0,
    });

    return { ok: true as const, skillVersionId: version._id };
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
      vtAnalysis: version?.vtAnalysis,
      vtStatus,
      llmStatus,
      llmAnalysis: version?.llmAnalysis,
      sourceVersionId: version?._id,
    });
    const sourceReasonCodes = snapshot.reasonCodes;
    const vtStatusForReason = scannerStatusFromReasonCodes({
      scanner: "vt",
      status: vtStatus,
      reasonCodes: sourceReasonCodes,
    });
    const rawVtStatus = normalizeAnalysisStatus(vtStatus);
    const llmStatusForReason =
      !vtStatusForReason &&
      (rawVtStatus === "malicious" || rawVtStatus === "suspicious") &&
      normalizeAnalysisStatus(llmStatus) === "clean"
        ? undefined
        : llmStatus;
    const sourceReason = resolveScannerModerationReason({
      vtStatus: vtStatusForReason,
      llmStatus: llmStatusForReason,
      verdict: snapshot.verdict,
    });
    const bypassSuspicious =
      snapshot.verdict === "suspicious" && isPrivilegedOwnerForSuspiciousBypass(owner);
    const moderationReasonCodes = bypassSuspicious
      ? sourceReasonCodes.filter((code) => !code.startsWith("suspicious."))
      : sourceReasonCodes;
    const moderationVerdict = verdictFromCodes(moderationReasonCodes);
    const isReviewOnlyVerdict =
      moderationVerdict === "clean" && hasReviewReasonCode(moderationReasonCodes);
    const moderationFlags = isReviewOnlyVerdict
      ? ["flagged.review"]
      : legacyFlagsFromVerdict(moderationVerdict);
    const moderationReason = bypassSuspicious
      ? normalizeScannerSuspiciousReason(sourceReason)
      : isReviewOnlyVerdict
        ? "scanner.llm.review"
        : sourceReason;
    const moderationStatus =
      moderationVerdict === "malicious"
        ? "hidden"
        : moderationVerdict === "clean"
          ? "active"
          : args.moderationStatus;

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
      unpublishedSlugReservedUntil: undefined,
      unpublishedSlugReleasedAt: undefined,
      unpublishedOriginalSlug: undefined,
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
      await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);
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
    // Stale batch guard: if the hold was lifted between batch pages,
    // stop hiding skills. Without this, a liftModerationHold call that
    // races with a multi-page hide chain can leave late-hidden skills
    // permanently stuck (the restore may have already paged past them).
    const user = await ctx.db.get(args.ownerUserId);
    if (user && !user.requiresModerationAt) {
      return { ok: true as const, hiddenCount: 0, scheduled: false, aborted: true };
    }

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
      const currentStatus = skill.moderationStatus ?? "active";
      if (currentStatus !== "active") continue;

      const nextReason =
        skill.moderationVerdict === "malicious"
          ? (skill.moderationReason ?? "scanner.aggregate.malicious")
          : USER_MODERATION_REASON;
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
      await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);

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
 * Batch restore skills hidden by a moderation hold.
 * Only restores skills where moderationReason is "user.moderation"
 * and moderationStatus is "hidden".
 *
 * Race condition safety: before processing each page, verifies the user
 * has not been placed under a new moderation hold. If requiresModerationAt
 * is set again (new hold placed between batch pages), the batch aborts
 * to avoid restoring skills that should remain hidden.
 *
 * Skills published while under hold also get moderationReason "user.moderation"
 * and are included in the restore. Skills hidden for other reasons (manual
 * moderator action, community reports) are not affected.
 */
export const restoreOwnedSkillsForModerationLiftBatchInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    holdPlacedAt: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Race condition guard: if the user has been re-held between batch pages,
    // abort to avoid restoring skills that should stay hidden under the new hold.
    const user = await ctx.db.get(args.ownerUserId);
    if (user?.requiresModerationAt) {
      return { ok: true as const, restoredCount: 0, scheduled: false, aborted: true };
    }

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
      // Skip skills hidden before this hold was placed — they belong to
      // an earlier moderation action and should not be restored here.
      // We use >= (not ===) because the hide batch may stamp hiddenAt
      // with the same `now` used for requiresModerationAt, or a later
      // timestamp if the user was re-moderated without clearing the hold.
      // The primary race-condition guard is the requiresModerationAt check
      // above: if a *new* hold exists, the batch aborts entirely.
      if (skill.hiddenAt != null && skill.hiddenAt < args.holdPlacedAt) continue;
      // Skip soft-deleted skills: if a ban raced with this batch, those
      // rows need their moderationReason intact for unban recovery.
      if (skill.softDeletedAt) continue;
      if (skill.moderationReason !== USER_MODERATION_REASON) continue;
      if (skill.moderationStatus !== "hidden") continue;

      // Re-evaluate based on the skill's own scan data rather than blindly
      // setting to active. If the skill's own static scan was malicious,
      // keep it hidden -- only the user-level hold should be lifted.
      const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
      const ownStaticVerdict = latestVersion?.staticScan?.status;
      if (ownStaticVerdict === "malicious") continue;

      // If the skill was never scanned (or was pending scan when the hold
      // was placed), re-queue it into the VT pipeline instead of marking it
      // as restored. The VT queue selector only picks up "pending.scan",
      // "pending.scan.stale", and "scanner.*" reasons, so
      // "restored.moderation_lift" would leave these skills permanently
      // unscanned.
      const vtStatus = latestVersion?.vtAnalysis?.status;
      const needsScan = !vtStatus || vtStatus === "pending" || vtStatus === "loading";
      const nextReason = needsScan ? "pending.scan" : "restored.moderation_lift";
      const patch: Partial<Doc<"skills">> = {
        moderationStatus: needsScan ? "hidden" : "active",
        moderationReason: nextReason,
        isSuspicious: computeIsSuspicious({
          moderationFlags: skill.moderationFlags,
          moderationReason: nextReason,
        }),
        hiddenAt: undefined,
        hiddenBy: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      };
      const nextSkill = { ...skill, ...patch };
      await ctx.db.patch(skill._id, patch);
      await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
      restoredCount += 1;
    }

    scheduleNextBatchIfNeeded(
      ctx.scheduler,
      internal.skills.restoreOwnedSkillsForModerationLiftBatchInternal,
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
    vtAnalysis: v.optional(vtAnalysisValidator),
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
    moderationMode: v.optional(v.union(v.literal("normal"), v.literal("preserve"))),
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
      agenticRiskFindings: v.optional(
        v.array(
          v.object({
            categoryId: v.string(),
            categoryLabel: v.string(),
            riskBucket: v.union(
              v.literal("abnormal_behavior_control"),
              v.literal("permission_boundary"),
              v.literal("sensitive_data_protection"),
            ),
            status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
            severity: v.string(),
            confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
            evidence: v.optional(
              v.object({
                path: v.string(),
                snippet: v.string(),
                explanation: v.string(),
              }),
            ),
            userImpact: v.string(),
            recommendation: v.string(),
          }),
        ),
      ),
      riskSummary: v.optional(
        v.object({
          abnormal_behavior_control: v.object({
            status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
            summary: v.string(),
            highestSeverity: v.optional(v.string()),
          }),
          permission_boundary: v.object({
            status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
            summary: v.string(),
            highestSeverity: v.optional(v.string()),
          }),
          sensitive_data_protection: v.object({
            status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
            summary: v.string(),
            highestSeverity: v.optional(v.string()),
          }),
        }),
      ),
      model: v.optional(v.string()),
      checkedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return;
    const nextVersion = { ...version, llmAnalysis: args.llmAnalysis };
    await ctx.db.patch(args.versionId, { llmAnalysis: args.llmAnalysis });
    if (args.moderationMode === "preserve") return;

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
      if (skill.latestVersionId && skill.latestVersionId !== version._id) {
        return { ok: true, skillId: version.skillId, versionId: version._id };
      }

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
      const nextModerationNotes = qualityLocked
        ? (skill.moderationNotes ??
          "Quality gate quarantine is still active. Manual moderation review required.")
        : undefined;
      const scanner = args.scanner.trim().toLowerCase();
      const snapshot = buildModerationSnapshot({
        staticScan: version.staticScan,
        vtAnalysis: version.vtAnalysis,
        vtStatus: scanner === "vt" ? args.status : version.vtAnalysis?.status,
        llmStatus: scanner === "llm" ? args.status : version.llmAnalysis?.status,
        llmAnalysis: version.llmAnalysis,
        sourceVersionId: version._id,
      });
      const nextReasonCodes =
        bypassSuspicious && !isMalicious
          ? snapshot.reasonCodes.filter((code) => !code.startsWith("suspicious."))
          : snapshot.reasonCodes;
      const nextVerdict = verdictFromCodes(nextReasonCodes);
      const nextLegacyFlags = legacyFlagsFromVerdict(nextVerdict);
      const isReviewOnlyVerdict = nextVerdict === "clean" && hasReviewReasonCode(nextReasonCodes);
      if (nextVerdict === "clean") {
        newFlags = isReviewOnlyVerdict ? ["flagged.review"] : undefined;
      }
      const nextModerationReason = qualityLocked
        ? "quality.low"
        : isReviewOnlyVerdict
          ? "scanner.llm.review"
          : bypassSuspicious
            ? `scanner.${args.scanner}.clean`
            : nextVerdict === "clean"
              ? "scanner.aggregate.clean"
              : `scanner.${args.scanner}.${args.status}`;
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
        unpublishedSlugReservedUntil: undefined,
        unpublishedSlugReleasedAt: undefined,
        unpublishedOriginalSlug: undefined,
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
      if (nextVerdict === "malicious" && skill.ownerUserId) {
        await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
          ownerUserId: skill.ownerUserId,
          sha256hash: args.sha256hash,
          slug: skill.slug,
          trigger: "vt.malicious",
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
    if (skill.latestVersionId && skill.latestVersionId !== version._id) return;

    const isMalicious = args.status === "malicious";
    const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? [];
    const alreadyBlocked = existingFlags.includes("blocked.malware");
    const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null;
    const bypassSuspicious =
      !isMalicious && !alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner);

    const snapshot = buildModerationSnapshot({
      staticScan: version.staticScan,
      vtAnalysis: version.vtAnalysis,
      vtStatus: args.status,
      llmStatus: version.llmAnalysis?.status,
      llmAnalysis: version.llmAnalysis,
      sourceVersionId: version._id,
    });
    const nextReasonCodes =
      bypassSuspicious && !isMalicious
        ? snapshot.reasonCodes.filter((code) => !code.startsWith("suspicious."))
        : snapshot.reasonCodes;
    const nextVerdict = verdictFromCodes(nextReasonCodes);
    const nextLegacyFlags = legacyFlagsFromVerdict(nextVerdict);

    // Determine new flags — stricter structured verdict wins.
    let newFlags: string[];
    if (nextVerdict === "malicious" || alreadyBlocked) {
      newFlags = ["blocked.malware"];
    } else if (bypassSuspicious) {
      newFlags = stripSuspiciousFlag(existingFlags) ?? [];
    } else {
      newFlags = ["flagged.suspicious"];
    }

    const isReviewOnlyVerdict = nextVerdict === "clean" && hasReviewReasonCode(nextReasonCodes);
    const nextModerationFlags = isReviewOnlyVerdict
      ? ["flagged.review"]
      : nextVerdict === "clean"
        ? undefined
        : newFlags.length
          ? newFlags
          : nextLegacyFlags;
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
    } else if (isReviewOnlyVerdict) {
      basePatch.moderationReason = "scanner.llm.review";
    } else if (nextVerdict === "clean") {
      const existingReason = skill.moderationReason as string | undefined;
      if (
        existingReason?.startsWith("scanner.") &&
        (existingReason.endsWith(".suspicious") || existingReason.endsWith(".malicious"))
      ) {
        basePatch.moderationReason = normalizeScannerSuspiciousReason(existingReason);
      }
    }

    // Only hide for malicious — suspicious stays visible with a flag
    if (nextVerdict === "malicious") {
      basePatch.moderationStatus = "hidden";
      // Security: reset hide provenance so the owner-undelete gate cannot
      // mistake prior owner-initiated soft-deletes (hiddenBy === owner,
      // moderationReason === undefined) for self-service state. The
      // moderationReason is intentionally NOT overwritten here to preserve
      // the aggregate LLM verdict (see function doc), but `blocked.malware`
      // is stamped into moderationFlags above and `moderationVerdict` is
      // "malicious", both of which the undelete gate also enforces.
      basePatch.hiddenAt = now;
      basePatch.hiddenBy = undefined;
      basePatch.unpublishedSlugReservedUntil = undefined;
      basePatch.unpublishedSlugReleasedAt = undefined;
      basePatch.unpublishedOriginalSlug = undefined;
      basePatch.lastReviewedAt = now;
    } else if (nextVerdict === "clean") {
      basePatch.moderationStatus = "active";
      basePatch.hiddenAt = undefined;
      basePatch.hiddenBy = undefined;
      basePatch.lastReviewedAt = undefined;
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
    if (nextVerdict === "malicious" && skill.ownerUserId) {
      await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
        ownerUserId: skill.ownerUserId,
        sha256hash: args.sha256hash,
        slug: skill.slug,
        trigger: "vt.malicious",
      });
    }
  },
});

/**
 * Re-sync skill-level moderation from each skill's current latest version.
 * This repairs rows that were previously stamped from an older version scan.
 */
export const backfillLatestSkillModerationInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      const shouldBackfill = args.force
        ? shouldForceBackfillLatestSkillModeration(skill)
        : shouldBackfillLatestSkillModeration(skill);
      if (!shouldBackfill) continue;
      await syncSkillModerationFromLatestVersion(ctx, skill, Date.now());
      patched++;
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.skills.backfillLatestSkillModerationInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
        force: args.force,
      });
    }

    return { patched, isDone, scanned: page.length };
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
    // Explicit opt-in from the client to migrate an existing skill's owner
    // when `ownerHandle` differs from the skill's current owner. Without this
    // flag, a mismatching Owner selector is treated as a slug collision so
    // re-publishes cannot silently transfer ownership.
    migrateOwner: v.optional(v.boolean()),
    slug: v.string(),
    displayName: v.string(),
    // Skill icon hint chosen by the publisher in the publish form. Stored as
    // a protocol-prefixed string (e.g. `lucide:Plug`). Unknown values are
    // silently dropped server-side; see lib/skillIcon.ts.
    icon: v.optional(v.string()),
    version: v.string(),
    changelog: v.string(),
    clawScanNote: v.optional(v.string()),
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
      migrateOwner: args.migrateOwner,
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

  const authUserId = await getOptionalActiveAuthUserIdFromAction(ctx);
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
        patch.capabilityTags = version.capabilityTags;
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

export const deleteTags = mutation({
  args: {
    skillId: v.id("skills"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");
    if (skill.ownerUserId !== user._id) {
      assertModerator(user);
    }

    const nextTags = { ...skill.tags };
    let changed = false;
    for (const tag of args.tags) {
      if (tag === "latest") continue;
      if (tag in nextTags) {
        delete nextTags[tag];
        changed = true;
      }
    }

    if (!changed) return;

    await ctx.db.patch(skill._id, {
      tags: nextTags,
      updatedAt: Date.now(),
    });
  },
});

export const updateSummary = mutation({
  args: {
    skillId: v.id("skills"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");
    if (user.role !== "admin" && user.role !== "moderator") {
      await assertCanManageOwnedResource(ctx, {
        actor: user,
        ownerUserId: skill.ownerUserId,
        ownerPublisherId: skill.ownerPublisherId,
        allowedPublisherRoles: ["admin"],
      });
    }
    const summary = args.summary.trim();
    if (summary.length > MAX_OWNER_SUMMARY_LENGTH) {
      throw new ConvexError(`Summary must be ${MAX_OWNER_SUMMARY_LENGTH} characters or less`);
    }

    const now = Date.now();
    const patch: Partial<Doc<"skills">> = {
      summary,
      updatedAt: now,
    };

    await ctx.db.patch(skill._id, patch);
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
  args: {
    skillId: v.id("skills"),
    deleted: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const now = Date.now();
    const note = args.reason ? trimManualOverrideNote(args.reason) : undefined;
    if (!note) {
      throw new ConvexError(
        args.deleted ? "Hide reason is required." : "Restore reason is required.",
      );
    }
    const patch: Partial<Doc<"skills">> = {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? "hidden" : "active",
      moderationNotes: note,
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? user._id : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    };
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
    await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);

    await setSkillEmbeddingsSoftDeleted(ctx, skill._id, args.deleted, now);

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.deleted ? "skill.delete" : "skill.undelete",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug: skill.slug,
        softDeletedAt: args.deleted ? now : null,
        reason: note,
      },
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
    await adjustUserSkillStatsForSkillChange(ctx, skill, {
      ...skill,
      ownerUserId: args.ownerUserId,
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

async function canManageSkillOwnerForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  skill: Pick<Doc<"skills">, "ownerUserId" | "ownerPublisherId">,
) {
  try {
    await assertCanManageOwnedResource(ctx, {
      actor,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      allowedPublisherRoles: ["admin"],
      allowPlatformAdmin: true,
    });
    return true;
  } catch (error) {
    if (error instanceof ConvexError || error instanceof Error) return false;
    throw error;
  }
}

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
  const sourceSlug = normalizeSkillSlug(sourceSlugArg);
  if (!sourceSlug) throw new ConvexError("Current slug required");
  // Full write-path validation for the new slug: length, pattern,
  // reserved-word blocklist, no consecutive hyphens.
  const newSlug = assertValidSkillSlug(newSlugArg);

  const resolved = await resolveSkillBySlugOrAlias(ctx, sourceSlug);
  const skill = resolved.skill;
  if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");
  await assertCanManageOwnedResource(ctx, {
    actor: user,
    ownerUserId: skill.ownerUserId,
    ownerPublisherId: skill.ownerPublisherId,
    allowedPublisherRoles: ["admin"],
    allowPlatformAdmin: true,
  });
  if (skill.slug === newSlug) {
    return { ok: true as const, slug: skill.slug, previousSlug: skill.slug };
  }

  const existingSkill = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", newSlug))
    .unique();
  if (existingSkill && existingSkill._id !== skill._id) {
    const owner = await ctx.db.get(existingSkill.ownerUserId);
    const ownsExisting =
      existingSkill.ownerUserId === actorUserId ||
      (await canManageSkillOwnerForActor(ctx, user, existingSkill));
    if (ownsExisting) {
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

  const aliasesForSkill = await listSkillSlugAliasesForSkill(ctx, skill._id);
  const aliasRemovedForNewSlug =
    existingAlias && existingAlias.skillId === skill._id ? existingAlias : null;
  const previousAlias = await getSkillSlugAliasBySlug(ctx, skill.slug);
  const addedSkillAliases = previousAlias?.skillId === skill._id ? 0 : 1;
  const removedSkillAliases = aliasRemovedForNewSlug ? 1 : 0;
  const addedOwnerAliases = previousAlias
    ? sameSkillSlugAliasOwner(previousAlias, skill.ownerUserId, skill.ownerPublisherId)
      ? 0
      : 1
    : 1;
  const removedOwnerAliases =
    aliasRemovedForNewSlug &&
    sameSkillSlugAliasOwner(aliasRemovedForNewSlug, skill.ownerUserId, skill.ownerPublisherId)
      ? 1
      : 0;
  await assertSkillSlugAliasQuota(ctx, {
    targetSkillId: skill._id,
    ownerUserId: skill.ownerUserId,
    ownerPublisherId: skill.ownerPublisherId,
    currentSkillAliasCount: aliasesForSkill.length,
    addedSkillAliases,
    removedSkillAliases,
    addedOwnerAliases,
    removedOwnerAliases,
  });

  if (existingAlias && existingAlias.skillId === skill._id) {
    await ctx.db.delete(existingAlias._id);
  }

  await ctx.db.patch(skill._id, {
    slug: newSlug,
    updatedAt: now,
  });
  await releaseActiveReservationsForSlug(ctx, newSlug, now);

  if (previousAlias) {
    await ctx.db.patch(previousAlias._id, {
      skillId: skill._id,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("skillSlugAliases", {
      slug: skill.slug,
      skillId: skill._id,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
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
  await assertCanManageOwnedResource(ctx, {
    actor: user,
    ownerUserId: source.ownerUserId,
    ownerPublisherId: source.ownerPublisherId,
  });
  await assertCanManageOwnedResource(ctx, {
    actor: user,
    ownerUserId: target.ownerUserId,
    ownerPublisherId: target.ownerPublisherId,
  });

  const targetLatestVersion = target.latestVersionId
    ? await ctx.db.get(target.latestVersionId)
    : null;
  const targetCanonicalSkillId = target.canonicalSkillId ?? target._id;

  const targetAliases = await listSkillSlugAliasesForSkill(ctx, target._id);
  const targetAliasSlugs = new Set(targetAliases.map((alias) => alias.slug));
  const aliases = await listSkillSlugAliasesForSkill(ctx, source._id);
  const sourceAlias = await getSkillSlugAliasBySlug(ctx, source.slug);
  const addedSkillAliasSlugs = new Set<string>();
  const addedOwnerAliasSlugs = new Set<string>();

  for (const alias of aliases) {
    if (alias.slug === target.slug) continue;
    if (!targetAliasSlugs.has(alias.slug)) {
      addedSkillAliasSlugs.add(alias.slug);
    }
    if (!sameSkillSlugAliasOwner(alias, target.ownerUserId, target.ownerPublisherId)) {
      addedOwnerAliasSlugs.add(alias.slug);
    }
  }
  if (sourceAlias) {
    if (sourceAlias.skillId !== target._id && !targetAliasSlugs.has(source.slug)) {
      addedSkillAliasSlugs.add(source.slug);
    }
    if (!sameSkillSlugAliasOwner(sourceAlias, target.ownerUserId, target.ownerPublisherId)) {
      addedOwnerAliasSlugs.add(source.slug);
    }
  } else {
    if (!targetAliasSlugs.has(source.slug)) {
      addedSkillAliasSlugs.add(source.slug);
    }
    addedOwnerAliasSlugs.add(source.slug);
  }

  await assertSkillSlugAliasQuota(ctx, {
    targetSkillId: target._id,
    ownerUserId: target.ownerUserId,
    ownerPublisherId: target.ownerPublisherId,
    currentSkillAliasCount: targetAliases.length,
    addedSkillAliases: addedSkillAliasSlugs.size,
    addedOwnerAliases: addedOwnerAliasSlugs.size,
  });

  for (const alias of aliases) {
    if (alias.slug === target.slug) {
      await ctx.db.delete(alias._id);
      continue;
    }
    await ctx.db.patch(alias._id, {
      skillId: target._id,
      ownerUserId: target.ownerUserId,
      ownerPublisherId: target.ownerPublisherId,
      updatedAt: now,
    });
  }

  if (sourceAlias) {
    await ctx.db.patch(sourceAlias._id, {
      skillId: target._id,
      ownerUserId: target.ownerUserId,
      ownerPublisherId: target.ownerPublisherId,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("skillSlugAliases", {
      slug: source.slug,
      skillId: target._id,
      ownerUserId: target.ownerUserId,
      ownerPublisherId: target.ownerPublisherId,
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
  await adjustUserSkillStatsForSkillChange(ctx, source, nextSkill);
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
    ownerPublisherId?: Id<"publishers"> | null;
    now: number;
  },
) {
  const patch: Partial<Doc<"skills">> = {
    ownerUserId: params.ownerUserId,
    lastReviewedAt: params.now,
    updatedAt: params.now,
  };
  if ("ownerPublisherId" in params) {
    patch.ownerPublisherId = params.ownerPublisherId ?? undefined;
  }

  const ownerChanged = params.skill.ownerUserId !== params.ownerUserId;
  const publisherChanged =
    "ownerPublisherId" in params && params.skill.ownerPublisherId !== params.ownerPublisherId;
  if (!ownerChanged && !publisherChanged) return;

  await ctx.db.patch(params.skill._id, patch);

  const aliases = await listSkillSlugAliasesForSkill(ctx, params.skill._id);
  for (const alias of aliases) {
    await ctx.db.patch(alias._id, {
      ownerUserId: params.ownerUserId,
      ...("ownerPublisherId" in params
        ? { ownerPublisherId: params.ownerPublisherId ?? undefined }
        : {}),
      updatedAt: params.now,
    });
  }

  if (ownerChanged) {
    const embeddings = await listSkillEmbeddingsForSkill(ctx, params.skill._id);
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        ownerId: params.ownerUserId,
        updatedAt: params.now,
      });
    }
    await adjustUserSkillStatsForSkillChange(ctx, params.skill, {
      ...params.skill,
      ...patch,
    });
  }
}

async function syncSkillSearchDigestForSkillDoc(ctx: MutationCtx, skill: Doc<"skills">) {
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: skill.ownerPublisherId,
    ownerUserId: skill.ownerUserId,
  });
  await upsertSkillSearchDigest(ctx, {
    ...extractDigestFields(skill),
    ownerHandle: owner?.handle ?? "",
    ownerKind: owner?.kind,
    ownerName: owner?.linkedUserId ? owner.handle : undefined,
    ownerDisplayName: owner?.displayName,
    ownerImage: owner?.image,
  });
}

async function canManagePublisherDestination(
  ctx: MutationCtx,
  actor: Doc<"users">,
  publisher: Doc<"publishers">,
) {
  if (actor.role === "admin") return true;
  if (publisher.kind === "user" && publisher.linkedUserId === actor._id) return true;
  const membership = await getPublisherMembership(ctx, publisher._id, actor._id);
  return Boolean(membership && isPublisherRoleAllowed(membership.role, ["admin"]));
}

export const transferSkillOwnerForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    toOwner: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

    const slug = normalizeSkillSlug(args.slug);
    if (!slug) throw new ConvexError("Skill slug required");
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");

    await assertCanManageOwnedResource(ctx, {
      actor,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      allowedPublisherRoles: ["admin"],
      allowPlatformAdmin: true,
    });

    const destinationHandle = normalizePublisherHandle(args.toOwner);
    if (!destinationHandle) throw new ConvexError("Destination owner is required");
    const destinationPublisher = await getPublisherByHandle(ctx, destinationHandle);
    if (!destinationPublisher || !isPublisherActive(destinationPublisher)) {
      throw new ConvexError(`Publisher "@${destinationHandle}" not found`);
    }
    if (!(await canManagePublisherDestination(ctx, actor, destinationPublisher))) {
      throw new ConvexError(
        `You do not have admin access for "@${destinationHandle}". Ask an owner or admin to add you before transferring this skill.`,
      );
    }

    const nextOwner =
      destinationPublisher.kind === "user" && destinationPublisher.linkedUserId
        ? await ctx.db.get(destinationPublisher.linkedUserId)
        : actor;
    if (!nextOwner || nextOwner.deletedAt || nextOwner.deactivatedAt) {
      throw new ConvexError("Destination owner user not found");
    }

    const now = Date.now();
    await transferSkillOwnershipAndEmbeddings(ctx, {
      skill,
      ownerUserId: nextOwner._id,
      ownerPublisherId: destinationPublisher._id,
      now,
    });
    await syncSkillSearchDigestForSkillDoc(ctx, {
      ...skill,
      ownerUserId: nextOwner._id,
      ownerPublisherId: destinationPublisher._id,
      lastReviewedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "skill.owner.transfer",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug: skill.slug,
        previousOwnerUserId: skill.ownerUserId,
        previousOwnerPublisherId: skill.ownerPublisherId,
        nextOwnerUserId: nextOwner._id,
        nextOwnerPublisherId: destinationPublisher._id,
        reason: args.reason || undefined,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      transferred: true as const,
      skillSlug: skill.slug,
      toPublisherHandle: destinationPublisher.handle,
      ownerUserId: nextOwner._id,
      ownerPublisherId: destinationPublisher._id,
    };
  },
});

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

export const reserveSlugInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    rightfulOwnerUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Slug required");

    const rightfulOwner = await ctx.db.get(args.rightfulOwnerUserId);
    if (!rightfulOwner || rightfulOwner.deletedAt || rightfulOwner.deactivatedAt) {
      throw new Error("Rightful owner not found");
    }

    const now = Date.now();
    const existingSkill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (existingSkill) {
      if (existingSkill.ownerUserId !== args.rightfulOwnerUserId) {
        throw new Error("Slug already exists and belongs to another owner");
      }

      await releaseActiveReservationsForSlug(ctx, slug, now);
      await ctx.db.insert("auditLogs", {
        actorUserId: args.actorUserId,
        action: "slug.reserve",
        targetType: "slug",
        targetId: slug,
        metadata: {
          slug,
          rightfulOwnerUserId: args.rightfulOwnerUserId,
          action: "already_owned",
          reason: args.reason || undefined,
        },
        createdAt: now,
      });
      return { ok: true as const, action: "already_owned" as const };
    }

    await upsertReservedSlugForRightfulOwner(ctx, {
      slug,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      deletedAt: now,
      expiresAt: now + SLUG_RESERVATION_MS,
      reason: args.reason || "slug.reserved",
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "slug.reserve",
      targetType: "slug",
      targetId: slug,
      metadata: {
        slug,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        reason: args.reason || undefined,
      },
      createdAt: now,
    });

    return { ok: true as const, action: "reserved" as const };
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

export const setSkillCapabilityTags = mutation({
  args: { skillId: v.id("skills"), capabilityTags: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const invalidTags = args.capabilityTags.filter(
      (tag) => !SKILL_CAPABILITY_TAGS.includes(tag as (typeof SKILL_CAPABILITY_TAGS)[number]),
    );
    if (invalidTags.length > 0) {
      throw new ConvexError(`Unknown capability tags: ${invalidTags.join(", ")}`);
    }

    const selectedTags = new Set(args.capabilityTags);
    const normalizedTags = SKILL_CAPABILITY_TAGS.filter((tag) => selectedTags.has(tag));
    const now = Date.now();

    if (skill.latestVersionId) {
      const latestVersion = await ctx.db.get(skill.latestVersionId);
      if (latestVersion) {
        await ctx.db.patch(latestVersion._id, {
          capabilityTags: normalizedTags.length ? normalizedTags : undefined,
        });
      }
    }

    const nextSkill = {
      ...skill,
      capabilityTags: normalizedTags.length ? normalizedTags : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    };

    await ctx.db.patch(skill._id, {
      capabilityTags: nextSkill.capabilityTags,
      lastReviewedAt: now,
      updatedAt: now,
    });

    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: nextSkill.ownerPublisherId,
      ownerUserId: nextSkill.ownerUserId,
    });
    await upsertSkillSearchDigest(ctx, {
      ...extractDigestFields(nextSkill),
      ownerHandle: owner?.handle ?? "",
      ownerKind: owner?.kind,
      ownerName: owner?.linkedUserId ? owner.handle : undefined,
      ownerDisplayName: owner?.displayName,
      ownerImage: owner?.image,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "skill.capability_tags.set",
      targetType: "skill",
      targetId: skill._id,
      metadata: { capabilityTags: normalizedTags },
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
    // Explicit opt-in to owner migration. When an existing skill row already has
    // a different `ownerPublisherId` than the one supplied above, the mutation
    // only rewrites ownership if `migrateOwner === true`. Without this flag the
    // mismatch is surfaced as a slug-collision error (the pre-org-migration
    // behaviour), so a silently-different Owner value in an older CLI or a
    // wrongly-defaulted form cannot re-own an org-owned skill by accident.
    migrateOwner: v.optional(v.boolean()),
    slug: v.string(),
    displayName: v.string(),
    // Skill icon hint chosen by the publisher (e.g. `lucide:Plug`). Optional;
    // omitted on backport publishes to preserve the existing skill icon.
    icon: v.optional(v.string()),
    version: v.string(),
    changelog: v.string(),
    clawScanNote: v.optional(v.string()),
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
    capabilityTags: v.optional(v.array(v.string())),
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
    // Lenient normalization first so we can look up an existing skill row
    // before deciding whether to enforce the strict write-path validator.
    // Owners of grandfathered slugs (reserved, <3 chars, >48 chars, or other
    // pre-validator shapes) must remain able to publish new versions; the
    // strict reserved/length/pattern rules only apply when creating a brand
    // new skill. The caller (publishVersionForUser) performs the same split,
    // but the mutation re-validates defensively because it can be invoked on
    // its own (e.g. tests, internal schedulers).
    const normalizedSlug = normalizeSkillSlug(args.slug);
    if (!normalizedSlug) throw new ConvexError("Slug is required.");
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");
    const personalPublisher = await ensurePersonalPublisherForUser(ctx, user, {
      actorUserId: userId,
      source: "skill.publish",
    });
    if (!personalPublisher) throw new ConvexError("Personal publisher not found");
    // `callerExplicitlySpecifiedOwner` distinguishes the two semantically
    // different reasons we end up with `ownerPublisherId === personalPublisher._id`:
    //   1. the caller explicitly asked to publish under their own personal
    //      publisher (we still allow migration in that case — moving from an
    //      org back to personal is symmetric to the org-migration flow), or
    //   2. the caller simply didn't pass the field (e.g. older CLI builds).
    // We only treat case (2) as "no migration intent", so that a silent client
    // upgrade can never re-own an org-owned skill into a personal namespace.
    const callerExplicitlySpecifiedOwner = args.ownerPublisherId !== undefined;
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
      .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
      .unique();

    if (skill && skill.softDeletedAt && skill.ownerUserId !== userId) {
      const unpublishedReservationExpiresAt = getUnpublishedSlugReservationExpiresAt(skill);
      if (unpublishedReservationExpiresAt !== null) {
        if (unpublishedReservationExpiresAt > now) {
          throw new ConvexError(
            formatUnpublishedSlugReservationMessage(
              normalizedSlug,
              unpublishedReservationExpiresAt,
            ),
          );
        }
        normalizeSkillSlugForWrite(args.slug);
        await releaseExpiredUnpublishedSkillSlug(ctx, skill, now, userId);
        skill = null;
      }
    }

    // Only enforce the strict write-path rules when creating a new skill.
    // For existing rows, keep the already-persisted (possibly grandfathered)
    // slug as-is so legacy publishers are not locked out of version updates.
    const slug = skill ? normalizedSlug : normalizeSkillSlugForWrite(args.slug);

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
      // Owner migration: allow publishing under a different publisher (e.g. moving
      // a skill from a personal publisher into an org, or between orgs) only when
      // the caller has sufficient authority on BOTH sides AND has explicitly
      // opted into a migration.
      //
      // Authority model — aligned with `transferPackage` in convex/packages.ts:
      //   * destination side — publisher-level rights were already enforced above
      //     (`requirePublisherRole(..., ["publisher"])`) when the caller is
      //     publishing into an org. That is enough for *publishing* into the
      //     destination, but *transferring ownership into* it is a stronger
      //     operation, so on the migration path we additionally require ADMIN
      //     rights on the destination publisher. Moving a skill into the
      //     caller's own personal publisher is still allowed because
      //     `ensurePersonalPublisherForUser` guarantees the caller is the
      //     publisher's `linkedUser` with role `owner` (>= admin).
      //   * source side — must be ADMIN on the source publisher (or the linked
      //     personal-publisher user themselves). This matches the transfer spec:
      //     moving a skill *out* of an org is an ownership change, so a plain
      //     "publisher" role member must not be able to trigger it by republishing.
      //
      // We also require the caller to have *explicitly* asked to publish under
      // a specific publisher (`args.ownerPublisherId !== undefined`) AND to
      // have explicitly signalled migration intent (`args.migrateOwner === true`).
      // Older clients that just call `publishVersion` without an owner param, or
      // newer clients where the Owner selector defaulted to the caller's
      // personal publisher, would otherwise accidentally migrate org-owned
      // skills on every publish.
      //
      // Defense in depth: `addMember` does not currently require publisher.kind ===
      // "org", so in principle a user-kind ("personal") publisher can end up with
      // extra members beyond its linkedUser. We refuse migration *out* of a
      // user-kind publisher unless the caller IS its linkedUser, so the only
      // way to move a personal skill is "the owner themselves decides to move
      // it" — never "a third party who happens to share a publisher row".
      // Legacy personal publisher rows may be missing `linkedUserId`, so the
      // persisted skill owner is accepted as the compatibility fallback.
      const callerRequestedMigration = args.migrateOwner === true;
      const sourcePublisher = await ctx.db.get(skill.ownerPublisherId);
      const callerOwnsSourceViaPersonalLink =
        sourcePublisher?.kind === "user" &&
        (sourcePublisher.linkedUserId === userId || skill.ownerUserId === userId);
      const sourceIsOrg = sourcePublisher?.kind === "org";

      const sourceMembership =
        callerExplicitlySpecifiedOwner && callerRequestedMigration && sourceIsOrg
          ? await getPublisherMembership(ctx, skill.ownerPublisherId, userId)
          : null;
      const callerHasSourceAdminRole = Boolean(
        sourceMembership && isPublisherRoleAllowed(sourceMembership.role, ["admin"]),
      );
      const callerCanPublishFromSource =
        callerExplicitlySpecifiedOwner &&
        callerRequestedMigration &&
        (callerOwnsSourceViaPersonalLink || callerHasSourceAdminRole);

      if (!callerCanPublishFromSource) {
        const owner = await getOwnerPublisher(ctx, {
          ownerPublisherId: skill.ownerPublisherId,
          ownerUserId: skill.ownerUserId,
        });
        throw new ConvexError(buildSlugTakenErrorMessage(skill, owner));
      }

      // Destination admin check: publishing into a publisher only requires
      // publisher-level rights, but *transferring ownership into* a publisher
      // requires admin-level rights on that destination too. For the caller's
      // own personal publisher this is trivially satisfied (linkedUser ===
      // role "owner"); for an org destination this rejects plain publishers.
      await requirePublisherRole(ctx, {
        publisherId: ownerPublisherId,
        userId,
        allowed: ["admin"],
      });

      const previousOwnerPublisherId = skill.ownerPublisherId;
      const previousOwnerUserId = skill.ownerUserId;

      const nextSkill: Doc<"skills"> = {
        ...skill,
        ownerPublisherId,
        ownerUserId: userId,
        updatedAt: now,
      };

      await ctx.db.patch(skill._id, {
        ownerPublisherId,
        ownerUserId: userId,
        updatedAt: now,
      });

      // Reassign per-user counters from the previous owner to the new one.
      // Without this, `users.publishedSkills / totalStars / totalDownloads`
      // would still credit the source owner after an org→org or
      // personal→org migration (and double-count once the new owner
      // publishes anything else). `adjustUserSkillStatsForSkillChange`
      // already handles the cross-owner move cleanly — this mirrors the
      // moderator `changeOwner` path above.
      await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);

      // Keep `skillEmbeddings.ownerId` in sync with the skill's owner so
      // "authored by" queries/filters and embedding-side access checks
      // don't keep resolving to the previous owner after the migration.
      const embeddings = await listSkillEmbeddingsForSkill(ctx, skill._id);
      for (const embedding of embeddings) {
        if (embedding.ownerId === userId) continue;
        await ctx.db.patch(embedding._id, {
          ownerId: userId,
          updatedAt: now,
        });
      }

      // Keep existing slug aliases pointed at the new owner so old URLs still
      // resolve correctly while the canonical page moves (the `$owner/$slug`
      // loader already redirects to the canonical owner handle on read).
      const aliases = await listSkillSlugAliasesForSkill(ctx, skill._id);
      for (const alias of aliases) {
        await ctx.db.patch(alias._id, {
          ownerPublisherId,
          ownerUserId: userId,
          updatedAt: now,
        });
      }

      await ctx.db.insert("auditLogs", {
        actorUserId: userId,
        action: "skill.ownership.migrate",
        targetType: "skill",
        targetId: skill._id,
        metadata: {
          reason: "publishVersion.ownerMigration",
          from: {
            ownerPublisherId: previousOwnerPublisherId,
            ownerUserId: previousOwnerUserId,
          },
          to: {
            ownerPublisherId,
            ownerUserId: userId,
          },
        },
        createdAt: now,
      });

      skill = nextSkill;
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

    const staticSnapshot = buildModerationSnapshot({
      staticScan: args.staticScan,
    });
    const isPublisherUnderModeration = Boolean(user.requiresModerationAt);
    const isStaticMalicious = staticSnapshot.verdict === "malicious";
    const initialModerationStatus =
      isStaticMalicious || isQualityQuarantine || isPublisherUnderModeration ? "hidden" : "active";

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
        icon: normalizeSkillIconValue(args.icon),
        ownerUserId: userId,
        ownerPublisherId,
        canonicalSkillId,
        forkOf,
        latestVersionId: undefined,
        tags: {},
        capabilityTags: args.capabilityTags,
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
        await adjustUserSkillStatsForSkillChange(ctx, null, skill);
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

    const clawScanNote = normalizeClawScanNoteForWrite(args.clawScanNote);

    const versionId = await ctx.db.insert("skillVersions", {
      skillId: skill._id,
      version: args.version,
      fingerprint: args.fingerprint,
      changelog: args.changelog,
      ...(clawScanNote ? { clawScanNote } : {}),
      changelogSource: args.changelogSource,
      files: args.files,
      parsed: args.parsed,
      capabilityTags: args.capabilityTags,
      staticScan: args.staticScan,
      createdBy: userId,
      createdAt: now,
      softDeletedAt: undefined,
    });

    // Only promote this version to `latest` if it is strictly greater than the
    // currently published latest version (by semver). This allows backport /
    // hotfix publishes on lower version lines (e.g. shipping 1.0.1 while 2.x is
    // live) without clobbering the latest pointer, tag, embedding, or summary.
    //
    // The schema only enforces `v.string()` on `latestVersionSummary.version`,
    // so legacy / imported skills may persist non-semver values (e.g. "latest",
    // "2024-12"). Calling `semver.gt` with a malformed right-hand operand
    // throws `TypeError: Invalid Version`, which would crash the publish
    // mutation. Short-circuit to treating the incoming publish as the new
    // latest in that case, which self-heals the skill back into a valid
    // semver latest pointer (args.version is already validated upstream in
    // publishVersionForUser / githubImport).
    const prevLatestVersion = skill.latestVersionSummary?.version;
    const isNewLatest =
      !prevLatestVersion ||
      !semver.valid(prevLatestVersion) ||
      semver.gt(args.version, prevLatestVersion);

    const nextTags: Record<string, Id<"skillVersions">> = { ...skill.tags };
    if (isNewLatest) {
      nextTags.latest = versionId;
    }
    // `latest` is a reserved tag: it is managed exclusively by the semver
    // comparison above so that backport publishes cannot clobber the latest
    // pointer. Silently drop it (case-insensitively) from caller-provided tags
    // to prevent a trivial bypass via args.tags: ["latest"].
    for (const tag of args.tags ?? []) {
      if (tag.toLowerCase() === "latest") continue;
      nextTags[tag] = versionId;
    }

    const latestBefore = skill.latestVersionId;

    const derivedSummary =
      args.summary ?? getFrontmatterValue(args.parsed.frontmatter, "description") ?? skill.summary;
    // Skill-level fields (displayName / summary / capabilityTags) should only
    // follow the latest version. Backport publishes must not leak their values
    // into the skill card shown on the listing / detail pages.
    const nextSummary = isNewLatest ? derivedSummary : skill.summary;
    // Backport publishes must not promote their displayName/summary onto the
    // skill card (see basePatch below), so the moderation evaluation must use
    // the same values that will actually be persisted. Otherwise we would
    // persist flags derived from text the user can never see on the card.
    const nextDisplayName = isNewLatest ? args.displayName : skill.displayName;
    // Skill icon follows the same "only update on new latest" rule as
    // displayName / summary so backport publishes can't surprise the card.
    // Only update when the publisher explicitly picked one this time —
    // omitting `args.icon` keeps the previously stored value.
    const nextIcon =
      isNewLatest && args.icon !== undefined ? normalizeSkillIconValue(args.icon) : skill.icon;
    const derivedFlags = deriveModerationFlags({
      skill: {
        slug: skill.slug,
        displayName: nextDisplayName,
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
      displayName: nextDisplayName,
      summary: nextSummary ?? undefined,
      icon: nextIcon,
      ownerPublisherId: skill.ownerPublisherId ?? ownerPublisherId,
      latestVersionId: isNewLatest ? versionId : skill.latestVersionId,
      latestVersionSummary: isNewLatest
        ? {
            version: args.version,
            createdAt: now,
            changelog: args.changelog,
            changelogSource: args.changelogSource,
            clawdis: args.parsed.clawdis,
          }
        : skill.latestVersionSummary,
      tags: nextTags,
      capabilityTags: isNewLatest ? args.capabilityTags : skill.capabilityTags,
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
      unpublishedSlugReservedUntil: undefined,
      unpublishedSlugReleasedAt: undefined,
      unpublishedOriginalSlug: undefined,
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
      const trigger =
        moderationSnapshot.reasonCodes.find((code) => code.startsWith("malicious.")) ??
        "static.malicious";
      await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
        ownerUserId: skill.ownerUserId,
        slug: skill.slug,
        trigger,
      });
    }

    const badgeMap = await getSkillBadgeMap(ctx, skill._id);
    const isApproved = Boolean(badgeMap.redactionApproved);

    const embeddingId = await ctx.db.insert("skillEmbeddings", {
      skillId: skill._id,
      versionId,
      ownerId: userId,
      embedding: args.embedding,
      isLatest: isNewLatest,
      isApproved,
      visibility: embeddingVisibilityFor(isNewLatest, isApproved),
      updatedAt: now,
    });
    // Lightweight lookup so search hydration can skip reading the 12KB embedding doc
    await ctx.db.insert("embeddingSkillMap", {
      embeddingId,
      skillId: skill._id,
    });

    // Only demote the previous latest embedding when this publish actually
    // replaces `latest`. Backport publishes must leave the existing latest
    // embedding untouched so vector search keeps returning the right version.
    if (isNewLatest && latestBefore) {
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

async function isOwnerInitiatedSkillHideForActor(
  ctx: MutationCtx,
  skill: Pick<Doc<"skills">, "ownerUserId" | "ownerPublisherId" | "hiddenBy">,
  actorUserId: Id<"users">,
) {
  if (skill.hiddenBy === actorUserId) return true;
  if (!skill.hiddenBy) return false;

  const hiddenBy = await ctx.db.get(skill.hiddenBy);
  if (!hiddenBy || hiddenBy.deletedAt || hiddenBy.deactivatedAt) return false;
  if (hiddenBy.role === "admin" || hiddenBy.role === "moderator") return false;

  try {
    await assertCanManageOwnedResource(ctx, {
      actor: hiddenBy,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      allowedPublisherRoles: ["admin"],
    });
    return true;
  } catch (error) {
    if (error instanceof ConvexError || error instanceof Error) return false;
    throw error;
  }
}

export const setSkillSoftDeletedInternal = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    deleted: v.boolean(),
    reason: v.optional(v.string()),
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

    const isModeratorOrAdmin = user.role === "admin" || user.role === "moderator";
    let isOwner = skill.ownerUserId === args.userId;

    if (!isOwner) {
      try {
        await assertCanManageOwnedResource(ctx, {
          actor: user,
          ownerUserId: skill.ownerUserId,
          ownerPublisherId: skill.ownerPublisherId,
          allowedPublisherRoles: ["admin"],
        });
        isOwner = true;
      } catch {
        if (!isModeratorOrAdmin) {
          // Preserve legacy behavior: delegate to assertModerator to produce the
          // standard "Forbidden" error for non-owners without elevated roles.
          assertModerator(user);
        }
      }
    }

    // Owner-delete provenance guard: an owner must NOT be able to "re-delete"
    // a skill that is currently in a non-owner-initiated hidden state. Such
    // a re-delete would rewrite `hiddenBy` to the owner (and clear
    // `moderationReason` via the data-hygiene reset below), erasing the
    // moderator/system provenance of the current hide and letting a
    // subsequent owner-undelete succeed — a privilege-escalation path where
    // the owner reverses moderator actions in two calls (delete, then
    // undelete).
    //
    // We only guard against hides whose current source is NOT the owner:
    //   - skill.hiddenBy === owner: the current hide was owner-initiated
    //     (e.g. a prior `clawhub delete`); re-delete is effectively a
    //     no-op and must remain idempotent.
    //   - skill.hiddenBy is some moderator/admin/system actor, OR is
    //     undefined while the row is hidden (e.g. `auto.reports` does not
    //     write hiddenBy): the hide is not owner-initiated, so block the
    //     owner from re-delete. Moderators/admins keep full access via the
    //     existing `isModeratorOrAdmin` branch.
    //
    // Staleness note: if a moderator previously restored the row
    // (`setSoftDeleted(deleted=false)`), `hiddenBy` is cleared and
    // `moderationStatus === "active"`, so this guard does NOT fire on
    // active rows — the existing data-hygiene reset continues to handle
    // stale `moderationReason` on active rows.
    if (args.deleted && isOwner && !isModeratorOrAdmin) {
      const isCurrentlyHidden = Boolean(skill.softDeletedAt) || skill.moderationStatus === "hidden";
      const isOwnerInitiatedHide = await isOwnerInitiatedSkillHideForActor(ctx, skill, args.userId);
      if (isCurrentlyHidden && !isOwnerInitiatedHide) {
        // Prefix with "Forbidden:" so HTTP boundary mappers
        // (softDeleteErrorToResponse) deterministically return 403 instead of
        // falling through to 500.
        throw new ConvexError(
          "Forbidden: This skill is currently hidden by moderation and cannot be re-deleted by the owner. Please contact a moderator.",
        );
      }
    }

    // gate: when an owner (without moderator/admin privileges) attempts to
    // undelete a skill, only allow it if the current hidden state was produced
    // by the owner themselves (i.e. via `clawhub delete`). Any other hidden
    // state originates from moderation, scanning, merges, bans, or security
    // redaction — only moderators/admins may lift those.
    //
    // Authorization is based on the *source of the current hide* (`hiddenBy`),
    // plus a small deny list of `moderationReason` values that are truly
    // bound to a non-owner current hide and therefore cannot be stale from
    // historical moderation metadata.
    //
    //   - `hiddenBy === args.userId` is the necessary baseline. A moderator
    //     hiding via `setSoftDeleted` records `hiddenBy = mod._id`, so the
    //     owner simply fails this check. A security redaction / auto-ban
    //     likewise records an admin/system actor, so those naturally fail.
    //   - The deny list below is intentionally narrow: each entry is a
    //     reason that is *only* set atomically with the current hide it
    //     describes, so it cannot be leftover historical metadata:
    //       * "owner.merged": merge mutation writes moderationReason,
    //         softDeletedAt, and hiddenBy as a single atomic patch; there
    //         is no flow that later restores the row while leaving this
    //         reason stale.
    //       * "user.banned": only written by the ban batch with
    //         hiddenBy = admin; unban clears softDeletedAt and rewrites
    //         moderationReason to "restored.unban", so a banned row never
    //         survives into an active state with this reason.
    //       * "security.redaction": paired with hiddenBy = security-admin;
    //         there is no owner-reachable path that lifts redaction while
    //         leaving this reason in place.
    //     Notably EXCLUDED:
    //       * "auto.reports" / "manual.report" — set by auto-hide or the
    //         moderator report-triage flow, but `setSoftDeleted(deleted=
    //         false)` (moderator restore) does NOT clear moderationReason.
    //         That means a row can be `moderationStatus="active"` with a
    //         stale `"auto.reports"` reason; if the owner later does a
    //         normal self-delete, `hiddenBy` becomes the owner and the
    //         current hide is owner-initiated, but the stale reason would
    //         still block self-undelete. These are therefore enforced
    //         solely via `hiddenBy !== owner` (auto.reports does not write
    //         hiddenBy; manual.report writes hiddenBy = mod._id).
    //       * "pending.scan.stale" / "pending.scan" / "scanner.*.*" — these
    //         describe the skill's moderation state, not the cause of the
    //         current hide, and must never block owner self-restore.
    //   - Benign scanner / pipeline reasons such as `pending.scan`,
    //     `scanner.aggregate.clean`, or `scanner.<scanner>.clean` describe
    //     the skill's moderation state, not the cause of the current hide,
    //     so they must NOT block owner self-restore.
    //   - If `hiddenBy` is somehow missing (legacy rows, manual override
    //     pathways that cleared it), fail closed and route the caller to a
    //     moderator.
    if (!args.deleted && isOwner && !isModeratorOrAdmin) {
      // Defense-in-depth: regardless of `hiddenBy`/`moderationReason`
      // provenance, an owner must NEVER be able to restore a skill that any
      // scanner has marked malicious. This closes a class of bugs where a
      // stale owner-initiated hide is left in place while a later scanner
      // escalation upgrades the verdict to malicious without rewriting
      // provenance fields (e.g. the VT-only escalation path intentionally
      // does not overwrite `moderationReason` to preserve the LLM verdict).
      const moderationFlags = (skill.moderationFlags as string[] | undefined) ?? [];
      const isMaliciousBlocked =
        moderationFlags.includes("blocked.malware") || skill.moderationVerdict === "malicious";
      if (isMaliciousBlocked) {
        throw new ConvexError(
          "Forbidden: This skill was blocked by automated malware detection and cannot be restored by the owner. Please contact a moderator.",
        );
      }

      // Reasons that are atomically bound to a non-owner current hide and
      // therefore cannot survive as stale historical metadata on an
      // owner-initiated hide. See the block comment above for why each is
      // included, and why report-related reasons are intentionally NOT.
      const OWNER_UNDELETE_DENIED_REASONS = new Set<string>([
        "owner.merged",
        "user.banned",
        "security.redaction",
      ]);
      const reason = skill.moderationReason as string | undefined;
      const ownerInitiatedHide =
        (await isOwnerInitiatedSkillHideForActor(ctx, skill, args.userId)) &&
        (reason === undefined || !OWNER_UNDELETE_DENIED_REASONS.has(reason));
      if (!ownerInitiatedHide) {
        // Prefix with "Forbidden:" so HTTP boundary mappers
        // (softDeleteErrorToResponse) deterministically return 403 instead of
        // falling through to 500. The suffix is preserved for clients that
        // surface a human-readable reason.
        throw new ConvexError(
          "Forbidden: This skill was hidden by moderation and cannot be restored by the owner. Please contact a moderator.",
        );
      }
    }

    const now = Date.now();
    const note = args.reason ? trimManualOverrideNote(args.reason) : undefined;
    const slugReservedUntil =
      args.deleted && isOwner ? now + UNPUBLISHED_SLUG_RESERVATION_MS : undefined;
    const patch: Partial<Doc<"skills">> = {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? "hidden" : "active",
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? args.userId : undefined,
      unpublishedSlugReservedUntil: slugReservedUntil,
      unpublishedSlugReleasedAt: undefined,
      unpublishedOriginalSlug: undefined,
      lastReviewedAt: now,
      updatedAt: now,
    };
    if (note) patch.moderationNotes = note;
    if (!args.deleted && isModeratorOrAdmin && note) {
      const manualOverride = buildManualOverrideRecord({
        note,
        reviewerUserId: user._id,
        updatedAt: now,
      });
      Object.assign(
        patch,
        applyManualOverrideToSkillPatch({
          basePatch: {
            ...patch,
            moderationReasonCodes: undefined,
            moderationEvidence: undefined,
            moderationSummary: undefined,
            moderationEngineVersion: undefined,
            moderationEvaluatedAt: undefined,
            moderationSourceVersionId: undefined,
          },
          override: manualOverride,
          now,
        }),
        {
          manualOverride,
          moderationNotes: note,
        },
      );
    }
    // Data hygiene: when the owner self-deletes (not a moderator/admin acting
    // via this internal entry point), reset any stale `moderationReason`
    // that may have survived from prior moderation metadata (e.g. an
    // `auto.reports` or `manual.report` reason that a moderator restore
    // never cleared). This keeps the row's provenance fields consistent
    // with the current hide (owner-initiated) and prevents a future
    // owner-undelete from tripping on historical reasons.
    if (args.deleted && isOwner && !isModeratorOrAdmin) {
      patch.moderationReason = undefined;
    }
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
    await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);

    await setSkillEmbeddingsSoftDeleted(ctx, skill._id, args.deleted, now);

    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      action: args.deleted ? "skill.delete" : "skill.undelete",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug,
        softDeletedAt: args.deleted ? now : null,
        actorRole: user.role ?? "user",
        ...(slugReservedUntil ? { slugReservedUntil } : {}),
        ...(note ? { reason: note } : {}),
      },
      createdAt: now,
    });

    return slugReservedUntil ? { ok: true as const, slugReservedUntil } : { ok: true as const };
  },
});

export const hideSkillForSecurityRedactionInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("Actor not found");

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Slug required");

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill) throw new Error("Skill not found");
    if (skill.softDeletedAt) return { ok: true as const, changed: false as const };

    const now = Date.now();
    const note = trimManualOverrideNote(args.reason);
    if (!note) throw new Error("Reason required");

    const patch: Partial<Doc<"skills">> = {
      softDeletedAt: now,
      moderationStatus: "hidden",
      moderationReason: "security.redaction",
      moderationNotes: note,
      hiddenAt: now,
      hiddenBy: actor._id,
      unpublishedSlugReservedUntil: undefined,
      unpublishedSlugReleasedAt: undefined,
      unpublishedOriginalSlug: undefined,
      lastReviewedAt: now,
      updatedAt: now,
    };
    const nextSkill = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await adjustGlobalPublicCountForSkillChange(ctx, skill, nextSkill);
    await adjustUserSkillStatsForSkillChange(ctx, skill, nextSkill);
    await setSkillEmbeddingsSoftDeleted(ctx, skill._id, true, now);

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "skill.delete.security_redaction",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug,
        softDeletedAt: now,
        reason: note,
      },
      createdAt: now,
    });

    return { ok: true as const, changed: true as const };
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
