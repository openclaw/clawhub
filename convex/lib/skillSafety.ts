import type { Doc } from "../_generated/dataModel";

function isScannerSuspiciousReason(reason: string | undefined) {
  if (!reason) return false;
  return reason.startsWith("scanner.") && reason.endsWith(".suspicious");
}

export function isSkillSuspicious(
  skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
) {
  if (skill.moderationFlags?.includes("flagged.suspicious")) return true;
  return isScannerSuspiciousReason(skill.moderationReason);
}

export function isSkillBlockedByMalware(skill: Pick<Doc<"skills">, "moderationFlags">) {
  return skill.moderationFlags?.includes("blocked.malware") ?? false;
}

export function isSkillTransferBlockedByModeration(
  skill: Pick<
    Doc<"skills">,
    | "moderationStatus"
    | "moderationVerdict"
    | "isSuspicious"
    | "moderationFlags"
    | "moderationReason"
  >,
) {
  const moderationStatus = skill.moderationStatus ?? "active";
  return (
    moderationStatus !== "active" ||
    skill.moderationVerdict === "suspicious" ||
    skill.moderationVerdict === "malicious" ||
    skill.isSuspicious ||
    skill.moderationFlags?.includes("flagged.suspicious") ||
    isSkillBlockedByMalware(skill) ||
    isSkillSuspicious(skill)
  );
}

export function isSkillReviewFlagged(skill: Pick<Doc<"skills">, "moderationFlags">) {
  return skill.moderationFlags?.includes("flagged.review") ?? false;
}

/**
 * Compute the denormalized `isSuspicious` boolean for a skill.
 * Use at every mutation site that writes `moderationFlags` or `moderationReason`.
 */
export function computeIsSuspicious(
  skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
): boolean {
  return isSkillSuspicious(skill);
}
