import type { Id } from "../_generated/dataModel";

export type SkillFileModerationInfo = {
  isPendingScan?: boolean | null;
  isMalwareBlocked?: boolean | null;
  isHiddenByMod?: boolean | null;
  isRemoved?: boolean | null;
  sourceVersionId?: Id<"skillVersions"> | string | null;
  overrideActive?: boolean | null;
  verdict?: string | null;
};

type SkillVersionSecurityInfo = {
  _id?: Id<"skillVersions"> | string;
  vtAnalysis?: {
    status?: string | null;
    verdict?: string | null;
  } | null;
  llmAnalysis?: {
    status?: string | null;
    verdict?: string | null;
  } | null;
  softDeletedAt?: number | null;
};

type SkillVersionSecuritySource = SkillVersionSecurityInfo & {
  _id: Id<"skillVersions"> | string;
};

type SkillModerationSource = {
  moderationStatus?: string | null;
  moderationReason?: string | null;
  moderationFlags?: string[] | null;
  moderationVerdict?: string | null;
  moderationSourceVersionId?: Id<"skillVersions"> | string | null;
  manualOverride?: boolean | null;
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
    overrideActive: Boolean(skill.manualOverride),
    verdict: skill.moderationVerdict ?? null,
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

export function getPublicSkillVersionFileAccessBlock(
  version: SkillVersionSecurityInfo | null | undefined,
  moderationInfo?: SkillFileModerationInfo | null,
  fallbackModeratedVersionId?: Id<"skillVersions"> | string | null,
): SkillFileAccessBlock | null {
  if (version?._id) {
    const moderationBlock = getPublicSkillVersionAccessBlock(
      moderationInfo,
      version._id,
      fallbackModeratedVersionId,
    );
    if (moderationBlock) return moderationBlock;
  }

  return getVersionSecurityAccessBlock(version, "served");
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

  return getVersionSecurityAccessBlock(version, "downloaded");
}

function getVersionSecurityAccessBlock(
  version: SkillVersionSecurityInfo | null | undefined,
  action: "downloaded" | "served" = "served",
): SkillFileAccessBlock | null {
  if (version?.softDeletedAt) {
    return { status: 410, message: "Version not available" };
  }
  if (hasVersionSecurityStatus(version, "malicious")) {
    return {
      status: 403,
      message:
        `Blocked: this skill version has been flagged as malicious by ClawScan and cannot be ${action}.`,
    };
  }
  if (hasVersionSecurityStatus(version, "pending")) {
    return {
      status: 423,
      message:
        "This skill version is pending a ClawScan security review. Please try again in a few minutes.",
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

export function isPublicSkillVersionAvailableForSkill(
  version:
    | {
        skillId?: Id<"skills"> | string | null;
        softDeletedAt?: number | null;
      }
    | null
    | undefined,
  skillId: Id<"skills"> | string,
) {
  return Boolean(version && !version.softDeletedAt && isSkillVersionForSkill(version, skillId));
}

function hasVersionSecurityStatus(
  version: SkillVersionSecurityInfo | null | undefined,
  status: "malicious" | "pending",
) {
  if (!version) return false;
  return [
    version.vtAnalysis?.verdict,
    version.vtAnalysis?.status,
    version.llmAnalysis?.verdict,
    version.llmAnalysis?.status,
  ].some((value) => normalizeVersionSecurityStatus(value) === status);
}

function normalizeVersionSecurityStatus(value: string | null | undefined) {
  switch (value?.trim().toLowerCase()) {
    case "malicious":
      return "malicious";
    case "pending":
    case "loading":
      return "pending";
    default:
      return null;
  }
}
