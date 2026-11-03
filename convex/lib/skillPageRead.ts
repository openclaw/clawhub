import { normalizeContentType } from "clawhub-schema/textFiles";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getOptionalActiveAuthUserId } from "./access";
import { getSkillBadgeMap } from "./badges";
import { isPublicSkillDoc } from "./globalStats";
import { toPublicPublisher, toPublicSkill } from "./public";
import { canAccessPublisherOwnerScope, getOwnerPublisher } from "./publishers";
import { selectGeneratedSkillCardFile, selectSkillCardFile } from "./skillCards";
import { isPublicSkillVersionAvailableForSkill } from "./skillFileAccess";
import { readSkillPublicationProgress } from "./skillPublicationProgress";
import { getFrontmatterValue } from "./skills/frontmatterValue";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
  normalizeSkillSlugKey,
  resolveLegacySkillBySlugOrAlias,
  resolvePublisherByOwnerHandle,
  type LegacyAmbiguousSkillMatch,
} from "./skills/slugResolution";
import { isSkillReviewFlagged } from "./skillSafety";

export type PublicSkillVersionParsed = {
  license?: "MIT-0";
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
  sha256hash?: string;
  vtAnalysis?: Doc<"skillVersions">["vtAnalysis"];
  aigAnalysis?: Doc<"skillVersions">["aigAnalysis"];
  skillSpectorAnalysis?: Doc<"skillVersions">["skillSpectorAnalysis"];
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
  generatedSkillCard?: {
    path: string;
    size: number;
    sha256: string;
    contentType?: string;
  } | null;
};

export function skillSummaryFromSkillVersion(
  version: Pick<Doc<"skillVersions">, "parsed"> | null | undefined,
) {
  const presentationSummary = version?.parsed?.presentation?.summary?.trim();
  if (presentationSummary) return presentationSummary;
  return version?.parsed?.frontmatter
    ? getFrontmatterValue(version.parsed.frontmatter, "description")?.trim() || undefined
    : undefined;
}

export async function resolveSkillBySlugOrAlias(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  slug: string,
  options: { includeSoftDeleted?: boolean } = {},
) {
  return await resolveLegacySkillBySlugOrAlias(ctx, slug, options);
}

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

export function toPublicSkillVersion(
  version: Doc<"skillVersions"> | null | undefined,
): PublicSkillVersion | null {
  if (!version) return null;
  const description = skillSummaryFromSkillVersion(version);
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
      contentType: normalizeContentType(file.contentType),
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
    sha256hash: version.sha256hash,
    vtAnalysis: version.vtAnalysis,
    aigAnalysis: version.aigAnalysis,
    skillSpectorAnalysis: version.skillSpectorAnalysis,
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

function toPublicSkillCardFile(file: Doc<"skillVersions">["files"][number]) {
  return {
    path: file.path,
    size: file.size,
    sha256: file.sha256,
    contentType: normalizeContentType(file.contentType),
  };
}

export async function getGeneratedSkillCardPublicFile(
  ctx: Pick<QueryCtx, "db">,
  version: Doc<"skillVersions"> | null,
) {
  if (!version) return null;
  const files = Array.isArray(version.files) ? version.files : [];
  if (!selectSkillCardFile(files)) return null;
  const entries = await ctx.db
    .query("skillVersionFingerprints")
    .withIndex("by_version_kind", (q) =>
      q.eq("versionId", version._id).eq("kind", "generated-bundle"),
    )
    .collect();
  const file = await selectGeneratedSkillCardFile(
    files,
    entries.map((entry) => entry.fingerprint),
  );
  return file ? toPublicSkillCardFile(file) : null;
}

export async function resolveSkillBySlugOrAliasForOwner(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  slug: string,
  ownerHandle?: string,
  options: { includeSoftDeleted?: boolean; includeInactiveOwnerFallback?: boolean } = {},
) {
  let skill: Doc<"skills"> | null = null;
  let requestedSlug = normalizeSkillSlugKey(slug);
  let resolvedSlug: string | null = null;
  if (ownerHandle) {
    const resolvedOwner = await resolvePublisherByOwnerHandle(ctx, ownerHandle);
    const scopedOwnerPublisher = resolvedOwner.publisher;
    if (scopedOwnerPublisher && requestedSlug) {
      skill = await getSkillBySlugForPublisher(ctx, requestedSlug, scopedOwnerPublisher);
      if (skill?.softDeletedAt && !options.includeSoftDeleted) {
        skill = null;
      }
      if (!skill) {
        const alias = await getSkillSlugAliasBySlugForPublisher(
          ctx,
          requestedSlug,
          scopedOwnerPublisher,
        );
        skill = alias ? await ctx.db.get(alias.skillId) : null;
        if (skill?.softDeletedAt && !options.includeSoftDeleted) {
          skill = null;
        }
      }
      resolvedSlug = skill?.slug ?? null;
    }
    if (!skill && options.includeInactiveOwnerFallback) {
      const legacyResolved = await resolveLegacySkillBySlugOrAlias(ctx, requestedSlug, {
        includeSoftDeleted: options.includeSoftDeleted,
        ownerHandle,
      });
      if (legacyResolved.ambiguous) {
        return {
          requestedSlug,
          resolvedSlug,
          skill: null,
          ambiguous: true as const,
          ambiguousMatches: legacyResolved.ambiguousMatches,
        };
      }
      skill = legacyResolved.skill;
      requestedSlug = legacyResolved.requestedSlug;
      resolvedSlug = legacyResolved.resolvedSlug;
    }
  } else {
    const resolved = await resolveSkillBySlugOrAlias(ctx, slug, options);
    if (resolved.ambiguous) {
      return {
        requestedSlug,
        resolvedSlug,
        skill: null,
        ambiguous: true as const,
        ambiguousMatches: resolved.ambiguousMatches,
      };
    }
    skill = resolved.skill;
    requestedSlug = resolved.requestedSlug;
    resolvedSlug = resolved.resolvedSlug;
  }
  return {
    requestedSlug,
    resolvedSlug,
    skill,
    ambiguous: false as const,
    ambiguousMatches: [] as LegacyAmbiguousSkillMatch[],
  };
}

export function isDirectSkillOwner(
  skill: Pick<Doc<"skills">, "ownerUserId" | "ownerPublisherId">,
  userId: Id<"users">,
) {
  return !skill.ownerPublisherId && skill.ownerUserId === userId;
}

export async function readSkillPageBySlug(
  ctx: QueryCtx,
  args: { slug: string; ownerHandle?: string },
) {
  const { skill, requestedSlug, resolvedSlug, ambiguous, ambiguousMatches } =
    await resolveSkillBySlugOrAliasForOwner(ctx, args.slug, args.ownerHandle);
  if (ambiguous) {
    return {
      requestedSlug,
      resolvedSlug,
      skill: null,
      latestVersion: null,
      owner: null,
      pendingReview: false,
      moderationInfo: null,
      forkOf: null,
      canonical: null,
      ambiguous: true as const,
      ambiguousMatches,
    };
  }
  if (!skill) return null;

  const userId = await getOptionalActiveAuthUserId(ctx);
  const ownerPublisher = await getOwnerPublisher(ctx, {
    ownerPublisherId: skill.ownerPublisherId,
    ownerUserId: skill.ownerUserId,
  });
  const skillOwnerPublisher = skill.ownerPublisherId
    ? await ctx.db.get(skill.ownerPublisherId)
    : null;
  const publisherOwner =
    userId && skillOwnerPublisher
      ? await canAccessPublisherOwnerScope(ctx, {
          publisher: skillOwnerPublisher,
          userId,
          legacyOwnerUserId: skill.ownerUserId,
        })
      : false;
  const isOwner = Boolean(userId && (isDirectSkillOwner(skill, userId) || publisherOwner));

  const latestVersionDoc = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
  const publicLatestVersionDoc = isPublicSkillVersionAvailableForSkill(latestVersionDoc, skill._id)
    ? latestVersionDoc
    : null;
  const latestVersion = toPublicSkillVersion(publicLatestVersionDoc);
  const generatedSkillCard = await getGeneratedSkillCardPublicFile(ctx, publicLatestVersionDoc);
  if (latestVersion) latestVersion.generatedSkillCard = generatedSkillCard;
  const owner = toPublicPublisher(ownerPublisher);
  if (!owner) return null;
  const badges = await getSkillBadgeMap(ctx, skill._id);

  const forkOf = await loadPublicSkillReference(ctx, skill.forkOf?.skillId);
  const canonical = await loadPublicSkillReference(ctx, skill.canonicalSkillId);
  const githubSource = skill.githubSourceId ? await ctx.db.get(skill.githubSourceId) : null;
  const githubSourceRepo = skill.githubCurrentRepo ?? githubSource?.repo;

  const publicSkill = toPublicSkill({ ...skill, badges });

  // Determine moderation state
  const isPendingScan =
    skill.moderationStatus === "hidden" && skill.moderationReason === "pending.scan";
  const isMalwareBlocked =
    skill.moderationVerdict === "malicious" ||
    (skill.moderationFlags?.includes("blocked.malware") ?? false);
  const isSuspicious = skill.moderationFlags?.includes("flagged.suspicious") ?? false;
  const isReviewFlagged = isSkillReviewFlagged(skill);
  const isHiddenByMod = skill.moderationStatus === "hidden" && !isPendingScan && !isMalwareBlocked;
  const isRemoved = skill.moderationStatus === "removed";

  if (isMalwareBlocked) return null;

  // Owners can see their non-malicious moderated skills.
  if (!publicSkill && !isOwner) return null;

  // For owners viewing their moderated skill, construct the response manually
  const skillData = publicSkill ?? {
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
    installKind: skill.installKind,
    githubPath: skill.githubPath,
    githubCurrentCommit: skill.githubCurrentCommit,
    githubCurrentStatus: skill.githubCurrentStatus,
    githubScanStatus: skill.githubScanStatus,
    githubHasSkillCard: skill.githubHasSkillCard,
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
    ...(githubSourceRepo ? { githubSourceRepo } : {}),
  };

  // Moderation info - visible to owners for all states, or anyone for flagged skills (transparency)
  const showModerationInfo = isOwner || isMalwareBlocked || isSuspicious || isReviewFlagged;
  const moderationInfo = showModerationInfo
    ? {
        isPendingScan,
        isMalwareBlocked,
        isSuspicious,
        isReviewFlagged,
        isHiddenByMod,
        isRemoved,
        verdict: skill.moderationVerdict,
        reasonCodes: skill.moderationReasonCodes,
        summary: skill.moderationSummary,
        engineVersion: skill.moderationEngineVersion,
        updatedAt: skill.moderationEvaluatedAt,
        sourceVersionId: skill.moderationSourceVersionId ?? null,
        reason: isOwner ? skill.moderationReason : undefined,
      }
    : null;

  return {
    requestedSlug,
    resolvedSlug,
    skill: responseSkillData,
    latestVersion,
    owner,
    pendingReview: isOwner && isPendingScan,
    publicationProgress: isOwner ? await readSkillPublicationProgress(ctx, skill) : null,
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
    ambiguous: false as const,
  };
}
