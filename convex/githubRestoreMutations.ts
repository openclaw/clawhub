import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { assertAdmin } from './lib/access'
import { deriveModerationFlags } from './lib/moderation'
import { parseFrontmatter } from './lib/skills'

/**
 * Internal mutation to re-create a skill record from backup data.
 * Called by the restore action after files have been uploaded to storage.
 */
export const restoreSkillInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    ownerUserId: v.id('users'),
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    forceOverwriteSquatter: v.optional(v.boolean()),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id('_storage'),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('Actor not found')
    assertAdmin(actor)

    const owner = await ctx.db.get(args.ownerUserId)
    if (!owner) throw new Error('Owner not found')

    const now = Date.now()

    // Check slug availability -- handle squatter eviction synchronously within
    // the same transaction to avoid the race condition where an async hard-delete
    // hasn't completed by the time we try to insert the restored skill.
    const existingSkill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()

    if (existingSkill) {
      if (existingSkill.ownerUserId === args.ownerUserId) {
        throw new Error(`Slug "${args.slug}" is already owned by the target user`)
      }
      if (!args.forceOverwriteSquatter) {
        throw new Error(`Slug "${args.slug}" is already taken`)
      }

      // Synchronously delete the squatter's skill record in this transaction.
      // We delete the skill row directly to free the slug immediately.
      // Related data (versions, embeddings, etc.) is cleaned up asynchronously.
      const squatterUserId = existingSkill.ownerUserId
      await ctx.db.delete(existingSkill._id)

      // Schedule async cleanup of the squatter's orphaned data (versions, etc.)
      // We use a dedicated audit action rather than hardDeleteInternal since
      // the skill record is already gone.
      await ctx.db.insert('auditLogs', {
        actorUserId: args.actorUserId,
        action: 'slug.reclaim.sync',
        targetType: 'skill',
        targetId: existingSkill._id,
        metadata: {
          slug: args.slug,
          squatterUserId,
          rightfulOwnerUserId: args.ownerUserId,
          reason: 'Synchronous eviction during backup restore',
        },
        createdAt: now,
      })
    }

    // Parse frontmatter from SKILL.md if present
    let frontmatter: Record<string, unknown> = {}
    const skillMdFile = args.files.find(
      (f: { path: string }) =>
        f.path.toLowerCase() === 'skill.md' || f.path.toLowerCase().endsWith('/skill.md'),
    )
    if (skillMdFile) {
      try {
        const blob = await ctx.storage.get(skillMdFile.storageId)
        if (blob) {
          const text = await blob.text()
          frontmatter = parseFrontmatter(text)
        }
      } catch {
        // Best-effort frontmatter parsing
      }
    }

    const parsed = { frontmatter }
    const summary =
      typeof frontmatter.description === 'string'
        ? (frontmatter.description as string)
        : undefined

    const moderationFlags = deriveModerationFlags({
      skill: { slug: args.slug, displayName: args.displayName, summary },
      parsed,
      files: args.files,
    })

    // Create the skill record -- mark as active since this is an admin restore
    const skillId = await ctx.db.insert('skills', {
      slug: args.slug,
      displayName: args.displayName,
      summary,
      ownerUserId: args.ownerUserId,
      canonicalSkillId: undefined,
      forkOf: undefined,
      latestVersionId: undefined,
      tags: {},
      softDeletedAt: undefined,
      badges: {
        redactionApproved: undefined,
        highlighted: undefined,
        official: undefined,
        deprecated: undefined,
      },
      moderationStatus: 'active',
      moderationReason: 'restored.backup',
      moderationFlags: moderationFlags.length ? moderationFlags : undefined,
      reportCount: 0,
      lastReportedAt: undefined,
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 0,
        comments: 0,
      },
      createdAt: now,
      updatedAt: now,
    })

    // Create the version record
    const versionId = await ctx.db.insert('skillVersions', {
      skillId,
      version: args.version,
      changelog: 'Restored from backup',
      changelogSource: 'auto',
      files: args.files,
      parsed,
      createdBy: args.ownerUserId,
      createdAt: now,
      softDeletedAt: undefined,
    })

    // Update the skill with the version reference
    await ctx.db.patch(skillId, {
      latestVersionId: versionId,
      tags: { latest: versionId },
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      updatedAt: now,
    })

    // Release any slug reservation for this slug
    const reservation = await ctx.db
      .query('reservedSlugs')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()
    if (reservation && !reservation.releasedAt) {
      await ctx.db.patch(reservation._id, { releasedAt: now })
    }

    // Audit log
    await ctx.db.insert('auditLogs', {
      actorUserId: args.actorUserId,
      action: 'skill.restore.backup',
      targetType: 'skill',
      targetId: skillId,
      metadata: {
        slug: args.slug,
        version: args.version,
        ownerUserId: args.ownerUserId,
      },
      createdAt: now,
    })

    return { skillId, versionId }
  },
})
