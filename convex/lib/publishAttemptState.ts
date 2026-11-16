// Publish attempt status values and terminal patches shared by publication owners.
import type { Doc } from "../_generated/dataModel";

export const PUBLISH_ATTEMPT_STATUSES = [
  "pending_checks",
  "ready_to_finalize",
  "finalizing",
  "finalized",
  "blocked",
  "failed",
  "expired",
] as const;
export const ACTIVE_PUBLISH_ATTEMPT_STATUSES = PUBLISH_ATTEMPT_STATUSES.slice(0, 3);

export function failedPublishAttemptPatch(
  status: Doc<"publishAttempts">["status"],
  error: string | undefined,
  now: number,
) {
  return {
    status: "failed" as const,
    checkClaimId: undefined,
    checkClaimedAt: undefined,
    checkClaimExpiresAt: undefined,
    checkClaimLastError: status === "pending_checks" ? error : undefined,
    checkFailureCount: undefined,
    finalizationClaimId: undefined,
    finalizationClaimedAt: undefined,
    finalizationClaimExpiresAt: undefined,
    finalizationLastError: status === "pending_checks" ? undefined : error,
    failedAt: now,
    updatedAt: now,
  };
}
