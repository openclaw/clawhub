import type { Id } from "../_generated/dataModel";

type SkillFileModerationInfo = {
  isPendingScan?: boolean | null;
  isMalwareBlocked?: boolean | null;
  isHiddenByMod?: boolean | null;
  isRemoved?: boolean | null;
};

type SkillFileAccessBlock = {
  status: number;
  message: string;
};

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
      message: "This skill is pending a ClawScan security review. Please try again in a few minutes.",
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
