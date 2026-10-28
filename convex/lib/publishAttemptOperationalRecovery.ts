import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requestPublishAttemptDispatch } from "../publishAttemptDispatch";
import { resolvePackageReleaseScanStatus } from "./packageSecurity";
import { assertCanManageOwnedResource, isPublisherActive } from "./publishers";
import { normalizeSecurityScanStatus } from "./securityScanPolicy";
import { matchesStorageSha256 } from "./storageDigests";

// Old personal attempts predate publisher IDs. Accept only the current owner's
// canonical bidirectional personal link; this never authorizes an org transfer.
function matchesAttemptPublisher(
  attempt: Doc<"publishAttempts">,
  ownerUserId: Id<"users">,
  ownerPublisherId: Id<"publishers"> | undefined,
  owner: Doc<"users"> | null,
  publisher: Doc<"publishers"> | null,
) {
  if (attempt.ownerPublisherId === ownerPublisherId) return true;
  return (
    attempt.ownerPublisherId === undefined &&
    attempt.userId === ownerUserId &&
    owner?._id === ownerUserId &&
    owner.personalPublisherId === ownerPublisherId &&
    publisher?._id === ownerPublisherId &&
    publisher?.kind === "user" &&
    publisher.linkedUserId === ownerUserId
  );
}

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
  let priorRetry: Doc<"skillVersions">["operationalRetry"];
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
      normalizeSecurityScanStatus(version.llmAnalysis?.verdict ?? version.llmAnalysis?.status) ===
        "malicious" ||
      version.fingerprint !== attempt.artifactFingerprint ||
      (version.publishAttemptId && version.publishAttemptId !== attempt._id)
    )
      return rejected("staged-target-unavailable");
    ownerUserId = skill.ownerUserId;
    ownerPublisherId = skill.ownerPublisherId;
    targetFiles = version.files;
    priorRetry = version.operationalRetry;
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
      (release.templateManifestSummary ? release.clawpackSha256 : release.integritySha256) !==
        attempt.artifactFingerprint ||
      (release.publishAttemptId && release.publishAttemptId !== attempt._id)
    )
      return rejected("staged-target-unavailable");
    ownerUserId = pkg.ownerUserId;
    ownerPublisherId = pkg.ownerPublisherId;
    targetFiles = release.files;
    priorRetry = release.operationalRetry;
    const insertArgs = attempt.packageInsertArgs as { clawpackStorageId?: unknown } | undefined;
    const originalArchive = attempt.clawpackStorageId ?? insertArgs?.clawpackStorageId;
    if (originalArchive !== release.clawpackStorageId) {
      return rejected("artifact-inventory-changed");
    }
    if (release.clawpackStorageId) {
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
  const owner = await ctx.db.get(ownerUserId);
  const publisher = ownerPublisherId ? await ctx.db.get(ownerPublisherId) : null;
  const originalOwnerUserId =
    attempt.ownerUserId ?? (attempt.ownerPublisherId ? undefined : attempt.userId);
  if (
    (originalOwnerUserId !== undefined && ownerUserId !== originalOwnerUserId) ||
    !matchesAttemptPublisher(attempt, ownerUserId, ownerPublisherId, owner, publisher)
  )
    return rejected("owner-changed");
  if (
    priorRetry &&
    (priorRetry.attemptId !== attempt._id ||
      priorRetry.actorUserId !== attempt.userId ||
      priorRetry.ownerUserId !== ownerUserId ||
      priorRetry.ownerPublisherId !== ownerPublisherId)
  )
    return rejected("retry-binding-changed");
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
  // Persist a typed binding on the staged target: checking authority only here
  // cannot protect against membership or moderation changes during scanning.
  const targetId = attempt.kind === "skill" ? attempt.skillVersionId! : attempt.packageReleaseId!;
  await ctx.db.patch(targetId, {
    publishAttemptId: attempt._id,
    operationalRetry: {
      attemptId: attempt._id,
      actorUserId: attempt.userId,
      ownerUserId,
      ...(ownerPublisherId ? { ownerPublisherId } : {}),
    },
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

// Called by the owners of final publication, in the transaction that makes the
// target public. An operational retry never freezes publisher authority or holds.
async function assertRetryFinalization(
  ctx: MutationCtx,
  parent: Pick<Doc<"skills">, "ownerUserId" | "ownerPublisherId">,
  target: Doc<"skillVersions"> | Doc<"packageReleases">,
  authorization: { publishAttemptId?: Id<"publishAttempts">; finalizationClaimId?: string },
) {
  const retry = target.operationalRetry;
  if (!retry) return null;
  const attempt = await ctx.db.get(retry.attemptId);
  if (
    !attempt ||
    authorization.publishAttemptId !== attempt._id ||
    authorization.finalizationClaimId !== attempt.finalizationClaimId ||
    target.publishAttemptId !== attempt._id ||
    attempt.userId !== retry.actorUserId ||
    (attempt.ownerUserId !== undefined && attempt.ownerUserId !== retry.ownerUserId) ||
    parent.ownerUserId !== retry.ownerUserId ||
    parent.ownerPublisherId !== retry.ownerPublisherId ||
    attempt.status !== "finalizing" ||
    !attempt.finalizationClaimId ||
    (attempt.finalizationClaimExpiresAt ?? 0) <= Date.now() ||
    attempt.checks.trufflehog.status !== "clean" ||
    attempt.checks.clawscan.status !== "clean" ||
    target.publicationStatus !== "pending" ||
    target.softDeletedAt ||
    target.ownerDeletedAt ||
    target.version !== attempt.version ||
    target.files.length !== attempt.files.length ||
    target.files.some((file, index) => {
      const original = attempt.files[index];
      return (
        file.path !== original.path ||
        file.size !== original.size ||
        file.storageId !== original.storageId ||
        file.sha256 !== original.sha256
      );
    })
  )
    throw new ConvexError("Operational retry publication binding, claim or artifact changed");
  const [actor, owner, publisher] = await Promise.all([
    ctx.db.get(retry.actorUserId),
    ctx.db.get(retry.ownerUserId),
    retry.ownerPublisherId ? ctx.db.get(retry.ownerPublisherId) : null,
  ]);
  if (
    !actor ||
    actor.deletedAt ||
    actor.deactivatedAt ||
    !owner ||
    owner.deletedAt ||
    owner.deactivatedAt ||
    (retry.ownerPublisherId && !isPublisherActive(publisher)) ||
    !matchesAttemptPublisher(attempt, retry.ownerUserId, retry.ownerPublisherId, owner, publisher)
  ) {
    throw new ConvexError("Operational retry publisher is unavailable");
  }
  await assertCanManageOwnedResource(ctx, {
    actor,
    ownerUserId: retry.ownerUserId,
    ownerPublisherId: retry.ownerPublisherId,
    allowedPublisherRoles: ["publisher"],
    allowPlatformAdmin: false,
  });
  for (const file of target.files) {
    const stored = await ctx.db.system.get(file.storageId);
    if (!stored || stored.size !== file.size || !matchesStorageSha256(stored.sha256, file.sha256)) {
      throw new ConvexError("Operational retry publication storage is unavailable");
    }
  }
  return attempt;
}

export async function assertOperationalSkillRetryFinalization(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  version: Doc<"skillVersions">,
  publishArgs: {
    userId: Id<"users">;
    ownerPublisherId?: Id<"publishers">;
    version: string;
    files: Doc<"skillVersions">["files"];
  },
  authorization: { publishAttemptId?: Id<"publishAttempts">; finalizationClaimId?: string },
) {
  const attempt = await assertRetryFinalization(ctx, skill, version, authorization);
  if (!attempt) return;
  if (
    attempt.kind !== "skill" ||
    attempt.skillId !== skill._id ||
    attempt.skillVersionId !== version._id ||
    version.skillId !== skill._id ||
    attempt.slug !== skill.slug ||
    attempt.artifactFingerprint !== version.fingerprint ||
    publishArgs.userId !== attempt.userId ||
    // Legacy retained payloads keep the original publisher scope after migration.
    (publishArgs.ownerPublisherId !== skill.ownerPublisherId &&
      publishArgs.ownerPublisherId !== attempt.ownerPublisherId) ||
    publishArgs.version !== version.version ||
    JSON.stringify(publishArgs.files) !== JSON.stringify(version.files) ||
    skill.softDeletedAt ||
    skill.moderationStatus === "removed" ||
    (skill.moderationStatus === "hidden" && skill.moderationReason !== "pending.publication") ||
    version.manualRevocation ||
    normalizeSecurityScanStatus(version.llmAnalysis?.verdict ?? version.llmAnalysis?.status) ===
      "malicious"
  ) {
    throw new ConvexError("Operational retry skill is held or its publication binding changed");
  }
}

export async function assertOperationalPackageRetryFinalization(
  ctx: MutationCtx,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
  authorization: { publishAttemptId?: Id<"publishAttempts">; finalizationClaimId?: string },
) {
  const attempt = await assertRetryFinalization(ctx, pkg, release, authorization);
  if (!attempt) return;
  if (
    attempt.kind !== "package" ||
    attempt.packageId !== pkg._id ||
    attempt.packageReleaseId !== release._id ||
    release.packageId !== pkg._id ||
    attempt.slug !== pkg.name ||
    pkg.softDeletedAt ||
    (release.templateManifestSummary ? release.clawpackSha256 : release.integritySha256) !==
      attempt.artifactFingerprint ||
    release.manualModeration?.state === "quarantined" ||
    release.manualModeration?.state === "revoked" ||
    resolvePackageReleaseScanStatus(release) === "malicious"
  ) {
    throw new ConvexError("Operational retry package is held or its publication binding changed");
  }
  const originalArchive =
    attempt.clawpackStorageId ??
    (attempt.packageInsertArgs as { clawpackStorageId?: unknown } | undefined)?.clawpackStorageId;
  if (originalArchive !== release.clawpackStorageId) {
    throw new ConvexError("Operational retry package archive binding changed");
  }
  if (release.clawpackStorageId) {
    const stored = await ctx.db.system.get(release.clawpackStorageId);
    if (
      originalArchive !== release.clawpackStorageId ||
      !stored ||
      stored.size !== release.clawpackSize ||
      !release.clawpackSha256 ||
      !matchesStorageSha256(stored.sha256, release.clawpackSha256)
    ) {
      throw new ConvexError("Operational retry package archive binding changed");
    }
  }
}
