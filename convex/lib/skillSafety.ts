import type { Doc } from "../_generated/dataModel";

export function isSkillSuspicious(
  _skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
) {
  return false;
}

export function isSkillReviewFlagged(_skill: Pick<Doc<"skills">, "moderationFlags">) {
  return false;
}

/**
 * Legacy compatibility while suspicious storage fields are being removed.
 * Returning undefined prevents new writes from recreating `isSuspicious`.
 */
export function computeIsSuspicious(
  _skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
): undefined {
  return undefined;
}
