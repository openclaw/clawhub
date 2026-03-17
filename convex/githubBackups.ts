import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action, internalMutation, internalQuery } from './functions'
import { assertRole, requireUserFromAction } from './lib/access'

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 200
const SYNC_STATE_KEY = 'default'

type BackupPageItem = {
  kind: 'ok'
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  slug: string
  displayName: string
  version: string
  ownerHandle: string
  publishedAt: number
}

type BackupPageResult = {
  items: BackupPageItem[]
  cursor: string | null
  isDone: boolean
}

type BackupSyncState = {
  cursor: string | null
  pruneCursor: string | null
}

export type SyncGitHubBackupsResult = {
  stats: {
    skillsScanned: number
    skillsSkipped: number
    skillsBackedUp: number
    skillsDeleted: number
    skillsMissingVersion: number
    errors: number
  }
  cursor: string | null
  pruneCursor: string | null
  isDone: boolean
}

export const getGitHubBackupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    let result
    try {
      result = await ctx.db
        .query('skillSearchDigest')
        .order('asc')
        .paginate({ cursor: args.cursor ?? null, numItems: batchSize })
    } catch (err) {
      // Cursor from a previous table (skills) — restart from beginning
      console.warn('GitHub backup page cursor reset (possibly stale table cursor):', err)
      result = await ctx.db
        .query('skillSearchDigest')
        .order('asc')
        .paginate({ cursor: null, numItems: batchSize })
    }
    const { page, isDone, continueCursor } = result

    const items: BackupPageItem[] = []
    for (const digest of page) {
      if (digest.softDeletedAt) continue
      if (digest.moderationStatus && digest.moderationStatus !== 'active') continue
      if (!digest.latestVersionId || !digest.latestVersionSummary) continue
      if (!digest.ownerHandle) continue

      items.push({
        kind: 'ok',
        skillId: digest.skillId,
        versionId: digest.latestVersionId,
        slug: digest.slug,
        displayName: digest.displayName,
        version: digest.latestVersionSummary.version,
        ownerHandle: digest.ownerHandle,
        publishedAt: digest.latestVersionSummary.createdAt,
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const getGitHubBackupSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupSyncState> => {
    const state = await ctx.db
      .query('githubBackupSyncState')
      .withIndex('by_key', (q) => q.eq('key', SYNC_STATE_KEY))
      .unique()
    return { cursor: state?.cursor ?? null, pruneCursor: state?.pruneCursor ?? null }
  },
})

export const setGitHubBackupSyncStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pruneCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const state = await ctx.db
      .query('githubBackupSyncState')
      .withIndex('by_key', (q) => q.eq('key', SYNC_STATE_KEY))
      .unique()

    if (!state) {
      await ctx.db.insert('githubBackupSyncState', {
        key: SYNC_STATE_KEY,
        cursor: args.cursor,
        pruneCursor: args.pruneCursor,
        updatedAt: now,
      })
      return { ok: true as const }
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      pruneCursor: args.pruneCursor,
      updatedAt: now,
    })

    return { ok: true as const }
  },
})

export const syncGitHubBackups: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    pruneBatchSize: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncGitHubBackupsResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])

    if (args.resetCursor && !args.dryRun) {
      await ctx.runMutation(internal.githubBackups.setGitHubBackupSyncStateInternal, {
        cursor: undefined,
        pruneCursor: undefined,
      })
    }

    return ctx.runAction(internal.githubBackupsNode.syncGitHubBackupsInternal, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
      pruneBatchSize: args.pruneBatchSize,
    }) as Promise<SyncGitHubBackupsResult>
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
