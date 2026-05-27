import type { Doc } from "../_generated/dataModel";
import { verdictFromCodes } from "./moderationReasonCodes";

function isScannerSuspiciousReason(reason: string | undefined) {
  if (!reason) return false;
  return reason.startsWith("scanner.") && reason.endsWith(".suspicious");
}

function isScannerMaliciousReason(reason: string | undefined) {
  if (!reason) return false;
  return reason.startsWith("scanner.") && reason.endsWith(".malicious");
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
    | "moderationReasonCodes"
    | "softDeletedAt"
  >,
) {
  const moderationStatus = skill.moderationStatus ?? "active";
  const moderationVerdict =
    skill.moderationVerdict ?? verdictFromCodes(skill.moderationReasonCodes ?? []);
  return (
    skill.softDeletedAt !== undefined ||
    moderationStatus !== "active" ||
    moderationVerdict === "suspicious" ||
    moderationVerdict === "malicious" ||
    skill.isSuspicious ||
    skill.moderationFlags?.includes("flagged.suspicious") ||
    isSkillBlockedByMalware(skill) ||
    isSkillSuspicious(skill) ||
    isScannerMaliciousReason(skill.moderationReason)
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
