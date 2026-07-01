import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isPublicSkillDoc } from "./globalStats";
import {
  isSecurityScanStatusBlockedFromPublic,
  normalizeSecurityScanStatus,
} from "./securityScanPolicy";
import { isSkillSuspicious } from "./skillSafety";

type SkillPublicBrowseFields = Pick<
  Doc<"skills">,
  | "softDeletedAt"
  | "moderationStatus"
  | "moderationReason"
  | "moderationFlags"
  | "moderationVerdict"
  | "moderationSourceVersionId"
  | "latestVersionId"
  | "installKind"
  | "githubScanStatus"
  | "stats"
>;

type SkillVersionPublicBrowseFields = Pick<
  Doc<"skillVersions">,
  | "_id"
  | "skillId"
  | "softDeletedAt"
  | "version"
  | "createdAt"
  | "changelog"
  | "changelogSource"
  | "parsed"
  | "vtAnalysis"
  | "llmAnalysis"
  | "staticScan"
>;

function isPendingSkillModerationReason(reason: string | null | undefined) {
  const normalized = reason?.trim().toLowerCase();
  return (
    normalized === "pending.scan" ||
    normalized === "pending.scan.stale" ||
    normalized === "scanner.vt.pending" ||
    normalized === "scanner.llm.pending"
  );
}

export function isSkillPendingPublicReview(
  skill: Pick<Doc<"skills">, "moderationStatus" | "moderationReason" | "moderationFlags">,
) {
  return isPendingSkillModerationReason(skill.moderationReason);
}

export function isHostedSkillPendingPublicReview(
  skill: Pick<
    Doc<"skills">,
    "installKind" | "moderationStatus" | "moderationReason" | "moderationFlags"
  >,
) {
  return skill.installKind !== "github" && isSkillPendingPublicReview(skill);
}

export function isHostedSkillPendingFirstPublicRelease(
  skill: Pick<
    Doc<"skills">,
    "installKind" | "stats" | "moderationStatus" | "moderationReason" | "moderationFlags"
  >,
) {
  return isHostedSkillPendingPublicReview(skill) && (skill.stats?.versions ?? 0) <= 1;
}

/** Cheap hint that a hosted skill may have an older public version to resolve. */
export function hostedSkillMayHavePriorApprovedVersion(
  skill: Pick<Doc<"skills">, "installKind" | "stats">,
) {
  return skill.installKind !== "github" && (skill.stats?.versions ?? 0) > 1;
}

export function shouldExcludeSkillFromPublicBrowse(skill: SkillPublicBrowseFields) {
  if (!isPublicSkillDoc(skill)) return true;
  if (isSkillSuspicious(skill)) return true;
  return isHostedSkillPendingFirstPublicRelease(skill);
}

export function isPubliclyListableSkillVersion(
  version: SkillVersionPublicBrowseFields | null | undefined,
) {
  if (!version || version.softDeletedAt) return false;
  const statuses = [
    normalizeSecurityScanStatus(version.vtAnalysis?.status),
    normalizeSecurityScanStatus(version.llmAnalysis?.verdict ?? version.llmAnalysis?.status),
    normalizeSecurityScanStatus(version.staticScan?.status),
  ];
  if (statuses.some((status) => status === "pending" || status === "not-run")) return false;
  return !statuses.some((status) => isSecurityScanStatusBlockedFromPublic(status));
}

export async function hasResolvablePublicBrowseVersion(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  skill: SkillPublicBrowseFields & { _id: Id<"skills"> },
) {
  if (shouldExcludeSkillFromPublicBrowse(skill)) return false;
  if (!isHostedSkillPendingPublicReview(skill)) return true;
  return (await resolvePublicBrowseVersionForSkill(ctx, skill)) !== null;
}

export async function resolvePublicBrowseVersionForSkill(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  skill: SkillPublicBrowseFields & { _id: Id<"skills"> },
): Promise<Doc<"skillVersions"> | null> {
  const latestVersionId = skill.latestVersionId;
  if (!latestVersionId) return null;

  if (!isSkillPendingPublicReview(skill)) {
    const latestVersion = await ctx.db.get(latestVersionId);
    return latestVersion &&
      latestVersion.skillId === skill._id &&
      isPubliclyListableSkillVersion(latestVersion)
      ? latestVersion
      : null;
  }

  if (!hostedSkillMayHavePriorApprovedVersion(skill)) return null;

  const versions = await ctx.db
    .query("skillVersions")
    .withIndex("by_skill_active_created", (q) =>
      q.eq("skillId", skill._id).eq("softDeletedAt", undefined),
    )
    .order("desc")
    .take(24);

  for (const version of versions) {
    if (version._id === skill.moderationSourceVersionId) continue;
    if (isPubliclyListableSkillVersion(version)) return version;
  }
  return null;
}
