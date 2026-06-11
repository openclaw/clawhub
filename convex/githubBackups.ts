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
const MAX_BACKUP_JOB_ERROR_LENGTH = 4000;
const DEFAULT_BACKUP_HEALTH_SAMPLE_LIMIT = 500;
const MAX_BACKUP_HEALTH_SAMPLE_LIMIT = 1000;

type BackupPageItem =
  | {
      kind: "ok";
      skillId: Id<"skills">;
      versionId: Id<"skillVersions">;
      slug: string;
      displayName: string;
      version: string;
      ownerHandle: string;
      publishedAt: number;
    }
  | { kind: "missingLatestVersion"; skillId: Id<"skills"> }
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
  pruneCursor: string | null;
};

export type SyncGitHubBackupsResult = {
  stats: {
    skillsScanned: number;
    skillsSkipped: number;
    skillsBackedUp: number;
    skillsDeleted: number;
    skillsMissingVersion: number;
    skillsMissingOwner: number;
    errors: number;
  };
  cursor: string | null;
  pruneCursor: string | null;
  isDone: boolean;
};

export const getGitHubBackupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    let pageResult;
    try {
      pageResult = await ctx.db
        .query("skillSearchDigest")
        .order("asc")
        .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    } catch (error) {
      if (!args.cursor || !isStaleCursorError(error)) throw error;
      pageResult = await ctx.db
        .query("skillSearchDigest")
        .order("asc")
        .paginate({ cursor: null, numItems: batchSize });
    }

    const items: BackupPageItem[] = [];
    for (const digest of pageResult.page) {
      if (!isPubliclyAvailableSkill(digest)) continue;
      if (!digest.latestVersionId || !digest.latestVersionSummary) {
        items.push({ kind: "missingLatestVersion", skillId: digest.skillId });
        continue;
      }

      if (digest.ownerHandle === undefined) {
        items.push({
          kind: "missingOwner",
          skillId: digest.skillId,
          ownerUserId: digest.ownerUserId,
        });
        continue;
      }

      const ownerHandle =
        digest.ownerHandle || String(digest.ownerPublisherId ?? digest.ownerUserId);
      items.push({
        kind: "ok",
        skillId: digest.skillId,
        versionId: digest.latestVersionId,
        slug: digest.slug,
        displayName: digest.displayName,
        version: digest.latestVersionSummary.version,
        ownerHandle,
        publishedAt: digest.latestVersionSummary.createdAt,
      });
    }

    return { items, cursor: pageResult.continueCursor, isDone: pageResult.isDone };
  },
});

export const getPackageGitHubBackupPageInternal = internalQuery({
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

function isPubliclyAvailableSkill(
  skill: Pick<
    Doc<"skillSearchDigest">,
    "softDeletedAt" | "moderationStatus" | "moderationFlags" | "moderationVerdict"
  >,
) {
  return isPublicSkillDoc(skill);
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

export const getGitHubBackupSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupSyncState> => {
    const state = await ctx.db
      .query("githubBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
      .unique();
    return { cursor: state?.cursor ?? null, pruneCursor: state?.pruneCursor ?? null };
  },
});

export const setGitHubBackupSyncStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pruneCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("githubBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
      .unique();

    if (!state) {
      await ctx.db.insert("githubBackupSyncState", {
        key: SYNC_STATE_KEY,
        cursor: args.cursor,
        pruneCursor: args.pruneCursor,
        updatedAt: now,
      });
      return { ok: true as const };
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      pruneCursor: args.pruneCursor,
      updatedAt: now,
    });

    return { ok: true as const };
  },
});

export const getGitHubPackageBackupSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupSyncState> => {
    const state = await ctx.db
      .query("githubBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", PACKAGE_SYNC_STATE_KEY))
      .unique();
    return { cursor: state?.cursor ?? null, pruneCursor: state?.pruneCursor ?? null };
  },
});

export const setGitHubPackageBackupSyncStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("githubBackupSyncState")
      .withIndex("by_key", (q) => q.eq("key", PACKAGE_SYNC_STATE_KEY))
      .unique();

    if (!state) {
      await ctx.db.insert("githubBackupSyncState", {
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

const registryArtifactBackupTargetKindValidator = v.union(
  v.literal("skillVersion"),
  v.literal("packageRelease"),
);
const registryArtifactBackupReasonValidator = v.union(
  v.literal("publish"),
  v.literal("sync"),
  v.literal("retry"),
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
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = clampInt(args.limit ?? 25, 1, 100);
    return await ctx.db
      .query("registryArtifactBackupJobs")
      .withIndex("by_status_nextRunAt", (q) => q.eq("status", "pending").lte("nextRunAt", now))
      .take(limit);
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

export const syncGitHubBackups: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    pruneBatchSize: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncGitHubBackupsResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);

    if (args.resetCursor && !args.dryRun) {
      await ctx.runMutation(internal.githubBackups.setGitHubBackupSyncStateInternal, {
        cursor: undefined,
        pruneCursor: undefined,
      });
      await ctx.runMutation(internal.githubBackups.setGitHubPackageBackupSyncStateInternal, {
        cursor: undefined,
      });
    }

    return ctx.runAction(internal.githubBackupsNode.syncGitHubBackupsInternal, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
      pruneBatchSize: args.pruneBatchSize,
    }) as Promise<SyncGitHubBackupsResult>;
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
    reason: "publish" | "sync" | "retry";
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
      lastError,
      nextRunAt: now,
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
