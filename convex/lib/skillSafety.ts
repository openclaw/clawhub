import type { Doc } from "../_generated/dataModel";
import { resolveSkillVerdict } from "./moderationEngine";

function isScannerSuspiciousReason(reason: string | undefined) {
  if (!reason) return false;
  return reason.startsWith("scanner.") && reason.endsWith(".suspicious");
}

export function isSkillSuspicious(
  skill: Pick<
    Doc<"skills">,
    "moderationVerdict" | "moderationReasonCodes" | "moderationFlags" | "moderationReason"
  >,
) {
  if (resolveSkillVerdict(skill) === "suspicious") return true;
  if (skill.moderationFlags?.includes("flagged.suspicious")) return true;
  return isScannerSuspiciousReason(skill.moderationReason);
}
