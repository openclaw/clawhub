'use node'

import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction } from './_generated/server'
import {
  fetchGitHubSkillMeta,
  getGitHubBackupContext,
  isGitHubBackupConfigured,
} from './lib/githubBackup'
import { assertAdmin } from './lib/access'
import {
  listGitHubBackupFiles,
  readGitHubBackupFile,
} from './lib/githubRestoreHelpers'
import { publishVersionForUser } from './lib/skillPublish'
import { guessContentTypeForPath } from './lib/contentTypes'

type RestoreResult = {
  slug: string
  status: 'restored' | 'slug_conflict' | 'already_exists' | 'no_backup' | 'error'
  detail?: string
}

type BulkRestoreResult = {
  results: RestoreResult[]
  totalRestored: number
  totalConflicts: number
  totalSkipped: number
  totalErrors: number
}

/**
 * Admin-only: restore a single skill from GitHub backup.
 * Reads the backup files from the GitHub repo and re-creates the skill in the database.
 */
export const restoreSkillFromBackup = internalAction({
  args: {
    actorUserId: v.id('users'),
    ownerHandle: v.string(),
    ownerUserId: v.id('users'),
    slug: v.string(),
    forceOverwriteSquatter: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<RestoreResult> => {
    try {
      const actor = await ctx.runQuery(internal.users.getByIdInternal, {
        userId: args.actorUserId,
      })
      if (!actor || actor.deletedAt || actor.deactivatedAt) {
        return { slug: args.slug, status: 'error', detail: 'Actor not found' }
      }
      assertAdmin(actor as Doc<'users'>)

      if (!isGitHubBackupConfigured()) {
        return { slug: args.slug, status: 'error', detail: 'GitHub backup not configured' }
      }

      const ghContext = await getGitHubBackupContext()

      // Check if skill already exists in the DB
      const existingSkill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
        slug: args.slug,
      })) as Doc<'skills'> | null

      if (existingSkill) {
        if (existingSkill.ownerUserId === args.ownerUserId) {
          return { slug: args.slug, status: 'already_exists', detail: 'Skill already owned by user' }
        }

        if (!args.forceOverwriteSquatter) {
          return {
            slug: args.slug,
            status: 'slug_conflict',
            detail: `Slug occupied by another user. Set forceOverwriteSquatter=true to reclaim.`,
          }
        }

        // Free the slug in-transaction by renaming the squatter, then enqueue cleanup.
        await ctx.runMutation(internal.githubRestoreMutations.evictSquatterSkillForRestoreInternal, {
          actorUserId: args.actorUserId,
          slug: args.slug,
          rightfulOwnerUserId: args.ownerUserId,
        })
      }

      // Fetch metadata from GitHub backup
      const meta = await fetchGitHubSkillMeta(ghContext, args.ownerHandle, args.slug)
      if (!meta) {
        return { slug: args.slug, status: 'no_backup', detail: 'No backup found in GitHub repo' }
      }

      // Read the actual files from the backup
      const backupFiles = await listGitHubBackupFiles(ghContext, args.ownerHandle, args.slug)
      if (backupFiles.length === 0) {
        return { slug: args.slug, status: 'no_backup', detail: 'Backup has no files' }
      }

      // Download and store each file in Convex storage
      const storedFiles: Array<{
        path: string
        size: number
        storageId: Id<'_storage'>
        sha256: string
        contentType: string
      }> = []

      for (const filePath of backupFiles) {
        const fileContent = await readGitHubBackupFile(ghContext, args.ownerHandle, args.slug, filePath)
        if (!fileContent) continue

        const sha256 = await sha256Hex(fileContent)
        const contentType = guessContentTypeForPath(filePath)
        const blob = new Blob([Buffer.from(fileContent)], { type: contentType })
        const storageId = await ctx.storage.store(blob)

        storedFiles.push({
          path: filePath,
          size: fileContent.byteLength,
          storageId,
          sha256,
          contentType,
        })
      }

      if (storedFiles.length === 0) {
        return { slug: args.slug, status: 'error', detail: 'Could not download any backup files' }
      }

      await publishVersionForUser(
        ctx,
        args.ownerUserId,
        {
          slug: args.slug,
          displayName: meta.displayName,
          version: meta.latest.version,
          changelog: 'Restored from GitHub backup',
          files: storedFiles,
        },
        {
          bypassGitHubAccountAge: true,
          bypassNewSkillRateLimit: true,
          bypassQualityGate: true,
          skipBackup: true,
          skipWebhook: true,
        },
      )

      return { slug: args.slug, status: 'restored' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[restore] Failed to restore ${args.slug}:`, message)
      return { slug: args.slug, status: 'error', detail: message }
    }
  },
})

/**
 * Admin-only: bulk restore all skills for a user from GitHub backup.
 */
export const restoreUserSkillsFromBackup = internalAction({
  args: {
    actorUserId: v.id('users'),
    ownerHandle: v.string(),
    ownerUserId: v.id('users'),
    slugs: v.array(v.string()),
    forceOverwriteSquatter: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BulkRestoreResult> => {
    const results: RestoreResult[] = []
    let totalRestored = 0
    let totalConflicts = 0
    let totalSkipped = 0
    let totalErrors = 0

    for (const slug of args.slugs) {
      const result = (await ctx.runAction(internal.githubRestore.restoreSkillFromBackup, {
        actorUserId: args.actorUserId,
        ownerHandle: args.ownerHandle,
        ownerUserId: args.ownerUserId,
        slug,
        forceOverwriteSquatter: args.forceOverwriteSquatter,
      })) as RestoreResult

      results.push(result)

      switch (result.status) {
        case 'restored':
          totalRestored += 1
          break
        case 'slug_conflict':
          totalConflicts += 1
          break
        case 'already_exists':
        case 'no_backup':
          totalSkipped += 1
          break
        case 'error':
          totalErrors += 1
          break
      }
    }

    return { results, totalRestored, totalConflicts, totalSkipped, totalErrors }
  },
})

async function sha256Hex(bytes: Uint8Array) {
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256')
  hash.update(bytes)
  return hash.digest('hex')
}

// guessContentTypeForPath in lib/contentTypes.ts
