"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./functions";
import {
  backupPackageReleaseToGitHub,
  backupSkillToGitHub,
  deleteGitHubSkillBackup,
  fetchGitHubPackageReleaseMeta,
  fetchGitHubSkillMeta,
  getGitHubBackupContext,
  isGitHubBackupConfigured,
  listGitHubSkillBackupEntries,
  normalizeOwner,
} from "./lib/githubBackup";
import { isPublicSkillDoc } from "./lib/globalStats";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 5;
const MAX_MAX_BATCHES = 200;
const DEFAULT_PRUNE_BATCH_SIZE = 10;
const MAX_PRUNE_BATCH_SIZE = 100;
const DEFAULT_JOB_BATCH_SIZE = 25;
const STALE_BACKUP_JOB_MS = 24 * 60 * 60 * 1000;

type BackupPageItem =
  | {
      kind: "ok";
      versionId: Doc<"skillVersions">["_id"];
      slug: string;
      version: string;
      displayName: string;
      ownerHandle: string;
      publishedAt: number;
    }
  | { kind: "missingLatestVersion" }
  | { kind: "missingOwner" };

type PackageBackupPageItem =
  | {
      kind: "ok";
      packageId: Doc<"packages">["_id"];
      releaseId: Doc<"packageReleases">["_id"];
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
  | { kind: "missingPackage" }
  | { kind: "missingOwner" }
  | { kind: "missingArtifact" };

export type GitHubBackupSyncStats = {
  skillsScanned: number;
  skillsSkipped: number;
  skillsBackedUp: number;
  skillsDeleted: number;
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

export type SyncGitHubBackupsInternalArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  pruneBatchSize?: number;
};

export type SyncGitHubBackupsInternalResult = {
  stats: GitHubBackupSyncStats;
  cursor: string | null;
  pruneCursor: string | null;
  packageCursor: string | null;
  skillsIsDone: boolean;
  packageIsDone: boolean;
  isDone: boolean;
};

export const backupSkillForPublishInternal = internalAction({
  args: {
    versionId: v.optional(v.id("skillVersions")),
    slug: v.string(),
    version: v.string(),
    displayName: v.string(),
    ownerHandle: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    publishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!isGitHubBackupConfigured()) {
      return { skipped: true as const };
    }
    try {
      await backupSkillToGitHub(ctx, args);
      return { skipped: false as const };
    } catch (error) {
      if (args.versionId) {
        await ctx.runMutation(internal.githubBackups.enqueueRegistryArtifactBackupJobInternal, {
          targetKind: "skillVersion",
          skillVersionId: args.versionId,
          reason: "publish",
          error: errorMessage(error),
        });
      }
      console.error("GitHub skill backup failed", error);
      return { skipped: false as const, queuedRetry: Boolean(args.versionId) };
    }
  },
});

export const backupPackageForPublishInternal = internalAction({
  args: {
    ownerHandle: v.string(),
    packageId: v.id("packages"),
    releaseId: v.id("packageReleases"),
    packageName: v.string(),
    normalizedName: v.string(),
    displayName: v.string(),
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
    version: v.string(),
    publishedAt: v.number(),
    artifactKind: v.optional(v.union(v.literal("legacy-zip"), v.literal("npm-pack"))),
    artifactStorageId: v.id("_storage"),
    artifactFileName: v.optional(v.string()),
    artifactSha256: v.optional(v.string()),
    artifactSize: v.optional(v.number()),
    artifactFormat: v.optional(v.literal("tgz")),
    npmIntegrity: v.optional(v.string()),
    npmShasum: v.optional(v.string()),
    npmUnpackedSize: v.optional(v.number()),
    npmFileCount: v.optional(v.number()),
    runtimeId: v.optional(v.string()),
    sourceRepo: v.optional(v.string()),
    compatibility: v.optional(v.any()),
    capabilities: v.optional(v.any()),
    extractedPackageJson: v.optional(v.any()),
    extractedPluginManifest: v.optional(v.any()),
    normalizedBundleManifest: v.optional(v.any()),
    files: v.array(v.object({ path: v.string(), size: v.number(), sha256: v.string() })),
  },
  handler: async (ctx, args) => {
    if (!isGitHubBackupConfigured()) {
      return { skipped: true as const };
    }
    try {
      await backupPackageReleaseToGitHub(ctx, args);
      return { skipped: false as const };
    } catch (error) {
      await ctx.runMutation(internal.githubBackups.enqueueRegistryArtifactBackupJobInternal, {
        targetKind: "packageRelease",
        packageReleaseId: args.releaseId,
        reason: "publish",
        error: errorMessage(error),
      });
      console.error("GitHub package backup failed", error);
      return { skipped: false as const, queuedRetry: true as const };
    }
  },
});

export async function syncGitHubBackupsInternalHandler(
  ctx: ActionCtx,
  args: SyncGitHubBackupsInternalArgs,
): Promise<SyncGitHubBackupsInternalResult> {
  const dryRun = Boolean(args.dryRun);
  const stats: GitHubBackupSyncStats = {
    skillsScanned: 0,
    skillsSkipped: 0,
    skillsBackedUp: 0,
    skillsDeleted: 0,
    skillsMissingVersion: 0,
    skillsMissingOwner: 0,
    packagesScanned: 0,
    packagesSkipped: 0,
    packagesBackedUp: 0,
    packagesMissingArtifact: 0,
    packagesMissingPackage: 0,
    packagesMissingOwner: 0,
    retryJobsProcessed: 0,
    retryJobsSucceeded: 0,
    retryJobsFailed: 0,
    staleJobs: 0,
    exhaustedJobs: 0,
    errors: 0,
  };

  if (!isGitHubBackupConfigured()) {
    return {
      stats,
      cursor: null,
      pruneCursor: null,
      packageCursor: null,
      skillsIsDone: true,
      packageIsDone: true,
      isDone: true,
    };
  }

  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const pruneBatchSize = clampInt(
    args.pruneBatchSize ?? DEFAULT_PRUNE_BATCH_SIZE,
    1,
    MAX_PRUNE_BATCH_SIZE,
  );
  const context = await getGitHubBackupContext();
  await processDueRegistryArtifactBackupJobs(ctx, context, dryRun, stats);

  const state = dryRun
    ? { cursor: null as string | null, pruneCursor: null as string | null }
    : ((await ctx.runQuery(internal.githubBackups.getGitHubBackupSyncStateInternal, {})) as {
        cursor: string | null;
        pruneCursor: string | null;
      });

  let cursor: string | null = state.cursor;
  let pruneCursor: string | null = state.pruneCursor;
  let isDone = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const page = (await ctx.runQuery(internal.githubBackups.getGitHubBackupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as { items: BackupPageItem[]; cursor: string | null; isDone: boolean };

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      if (item.kind !== "ok") {
        if (item.kind === "missingLatestVersion") {
          stats.skillsMissingVersion += 1;
        } else if (item.kind === "missingOwner") {
          stats.skillsMissingOwner += 1;
        }
        continue;
      }

      stats.skillsScanned += 1;
      try {
        const meta = await fetchGitHubSkillMeta(context, item.ownerHandle, item.slug);
        if (meta?.latest?.version === item.version) {
          stats.skillsSkipped += 1;
          continue;
        }

        const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
          versionId: item.versionId,
        })) as Doc<"skillVersions"> | null;
        if (!version) {
          stats.skillsMissingVersion += 1;
          continue;
        }

        if (!dryRun) {
          await backupSkillToGitHub(
            ctx,
            {
              slug: item.slug,
              version: item.version,
              displayName: item.displayName,
              ownerHandle: item.ownerHandle,
              files: version.files,
              publishedAt: item.publishedAt,
            },
            context,
          );
          stats.skillsBackedUp += 1;
        }
      } catch (error) {
        console.error("GitHub backup sync failed", error);
        stats.errors += 1;
      }
    }

    if (!dryRun) {
      await ctx.runMutation(internal.githubBackups.setGitHubBackupSyncStateInternal, {
        cursor: isDone ? undefined : (cursor ?? undefined),
        pruneCursor: pruneCursor ?? undefined,
      });
    }

    if (isDone) break;
  }

  pruneCursor = await pruneDeletedSkillBackups(
    ctx,
    context,
    dryRun,
    stats,
    pruneCursor,
    pruneBatchSize,
  );

  const packageSync = await syncPackageReleaseBackups(ctx, context, args, dryRun, stats);
  await alertOnUnhealthyBackupBacklog(ctx, stats);

  if (!dryRun) {
    await ctx.runMutation(internal.githubBackups.setGitHubBackupSyncStateInternal, {
      cursor: isDone ? undefined : (cursor ?? undefined),
      pruneCursor: pruneCursor ?? undefined,
    });
  }

  return {
    stats,
    cursor,
    pruneCursor,
    packageCursor: packageSync.cursor,
    skillsIsDone: isDone,
    packageIsDone: packageSync.isDone,
    isDone: isDone && packageSync.isDone,
  };
}

async function syncPackageReleaseBackups(
  ctx: ActionCtx,
  context: Awaited<ReturnType<typeof getGitHubBackupContext>>,
  args: SyncGitHubBackupsInternalArgs,
  dryRun: boolean,
  stats: GitHubBackupSyncStats,
): Promise<{ cursor: string | null; isDone: boolean }> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const state = dryRun
    ? { cursor: null as string | null, pruneCursor: null as string | null }
    : ((await ctx.runQuery(internal.githubBackups.getGitHubPackageBackupSyncStateInternal, {})) as {
        cursor: string | null;
        pruneCursor: string | null;
      });
  let cursor: string | null = state.cursor;
  let isDone = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const page = (await ctx.runQuery(internal.githubBackups.getPackageGitHubBackupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as { items: PackageBackupPageItem[]; cursor: string | null; isDone: boolean };
    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      if (item.kind !== "ok") {
        if (item.kind === "missingArtifact") stats.packagesMissingArtifact += 1;
        if (item.kind === "missingPackage") stats.packagesMissingPackage += 1;
        if (item.kind === "missingOwner") stats.packagesMissingOwner += 1;
        continue;
      }
      stats.packagesScanned += 1;
      try {
        const meta = await fetchGitHubPackageReleaseMeta(
          context,
          item.ownerHandle,
          item.normalizedName,
          item.version,
        );
        if (
          meta?.restore?.releaseId === item.releaseId &&
          meta.artifact.sha256 === item.artifactSha256
        ) {
          stats.packagesSkipped += 1;
          continue;
        }
        if (!dryRun) {
          await backupPackageReleaseToGitHub(ctx, item, context);
          stats.packagesBackedUp += 1;
        }
      } catch (error) {
        stats.errors += 1;
        console.error("GitHub package backup sync failed", error);
        if (!dryRun) {
          await ctx.runMutation(internal.githubBackups.enqueueRegistryArtifactBackupJobInternal, {
            targetKind: "packageRelease",
            packageReleaseId: item.releaseId,
            reason: "sync",
            error: errorMessage(error),
          });
        }
      }
    }

    if (!dryRun) {
      await ctx.runMutation(internal.githubBackups.setGitHubPackageBackupSyncStateInternal, {
        cursor: isDone ? undefined : (cursor ?? undefined),
      });
    }
    if (isDone) break;
  }
  return { cursor, isDone };
}

async function processDueRegistryArtifactBackupJobs(
  ctx: ActionCtx,
  context: Awaited<ReturnType<typeof getGitHubBackupContext>>,
  dryRun: boolean,
  stats: GitHubBackupSyncStats,
) {
  if (dryRun) return;
  const jobs = (await ctx.runQuery(
    internal.githubBackups.getDueRegistryArtifactBackupJobsInternal,
    {
      limit: DEFAULT_JOB_BATCH_SIZE,
    },
  )) as Array<Doc<"registryArtifactBackupJobs">>;

  for (const job of jobs) {
    stats.retryJobsProcessed += 1;
    try {
      if (job.targetKind === "packageRelease" && job.packageReleaseId) {
        const item = await getPackageBackupItemForRelease(ctx, job.packageReleaseId);
        if (item) await backupPackageReleaseToGitHub(ctx, item, context);
      } else if (job.targetKind === "skillVersion" && job.skillVersionId) {
        const item = await getSkillBackupItemForVersion(ctx, job.skillVersionId);
        if (item) await backupSkillToGitHub(ctx, item, context);
      }
      await ctx.runMutation(internal.githubBackups.markRegistryArtifactBackupJobSucceededInternal, {
        jobId: job._id,
      });
      stats.retryJobsSucceeded += 1;
    } catch (error) {
      stats.retryJobsFailed += 1;
      await ctx.runMutation(internal.githubBackups.markRegistryArtifactBackupJobFailedInternal, {
        jobId: job._id,
        error: errorMessage(error),
      });
    }
  }
}

async function getPackageBackupItemForRelease(
  ctx: ActionCtx,
  releaseId: Id<"packageReleases">,
): Promise<Extract<PackageBackupPageItem, { kind: "ok" }> | null> {
  const release = (await ctx.runQuery(internal.packages.getReleaseByIdInternal, {
    releaseId,
  })) as Doc<"packageReleases"> | null;
  if (!release || release.softDeletedAt) return null;
  const pkg = (await ctx.runQuery(internal.packages.getPackageByIdInternal, {
    packageId: release.packageId,
  })) as Doc<"packages"> | null;
  if (!pkg || pkg.softDeletedAt || !release.clawpackStorageId) return null;
  if (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin") return null;
  const owner = pkg.ownerPublisherId
    ? ((await ctx.runQuery(internal.publishers.getByIdInternal, {
        publisherId: pkg.ownerPublisherId,
      })) as Doc<"publishers"> | null)
    : ((await ctx.runQuery(internal.users.getByIdInternal, {
        userId: pkg.ownerUserId,
      })) as Doc<"users"> | null);
  if (!owner || owner.deletedAt || owner.deactivatedAt) return null;
  return {
    kind: "ok",
    packageId: pkg._id,
    releaseId: release._id,
    ownerHandle: owner.handle ?? String(pkg.ownerPublisherId ?? pkg.ownerUserId),
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
    files: release.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
  };
}

async function getSkillBackupItemForVersion(
  ctx: ActionCtx,
  versionId: Id<"skillVersions">,
): Promise<Parameters<typeof backupSkillToGitHub>[1] | null> {
  const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
    versionId,
  })) as Doc<"skillVersions"> | null;
  if (!version) return null;
  const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
    skillId: version.skillId,
  })) as Doc<"skills"> | null;
  if (!skill || skill.softDeletedAt) return null;
  const owner = skill.ownerPublisherId
    ? ((await ctx.runQuery(internal.publishers.getByIdInternal, {
        publisherId: skill.ownerPublisherId,
      })) as Doc<"publishers"> | null)
    : ((await ctx.runQuery(internal.users.getByIdInternal, {
        userId: skill.ownerUserId,
      })) as Doc<"users"> | null);
  if (!owner || owner.deletedAt || owner.deactivatedAt) return null;
  return {
    slug: skill.slug,
    version: version.version,
    displayName: skill.displayName,
    ownerHandle: owner.handle ?? String(skill.ownerPublisherId ?? skill.ownerUserId),
    files: version.files,
    publishedAt: version.createdAt,
  };
}

async function alertOnUnhealthyBackupBacklog(ctx: ActionCtx, stats: GitHubBackupSyncStats) {
  const health = (await ctx.runQuery(
    internal.githubBackups.getRegistryArtifactBackupHealthInternal,
    {
      staleAfterMs: STALE_BACKUP_JOB_MS,
    },
  )) as { stale: number; exhausted: number };
  stats.staleJobs = health.stale;
  stats.exhaustedJobs = health.exhausted;
  if (health.stale > 0 || health.exhausted > 0) {
    console.error("Registry artifact backup backlog unhealthy", health);
  }
}

async function pruneDeletedSkillBackups(
  ctx: ActionCtx,
  context: Awaited<ReturnType<typeof getGitHubBackupContext>>,
  dryRun: boolean,
  stats: GitHubBackupSyncStats,
  pruneCursor: string | null,
  pruneBatchSize: number,
): Promise<string | null> {
  let entries: Awaited<ReturnType<typeof listGitHubSkillBackupEntries>>;
  try {
    entries = await listGitHubSkillBackupEntries(context);
  } catch (error) {
    console.error("GitHub backup cleanup list failed", error);
    stats.errors += 1;
    return pruneCursor;
  }

  if (!entries.length) return null;

  const sortedEntries = [...entries].sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  const startIndex =
    pruneCursor == null
      ? 0
      : sortedEntries.findIndex((entry) => entry.rootPath.localeCompare(pruneCursor) > 0);

  if (startIndex === -1) return null;
  const chunk = sortedEntries.slice(startIndex, startIndex + pruneBatchSize);
  if (!chunk.length) return null;

  let lastProcessed = pruneCursor;
  for (const entry of chunk) {
    lastProcessed = entry.rootPath;
    try {
      const skill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
        slug: entry.slug,
      })) as Doc<"skills"> | null;
      if (!isMirrorEligibleSkill(skill)) {
        await deleteBackupIfNeeded(context, entry, dryRun, stats);
        continue;
      }

      const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
        userId: skill.ownerUserId,
      })) as Doc<"users"> | null;
      if (!owner || owner.deletedAt || owner.deactivatedAt) {
        await deleteBackupIfNeeded(context, entry, dryRun, stats);
        continue;
      }

      const ownerHandle = normalizeOwner(owner.handle ?? owner._id);
      if (ownerHandle !== entry.owner) {
        await deleteBackupIfNeeded(context, entry, dryRun, stats);
      }
    } catch (error) {
      console.error("GitHub backup cleanup failed", error);
      stats.errors += 1;
    }
  }

  const reachedEnd = startIndex + chunk.length >= sortedEntries.length;
  return reachedEnd ? null : (lastProcessed ?? null);
}

function isMirrorEligibleSkill(skill: Doc<"skills"> | null): skill is Doc<"skills"> {
  return isPublicSkillDoc(skill);
}

async function deleteBackupIfNeeded(
  context: Awaited<ReturnType<typeof getGitHubBackupContext>>,
  entry: Awaited<ReturnType<typeof listGitHubSkillBackupEntries>>[number],
  dryRun: boolean,
  stats: GitHubBackupSyncStats,
) {
  const result = dryRun
    ? { deleted: true as const }
    : await deleteGitHubSkillBackup(context, entry.owner, entry.slug);
  if (result.deleted) {
    stats.skillsDeleted += 1;
  }
}

export const syncGitHubBackupsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    pruneBatchSize: v.optional(v.number()),
  },
  handler: syncGitHubBackupsInternalHandler,
});

export const deleteGitHubBackupForSlugInternal = internalAction({
  args: {
    ownerHandle: v.string(),
    slug: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    if (!isGitHubBackupConfigured()) {
      return { skipped: true as const, deleted: false as const };
    }
    if (args.dryRun) {
      return { skipped: false as const, deleted: true as const, dryRun: true as const };
    }
    const context = await getGitHubBackupContext();
    const result = await deleteGitHubSkillBackup(context, args.ownerHandle, args.slug);
    return { skipped: false as const, ...result };
  },
});

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
