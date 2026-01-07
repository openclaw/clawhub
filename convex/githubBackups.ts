import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalQuery } from './_generated/server'
import { assertRole, requireUserFromAction } from './lib/access'

const MAX_BATCH_SIZE = 500
const DEFAULT_BATCH_SIZE = MAX_BATCH_SIZE

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
      if (!owner || owner.deletedAt) {
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
        ownerHandle: owner.handle ?? owner.name ?? owner.email ?? owner._id,
        files: version.files,
        publishedAt: version.createdAt,
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const syncGitHubBackups = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(internal.githubBackupsNode.syncGitHubBackupsInternal, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
    })
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
