import type { Doc } from "../_generated/dataModel";
import { verdictFromCodes } from "./moderationReasonCodes";

type SkillVisibilityFields = Pick<
  Doc<"skills">,
  "softDeletedAt" | "moderationStatus" | "moderationFlags"
> &
  Partial<Pick<Doc<"skills">, "moderationVerdict">>;

export function isPublicSkillDoc<T extends SkillVisibilityFields>(
  skill: T | null | undefined,
): skill is T {
  if (!skill || skill.softDeletedAt) return false;
  if (skill.moderationStatus && skill.moderationStatus !== "active") return false;
  if (skill.moderationVerdict === "malicious") return false;
  if (skill.moderationFlags?.includes("blocked.malware")) return false;
  return true;
}

export function getPublicSkillVisibilityDelta(
  before: SkillVisibilityFields | null | undefined,
  after: SkillVisibilityFields | null | undefined,
) {
  const beforePublic = isPublicSkillDoc(before);
  const afterPublic = isPublicSkillDoc(after);
  if (beforePublic === afterPublic) return 0;
  return afterPublic ? 1 : -1;
}

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
