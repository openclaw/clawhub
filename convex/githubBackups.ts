import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalMutation, internalQuery } from './_generated/server'
import { assertRole, requireUserFromAction } from './lib/access'

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 200
const SYNC_STATE_KEY = 'default'

type BackupPageItem =
  | {
      kind: 'ok'
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
      displayName: string
      version: string
      ownerHandle: string
      files: Doc<'skillVersions'>['files']
      publishedAt: number
    }
  | { kind: 'missingLatestVersion'; skillId: Id<'skills'> }
  | { kind: 'missingVersionDoc'; skillId: Id<'skills'>; versionId: Id<'skillVersions'> }
  | { kind: 'missingOwner'; skillId: Id<'skills'>; ownerUserId: Id<'users'> }

type BackupPageResult = {
  items: BackupPageItem[]
  cursor: string | null
  isDone: boolean
}

type BackupSyncState = {
  cursor: string | null
}

export type SyncGitHubBackupsResult = {
  stats: {
    skillsScanned: number
    skillsSkipped: number
    skillsBackedUp: number
    skillsMissingVersion: number
    skillsMissingOwner: number
    errors: number
  }
  cursor: string | null
  isDone: boolean
}

export const getGitHubBackupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: BackupPageItem[] = []
    for (const skill of page) {
      if (skill.softDeletedAt) continue
      if (!skill.latestVersionId) {
        items.push({ kind: 'missingLatestVersion', skillId: skill._id })
        continue
      }

      const version = await ctx.db.get(skill.latestVersionId)
      if (!version) {
        items.push({
          kind: 'missingVersionDoc',
          skillId: skill._id,
          versionId: skill.latestVersionId,
        })
        continue
      }

      const owner = await ctx.db.get(skill.ownerUserId)
      if (!owner || owner.deletedAt || owner.deactivatedAt) {
        items.push({ kind: 'missingOwner', skillId: skill._id, ownerUserId: skill.ownerUserId })
        continue
      }

      items.push({
        kind: 'ok',
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
        displayName: skill.displayName,
        version: version.version,
        ownerHandle: owner.handle ?? owner._id,
        files: version.files,
        publishedAt: version.createdAt,
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
    return { cursor: state?.cursor ?? null }
  },
})

export const setGitHubBackupSyncStateInternal = internalMutation({
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

export const syncGitHubBackups: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncGitHubBackupsResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])

    if (args.resetCursor && !args.dryRun) {
      await ctx.runMutation(internal.githubBackups.setGitHubBackupSyncStateInternal, {
        cursor: undefined,
      })
    }

    return ctx.runAction(internal.githubBackupsNode.syncGitHubBackupsInternal, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
    }) as Promise<SyncGitHubBackupsResult>
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
