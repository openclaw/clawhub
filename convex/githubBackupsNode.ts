'use node'

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import {
  backupSkillToGitHub,
  fetchGitHubSkillMeta,
  getGitHubBackupContext,
  isGitHubBackupConfigured,
} from './lib/githubBackup'

const MAX_BATCH_SIZE = 500
const DEFAULT_BATCH_SIZE = MAX_BATCH_SIZE

type BackupStats = {
  skillsScanned: number
  skillsSkipped: number
  skillsBackedUp: number
  skillsMissingVersion: number
  skillsMissingOwner: number
  errors: number
}

export const backupSkillForPublishInternal = internalAction({
  args: {
    slug: v.string(),
    version: v.string(),
    displayName: v.string(),
    ownerHandle: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id('_storage'),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    publishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!isGitHubBackupConfigured()) {
      return { skipped: true as const }
    }
    await backupSkillToGitHub(ctx, args)
    return { skipped: false as const }
  },
})

export const syncGitHubBackupsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stats: BackupStats = {
      skillsScanned: 0,
      skillsSkipped: 0,
      skillsBackedUp: 0,
      skillsMissingVersion: 0,
      skillsMissingOwner: 0,
      errors: 0,
    }

    if (!isGitHubBackupConfigured()) {
      return { stats, cursor: null, isDone: true }
    }

    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const maxBatches =
      typeof args.maxBatches === 'number'
        ? clampInt(args.maxBatches, 1, Number.MAX_SAFE_INTEGER)
        : Number.POSITIVE_INFINITY
    const context = await getGitHubBackupContext()

    let cursor: string | null = null
    let isDone = false
    let batches = 0

    while (!isDone && batches < maxBatches) {
      const page = await ctx.runQuery(internal.githubBackups.getGitHubBackupPageInternal, {
        cursor,
        batchSize,
      })

      cursor = page.cursor
      isDone = page.isDone
      batches += 1

      for (const item of page.items) {
        if (item.kind === 'missingLatestVersion' || item.kind === 'missingVersionDoc') {
          stats.skillsMissingVersion += 1
          continue
        }
        if (item.kind === 'missingOwner') {
          stats.skillsMissingOwner += 1
          continue
        }

        stats.skillsScanned += 1
        try {
          const meta = await fetchGitHubSkillMeta(context, item.ownerHandle, item.slug)
          if (meta?.latest?.version === item.version) {
            stats.skillsSkipped += 1
            continue
          }

          if (!args.dryRun) {
            await backupSkillToGitHub(
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
            )
            stats.skillsBackedUp += 1
          }
        } catch (error) {
          console.error('GitHub backup sync failed', error)
          stats.errors += 1
        }
      }
    }

    return { stats, cursor, isDone }
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
