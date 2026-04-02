"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./functions";
import {
  backupSoulToGitHub,
  fetchGitHubSoulMeta,
  getGitHubSoulBackupContext,
  isGitHubSoulBackupConfigured,
} from "./lib/githubSoulBackup";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 5;
const MAX_MAX_BATCHES = 200;

type BackupPageItem =
  | {
      kind: "ok";
      slug: string;
      version: string;
      displayName: string;
      ownerHandle: string;
      files: Doc<"soulVersions">["files"];
      publishedAt: number;
    }
  | { kind: "missingLatestVersion" }
  | { kind: "missingVersionDoc" }
  | { kind: "missingOwner" };

export type GitHubSoulBackupSyncStats = {
  soulsScanned: number;
  soulsSkipped: number;
  soulsBackedUp: number;
  soulsMissingVersion: number;
  soulsMissingOwner: number;
  errors: number;
};

export type SyncGitHubSoulBackupsInternalArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
};

export type SyncGitHubSoulBackupsInternalResult = {
  stats: GitHubSoulBackupSyncStats;
  cursor: string | null;
  isDone: boolean;
};

export const backupSoulForPublishInternal = internalAction({
  args: {
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
    if (!isGitHubSoulBackupConfigured()) {
      return { skipped: true as const };
    }
    await backupSoulToGitHub(ctx, args);
    return { skipped: false as const };
  },
});

export async function syncGitHubSoulBackupsInternalHandler(
  ctx: ActionCtx,
  args: SyncGitHubSoulBackupsInternalArgs,
): Promise<SyncGitHubSoulBackupsInternalResult> {
  const dryRun = Boolean(args.dryRun);
  const stats: GitHubSoulBackupSyncStats = {
    soulsScanned: 0,
    soulsSkipped: 0,
    soulsBackedUp: 0,
    soulsMissingVersion: 0,
    soulsMissingOwner: 0,
    errors: 0,
  };

  if (!isGitHubSoulBackupConfigured()) {
    return { stats, cursor: null, isDone: true };
  }

  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const context = await getGitHubSoulBackupContext();

  const state = dryRun
    ? { cursor: null as string | null }
    : ((await ctx.runQuery(
        internal.githubSoulBackups.getGitHubSoulBackupSyncStateInternal,
        {},
      )) as {
        cursor: string | null;
      });

  let cursor: string | null = state.cursor;
  let isDone = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const page = (await ctx.runQuery(internal.githubSoulBackups.getGitHubSoulBackupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as { items: BackupPageItem[]; cursor: string | null; isDone: boolean };

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      if (item.kind !== "ok") {
        if (item.kind === "missingLatestVersion" || item.kind === "missingVersionDoc") {
          stats.soulsMissingVersion += 1;
        } else if (item.kind === "missingOwner") {
          stats.soulsMissingOwner += 1;
        }
        continue;
      }

      stats.soulsScanned += 1;
      try {
        const meta = await fetchGitHubSoulMeta(context, item.ownerHandle, item.slug);
        if (meta?.latest?.version === item.version) {
          stats.soulsSkipped += 1;
          continue;
        }

        if (!dryRun) {
          await backupSoulToGitHub(
            ctx,
            {
              slug: item.slug,
              version: item.version,
              displayName: item.displayName,
              ownerHandle: item.ownerHandle,
              files: item.files,
              publishedAt: item.publishedAt,
            },
            context,
          );
          stats.soulsBackedUp += 1;
        }
      } catch (error) {
        console.error("GitHub soul backup sync failed", error);
        stats.errors += 1;
      }
    }

    if (!dryRun) {
      await ctx.runMutation(internal.githubSoulBackups.setGitHubSoulBackupSyncStateInternal, {
        cursor: isDone ? undefined : (cursor ?? undefined),
      });
    }

    if (isDone) break;
  }

  return { stats, cursor, isDone };
}

export const syncGitHubSoulBackupsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: syncGitHubSoulBackupsInternalHandler,
});

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
