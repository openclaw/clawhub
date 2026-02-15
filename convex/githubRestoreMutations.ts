import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { assertAdmin } from './lib/access'

export const evictSquatterSkillForRestoreInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    slug: v.string(),
    rightfulOwnerUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('Actor not found')
    assertAdmin(actor)

    const slug = args.slug.trim().toLowerCase()
    if (!slug) throw new Error('Slug required')

    const now = Date.now()

    const existingSkill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!existingSkill) return { ok: true as const, action: 'noop' as const }
    if (existingSkill.ownerUserId === args.rightfulOwnerUserId) {
      return { ok: true as const, action: 'already_owned' as const }
    }

    const evictedSlug = buildEvictedSlug(slug, now)

    // Free the slug immediately (same transaction) by renaming the squatter's skill.
    await ctx.db.patch(existingSkill._id, {
      slug: evictedSlug,
      softDeletedAt: now,
      hiddenAt: existingSkill.hiddenAt ?? now,
      hiddenBy: existingSkill.hiddenBy ?? actor._id,
      updatedAt: now,
    })

    // Remove from vector search ASAP.
    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', existingSkill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: 'deleted',
        updatedAt: now,
      })
    }

    // Cleanup the rest asynchronously (versions, fingerprints, installs, etc.)
    await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
      skillId: existingSkill._id,
      actorUserId: actor._id,
      phase: 'versions',
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: actor._id,
      action: 'slug.reclaim.sync',
      targetType: 'skill',
      targetId: existingSkill._id,
      metadata: {
        slug,
        evictedSlug,
        squatterUserId: existingSkill.ownerUserId,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        reason: 'Synchronous eviction during GitHub restore',
      },
      createdAt: now,
    })

    return { ok: true as const, action: 'evicted' as const, evictedSlug }
  },
})

function buildEvictedSlug(slug: string, now: number) {
  const suffix = now.toString(36)
  return `${slug}-evicted-${suffix}`
}

