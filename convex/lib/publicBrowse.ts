import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isPublicSkillDoc } from "./globalStats";
import {
  isSecurityScanStatusBlockedFromPublic,
  normalizeSecurityScanStatus,
} from "./securityScanPolicy";
import { isSkillReviewFlagged, isSkillSuspicious } from "./skillSafety";

type SkillPublicBrowseFields = Pick<
  Doc<"skills">,
  | "softDeletedAt"
  | "moderationStatus"
  | "moderationReason"
  | "moderationFlags"
  | "moderationVerdict"
  | "moderationSourceVersionId"
  | "latestVersionId"
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
  if (isSkillReviewFlagged(skill)) return true;
  return isPendingSkillModerationReason(skill.moderationReason);
}

export function hasPriorApprovedPublicSkillVersion(skill: Pick<Doc<"skills">, "stats">) {
  return (skill.stats?.versions ?? 0) > 1;
}

export function shouldExcludeSkillFromPublicBrowse(skill: SkillPublicBrowseFields) {
  if (!isPublicSkillDoc(skill)) return true;
  if (isSkillSuspicious(skill)) return true;
  if (normalizeSecurityScanStatus(skill.githubScanStatus) === "pending") return true;
  if (!isSkillPendingPublicReview(skill)) return false;
  return !hasPriorApprovedPublicSkillVersion(skill);
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

  if (!hasPriorApprovedPublicSkillVersion(skill)) return null;

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
