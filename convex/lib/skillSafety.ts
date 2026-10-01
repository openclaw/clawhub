import type { Doc } from "../_generated/dataModel";
import { verdictFromCodes } from "./moderationReasonCodes";

type SkillTransferSafetyFields = Pick<
  Doc<"skills">,
  | "moderationStatus"
  | "moderationVerdict"
  | "isSuspicious"
  | "moderationFlags"
  | "moderationReason"
  | "moderationReasonCodes"
  | "softDeletedAt"
  | "forkOf"
>;

const ADMIN_TRANSFER_DENIED_REASONS = new Set([
  "owner.merged",
  "user.banned",
  "security.redaction",
]);

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

function hasUnsafeSkillTransferModeration(skill: SkillTransferSafetyFields) {
  const moderationVerdict =
    skill.moderationVerdict ?? verdictFromCodes(skill.moderationReasonCodes ?? []);
  return (
    moderationVerdict === "suspicious" ||
    moderationVerdict === "malicious" ||
    skill.isSuspicious ||
    skill.moderationFlags?.includes("flagged.suspicious") ||
    isSkillBlockedByMalware(skill) ||
    isSkillSuspicious(skill) ||
    isScannerMaliciousReason(skill.moderationReason)
  );
}

export function isSoftDeletedSkillEligibleForAdminTransfer(skill: SkillTransferSafetyFields) {
  // Hide actor provenance requires DB-backed publisher authorization and is checked transactionally.
  return (
    skill.softDeletedAt !== undefined &&
    (skill.moderationStatus === undefined || skill.moderationStatus === "hidden") &&
    !ADMIN_TRANSFER_DENIED_REASONS.has(skill.moderationReason ?? "") &&
    !hasUnsafeSkillTransferModeration(skill)
  );
}

export function isSkillTransferBlockedByModeration(skill: SkillTransferSafetyFields) {
  const moderationStatus = skill.moderationStatus ?? "active";
  return (
    skill.softDeletedAt !== undefined ||
    moderationStatus !== "active" ||
    hasUnsafeSkillTransferModeration(skill)
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
