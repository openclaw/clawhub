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

/**
 * Compute the denormalized `isSuspicious` boolean for a skill.
 * Use at every mutation site that writes `moderationFlags` or `moderationReason`.
 */
export function computeIsSuspicious(
  skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
): boolean {
  return isSkillSuspicious(skill);
}
