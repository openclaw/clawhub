import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery } from "./functions";
import { finalizeSkillPublishAttempt } from "./lib/skillPublish";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CHECK_CLAIM_LEASE_MS = 30 * 60 * 1000;
const CHECK_RETRY_BACKOFF_MS = 5 * 60 * 1000;
const FINALIZATION_CLAIM_LEASE_MS = 10 * 60 * 1000;

const publishResultValidator = v.object({
  skillId: v.id("skills"),
  versionId: v.id("skillVersions"),
  embeddingId: v.id("skillEmbeddings"),
});

const packagePublishResultValidator = v.object({
  ok: v.boolean(),
  packageId: v.id("packages"),
  releaseId: v.id("packageReleases"),
});

const workerCheckResultValidator = v.object({
  status: v.union(v.literal("clean"), v.literal("blocked"), v.literal("failed")),
  summary: v.optional(v.string()),
  redactedFindings: v.optional(v.array(v.string())),
});

const workerLlmAnalysisValidator = v.object({
  status: v.string(),
  verdict: v.optional(v.string()),
  confidence: v.optional(v.string()),
  summary: v.optional(v.string()),
  dimensions: v.optional(
    v.array(
      v.object({
        name: v.string(),
        label: v.string(),
        rating: v.string(),
        detail: v.string(),
      }),
    ),
  ),
  guidance: v.optional(v.string()),
  findings: v.optional(v.string()),
  model: v.optional(v.string()),
  checkedAt: v.number(),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function withClawscanAnalysis(insertArgs: unknown, clawscanAnalysis: unknown) {
  if (!clawscanAnalysis) return insertArgs;
  return {
    ...asRecord(insertArgs),
    llmAnalysis: clawscanAnalysis,
  };
}

function scannerFailureSummary(args: {
  trufflehog: { status: string; summary?: string };
  clawscan: { status: string; summary?: string };
}) {
  if (args.trufflehog.status === "failed" && args.trufflehog.summary) {
    return args.trufflehog.summary;
  }
  if (args.clawscan.status === "failed" && args.clawscan.summary) {
    return args.clawscan.summary;
  }
  return "Pre-publication scanner failed before returning a verdict.";
}

function isTerminalFinalizationConflict(error: string | undefined) {
  return (
    typeof error === "string" &&
    (/Version .+ already exists\. Increment the version number and try again\./.test(error) ||
      error.includes("Slug is used by multiple publishers. Use an owner-qualified skill URL."))
  );
}

function releaseFinalizationClaimPatch(error: string | undefined, now: number) {
  if (!isTerminalFinalizationConflict(error)) {
    return {
      status: "ready_to_finalize" as const,
      finalizationClaimId: undefined,
      finalizationClaimedAt: undefined,
      finalizationClaimExpiresAt: undefined,
      finalizationLastError: error,
      updatedAt: now,
    };
  }
  return {
    status: "failed" as const,
    checkClaimId: undefined,
    checkClaimedAt: undefined,
    checkClaimExpiresAt: undefined,
    checkClaimLastError: undefined,
    finalizationClaimId: undefined,
    finalizationClaimedAt: undefined,
    finalizationClaimExpiresAt: undefined,
    finalizationLastError: error,
    failedAt: now,
    updatedAt: now,
  };
}

export const createSkillPublishAttemptInternal = internalMutation({
  args: {
    userId: v.id("users"),
    ownerPublisherId: v.optional(v.id("publishers")),
    sourceOwnerPublisherId: v.optional(v.id("publishers")),
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    idempotencyKey: v.string(),
    artifactFingerprint: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    skillInsertArgs: v.any(),
    followup: v.object({
      skipWebhook: v.optional(v.boolean()),
      ownerHandle: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await findReusablePublishAttemptByIdempotencyKey(ctx, args.idempotencyKey);
    if (existing) {
      return {
        attemptId: existing._id,
        status: existing.status,
        result: existing.result,
      };
    }

    const now = Date.now();
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "skill",
      status: "pending_checks",
      userId: args.userId,
      ownerPublisherId: args.ownerPublisherId,
      sourceOwnerPublisherId: args.sourceOwnerPublisherId,
      slug: args.slug,
      displayName: args.displayName,
      version: args.version,
      idempotencyKey: args.idempotencyKey,
      artifactFingerprint: args.artifactFingerprint,
      files: args.files,
      checks: {
        trufflehog: { status: "pending" },
        clawscan: { status: "pending" },
      },
      skillInsertArgs: args.skillInsertArgs,
      followup: args.followup,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + THIRTY_DAYS_MS,
    });

    return { attemptId, status: "pending_checks" as const, result: undefined };
  },
});

async function findReusablePublishAttemptByIdempotencyKey(
  ctx: MutationCtx,
  idempotencyKey: string,
) {
  const attempts = await ctx.db
    .query("publishAttempts")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .order("desc")
    .take(10);
  return attempts.find((attempt) => !isTerminalRetriableAttemptStatus(attempt.status)) ?? null;
}

function isTerminalRetriableAttemptStatus(status: string) {
  return status === "blocked" || status === "failed" || status === "expired";
}

export const createPackagePublishAttemptInternal = internalMutation({
  args: {
    userId: v.id("users"),
    ownerUserId: v.id("users"),
    ownerPublisherId: v.optional(v.id("publishers")),
    name: v.string(),
    displayName: v.string(),
    version: v.string(),
    idempotencyKey: v.string(),
    artifactFingerprint: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    packageInsertArgs: v.any(),
    packageFollowup: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await findReusablePublishAttemptByIdempotencyKey(ctx, args.idempotencyKey);
    if (existing) {
      return {
        attemptId: existing._id,
        status: existing.status,
        result: existing.result,
      };
    }

    const now = Date.now();
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "package",
      status: "pending_checks",
      userId: args.userId,
      ownerUserId: args.ownerUserId,
      ownerPublisherId: args.ownerPublisherId,
      slug: args.name,
      displayName: args.displayName,
      version: args.version,
      idempotencyKey: args.idempotencyKey,
      artifactFingerprint: args.artifactFingerprint,
      files: args.files,
      checks: {
        trufflehog: { status: "pending" },
        clawscan: { status: "pending" },
      },
      packageInsertArgs: args.packageInsertArgs,
      packageFollowup: args.packageFollowup,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + THIRTY_DAYS_MS,
    });

    return { attemptId, status: "pending_checks" as const, result: undefined };
  },
});

function getSecretBlockedStorageIds(attempt: {
  files: Array<{ storageId: Id<"_storage"> }>;
  packageInsertArgs?: unknown;
}) {
  const storageIds = new Set<Id<"_storage">>(attempt.files.map((file) => file.storageId));
  const packageInsertArgs = attempt.packageInsertArgs;
  if (packageInsertArgs && typeof packageInsertArgs === "object") {
    const clawpackStorageId = (packageInsertArgs as { clawpackStorageId?: unknown })
      .clawpackStorageId;
    if (typeof clawpackStorageId === "string") {
      storageIds.add(clawpackStorageId as Id<"_storage">);
    }
  }
  return [...storageIds];
}

function buildSkillAttemptScanContext(attempt: { skillInsertArgs?: unknown }) {
  const skillInsertArgs = asRecord(attempt.skillInsertArgs);
  const parsed = asRecord(skillInsertArgs.parsed);
  return withoutUndefined({
    version: withoutUndefined({
      staticScan: skillInsertArgs.staticScan,
      parsed: withoutUndefined({
        metadata: parsed.metadata,
        clawdis: parsed.clawdis,
        license: parsed.license,
      }),
      qualityAssessment: skillInsertArgs.qualityAssessment,
      sourceProvenance: skillInsertArgs.sourceProvenance,
    }),
  });
}

function buildPackageAttemptScanContext(attempt: { packageInsertArgs?: unknown }) {
  const packageInsertArgs = asRecord(attempt.packageInsertArgs);
  const verification = asRecord(packageInsertArgs.verification);
  return withoutUndefined({
    trustedOpenClawPlugin: verification.trustedOpenClawPlugin === true ? true : undefined,
    release: withoutUndefined({
      staticScan: packageInsertArgs.staticScan,
      pluginManifestSummary: packageInsertArgs.pluginManifestSummary,
      verification: packageInsertArgs.verification,
      artifactKind: packageInsertArgs.artifactKind,
      npmIntegrity: packageInsertArgs.npmIntegrity,
      npmShasum: packageInsertArgs.npmShasum,
      npmTarballName: packageInsertArgs.npmTarballName,
      source: packageInsertArgs.source,
    }),
  });
}

function publishAttemptClawpackStorageId(attempt: { packageInsertArgs?: unknown }) {
  const clawpackStorageId = asRecord(attempt.packageInsertArgs).clawpackStorageId;
  return typeof clawpackStorageId === "string" ? (clawpackStorageId as Id<"_storage">) : undefined;
}

export const recordSkillPublishAttemptChecksPassedInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    trufflehogSummary: v.optional(v.string()),
    clawscanSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attempt = await requireSkillPublishAttempt(ctx, args.attemptId);
    if (attempt.status === "finalized") {
      return { attemptId: attempt._id, status: attempt.status, result: attempt.result };
    }
    if (attempt.status !== "pending_checks" && attempt.status !== "ready_to_finalize") {
      throw new ConvexError(`Publish attempt is ${attempt.status}, not pending checks.`);
    }

    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      status: "ready_to_finalize",
      checks: {
        trufflehog: {
          status: "clean",
          checkedAt: now,
          summary: args.trufflehogSummary,
        },
        clawscan: {
          status: "clean",
          checkedAt: now,
          summary: args.clawscanSummary,
        },
      },
      updatedAt: now,
    });

    return { attemptId: attempt._id, status: "ready_to_finalize" as const, result: undefined };
  },
});

export const completePendingPublishAttemptChecksInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
    artifactFingerprint: v.string(),
    trufflehog: workerCheckResultValidator,
    clawscan: workerCheckResultValidator,
    clawscanAnalysis: v.optional(workerLlmAnalysisValidator),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new ConvexError("Publish attempt not found.");
    if (attempt.artifactFingerprint !== args.artifactFingerprint) {
      throw new ConvexError("Publish attempt artifact fingerprint does not match scanned input.");
    }
    if (
      attempt.status === "finalizing" &&
      (attempt.finalizationClaimExpiresAt ?? 0) <= Date.now()
    ) {
      return { attemptId: attempt._id, kind: attempt.kind, status: "ready_to_finalize" as const };
    }
    if (attempt.status !== "pending_checks") {
      return { attemptId: attempt._id, kind: attempt.kind, status: attempt.status };
    }
    if (attempt.checkClaimId !== args.claimId || (attempt.checkClaimExpiresAt ?? 0) <= Date.now()) {
      throw new ConvexError("Publish attempt check claim is not active.");
    }

    const now = Date.now();
    const checks = {
      trufflehog: {
        status: args.trufflehog.status,
        checkedAt: now,
        summary: args.trufflehog.summary,
        redactedFindings: args.trufflehog.redactedFindings,
      },
      clawscan: {
        status: args.clawscan.status,
        checkedAt: now,
        summary: args.clawscan.summary,
        redactedFindings: args.clawscan.redactedFindings,
      },
    };

    if (args.trufflehog.status === "blocked") {
      await Promise.all(
        getSecretBlockedStorageIds(attempt).map((storageId) => ctx.storage.delete(storageId)),
      );
      await ctx.db.patch(attempt._id, {
        status: "blocked",
        checks,
        files: [],
        skillInsertArgs: undefined,
        packageInsertArgs: undefined,
        followup: undefined,
        packageFollowup: undefined,
        checkClaimId: undefined,
        checkClaimedAt: undefined,
        checkClaimExpiresAt: undefined,
        checkClaimLastError: undefined,
        blockedAt: now,
        updatedAt: now,
      });
      await scheduleSecretPublishBlockedEmail(ctx, attempt);
      return { attemptId: attempt._id, kind: attempt.kind, status: "blocked" as const };
    }

    if (args.clawscan.status === "blocked") {
      await ctx.db.patch(attempt._id, {
        status: "blocked",
        checks,
        skillInsertArgs:
          attempt.kind === "skill"
            ? withClawscanAnalysis(attempt.skillInsertArgs, args.clawscanAnalysis)
            : attempt.skillInsertArgs,
        packageInsertArgs:
          attempt.kind === "package"
            ? withClawscanAnalysis(attempt.packageInsertArgs, args.clawscanAnalysis)
            : attempt.packageInsertArgs,
        checkClaimId: undefined,
        checkClaimedAt: undefined,
        checkClaimExpiresAt: undefined,
        checkClaimLastError: undefined,
        blockedAt: now,
        updatedAt: now,
      });
      return { attemptId: attempt._id, kind: attempt.kind, status: "blocked" as const };
    }

    if (args.trufflehog.status === "failed" || args.clawscan.status === "failed") {
      await ctx.db.patch(attempt._id, {
        status: "pending_checks",
        checks,
        checkClaimId: undefined,
        checkClaimedAt: undefined,
        checkClaimExpiresAt: now + CHECK_RETRY_BACKOFF_MS,
        checkClaimLastError: scannerFailureSummary(args),
        failedAt: undefined,
        updatedAt: now,
      });
      return { attemptId: attempt._id, kind: attempt.kind, status: "pending_checks" as const };
    }

    await ctx.db.patch(attempt._id, {
      status: "ready_to_finalize",
      checks,
      skillInsertArgs:
        attempt.kind === "skill"
          ? withClawscanAnalysis(attempt.skillInsertArgs, args.clawscanAnalysis)
          : attempt.skillInsertArgs,
      packageInsertArgs:
        attempt.kind === "package"
          ? withClawscanAnalysis(attempt.packageInsertArgs, args.clawscanAnalysis)
          : attempt.packageInsertArgs,
      checkClaimId: undefined,
      checkClaimedAt: undefined,
      checkClaimExpiresAt: undefined,
      checkClaimLastError: undefined,
      updatedAt: now,
    });
    return { attemptId: attempt._id, kind: attempt.kind, status: "ready_to_finalize" as const };
  },
});

export const claimPendingPublishAttemptChecksInternal = internalMutation({
  args: {
    claimId: v.string(),
    attemptId: v.optional(v.id("publishAttempts")),
    kind: v.optional(v.union(v.literal("skill"), v.literal("package"))),
    slug: v.optional(v.string()),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const attempt = args.attemptId
      ? await ctx.db.get(args.attemptId)
      : (
          await ctx.db
            .query("publishAttempts")
            .withIndex("by_status_and_created", (q) => q.eq("status", "pending_checks"))
            .order("asc")
            .take(25)
        ).find((candidate) => {
          if ((candidate.checkClaimExpiresAt ?? 0) > now) return false;
          if (args.kind && candidate.kind !== args.kind) return false;
          if (args.slug && candidate.slug !== args.slug) return false;
          if (args.version && candidate.version !== args.version) return false;
          return true;
        });

    if (!attempt) return null;
    if (attempt.status !== "pending_checks") {
      throw new ConvexError(`Publish attempt is ${attempt.status}, not pending checks.`);
    }
    if (args.kind && attempt.kind !== args.kind) {
      throw new ConvexError("Publish attempt kind does not match worker claim.");
    }
    if (args.slug && attempt.slug !== args.slug) {
      throw new ConvexError("Publish attempt slug does not match worker claim.");
    }
    if (args.version && attempt.version !== args.version) {
      throw new ConvexError("Publish attempt version does not match worker claim.");
    }
    if ((attempt.checkClaimExpiresAt ?? 0) > now && attempt.checkClaimId !== args.claimId) {
      throw new ConvexError("Publish attempt checks are already claimed.");
    }

    const checkClaimExpiresAt = now + CHECK_CLAIM_LEASE_MS;
    await ctx.db.patch(attempt._id, {
      checkClaimId: args.claimId,
      checkClaimedAt: now,
      checkClaimExpiresAt,
      checkClaimLastError: undefined,
      updatedAt: now,
    });

    return {
      attemptId: attempt._id,
      status: attempt.status,
      claimId: args.claimId,
      kind: attempt.kind,
      userId: attempt.userId,
      ownerUserId: attempt.ownerUserId,
      ownerPublisherId: attempt.ownerPublisherId,
      sourceOwnerPublisherId: attempt.sourceOwnerPublisherId,
      slug: attempt.slug,
      displayName: attempt.displayName,
      version: attempt.version,
      artifactFingerprint: attempt.artifactFingerprint,
      files: attempt.files,
      ...(attempt.kind === "skill"
        ? {
            scanContext: buildSkillAttemptScanContext(attempt),
          }
        : {
            clawpackStorageId: publishAttemptClawpackStorageId(attempt),
            scanContext: buildPackageAttemptScanContext(attempt),
          }),
      checkClaimExpiresAt,
      createdAt: attempt.createdAt,
    };
  },
});

export const claimReadyPublishAttemptFinalizationRetryInternal = internalMutation({
  args: {
    claimId: v.string(),
    attemptId: v.optional(v.id("publishAttempts")),
    kind: v.optional(v.union(v.literal("skill"), v.literal("package"))),
    slug: v.optional(v.string()),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const attempt = args.attemptId
      ? await ctx.db.get(args.attemptId)
      : (
          await ctx.db
            .query("publishAttempts")
            .withIndex("by_status_and_created", (q) => q.eq("status", "ready_to_finalize"))
            .order("asc")
            .take(25)
        ).find((candidate) => {
          if ((candidate.checkClaimExpiresAt ?? 0) > now) return false;
          if (args.kind && candidate.kind !== args.kind) return false;
          if (args.slug && candidate.slug !== args.slug) return false;
          if (args.version && candidate.version !== args.version) return false;
          return true;
        });

    if (!attempt) return null;
    if (attempt.status !== "ready_to_finalize") {
      return null;
    }
    if (args.kind && attempt.kind !== args.kind) {
      throw new ConvexError("Publish attempt kind does not match worker claim.");
    }
    if (args.slug && attempt.slug !== args.slug) {
      throw new ConvexError("Publish attempt slug does not match worker claim.");
    }
    if (args.version && attempt.version !== args.version) {
      throw new ConvexError("Publish attempt version does not match worker claim.");
    }
    if ((attempt.checkClaimExpiresAt ?? 0) > now && attempt.checkClaimId !== args.claimId) {
      throw new ConvexError("Publish attempt finalization retry is already claimed.");
    }

    await ctx.db.patch(attempt._id, {
      checkClaimId: args.claimId,
      checkClaimedAt: now,
      checkClaimExpiresAt: now + CHECK_CLAIM_LEASE_MS,
      checkClaimLastError: undefined,
      updatedAt: now,
    });

    return {
      attemptId: attempt._id,
      status: attempt.status,
      claimId: args.claimId,
      kind: attempt.kind,
      userId: attempt.userId,
      ownerUserId: attempt.ownerUserId,
      ownerPublisherId: attempt.ownerPublisherId,
      sourceOwnerPublisherId: attempt.sourceOwnerPublisherId,
      slug: attempt.slug,
      displayName: attempt.displayName,
      version: attempt.version,
      artifactFingerprint: attempt.artifactFingerprint,
      files: [],
      checkClaimExpiresAt: now + CHECK_CLAIM_LEASE_MS,
      createdAt: attempt.createdAt,
    };
  },
});

export const claimSkillPublishAttemptForFinalizationInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await requireSkillPublishAttempt(ctx, args.attemptId);
    const now = Date.now();
    if (attempt.status === "finalized" && attempt.result) {
      return {
        status: "finalized" as const,
        attemptId: attempt._id,
        result: attempt.result,
        followup: buildSkillPublishFollowup(attempt),
      };
    }
    if (attempt.status === "finalizing" && (attempt.finalizationClaimExpiresAt ?? 0) > now) {
      throw new ConvexError("Publish attempt is already finalizing.");
    }
    if (attempt.status !== "ready_to_finalize" && attempt.status !== "finalizing") {
      throw new ConvexError(`Publish attempt is ${attempt.status}, not ready to finalize.`);
    }

    await ctx.db.patch(attempt._id, {
      status: "finalizing",
      finalizationClaimId: args.claimId,
      finalizationClaimedAt: now,
      finalizationClaimExpiresAt: now + FINALIZATION_CLAIM_LEASE_MS,
      finalizationLastError: undefined,
      updatedAt: now,
    });

    return {
      status: "claimed" as const,
      attemptId: attempt._id,
      createdAt: attempt.createdAt,
      skillInsertArgs: attempt.skillInsertArgs,
      followup: buildSkillPublishFollowup(attempt),
    };
  },
});

export const claimPackagePublishAttemptForFinalizationInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await requirePackagePublishAttempt(ctx, args.attemptId);
    const now = Date.now();
    if (attempt.status === "finalized" && attempt.result) {
      return {
        status: "finalized" as const,
        attemptId: attempt._id,
        result: attempt.result,
        packageFollowup: attempt.packageFollowup,
      };
    }
    if (attempt.status === "finalizing" && (attempt.finalizationClaimExpiresAt ?? 0) > now) {
      throw new ConvexError("Publish attempt is already finalizing.");
    }
    if (attempt.status !== "ready_to_finalize" && attempt.status !== "finalizing") {
      throw new ConvexError(`Publish attempt is ${attempt.status}, not ready to finalize.`);
    }

    await ctx.db.patch(attempt._id, {
      status: "finalizing",
      finalizationClaimId: args.claimId,
      finalizationClaimedAt: now,
      finalizationClaimExpiresAt: now + FINALIZATION_CLAIM_LEASE_MS,
      finalizationLastError: undefined,
      updatedAt: now,
    });

    return {
      status: "claimed" as const,
      attemptId: attempt._id,
      packageInsertArgs: attempt.packageInsertArgs,
      packageFollowup: attempt.packageFollowup,
    };
  },
});

export const releaseSkillPublishAttemptFinalizationClaimInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attempt = await requireSkillPublishAttempt(ctx, args.attemptId);
    if (attempt.status !== "finalizing" || attempt.finalizationClaimId !== args.claimId) {
      return { attemptId: attempt._id, status: attempt.status };
    }

    const patch = releaseFinalizationClaimPatch(args.error, Date.now());
    await ctx.db.patch(attempt._id, patch);
    return { attemptId: attempt._id, status: patch.status };
  },
});

export const releasePackagePublishAttemptFinalizationClaimInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attempt = await requirePackagePublishAttempt(ctx, args.attemptId);
    if (attempt.status !== "finalizing" || attempt.finalizationClaimId !== args.claimId) {
      return { attemptId: attempt._id, status: attempt.status };
    }

    const patch = releaseFinalizationClaimPatch(args.error, Date.now());
    await ctx.db.patch(attempt._id, patch);
    return { attemptId: attempt._id, status: patch.status };
  },
});

export const recordSkillPublishAttemptFinalizedInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
    result: publishResultValidator,
  },
  handler: async (ctx, args) => {
    const attempt = await requireSkillPublishAttempt(ctx, args.attemptId);
    if (attempt.status === "finalized" && attempt.result) {
      return { attemptId: attempt._id, status: attempt.status, result: attempt.result };
    }
    const now = Date.now();
    if (
      attempt.status !== "finalizing" ||
      attempt.finalizationClaimId !== args.claimId ||
      (attempt.finalizationClaimExpiresAt ?? 0) <= now
    ) {
      throw new ConvexError("Publish attempt finalization claim is not active.");
    }

    await ctx.db.patch(attempt._id, {
      status: "finalized",
      finalizationClaimId: undefined,
      finalizationClaimedAt: undefined,
      finalizationClaimExpiresAt: undefined,
      finalizationLastError: undefined,
      result: args.result,
      finalizedAt: now,
      updatedAt: now,
    });

    return { attemptId: attempt._id, status: "finalized" as const, result: args.result };
  },
});

export const recordPackagePublishAttemptFinalizedInternal = internalMutation({
  args: {
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
    result: packagePublishResultValidator,
  },
  handler: async (ctx, args) => {
    const attempt = await requirePackagePublishAttempt(ctx, args.attemptId);
    if (attempt.status === "finalized" && attempt.result) {
      return { attemptId: attempt._id, status: attempt.status, result: attempt.result };
    }
    const now = Date.now();
    if (
      attempt.status !== "finalizing" ||
      attempt.finalizationClaimId !== args.claimId ||
      (attempt.finalizationClaimExpiresAt ?? 0) <= now
    ) {
      throw new ConvexError("Publish attempt finalization claim is not active.");
    }

    await ctx.db.patch(attempt._id, {
      status: "finalized",
      finalizationClaimId: undefined,
      finalizationClaimedAt: undefined,
      finalizationClaimExpiresAt: undefined,
      finalizationLastError: undefined,
      result: args.result,
      finalizedAt: now,
      updatedAt: now,
    });

    return { attemptId: attempt._id, status: "finalized" as const, result: args.result };
  },
});

export const findSkillPublishAttemptPublicResultInternal = internalQuery({
  args: {
    attemptId: v.id("publishAttempts"),
  },
  handler: async (ctx, args) => {
    const attempt = await requireSkillPublishAttempt(ctx, args.attemptId);
    let ownerPublisherId = attempt.ownerPublisherId;
    if (!ownerPublisherId) {
      const personalPublishers = await ctx.db
        .query("publishers")
        .withIndex("by_linked_user", (q) => q.eq("linkedUserId", attempt.userId))
        .take(5);
      ownerPublisherId = personalPublishers.find(
        (publisher) =>
          publisher.kind === "user" && !publisher.deletedAt && !publisher.deactivatedAt,
      )?._id;
    }

    const skill = ownerPublisherId
      ? await ctx.db
          .query("skills")
          .withIndex("by_owner_publisher_slug", (q) =>
            q.eq("ownerPublisherId", ownerPublisherId).eq("slug", attempt.slug),
          )
          .unique()
      : await ctx.db
          .query("skills")
          .withIndex("by_owner_slug", (q) =>
            q.eq("ownerUserId", attempt.userId).eq("slug", attempt.slug),
          )
          .unique();
    if (!skill) return null;

    const version = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_version", (q) =>
        q.eq("skillId", skill._id).eq("version", attempt.version),
      )
      .unique();
    if (!version || version.softDeletedAt || version.fingerprint !== attempt.artifactFingerprint) {
      return null;
    }

    const embedding = await ctx.db
      .query("skillEmbeddings")
      .withIndex("by_version", (q) => q.eq("versionId", version._id))
      .unique();
    if (!embedding) return null;

    return {
      skillId: skill._id,
      versionId: version._id,
      embeddingId: embedding._id,
    };
  },
});

export const finalizeSkillPublishAttemptInternal = internalAction({
  args: {
    attemptId: v.id("publishAttempts"),
  },
  handler: async (ctx, args) => {
    return await finalizeSkillPublishAttempt(ctx, args.attemptId);
  },
});

export const claimPrePublicationChecks: ReturnType<typeof action> = action({
  args: {
    token: v.string(),
    attemptId: v.optional(v.id("publishAttempts")),
    kind: v.optional(v.union(v.literal("skill"), v.literal("package"))),
    slug: v.optional(v.string()),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertWorkerToken(args.token);
    const claimId = buildCheckClaimId();
    const claimArgs = {
      claimId,
      attemptId: args.attemptId,
      kind: args.kind,
      slug: args.slug,
      version: args.version,
    };
    const claimed = ((await ctx.runMutation(
      internal.publishAttempts.claimReadyPublishAttemptFinalizationRetryInternal,
      claimArgs,
    )) ??
      (await ctx.runMutation(
        internal.publishAttempts.claimPendingPublishAttemptChecksInternal,
        claimArgs,
      ))) as null | {
      attemptId: Id<"publishAttempts">;
      status: "pending_checks" | "ready_to_finalize";
      claimId: string;
      kind: "skill" | "package";
      userId: Id<"users">;
      ownerUserId?: Id<"users">;
      ownerPublisherId?: Id<"publishers">;
      sourceOwnerPublisherId?: Id<"publishers">;
      slug: string;
      displayName: string;
      version: string;
      artifactFingerprint: string;
      files: Array<{
        path: string;
        size: number;
        storageId: Id<"_storage">;
        sha256: string;
        contentType?: string;
      }>;
      clawpackStorageId?: Id<"_storage">;
      scanContext?: Record<string, unknown>;
      checkClaimExpiresAt: number;
      createdAt: number;
    };
    if (!claimed) return null;

    const files = await Promise.all(
      claimed.files.map(async (file) => ({
        ...file,
        url: await ctx.storage.getUrl(file.storageId),
      })),
    );
    const clawpackUrl = claimed.clawpackStorageId
      ? await ctx.storage.getUrl(claimed.clawpackStorageId)
      : undefined;
    return withoutUndefined({
      ...claimed,
      files,
      clawpackStorageId: undefined,
      clawpackUrl,
    });
  },
});

export const completePrePublicationChecks: ReturnType<typeof action> = action({
  args: {
    token: v.string(),
    attemptId: v.id("publishAttempts"),
    claimId: v.string(),
    artifactFingerprint: v.string(),
    trufflehog: workerCheckResultValidator,
    clawscan: workerCheckResultValidator,
    clawscanAnalysis: v.optional(workerLlmAnalysisValidator),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertWorkerToken(args.token);
    const completed = (await ctx.runMutation(
      internal.publishAttempts.completePendingPublishAttemptChecksInternal,
      {
        attemptId: args.attemptId,
        claimId: args.claimId,
        artifactFingerprint: args.artifactFingerprint,
        trufflehog: args.trufflehog,
        clawscan: args.clawscan,
        clawscanAnalysis: args.clawscanAnalysis,
      },
    )) as {
      attemptId: Id<"publishAttempts">;
      kind: "skill" | "package";
      status: "blocked" | "pending_checks" | "ready_to_finalize";
    };

    if (completed.status !== "ready_to_finalize") return completed;
    if (completed.kind === "skill") {
      const result = await finalizeSkillPublishAttempt(ctx, completed.attemptId);
      return { ...completed, status: "finalized" as const, result };
    }

    const result: unknown = await ctx.runAction(
      internal.packages.finalizePackagePublishAttemptInternal,
      {
        attemptId: completed.attemptId,
      },
    );
    return { ...completed, status: "finalized" as const, result };
  },
});

function assertWorkerToken(token: string) {
  const expected = process.env.SECURITY_SCAN_WORKER_TOKEN;
  if (!expected || token !== expected) throw new ConvexError("Unauthorized");
}

function buildCheckClaimId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function scheduleSecretPublishBlockedEmail(
  ctx: MutationCtx,
  attempt: {
    _id: Id<"publishAttempts">;
    userId: Id<"users">;
    kind: "skill" | "package";
    slug: string;
    version: string;
  },
) {
  const user = await ctx.db.get(attempt.userId);
  if (!user?.email) return;
  await ctx.scheduler.runAfter(
    0,
    internal.emailsNode.sendSecretPublishBlockedNotificationInternal,
    {
      attemptId: attempt._id,
      userId: attempt.userId,
      to: user.email,
      handle: user.handle,
      artifact: {
        kind: attempt.kind === "skill" ? "skill" : "plugin",
        name: attempt.slug,
      },
      version: attempt.version,
    },
  );
}

async function requireSkillPublishAttempt(
  ctx: { db: { get: (id: Id<"publishAttempts">) => Promise<unknown> } },
  attemptId: Id<"publishAttempts">,
) {
  const attempt = await ctx.db.get(attemptId);
  if (!attempt || typeof attempt !== "object") {
    throw new ConvexError("Publish attempt not found.");
  }
  const typed = attempt as {
    _id: Id<"publishAttempts">;
    kind: "skill" | "package";
    status:
      | "pending_checks"
      | "ready_to_finalize"
      | "finalizing"
      | "finalized"
      | "blocked"
      | "failed"
      | "expired";
    skillInsertArgs: unknown;
    followup: { skipWebhook?: boolean; ownerHandle?: string };
    userId: Id<"users">;
    ownerPublisherId?: Id<"publishers">;
    slug: string;
    version: string;
    displayName: string;
    artifactFingerprint: string;
    createdAt: number;
    finalizationClaimId?: string;
    finalizationClaimExpiresAt?: number;
    result?: {
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      embeddingId: Id<"skillEmbeddings">;
    };
  };
  if (typed.kind !== "skill" || !typed.skillInsertArgs || !typed.followup) {
    throw new ConvexError("Skill publish attempt not found.");
  }
  return typed as typeof typed & {
    kind: "skill";
    skillInsertArgs: unknown;
    followup: { skipWebhook?: boolean; ownerHandle?: string };
  };
}

async function requirePackagePublishAttempt(
  ctx: { db: { get: (id: Id<"publishAttempts">) => Promise<unknown> } },
  attemptId: Id<"publishAttempts">,
) {
  const attempt = await ctx.db.get(attemptId);
  if (!attempt || typeof attempt !== "object") {
    throw new ConvexError("Publish attempt not found.");
  }
  const typed = attempt as {
    _id: Id<"publishAttempts">;
    kind: "skill" | "package";
    status:
      | "pending_checks"
      | "ready_to_finalize"
      | "finalizing"
      | "finalized"
      | "blocked"
      | "failed"
      | "expired";
    packageInsertArgs?: unknown;
    packageFollowup?: unknown;
    finalizationClaimId?: string;
    finalizationClaimExpiresAt?: number;
    result?: {
      ok: true;
      packageId: Id<"packages">;
      releaseId: Id<"packageReleases">;
    };
  };
  if (typed.kind !== "package" || !typed.packageInsertArgs) {
    throw new ConvexError("Package publish attempt not found.");
  }
  return typed;
}

function buildSkillPublishFollowup(attempt: {
  followup: { skipWebhook?: boolean; ownerHandle?: string };
  slug: string;
  version: string;
  displayName: string;
}) {
  return {
    ...attempt.followup,
    slug: attempt.slug,
    version: attempt.version,
    displayName: attempt.displayName,
  };
}
