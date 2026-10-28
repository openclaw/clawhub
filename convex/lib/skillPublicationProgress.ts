import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { buildSkillPublishAttemptIdempotencyKey } from "./skillPublish";

export type SkillPublicationProgress = {
  version: string;
  stage:
    | Exclude<Doc<"publishAttempts">["status"], "finalized">
    | "checks_failed"
    | "checks_incomplete"
    | "unavailable";
  retrying: boolean;
  updatedAt: number;
  checks?: {
    trufflehog: Doc<"publishAttempts">["checks"]["trufflehog"]["status"];
    clawscan: Doc<"publishAttempts">["checks"]["clawscan"]["status"];
  };
};

// Call only after the existing skill-owner or staff authorization has succeeded.
export async function readSkillPublicationProgress(
  ctx: QueryCtx,
  skill: Doc<"skills">,
): Promise<SkillPublicationProgress | null> {
  const version = await ctx.db
    .query("skillVersions")
    .withIndex("by_skill_active_created", (q) =>
      q.eq("skillId", skill._id).eq("softDeletedAt", undefined),
    )
    .order("desc")
    .first();
  if (
    !version ||
    version.ownerDeletedAt ||
    (version.publicationStatus !== "pending" && version.publicationStatus !== "blocked")
  )
    return null;

  const matchesVersion = (attempt: Doc<"publishAttempts"> | null) =>
    attempt?.kind === "skill" &&
    attempt.skillId === skill._id &&
    attempt.skillVersionId === version._id &&
    attempt.version === version.version &&
    attempt.artifactFingerprint === version.fingerprint;
  let attempt = version.publishAttemptId ? await ctx.db.get(version.publishAttemptId) : null;
  if (!version.publishAttemptId && version.fingerprint) {
    const fingerprint = version.fingerprint;
    // Older pending versions lack a backlink, including those created before
    // personal publisher migration. Reuse the producer's indexed identity.
    const keys = new Set(
      [skill.ownerPublisherId, undefined].map((ownerPublisherId) =>
        buildSkillPublishAttemptIdempotencyKey({
          userId: version.createdBy,
          ownerPublisherId,
          slug: skill.slug,
          version: version.version,
          fingerprint,
        }),
      ),
    );
    const attempts = await Promise.all(
      [...keys].map((key) =>
        ctx.db
          .query("publishAttempts")
          .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", key))
          .order("desc")
          .take(10),
      ),
    );
    attempt =
      attempts
        .flat()
        .filter(matchesVersion)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  const unavailable: SkillPublicationProgress = {
    version: version.version,
    stage: "unavailable",
    retrying: false,
    updatedAt: version.createdAt,
  };
  if (!attempt || !matchesVersion(attempt) || attempt.status === "finalized") return unavailable;

  const checks = {
    trufflehog: attempt.checks.trufflehog.status,
    clawscan: attempt.checks.clawscan.status,
  };
  let stage: SkillPublicationProgress["stage"] = attempt.status;
  if (attempt.status === "pending_checks" || attempt.status === "failed") {
    if (checks.trufflehog === "failed" || checks.clawscan === "failed") stage = "checks_failed";
    else if (attempt.checkClaimLastError) stage = "checks_incomplete";
  }
  return {
    version: version.version,
    stage,
    retrying: attempt.status === "pending_checks" && stage !== "pending_checks",
    updatedAt: attempt.updatedAt,
    checks,
  };
}
