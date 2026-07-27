import type { Id } from "../_generated/dataModel";
import {
  isSecurityScanStatusBlockedFromPublic,
  normalizeSecurityScanStatus,
} from "./securityScanPolicy";

export type SkillFileModerationInfo = {
  isPendingScan?: boolean | null;
  isMalwareBlocked?: boolean | null;
  isHiddenByMod?: boolean | null;
  isRemoved?: boolean | null;
  sourceVersionId?: Id<"skillVersions"> | string | null;
};

type SkillVersionSecuritySource = {
  _id: Id<"skillVersions"> | string;
  publicationStatus?: "pending" | "published" | "blocked" | null;
  llmAnalysis?: {
    status?: string | null;
    verdict?: string | null;
  } | null;
};

type SkillModerationSource = {
  moderationStatus?: string | null;
  moderationReason?: string | null;
  moderationFlags?: string[] | null;
  moderationVerdict?: string | null;
  moderationSourceVersionId?: Id<"skillVersions"> | string | null;
};

type SkillFileAccessBlock = {
  status: number;
  message: string;
};

function isPendingSkillModerationReason(reason: string | null | undefined) {
  const normalized = reason?.trim().toLowerCase();
  return (
    normalized === "pending.scan" ||
    normalized === "pending.scan.stale" ||
    normalized === "scanner.vt.pending" ||
    normalized === "scanner.llm.pending"
  );
}

export function getSkillFileModerationInfoFromSkill(
  skill: SkillModerationSource,
): SkillFileModerationInfo {
  const isPendingScan =
    skill.moderationStatus === "hidden" && isPendingSkillModerationReason(skill.moderationReason);
  const isMalwareBlocked =
    skill.moderationVerdict === "malicious" ||
    (skill.moderationFlags?.includes("blocked.malware") ?? false);
  return {
    isPendingScan,
    isMalwareBlocked,
    isHiddenByMod: skill.moderationStatus === "hidden" && !isPendingScan && !isMalwareBlocked,
    isRemoved: skill.moderationStatus === "removed",
    sourceVersionId: skill.moderationSourceVersionId ?? null,
  };
}

export function getPublicSkillFileAccessBlock(
  moderationInfo: SkillFileModerationInfo | null | undefined,
): SkillFileAccessBlock | null {
  if (moderationInfo?.isMalwareBlocked) {
    return {
      status: 403,
      message:
        "Blocked: this skill has been flagged as malicious by ClawScan and cannot be downloaded.",
    };
  }
  if (moderationInfo?.isPendingScan) {
    return {
      status: 423,
      message:
        "This skill is pending a ClawScan security review. Please try again in a few minutes.",
    };
  }
  if (moderationInfo?.isRemoved) {
    return { status: 410, message: "This skill has been removed by a moderator." };
  }
  if (moderationInfo?.isHiddenByMod) {
    return { status: 403, message: "This skill is currently unavailable." };
  }
  return null;
}

export function getPublicSkillVersionAccessBlock(
  moderationInfo: SkillFileModerationInfo | null | undefined,
  versionId: Id<"skillVersions"> | string,
  fallbackModeratedVersionId?: Id<"skillVersions"> | string | null,
): SkillFileAccessBlock | null {
  const block = getPublicSkillFileAccessBlock(moderationInfo);
  if (!block) return null;
  if (moderationInfo?.isRemoved || moderationInfo?.isHiddenByMod) return block;

  const moderatedVersionId = moderationInfo?.sourceVersionId ?? fallbackModeratedVersionId;
  return moderatedVersionId === versionId ? block : null;
}

export function getPublicSkillVersionDownloadBlock(
  moderationInfo: SkillFileModerationInfo | null | undefined,
  version: SkillVersionSecuritySource,
  fallbackModeratedVersionId?: Id<"skillVersions"> | string | null,
): SkillFileAccessBlock | null {
  const moderationBlock = getPublicSkillVersionAccessBlock(
    moderationInfo,
    version._id,
    fallbackModeratedVersionId,
  );
  if (moderationBlock) return moderationBlock;

  const scanStatus = normalizeSecurityScanStatus(
    version.llmAnalysis?.verdict ?? version.llmAnalysis?.status,
  );
  if (isSecurityScanStatusBlockedFromPublic(scanStatus)) {
    return {
      status: 403,
      message:
        "Blocked: this skill version has been flagged as malicious by ClawScan and cannot be downloaded.",
    };
  }

  return null;
}

export function isSkillVersionForSkill(
  version: { skillId?: Id<"skills"> | string | null } | null | undefined,
  skillId: Id<"skills"> | string,
) {
  return version?.skillId === skillId;
}

export function isPublishedSkillVersion(
  version:
    | {
        publicationStatus?: string | null;
      }
    | null
    | undefined,
) {
  return Boolean(
    version &&
    (version.publicationStatus === undefined || version.publicationStatus === "published"),
  );
}

export function isPublicSkillVersionAvailableForSkill(
  version:
    | {
        skillId?: Id<"skills"> | string | null;
        softDeletedAt?: number | null;
        publicationStatus?: string | null;
      }
    | null
    | undefined,
  skillId: Id<"skills"> | string,
) {
  return Boolean(
    version &&
    !version.softDeletedAt &&
    isPublishedSkillVersion(version) &&
    isSkillVersionForSkill(version, skillId),
  );
}
