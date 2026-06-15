import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./functions";
import { assertRole, requireUserFromAction } from "./lib/access";
import { isPublicSkillDoc } from "./lib/globalStats";
import { getOwnerPublisher } from "./lib/publishers";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const SYNC_STATE_KEY = "default";
const PACKAGE_SYNC_STATE_KEY = "packageReleases";
const RETRY_LEASE_KEY = "retryLease";
const MAX_BACKUP_JOB_ERROR_LENGTH = 4000;
const DEFAULT_BACKUP_HEALTH_SAMPLE_LIMIT = 500;
const MAX_BACKUP_HEALTH_SAMPLE_LIMIT = 1000;
const DEFAULT_BACKUP_JOB_LIMIT = 25;
const MAX_BACKUP_JOB_LIMIT = 500;
const DEFAULT_BACKUP_JOB_REPAIR_ATTEMPTS = 16;
const DEFAULT_RETRY_LEASE_TTL_MS = 20 * 60 * 1000;
const MAX_RETRY_LEASE_TTL_MS = 60 * 60 * 1000;

type BackupPageItem =
  | {
      kind: "ok";
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
      displayName: string;
      version: string;
      isLatest: boolean;
      ownerHandle: string;
      publishedAt: number;
    }
  | { kind: "missingOwner"; skillId: Id<"skills">; ownerUserId: Id<"users"> };

type BackupPageResult = {
  items: BackupPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type PackageBackupPageItem =
  | {
      kind: "ok";
      packageId: Id<"packages">;
      releaseId: Id<"packageReleases">;
      ownerHandle: string;
      packageName: string;
      normalizedName: string;
      displayName: string;
      family: "code-plugin" | "bundle-plugin";
      version: string;
      isLatest: boolean;
      publishedAt: number;
      artifactKind?: "legacy-zip" | "npm-pack";
      artifactStorageId: Id<"_storage">;
      artifactFileName?: string;
      artifactSha256?: string;
      artifactSize?: number;
      artifactFormat?: "tgz";
      npmIntegrity?: string;
      npmShasum?: string;
      npmUnpackedSize?: number;
      npmFileCount?: number;
      runtimeId?: string;
      sourceRepo?: string;
      compatibility?: unknown;
      capabilities?: unknown;
      extractedPackageJson?: unknown;
      extractedPluginManifest?: unknown;
      normalizedBundleManifest?: unknown;
      files: Array<{ path: string; size: number; sha256: string }>;
    }
  | { kind: "missingPackage"; releaseId: Id<"packageReleases">; packageId: Id<"packages"> }
  | { kind: "missingOwner"; releaseId: Id<"packageReleases">; packageId: Id<"packages"> }
  | { kind: "missingArtifact"; releaseId: Id<"packageReleases">; packageId: Id<"packages"> };

type PackageBackupPageResult = {
  items: PackageBackupPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type BackupSyncState = {
  cursor: string | null;
};

export type SeedRegistryArtifactBackupsResult = {
  stats: {
    skillsScanned: number;
    skillsSkipped: number;
    skillsBackedUp: number;
    skillsMissingVersion: number;
    skillsMissingOwner: number;
    packagesScanned: number;
    packagesSkipped: number;
    packagesBackedUp: number;
    packagesMissingArtifact: number;
    packagesMissingPackage: number;
    packagesMissingOwner: number;
    retryJobsProcessed: number;
    retryJobsSucceeded: number;
    retryJobsFailed: number;
    staleJobs: number;
    exhaustedJobs: number;
    errors: number;
  };
  cursor: string | null;
  packageCursor: string | null;
  skillsIsDone: boolean;
  packageIsDone: boolean;
  isDone: boolean;
};

export const getRegistryArtifactBackupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    let pageResult;
    try {
      pageResult = await ctx.db
        .query("skillVersions")
        .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
        .order("asc")
        .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    } catch (error) {
      if (!args.cursor || !isStaleCursorError(error)) throw error;
      pageResult = await ctx.db
        .query("skillVersions")
        .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
        .order("asc")
        .paginate({ cursor: null, numItems: batchSize });
    }

    const items: BackupPageItem[] = [];
    for (const version of pageResult.page) {
      const item = await toSkillVersionBackupPageItem(ctx, version);
      if (item) items.push(item);
    }

    return { items, cursor: pageResult.continueCursor, isDone: pageResult.isDone };
  },
});

export const getPackageRegistryArtifactBackupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PackageBackupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const pageResult = await ctx.db
      .query("packageReleases")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: PackageBackupPageItem[] = [];
    for (const release of pageResult.page) {
      const item = await toPackageBackupPageItem(ctx, release);
      if (item) items.push(item);
    }

    return { items, cursor: pageResult.continueCursor, isDone: pageResult.isDone };
  },
});

async function toSkillVersionBackupPageItem(
  ctx: Parameters<typeof getOwnerPublisher>[0],
  version: Doc<"skillVersions">,
): Promise<BackupPageItem | null> {
  const skill = await ctx.db.get(version.skillId);
  if (!skill || !isPublicSkillDoc(skill)) return null;
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: skill.ownerPublisherId,
    ownerUserId: skill.ownerUserId,
  });
  if (!owner || owner.deletedAt || owner.deactivatedAt) {
    return { kind: "missingOwner", skillId: skill._id, ownerUserId: skill.ownerUserId };
  }
  return {
    kind: "ok",
    skillId: skill._id,
    versionId: version._id,
    slug: skill.slug,
    displayName: skill.displayName,
    version: version.version,
    isLatest: skill.latestVersionId === version._id,
    ownerHandle: owner.handle ?? String(skill.ownerPublisherId ?? skill.ownerUserId),
    publishedAt: version.createdAt,
  };
}

async function toPackageBackupPageItem(
  ctx: Parameters<typeof getOwnerPublisher>[0],
  release: Doc<"packageReleases">,
): Promise<PackageBackupPageItem | null> {
  const pkg = await ctx.db.get(release.packageId);
  if (!pkg || pkg.softDeletedAt) {
    return { kind: "missingPackage", releaseId: release._id, packageId: release.packageId };
  }
  if (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin") return null;
  if (!release.clawpackStorageId) {
    return { kind: "missingArtifact", releaseId: release._id, packageId: release.packageId };
  }
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: pkg.ownerPublisherId,
    ownerUserId: pkg.ownerUserId,
  });
  if (!owner || owner.deletedAt || owner.deactivatedAt) {
    return { kind: "missingOwner", releaseId: release._id, packageId: release.packageId };
  }
  return {
    kind: "ok",
    packageId: pkg._id,
    releaseId: release._id,
    ownerHandle: owner.handle,
    packageName: pkg.name,
    normalizedName: pkg.normalizedName,
    displayName: pkg.displayName,
    family: pkg.family,
    version: release.version,
    isLatest: pkg.latestReleaseId === release._id,
    publishedAt: release.createdAt,
    artifactKind: release.artifactKind,
    artifactStorageId: release.clawpackStorageId,
    artifactFileName: release.npmTarballName,
    artifactSha256: release.clawpackSha256,
    artifactSize: release.clawpackSize,
    artifactFormat: release.clawpackFormat,
    npmIntegrity: release.npmIntegrity,
    npmShasum: release.npmShasum,
    npmUnpackedSize: release.npmUnpackedSize,
    npmFileCount: release.npmFileCount,
    runtimeId: release.runtimeId,
    sourceRepo: release.sourceRepo,
    compatibility: release.compatibility,
    capabilities: release.capabilities,
    extractedPackageJson: release.extractedPackageJson,
    extractedPluginManifest: release.extractedPluginManifest,
    normalizedBundleManifest: release.normalizedBundleManifest,
    files: release.files.map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

function isStaleCursorError(error: unknown) {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : "";
  return (
    message.includes("Failed to parse cursor") ||
    message.includes("cursor is from a different query")
  );
}

export const getRegistryArtifactBackupSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupSyncState> => {
    const state = await ctx.db
      .query("registryArtifactBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
      .unique();
    return { cursor: state?.cursor ?? null };
  },
});

export const setRegistryArtifactBackupSyncStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("registryArtifactBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
      .unique();

    if (!state) {
      await ctx.db.insert("registryArtifactBackupSyncState", {
        key: SYNC_STATE_KEY,
        cursor: args.cursor,
        updatedAt: now,
      });
      return { ok: true as const };
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      updatedAt: now,
    });

    return { ok: true as const };
  },
});

export const getPackageRegistryArtifactBackupSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupSyncState> => {
    const state = await ctx.db
      .query("registryArtifactBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", PACKAGE_SYNC_STATE_KEY))
      .unique();
    return { cursor: state?.cursor ?? null };
  },
});

export const setPackageRegistryArtifactBackupSyncStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("registryArtifactBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", PACKAGE_SYNC_STATE_KEY))
      .unique();

    if (!state) {
      await ctx.db.insert("registryArtifactBackupSyncState", {
        key: PACKAGE_SYNC_STATE_KEY,
        cursor: args.cursor,
        updatedAt: now,
      });
      return { ok: true as const };
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      updatedAt: now,
    });

    return { ok: true as const };
  },
});

export async function tryAcquireRegistryArtifactBackupRetryLeaseHandler(
  ctx: Pick<MutationCtx, "db">,
  args: { now?: number; token: string; ttlMs?: number },
) {
  const now = args.now ?? Date.now();
  const ttlMs = clampInt(args.ttlMs ?? DEFAULT_RETRY_LEASE_TTL_MS, 1_000, MAX_RETRY_LEASE_TTL_MS);
  const state = await ctx.db
    .query("registryArtifactBackupSyncState")
    .withIndex("by_key", (q) => q.eq("key", RETRY_LEASE_KEY))
    .unique();
  if (state?.cursor && state.updatedAt + ttlMs > now) {
    return { acquired: false as const, holderUpdatedAt: state.updatedAt };
  }

  if (!state) {
    await ctx.db.insert("registryArtifactBackupSyncState", {
      key: RETRY_LEASE_KEY,
      cursor: args.token,
      updatedAt: now,
    });
    return { acquired: true as const };
  }

  await ctx.db.patch(state._id, {
    cursor: args.token,
    updatedAt: now,
  });
  return { acquired: true as const };
}

export const tryAcquireRegistryArtifactBackupRetryLeaseInternal = internalMutation({
  args: {
    now: v.optional(v.number()),
    token: v.string(),
    ttlMs: v.optional(v.number()),
  },
  handler: tryAcquireRegistryArtifactBackupRetryLeaseHandler,
});

export async function releaseRegistryArtifactBackupRetryLeaseHandler(
  ctx: Pick<MutationCtx, "db">,
  args: { now?: number; token: string },
) {
  const now = args.now ?? Date.now();
  const state = await ctx.db
    .query("registryArtifactBackupSyncState")
    .withIndex("by_key", (q) => q.eq("key", RETRY_LEASE_KEY))
    .unique();
  if (!state || state.cursor !== args.token) return { released: false as const };

  await ctx.db.patch(state._id, {
    cursor: undefined,
    updatedAt: now,
  });
  return { released: true as const };
}

export const releaseRegistryArtifactBackupRetryLeaseInternal = internalMutation({
  args: {
    now: v.optional(v.number()),
    token: v.string(),
  },
  handler: releaseRegistryArtifactBackupRetryLeaseHandler,
});

const registryArtifactBackupTargetKindValidator = v.union(
  v.literal("skillVersion"),
  v.literal("packageRelease"),
);
const registryArtifactBackupReasonValidator = v.union(
  v.literal("publish"),
  v.literal("seed"),
  v.literal("retry"),
  v.literal("sync"),
);

export const enqueueRegistryArtifactBackupJobInternal = internalMutation({
  args: {
    targetKind: registryArtifactBackupTargetKindValidator,
    skillVersionId: v.optional(v.id("skillVersions")),
    packageReleaseId: v.optional(v.id("packageReleases")),
    reason: registryArtifactBackupReasonValidator,
    error: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: enqueueRegistryArtifactBackupJobHandler,
});

export const markRegistryArtifactBackupJobSucceededInternal = internalMutation({
  args: {
    jobId: v.id("registryArtifactBackupJobs"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      completedAt: now,
      lastError: undefined,
      updatedAt: now,
    });
  },
});

export const markRegistryArtifactBackupJobFailedInternal = internalMutation({
  args: {
    jobId: v.id("registryArtifactBackupJobs"),
    error: v.string(),
    now: v.optional(v.number()),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const maxAttempts = Math.max(1, Math.floor(args.maxAttempts ?? 8));
    const job = await ctx.db.get(args.jobId);
    if (!job) return { missing: true as const };
    const attempts = job.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    await ctx.db.patch(args.jobId, {
      status: exhausted ? "exhausted" : "pending",
      attempts,
      lastAttemptAt: now,
      lastError: truncateBackupJobError(args.error),
      nextRunAt: exhausted ? now : now + retryDelayMs(attempts),
      exhaustedAt: exhausted ? now : undefined,
      updatedAt: now,
    });
    return { missing: false as const, exhausted, attempts };
  },
});

export const getDueRegistryArtifactBackupJobsInternal = internalQuery({
  args: {
    includeExhaustedRepair: v.optional(v.boolean()),
    ignoreNextRunAt: v.optional(v.boolean()),
    maxRepairAttempts: v.optional(v.number()),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = clampInt(args.limit ?? DEFAULT_BACKUP_JOB_LIMIT, 1, MAX_BACKUP_JOB_LIMIT);
    const pending = await ctx.db
      .query("registryArtifactBackupJobs")
      .withIndex("by_status_nextRunAt", (q) => {
        const byStatus = q.eq("status", "pending");
        return args.ignoreNextRunAt ? byStatus : byStatus.lte("nextRunAt", now);
      })
      .take(limit);
    if (!args.includeExhaustedRepair || pending.length >= limit) return pending;

    const maxRepairAttempts = Math.max(
      1,
      Math.floor(args.maxRepairAttempts ?? DEFAULT_BACKUP_JOB_REPAIR_ATTEMPTS),
    );
    const remaining = limit - pending.length;
    const exhausted = await ctx.db
      .query("registryArtifactBackupJobs")
      .withIndex("by_status_attempts", (q) =>
        q.eq("status", "exhausted").lt("attempts", maxRepairAttempts),
      )
      .take(remaining);

    return [...pending, ...exhausted];
  },
});

export const getRegistryArtifactBackupHealthInternal = internalQuery({
  args: {
    now: v.optional(v.number()),
    staleAfterMs: v.optional(v.number()),
    sampleLimit: v.optional(v.number()),
  },
  handler: getRegistryArtifactBackupHealthHandler,
});

export const seedRegistryArtifactBackups: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SeedRegistryArtifactBackupsResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);

    if (args.resetCursor && !args.dryRun) {
      await ctx.runMutation(
        internal.registryArtifactBackups.setRegistryArtifactBackupSyncStateInternal,
        {
          cursor: undefined,
        },
      );
      await ctx.runMutation(
        internal.registryArtifactBackups.setPackageRegistryArtifactBackupSyncStateInternal,
        {
          cursor: undefined,
        },
      );
    }

    return ctx.runAction(internal.registryArtifactBackupsNode.seedRegistryArtifactBackupsInternal, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
    }) as Promise<SeedRegistryArtifactBackupsResult>;
  },
});

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function enqueueRegistryArtifactBackupJobHandler(
  ctx: Pick<MutationCtx, "db">,
  args: {
    targetKind: "skillVersion" | "packageRelease";
    skillVersionId?: Id<"skillVersions">;
    packageReleaseId?: Id<"packageReleases">;
    reason: "publish" | "seed" | "retry" | "sync";
    error?: string;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const existing =
    args.targetKind === "skillVersion" && args.skillVersionId
      ? await ctx.db
          .query("registryArtifactBackupJobs")
          .withIndex("by_skill_version", (q) => q.eq("skillVersionId", args.skillVersionId))
          .unique()
      : args.targetKind === "packageRelease" && args.packageReleaseId
        ? await ctx.db
            .query("registryArtifactBackupJobs")
            .withIndex("by_package_release", (q) => q.eq("packageReleaseId", args.packageReleaseId))
            .unique()
        : null;

  const lastError = truncateBackupJobError(args.error);
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "pending",
      reason: args.reason,
      attempts: 0,
      lastError,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
      exhaustedAt: undefined,
      completedAt: undefined,
    });
    return { jobId: existing._id, created: false as const };
  }

  const jobId = await ctx.db.insert("registryArtifactBackupJobs", {
    targetKind: args.targetKind,
    skillVersionId: args.skillVersionId,
    packageReleaseId: args.packageReleaseId,
    status: "pending",
    reason: args.reason,
    attempts: 0,
    nextRunAt: now,
    lastError,
    createdAt: now,
    updatedAt: now,
  });
  return { jobId, created: true as const };
}

export async function getRegistryArtifactBackupHealthHandler(
  ctx: Pick<QueryCtx, "db">,
  args: { now?: number; staleAfterMs?: number; sampleLimit?: number },
) {
  const now = args.now ?? Date.now();
  const staleAfterMs = args.staleAfterMs ?? 24 * 60 * 60 * 1000;
  const sampleLimit = clampInt(
    args.sampleLimit ?? DEFAULT_BACKUP_HEALTH_SAMPLE_LIMIT,
    1,
    MAX_BACKUP_HEALTH_SAMPLE_LIMIT,
  );
  const pending = await ctx.db
    .query("registryArtifactBackupJobs")
    .withIndex("by_status_nextRunAt", (q) => q.eq("status", "pending").lte("nextRunAt", now))
    .take(sampleLimit + 1);
  const exhausted = await ctx.db
    .query("registryArtifactBackupJobs")
    .withIndex("by_status_nextRunAt", (q) => q.eq("status", "exhausted"))
    .take(sampleLimit + 1);
  const pendingSample = pending.slice(0, sampleLimit);
  const exhaustedSample = exhausted.slice(0, sampleLimit);
  const oldestPendingAgeMs = pendingSample.reduce(
    (max: number, job: { createdAt: number }) => Math.max(max, now - job.createdAt),
    0,
  );
  const stale = pendingSample.filter(
    (job: { createdAt: number }) => now - job.createdAt >= staleAfterMs,
  ).length;
  return {
    pending: pendingSample.length,
    stale,
    exhausted: exhaustedSample.length,
    oldestPendingAgeMs,
    pendingCapped: pending.length > sampleLimit,
    exhaustedCapped: exhausted.length > sampleLimit,
  };
}

function truncateBackupJobError(error: string | undefined) {
  if (!error) return undefined;
  return error.slice(0, MAX_BACKUP_JOB_ERROR_LENGTH);
}

function retryDelayMs(attempts: number) {
  const minutes = Math.min(60, 2 ** Math.min(attempts, 6));
  return minutes * 60 * 1000;
}
