import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requestPublishAttemptDispatch } from "../publishAttemptDispatch";
import { resolvePackageReleaseScanStatus } from "./packageSecurity";
import { assertCanManageOwnedResource, isPublisherActive } from "./publishers";
import { matchesStorageSha256 } from "./storageDigests";

// Operator maintenance, not an owner authorization or moderation override. Every
// retry goes through the existing scanner, claim and finalization boundaries.
export async function retryFailedPublishAttemptChecks(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"publishAttempts">;
    expectedArtifactFingerprint: string;
    expectedUpdatedAt: number;
    reason: string;
    dryRun?: boolean;
  },
) {
  const reason = args.reason.trim();
  if (!reason || reason.length > 500 || !Number.isFinite(args.expectedUpdatedAt)) {
    throw new ConvexError("Supply a 1–500 character reason and the observed update time");
  }
  const rejected = (code: string) => ({ eligible: false, requeued: false, reason: code });
  const attempt = await ctx.db.get(args.attemptId);
  if (!attempt || attempt.status !== "failed") return rejected("not-failed");
  if (
    attempt.updatedAt !== args.expectedUpdatedAt ||
    attempt.artifactFingerprint !== args.expectedArtifactFingerprint
  )
    return rejected("attempt-changed");
  const now = Date.now();
  if (attempt.expiresAt <= now) return rejected("attempt-expired");
  if ((attempt.checkClaimExpiresAt ?? 0) > now || (attempt.finalizationClaimExpiresAt ?? 0) > now)
    return rejected("active-claim");
  // Completion also exhausts the operational retry budget when the supporting
  // A.I.G evidence is unavailable after both primary scanners succeeded.
  const missingAigEvidence =
    attempt.kind === "skill" &&
    attempt.checks.trufflehog.status === "clean" &&
    attempt.checks.clawscan.status === "clean" &&
    attempt.checkClaimLastError === "A.I.G evidence is required before a skill can be published.";
  if (
    attempt.checks.trufflehog.status === "blocked" ||
    attempt.checks.clawscan.status === "blocked" ||
    (!missingAigEvidence &&
      attempt.checks.trufflehog.status !== "failed" &&
      attempt.checks.clawscan.status !== "failed")
  )
    return rejected("not-operational-failure");
  if (!Number.isSafeInteger(attempt.checkFailureCount) || (attempt.checkFailureCount ?? -1) < 0)
    return rejected("failure-history-unavailable");

  const user = await ctx.db.get(attempt.userId);
  if (!user || user.deletedAt || user.deactivatedAt) return rejected("publisher-unavailable");
  let ownerUserId: Id<"users">;
  let ownerPublisherId: Id<"publishers"> | undefined;
  let targetFiles: typeof attempt.files;
  let archive: { storageId: Id<"_storage">; size?: number; sha256?: string } | undefined;
  if (attempt.kind === "skill") {
    const version = attempt.skillVersionId ? await ctx.db.get(attempt.skillVersionId) : null;
    const skill = attempt.skillId ? await ctx.db.get(attempt.skillId) : null;
    if (
      !version ||
      !skill ||
      version.skillId !== skill._id ||
      version.version !== attempt.version ||
      skill.slug !== attempt.slug ||
      version.publicationStatus !== "pending" ||
      version.softDeletedAt ||
      version.ownerDeletedAt ||
      version.manualRevocation ||
      skill.softDeletedAt ||
      (skill.moderationStatus === "hidden" && skill.moderationReason !== "pending.publication") ||
      skill.moderationStatus === "removed" ||
      version.llmAnalysis?.status === "malicious" ||
      version.fingerprint !== attempt.artifactFingerprint ||
      (version.publishAttemptId && version.publishAttemptId !== attempt._id)
    )
      return rejected("staged-target-unavailable");
    ownerUserId = skill.ownerUserId;
    ownerPublisherId = skill.ownerPublisherId;
    targetFiles = version.files;
  } else {
    const release = attempt.packageReleaseId ? await ctx.db.get(attempt.packageReleaseId) : null;
    const pkg = attempt.packageId ? await ctx.db.get(attempt.packageId) : null;
    if (
      !release ||
      !pkg ||
      release.packageId !== pkg._id ||
      release.version !== attempt.version ||
      pkg.name !== attempt.slug ||
      release.publicationStatus !== "pending" ||
      release.softDeletedAt ||
      release.ownerDeletedAt ||
      pkg.softDeletedAt ||
      release.manualModeration?.state === "quarantined" ||
      release.manualModeration?.state === "revoked" ||
      resolvePackageReleaseScanStatus(release) === "malicious" ||
      (release.clawManifestSummary ? release.clawpackSha256 : release.integritySha256) !==
        attempt.artifactFingerprint ||
      (release.publishAttemptId && release.publishAttemptId !== attempt._id)
    )
      return rejected("staged-target-unavailable");
    ownerUserId = pkg.ownerUserId;
    ownerPublisherId = pkg.ownerPublisherId;
    targetFiles = release.files;
    if (release.clawpackStorageId) {
      const insertArgs = attempt.packageInsertArgs as { clawpackStorageId?: unknown } | undefined;
      const originalArchive = attempt.clawpackStorageId ?? insertArgs?.clawpackStorageId;
      if (originalArchive !== release.clawpackStorageId) {
        return rejected("artifact-inventory-changed");
      }
      archive = {
        storageId: release.clawpackStorageId,
        size: release.clawpackSize,
        sha256: release.clawpackSha256,
      };
    }
  }
  // Legacy pending targets may not have an attempt backlink. Never adopt bytes
  // that another live or finalized attempt already owns.
  for (const status of [
    "pending_checks",
    "ready_to_finalize",
    "finalizing",
    "finalized",
  ] as const) {
    const other = await ctx.db
      .query("publishAttempts")
      .withIndex("by_kind_status_slug_version_created", (q) =>
        q
          .eq("kind", attempt.kind)
          .eq("status", status)
          .eq("slug", attempt.slug)
          .eq("version", attempt.version),
      )
      .filter((q) =>
        q.eq(
          q.field(attempt.kind === "skill" ? "skillVersionId" : "packageReleaseId"),
          attempt.kind === "skill" ? attempt.skillVersionId : attempt.packageReleaseId,
        ),
      )
      .first();
    if (other) return rejected("another-attempt-owns-artifact");
  }
  // Skill attempts historically bind the publisher scope, not ownerUserId.
  // An organization member may submit on behalf of a different resource owner.
  const originalOwnerUserId =
    attempt.ownerUserId ?? (attempt.ownerPublisherId ? undefined : attempt.userId);
  if (
    (originalOwnerUserId !== undefined && ownerUserId !== originalOwnerUserId) ||
    ownerPublisherId !== attempt.ownerPublisherId
  )
    return rejected("owner-changed");
  const owner = await ctx.db.get(ownerUserId);
  const publisher = ownerPublisherId ? await ctx.db.get(ownerPublisherId) : null;
  if (
    !owner ||
    owner.deletedAt ||
    owner.deactivatedAt ||
    (ownerPublisherId && !isPublisherActive(publisher))
  )
    return rejected("publisher-unavailable");
  try {
    await assertCanManageOwnedResource(ctx, {
      actor: user,
      ownerUserId,
      ownerPublisherId,
      allowedPublisherRoles: ["publisher"],
      allowPlatformAdmin: false,
    });
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    return rejected("publisher-authorization-revoked");
  }
  if (
    targetFiles.length !== attempt.files.length ||
    targetFiles.some((file, index) => {
      const original = attempt.files[index];
      return (
        file.path !== original.path ||
        file.size !== original.size ||
        file.storageId !== original.storageId ||
        file.sha256 !== original.sha256
      );
    })
  )
    return rejected("artifact-inventory-changed");
  for (const file of [...targetFiles, ...(archive ? [archive] : [])]) {
    const stored = await ctx.db.system.get(file.storageId);
    if (
      !stored ||
      stored.size !== file.size ||
      !file.sha256 ||
      !matchesStorageSha256(stored.sha256, file.sha256)
    )
      return rejected("artifact-storage-unavailable");
  }
  const result = {
    eligible: true,
    requeued: false,
    attemptId: attempt._id,
    kind: attempt.kind,
    slug: attempt.slug,
    version: attempt.version,
    artifactFingerprint: attempt.artifactFingerprint,
    previousFailureCount: attempt.checkFailureCount,
  };
  if (args.dryRun !== false) return result;
  await ctx.db.insert("auditLogs", {
    action: "publish_attempt.operational_retry",
    targetType: "publishAttempt",
    targetId: attempt._id,
    metadata: {
      reason,
      artifactFingerprint: attempt.artifactFingerprint,
      previousUpdatedAt: attempt.updatedAt,
      previousChecks: attempt.checks,
      previousFailureCount: attempt.checkFailureCount,
      previousFailure: attempt.checkClaimLastError ?? null,
      previousFailedAt: attempt.failedAt ?? null,
    },
    createdAt: now,
  });
  // Keep the failed check, error and cumulative count. This grants one operator
  // retry, not a fresh automatic retry budget or a passing scanner verdict.
  await ctx.db.patch(attempt._id, {
    status: "pending_checks",
    checkClaimId: undefined,
    checkClaimedAt: undefined,
    checkClaimExpiresAt: now,
    finalizationClaimId: undefined,
    finalizationClaimedAt: undefined,
    finalizationClaimExpiresAt: undefined,
    updatedAt: now,
  });
  const dispatch = await requestPublishAttemptDispatch(ctx, attempt._id);
  return { ...result, requeued: true, dispatchScheduled: dispatch.scheduled };
}
