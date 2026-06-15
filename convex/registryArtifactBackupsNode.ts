"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./functions";
import { isPublicSkillDoc } from "./lib/globalStats";
import {
  backupPackageReleaseToObjectStorage,
  backupSkillVersionToObjectStorage,
  fetchPackageBackupIndex,
  fetchPackageReleaseBackupMeta,
  fetchSkillBackupIndex,
  fetchSkillVersionBackupMeta,
  getRegistryArtifactBackupContext,
  isRegistryArtifactBackupConfigured,
  repairPackageReleaseBackupIndexes,
  repairSkillVersionBackupIndexes,
  type RegistryArtifactBackupContext,
} from "./lib/registryArtifactBackup";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 5;
const MAX_MAX_BATCHES = 200;
const DEFAULT_JOB_BATCH_SIZE = 500;
const MAX_RETRY_REPAIR_ATTEMPTS = 16;
const MAX_PARALLEL_RETRY_ROOTS = 50;
const UNKNOWN_PACKAGE_ARTIFACT_BYTES = 120 * 1024 * 1024;
const UNKNOWN_SKILL_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_PARALLEL_RETRY_ARTIFACT_BYTES = UNKNOWN_PACKAGE_ARTIFACT_BYTES;
const STALE_BACKUP_JOB_MS = 24 * 60 * 60 * 1000;
const RETRY_LEASE_TTL_MS = 20 * 60 * 1000;

type BackupPageItem =
  | {
      kind: "ok";
      skillId: Doc<"skills">["_id"];
      versionId: Doc<"skillVersions">["_id"];
      slug: string;
      version: string;
      isLatest: boolean;
      displayName: string;
      ownerHandle: string;
      publishedAt: number;
    }
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
  | { kind: "missingPackage" }
  | { kind: "missingOwner" }
  | { kind: "missingArtifact" };

export type RegistryArtifactBackupSyncStats = {
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

export type SeedRegistryArtifactBackupsInternalArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
};

export type SeedRegistryArtifactBackupsInternalResult = {
  stats: RegistryArtifactBackupSyncStats;
  cursor: string | null;
  packageCursor: string | null;
  skillsIsDone: boolean;
  packageIsDone: boolean;
  isDone: boolean;
};

export type ProcessRegistryArtifactBackupRetriesInternalResult = {
  stats: RegistryArtifactBackupSyncStats;
};

export type ProcessRegistryArtifactBackupRetriesInternalArgs = {
  dryRun?: boolean;
  forceDue?: boolean;
};

export const backupSkillForPublishInternal = internalAction({
  args: {
    skillId: v.optional(v.id("skills")),
    versionId: v.optional(v.id("skillVersions")),
    slug: v.string(),
    version: v.string(),
    isLatest: v.optional(v.boolean()),
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
    if (!isRegistryArtifactBackupConfigured()) {
      return { skipped: true as const };
    }
    try {
      const item = args.versionId ? await getSkillBackupItemForVersion(ctx, args.versionId) : null;
      if (args.versionId && !item) {
        return { skipped: true as const };
      }
      await backupSkillVersionToObjectStorage(ctx, item ?? args);
      return { skipped: false as const };
    } catch (error) {
      if (args.versionId) {
        await ctx.runMutation(
          internal.registryArtifactBackups.enqueueRegistryArtifactBackupJobInternal,
          {
            targetKind: "skillVersion",
            skillVersionId: args.versionId,
            reason: "publish",
            error: errorMessage(error),
          },
        );
      }
      console.error("Registry skill artifact backup failed", error);
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
    isLatest: v.optional(v.boolean()),
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
    if (!isRegistryArtifactBackupConfigured()) {
      return { skipped: true as const };
    }
    try {
      const item = await getPackageBackupItemForRelease(ctx, args.releaseId);
      if (!item) {
        return { skipped: true as const };
      }
      await backupPackageReleaseToObjectStorage(ctx, item);
      return { skipped: false as const };
    } catch (error) {
      await ctx.runMutation(
        internal.registryArtifactBackups.enqueueRegistryArtifactBackupJobInternal,
        {
          targetKind: "packageRelease",
          packageReleaseId: args.releaseId,
          reason: "publish",
          error: errorMessage(error),
        },
      );
      console.error("Registry package artifact backup failed", error);
      return { skipped: false as const, queuedRetry: true as const };
    }
  },
});

export async function seedRegistryArtifactBackupsInternalHandler(
  ctx: ActionCtx,
  args: SeedRegistryArtifactBackupsInternalArgs,
): Promise<SeedRegistryArtifactBackupsInternalResult> {
  const dryRun = Boolean(args.dryRun);
  const stats = initialRegistryArtifactBackupSyncStats();

  if (!isRegistryArtifactBackupConfigured()) {
    return {
      stats,
      cursor: null,
      packageCursor: null,
      skillsIsDone: true,
      packageIsDone: true,
      isDone: true,
    };
  }

  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const context = getRegistryArtifactBackupContext();
  await processDueRegistryArtifactBackupJobs(ctx, context, dryRun, stats);

  const state = dryRun
    ? { cursor: null as string | null }
    : ((await ctx.runQuery(
        internal.registryArtifactBackups.getRegistryArtifactBackupSyncStateInternal,
        {},
      )) as {
        cursor: string | null;
      });

  let cursor: string | null = state.cursor;
  let isDone = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const page = (await ctx.runQuery(
      internal.registryArtifactBackups.getRegistryArtifactBackupPageInternal,
      {
        cursor: cursor ?? undefined,
        batchSize,
      },
    )) as { items: BackupPageItem[]; cursor: string | null; isDone: boolean };

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      if (item.kind !== "ok") {
        if (item.kind === "missingOwner") {
          stats.skillsMissingOwner += 1;
        }
        continue;
      }

      stats.skillsScanned += 1;
      try {
        const meta = await fetchSkillVersionBackupMeta(
          context,
          item.ownerHandle,
          item.slug,
          item.version,
        );
        if (meta?.version === item.version && meta.restore.versionId === item.versionId) {
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
          await backupSkillVersionToObjectStorage(
            ctx,
            {
              skillId: item.skillId,
              versionId: item.versionId,
              slug: item.slug,
              version: item.version,
              isLatest: item.isLatest,
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
        console.error("Registry skill artifact backup seed failed", error);
        stats.errors += 1;
        if (!dryRun) {
          await ctx.runMutation(
            internal.registryArtifactBackups.enqueueRegistryArtifactBackupJobInternal,
            {
              targetKind: "skillVersion",
              skillVersionId: item.versionId,
              reason: "seed",
              error: errorMessage(error),
            },
          );
        }
      }
    }

    if (!dryRun) {
      await ctx.runMutation(
        internal.registryArtifactBackups.setRegistryArtifactBackupSyncStateInternal,
        {
          cursor: isDone ? undefined : (cursor ?? undefined),
        },
      );
    }

    if (isDone) break;
  }

  const packageSync = await syncPackageReleaseBackups(ctx, context, args, dryRun, stats);
  await alertOnUnhealthyBackupBacklog(ctx, stats);

  if (!dryRun) {
    await ctx.runMutation(
      internal.registryArtifactBackups.setRegistryArtifactBackupSyncStateInternal,
      {
        cursor: isDone ? undefined : (cursor ?? undefined),
      },
    );
  }

  return {
    stats,
    cursor,
    packageCursor: packageSync.cursor,
    skillsIsDone: isDone,
    packageIsDone: packageSync.isDone,
    isDone: isDone && packageSync.isDone,
  };
}

async function syncPackageReleaseBackups(
  ctx: ActionCtx,
  context: RegistryArtifactBackupContext,
  args: SeedRegistryArtifactBackupsInternalArgs,
  dryRun: boolean,
  stats: RegistryArtifactBackupSyncStats,
): Promise<{ cursor: string | null; isDone: boolean }> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const state = dryRun
    ? { cursor: null as string | null }
    : ((await ctx.runQuery(
        internal.registryArtifactBackups.getPackageRegistryArtifactBackupSyncStateInternal,
        {},
      )) as {
        cursor: string | null;
      });
  let cursor: string | null = state.cursor;
  let isDone = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const page = (await ctx.runQuery(
      internal.registryArtifactBackups.getPackageRegistryArtifactBackupPageInternal,
      {
        cursor: cursor ?? undefined,
        batchSize,
      },
    )) as { items: PackageBackupPageItem[]; cursor: string | null; isDone: boolean };
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
        const meta = await fetchPackageReleaseBackupMeta(
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
          await backupPackageReleaseToObjectStorage(ctx, item, context);
          stats.packagesBackedUp += 1;
        }
      } catch (error) {
        stats.errors += 1;
        console.error("Registry package artifact backup seed failed", error);
        if (!dryRun) {
          await ctx.runMutation(
            internal.registryArtifactBackups.enqueueRegistryArtifactBackupJobInternal,
            {
              targetKind: "packageRelease",
              packageReleaseId: item.releaseId,
              reason: "seed",
              error: errorMessage(error),
            },
          );
        }
      }
    }

    if (!dryRun) {
      await ctx.runMutation(
        internal.registryArtifactBackups.setPackageRegistryArtifactBackupSyncStateInternal,
        {
          cursor: isDone ? undefined : (cursor ?? undefined),
        },
      );
    }
    if (isDone) break;
  }
  return { cursor, isDone };
}

async function processDueRegistryArtifactBackupJobs(
  ctx: ActionCtx,
  context: RegistryArtifactBackupContext,
  dryRun: boolean,
  stats: RegistryArtifactBackupSyncStats,
  options: { forceDue?: boolean } = {},
) {
  if (dryRun) return;
  const jobs = (await ctx.runQuery(
    internal.registryArtifactBackups.getDueRegistryArtifactBackupJobsInternal,
    {
      includeExhaustedRepair: true,
      ignoreNextRunAt: options.forceDue,
      limit: DEFAULT_JOB_BATCH_SIZE,
      maxRepairAttempts: MAX_RETRY_REPAIR_ATTEMPTS,
    },
  )) as Array<Doc<"registryArtifactBackupJobs">>;

  const groups = await groupRetryJobsByRoot(ctx, jobs);
  const chunks = chunkRetryJobGroups(groups);
  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map((group) => processRetryJobGroup(ctx, context, group)),
    );
    for (const result of results) {
      stats.retryJobsProcessed += result.processed;
      stats.retryJobsSucceeded += result.succeeded;
      stats.retryJobsFailed += result.failed;
    }
  }
}

type RetryJobWorkItem =
  | {
      error: unknown;
      kind: "lookupFailed";
      job: Doc<"registryArtifactBackupJobs">;
    }
  | {
      kind: "missing";
      job: Doc<"registryArtifactBackupJobs">;
    }
  | {
      kind: "packageRelease";
      job: Doc<"registryArtifactBackupJobs">;
      item: Extract<PackageBackupPageItem, { kind: "ok" }>;
      rootKey: string;
      estimatedBytes: number;
    }
  | {
      kind: "skillVersion";
      job: Doc<"registryArtifactBackupJobs">;
      item: Parameters<typeof backupSkillVersionToObjectStorage>[1];
      rootKey: string;
      estimatedBytes: number;
    };

type ArtifactRetryJobWorkItem =
  | Extract<RetryJobWorkItem, { kind: "packageRelease" }>
  | Extract<RetryJobWorkItem, { kind: "skillVersion" }>;

type RetryJobGroup = {
  estimatedBytes: number;
  items: RetryJobWorkItem[];
};

async function groupRetryJobsByRoot(
  ctx: ActionCtx,
  jobs: Array<Doc<"registryArtifactBackupJobs">>,
) {
  const groups = new Map<string, RetryJobGroup>();
  for (const job of jobs) {
    const workItem = await toRetryJobWorkItem(ctx, job).catch((error: unknown) => ({
      error,
      kind: "lookupFailed" as const,
      job,
    }));
    const rootKey =
      workItem.kind === "missing" || workItem.kind === "lookupFailed"
        ? `${workItem.kind}:${job._id}`
        : workItem.rootKey;
    const group = groups.get(rootKey);
    const estimatedBytes = estimatedRetryJobBytes(workItem);
    if (group) {
      group.items.push(workItem);
      group.estimatedBytes = Math.max(group.estimatedBytes, estimatedBytes);
    } else {
      groups.set(rootKey, { estimatedBytes, items: [workItem] });
    }
  }
  return Array.from(groups.values());
}

async function toRetryJobWorkItem(
  ctx: ActionCtx,
  job: Doc<"registryArtifactBackupJobs">,
): Promise<RetryJobWorkItem> {
  if (job.targetKind === "packageRelease" && job.packageReleaseId) {
    const item = await getPackageBackupItemForRelease(ctx, job.packageReleaseId);
    if (!item) return { kind: "missing", job };
    return {
      estimatedBytes: item.artifactSize ?? UNKNOWN_PACKAGE_ARTIFACT_BYTES,
      kind: "packageRelease",
      job,
      item,
      rootKey: `package:${item.ownerHandle}/${item.normalizedName}`,
    };
  }
  if (job.targetKind === "skillVersion" && job.skillVersionId) {
    const item = await getSkillBackupItemForVersion(ctx, job.skillVersionId);
    if (!item) return { kind: "missing", job };
    return {
      estimatedBytes: estimateSkillBackupBytes(item),
      kind: "skillVersion",
      job,
      item,
      rootKey: `skill:${item.ownerHandle}/${item.slug}`,
    };
  }
  return { kind: "missing", job };
}

async function processRetryJobGroup(
  ctx: ActionCtx,
  context: RegistryArtifactBackupContext,
  group: RetryJobGroup,
) {
  const result = { processed: 0, succeeded: 0, failed: 0 };
  const packageIndexRepairs: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>> = [];
  const skillIndexRepairs: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>> = [];
  for (const workItem of group.items) {
    result.processed += 1;
    try {
      if (workItem.kind === "lookupFailed") {
        throw workItem.error;
      } else if (workItem.kind === "missing") {
        await markRetryJobSucceeded(ctx, workItem.job);
        result.succeeded += 1;
      } else if (workItem.kind === "packageRelease") {
        if (await hasMatchingPackageReleaseMeta(context, workItem.item)) {
          packageIndexRepairs.push(workItem);
        } else {
          await backupPackageReleaseToObjectStorage(ctx, workItem.item, context);
          await markRetryJobSucceeded(ctx, workItem.job);
          result.succeeded += 1;
        }
      } else {
        if (await hasMatchingSkillVersionMeta(context, workItem.item)) {
          skillIndexRepairs.push(workItem);
        } else {
          await backupSkillVersionToObjectStorage(ctx, workItem.item, context);
          await markRetryJobSucceeded(ctx, workItem.job);
          result.succeeded += 1;
        }
      }
    } catch (error) {
      result.failed += 1;
      await ctx.runMutation(
        internal.registryArtifactBackups.markRegistryArtifactBackupJobFailedInternal,
        {
          jobId: workItem.job._id,
          error: errorMessage(error),
          maxAttempts: MAX_RETRY_REPAIR_ATTEMPTS,
        },
      );
    }
  }
  await flushPackageIndexRepairs(ctx, context, packageIndexRepairs, result);
  await flushSkillIndexRepairs(ctx, context, skillIndexRepairs, result);
  return result;
}

async function flushPackageIndexRepairs(
  ctx: ActionCtx,
  context: RegistryArtifactBackupContext,
  workItems: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>>,
  result: { succeeded: number; failed: number },
) {
  if (workItems.length === 0) return;
  let splitItems: {
    indexed: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>>;
    missing: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>>;
  };
  try {
    splitItems = await splitPackageIndexRepairItems(context, workItems);
  } catch (error) {
    result.failed += workItems.length;
    await markRetryJobsFailed(ctx, workItems, error);
    return;
  }

  const { indexed, missing } = splitItems;
  await markIndexedRetryJobsSucceeded(ctx, indexed, result);
  if (missing.length === 0) return;

  try {
    await repairPackageReleaseBackupIndexes(
      ctx,
      missing.map((workItem) => workItem.item),
      context,
    );
    for (const workItem of missing) {
      await markRetryJobSucceeded(ctx, workItem.job);
    }
    result.succeeded += missing.length;
  } catch (error) {
    result.failed += missing.length;
    await markRetryJobsFailed(ctx, missing, error);
  }
}

async function flushSkillIndexRepairs(
  ctx: ActionCtx,
  context: RegistryArtifactBackupContext,
  workItems: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>>,
  result: { succeeded: number; failed: number },
) {
  if (workItems.length === 0) return;
  let splitItems: {
    indexed: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>>;
    missing: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>>;
  };
  try {
    splitItems = await splitSkillIndexRepairItems(context, workItems);
  } catch (error) {
    result.failed += workItems.length;
    await markRetryJobsFailed(ctx, workItems, error);
    return;
  }

  const { indexed, missing } = splitItems;
  await markIndexedRetryJobsSucceeded(ctx, indexed, result);
  if (missing.length === 0) return;

  try {
    await repairSkillVersionBackupIndexes(
      ctx,
      missing.map((workItem) => workItem.item),
      context,
    );
    for (const workItem of missing) {
      await markRetryJobSucceeded(ctx, workItem.job);
    }
    result.succeeded += missing.length;
  } catch (error) {
    result.failed += missing.length;
    await markRetryJobsFailed(ctx, missing, error);
  }
}

async function splitPackageIndexRepairItems(
  context: RegistryArtifactBackupContext,
  workItems: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>>,
) {
  const first = workItems[0];
  const index = first
    ? await fetchPackageBackupIndex(context, first.item.ownerHandle, first.item.normalizedName)
    : null;
  const indexed: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>> = [];
  const missing: Array<Extract<RetryJobWorkItem, { kind: "packageRelease" }>> = [];
  for (const workItem of workItems) {
    const present = packageIndexEntryMatchesRetry(index, workItem.item);
    (present ? indexed : missing).push(workItem);
  }
  return { indexed, missing };
}

async function splitSkillIndexRepairItems(
  context: RegistryArtifactBackupContext,
  workItems: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>>,
) {
  const first = workItems[0];
  const index = first
    ? await fetchSkillBackupIndex(context, first.item.ownerHandle, first.item.slug)
    : null;
  const indexed: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>> = [];
  const missing: Array<Extract<RetryJobWorkItem, { kind: "skillVersion" }>> = [];
  for (const workItem of workItems) {
    const present = skillIndexEntryMatchesRetry(index, workItem.item);
    (present ? indexed : missing).push(workItem);
  }
  return { indexed, missing };
}

function packageIndexEntryMatchesRetry(
  index: Awaited<ReturnType<typeof fetchPackageBackupIndex>>,
  item: Extract<RetryJobWorkItem, { kind: "packageRelease" }>["item"],
) {
  const entry = index?.versions.find(
    (candidate) => candidate.releaseId === item.releaseId && candidate.version === item.version,
  );
  if (!entry) return false;
  if (typeof item.isLatest !== "boolean") return true;
  if (entry.isLatest !== item.isLatest) return false;
  const latestMatches = Boolean(
    index && index.latest.releaseId === item.releaseId && index.latest.version === item.version,
  );
  return item.isLatest ? latestMatches : !latestMatches;
}

function skillIndexEntryMatchesRetry(
  index: Awaited<ReturnType<typeof fetchSkillBackupIndex>>,
  item: Extract<RetryJobWorkItem, { kind: "skillVersion" }>["item"],
) {
  const entry = index?.versions.find(
    (candidate) => candidate.versionId === item.versionId && candidate.version === item.version,
  );
  if (!entry) return false;
  if (typeof item.isLatest !== "boolean") return true;
  if (entry.isLatest !== item.isLatest) return false;
  const latestMatches = Boolean(
    index && index.latest.versionId === item.versionId && index.latest.version === item.version,
  );
  return item.isLatest ? latestMatches : !latestMatches;
}

async function markIndexedRetryJobsSucceeded(
  ctx: ActionCtx,
  workItems: ArtifactRetryJobWorkItem[],
  result: { succeeded: number; failed: number },
) {
  for (const workItem of workItems) {
    try {
      await markRetryJobSucceeded(ctx, workItem.job);
      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      try {
        await markRetryJobsFailed(ctx, [workItem], error);
      } catch (markFailedError) {
        console.error("Registry artifact backup retry status update failed", markFailedError);
      }
    }
  }
}

async function markRetryJobsFailed(
  ctx: ActionCtx,
  workItems: ArtifactRetryJobWorkItem[],
  error: unknown,
) {
  for (const workItem of workItems) {
    await ctx.runMutation(
      internal.registryArtifactBackups.markRegistryArtifactBackupJobFailedInternal,
      {
        jobId: workItem.job._id,
        error: errorMessage(error),
        maxAttempts: MAX_RETRY_REPAIR_ATTEMPTS,
      },
    );
  }
}

async function markRetryJobSucceeded(ctx: ActionCtx, job: Doc<"registryArtifactBackupJobs">) {
  await ctx.runMutation(
    internal.registryArtifactBackups.markRegistryArtifactBackupJobSucceededInternal,
    {
      jobId: job._id,
    },
  );
}

async function hasMatchingSkillVersionMeta(
  context: RegistryArtifactBackupContext,
  item: Parameters<typeof backupSkillVersionToObjectStorage>[1],
) {
  const meta = await fetchSkillVersionBackupMeta(
    context,
    item.ownerHandle,
    item.slug,
    item.version,
  );
  return meta?.version === item.version && meta.restore.versionId === item.versionId;
}

async function hasMatchingPackageReleaseMeta(
  context: RegistryArtifactBackupContext,
  item: Extract<PackageBackupPageItem, { kind: "ok" }>,
) {
  const meta = await fetchPackageReleaseBackupMeta(
    context,
    item.ownerHandle,
    item.normalizedName,
    item.version,
  );
  return (
    meta?.restore?.releaseId === item.releaseId && meta.artifact.sha256 === item.artifactSha256
  );
}

function estimatedRetryJobBytes(workItem: RetryJobWorkItem) {
  if (workItem.kind === "packageRelease" || workItem.kind === "skillVersion") {
    return workItem.estimatedBytes;
  }
  return 0;
}

function estimateSkillBackupBytes(item: Parameters<typeof backupSkillVersionToObjectStorage>[1]) {
  const total = item.files.reduce((sum, file) => sum + file.size, 0);
  return total || UNKNOWN_SKILL_ARTIFACT_BYTES;
}

function chunkRetryJobGroups(groups: RetryJobGroup[]) {
  const chunks: RetryJobGroup[][] = [];
  let current: RetryJobGroup[] = [];
  let currentBytes = 0;

  for (const group of groups) {
    const groupBytes = group.estimatedBytes;
    const wouldExceedRootLimit = current.length >= MAX_PARALLEL_RETRY_ROOTS;
    const wouldExceedByteLimit =
      current.length > 0 && currentBytes + groupBytes > MAX_PARALLEL_RETRY_ARTIFACT_BYTES;
    if (wouldExceedRootLimit || wouldExceedByteLimit) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(group);
    currentBytes += groupBytes;
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
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
    files: release.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
  };
}

async function getSkillBackupItemForVersion(
  ctx: ActionCtx,
  versionId: Id<"skillVersions">,
): Promise<Parameters<typeof backupSkillVersionToObjectStorage>[1] | null> {
  const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
    versionId,
  })) as Doc<"skillVersions"> | null;
  if (!version || version.softDeletedAt) return null;
  const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
    skillId: version.skillId,
  })) as Doc<"skills"> | null;
  if (!isPublicSkillDoc(skill)) return null;
  const owner = skill.ownerPublisherId
    ? ((await ctx.runQuery(internal.publishers.getByIdInternal, {
        publisherId: skill.ownerPublisherId,
      })) as Doc<"publishers"> | null)
    : ((await ctx.runQuery(internal.users.getByIdInternal, {
        userId: skill.ownerUserId,
      })) as Doc<"users"> | null);
  if (!owner || owner.deletedAt || owner.deactivatedAt) return null;
  return {
    skillId: skill._id,
    versionId: version._id,
    slug: skill.slug,
    version: version.version,
    isLatest: skill.latestVersionId === version._id,
    displayName: skill.displayName,
    ownerHandle: owner.handle ?? String(skill.ownerPublisherId ?? skill.ownerUserId),
    files: version.files,
    publishedAt: version.createdAt,
  };
}

async function alertOnUnhealthyBackupBacklog(
  ctx: ActionCtx,
  stats: RegistryArtifactBackupSyncStats,
) {
  const health = (await ctx.runQuery(
    internal.registryArtifactBackups.getRegistryArtifactBackupHealthInternal,
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

export async function processRegistryArtifactBackupRetriesInternalHandler(
  ctx: ActionCtx,
  args: ProcessRegistryArtifactBackupRetriesInternalArgs,
): Promise<ProcessRegistryArtifactBackupRetriesInternalResult> {
  const stats = initialRegistryArtifactBackupSyncStats();

  if (!isRegistryArtifactBackupConfigured()) {
    return { stats };
  }

  const context = getRegistryArtifactBackupContext();
  if (args.dryRun) {
    await processDueRegistryArtifactBackupJobs(ctx, context, true, stats);
    await alertOnUnhealthyBackupBacklog(ctx, stats);
    return { stats };
  }

  const token = `retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lease = (await ctx.runMutation(
    internal.registryArtifactBackups.tryAcquireRegistryArtifactBackupRetryLeaseInternal,
    {
      token,
      ttlMs: RETRY_LEASE_TTL_MS,
    },
  )) as { acquired: boolean };
  if (!lease.acquired) return { stats };

  try {
    await processDueRegistryArtifactBackupJobs(ctx, context, false, stats, {
      forceDue: args.forceDue,
    });
    await alertOnUnhealthyBackupBacklog(ctx, stats);
  } finally {
    await ctx.runMutation(
      internal.registryArtifactBackups.releaseRegistryArtifactBackupRetryLeaseInternal,
      {
        token,
      },
    );
  }
  return { stats };
}

export const seedRegistryArtifactBackupsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: seedRegistryArtifactBackupsInternalHandler,
});

export const processRegistryArtifactBackupRetriesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    forceDue: v.optional(v.boolean()),
  },
  handler: processRegistryArtifactBackupRetriesInternalHandler,
});

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function initialRegistryArtifactBackupSyncStats(): RegistryArtifactBackupSyncStats {
  return {
    skillsScanned: 0,
    skillsSkipped: 0,
    skillsBackedUp: 0,
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
}
