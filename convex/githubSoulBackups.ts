import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalMutation, internalQuery } from './_generated/server'
import { assertRole, requireUserFromAction } from './lib/access'

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 200
const SYNC_STATE_KEY = 'souls'

type BackupPageItem =
  | {
      kind: 'ok'
      soulId: Id<'souls'>
      versionId: Id<'soulVersions'>
      slug: string
      displayName: string
      version: string
      ownerHandle: string
      files: Doc<'soulVersions'>['files']
      publishedAt: number
    }
  | { kind: 'missingLatestVersion'; soulId: Id<'souls'> }
  | { kind: 'missingVersionDoc'; soulId: Id<'souls'>; versionId: Id<'soulVersions'> }
  | { kind: 'missingOwner'; soulId: Id<'souls'>; ownerUserId: Id<'users'> }

type BackupPageResult = {
  items: BackupPageItem[]
  cursor: string | null
  isDone: boolean
}

type BackupSyncState = {
  cursor: string | null
}

export type SyncGitHubSoulBackupsResult = {
  stats: {
    soulsScanned: number
    soulsSkipped: number
    soulsBackedUp: number
    soulsMissingVersion: number
    soulsMissingOwner: number
    errors: number
  }
  cursor: string | null
  isDone: boolean
}

export const getGitHubSoulBackupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('souls')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: BackupPageItem[] = []
    for (const soul of page) {
      if (soul.softDeletedAt) continue
      if (!soul.latestVersionId) {
        items.push({ kind: 'missingLatestVersion', soulId: soul._id })
        continue
      }

      const version = await ctx.db.get(soul.latestVersionId)
      if (!version) {
        items.push({
          kind: 'missingVersionDoc',
          soulId: soul._id,
          versionId: soul.latestVersionId,
        })
        continue
      }

      const owner = await ctx.db.get(soul.ownerUserId)
      if (!owner || owner.deletedAt || owner.deactivatedAt) {
        items.push({ kind: 'missingOwner', soulId: soul._id, ownerUserId: soul.ownerUserId })
        continue
      }

      items.push({
        kind: 'ok',
        soulId: soul._id,
        versionId: version._id,
        slug: soul.slug,
        displayName: soul.displayName,
        version: version.version,
        ownerHandle: owner.handle ?? owner._id,
        files: version.files,
        publishedAt: version.createdAt,
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const getGitHubSoulBackupSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupSyncState> => {
    const state = await ctx.db
      .query('githubBackupSyncState')
      .withIndex('by_key', (q) => q.eq('key', SYNC_STATE_KEY))
      .unique()
    return { cursor: state?.cursor ?? null }
  },
})

export const setGitHubSoulBackupSyncStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
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
        updatedAt: now,
      })
      return { ok: true as const }
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      updatedAt: now,
    })

    return { ok: true as const }
  },
})

export const syncGitHubSoulBackups: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncGitHubSoulBackupsResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])

    if (args.resetCursor && !args.dryRun) {
      await ctx.runMutation(internal.githubSoulBackups.setGitHubSoulBackupSyncStateInternal, {
        cursor: undefined,
      })
    }

    return ctx.runAction(internal.githubSoulBackupsNode.syncGitHubSoulBackupsInternal, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
    }) as Promise<SyncGitHubSoulBackupsResult>
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
