import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireUser } from './lib/access'
import { toPublicSoul } from './lib/public'

export const isStarred = query({
  args: { soulId: v.id('souls') },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const existing = await ctx.db
      .query('soulStars')
      .withIndex('by_soul_user', (q) => q.eq('soulId', args.soulId).eq('userId', userId))
      .unique()
    return Boolean(existing)
  },
})

export const toggle = mutation({
  args: { soulId: v.id('souls') },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const soul = await ctx.db.get(args.soulId)
    if (!soul) throw new Error('Soul not found')

    const existing = await ctx.db
      .query('soulStars')
      .withIndex('by_soul_user', (q) => q.eq('soulId', args.soulId).eq('userId', userId))
      .unique()

    if (existing) {
      await ctx.db.delete(existing._id)
      await ctx.db.patch(soul._id, {
        stats: { ...soul.stats, stars: Math.max(0, soul.stats.stars - 1) },
        updatedAt: Date.now(),
      })
      return { starred: false }
    }

    await ctx.db.insert('soulStars', {
      soulId: args.soulId,
      userId,
      createdAt: Date.now(),
    })
    await ctx.db.patch(soul._id, {
      stats: { ...soul.stats, stars: soul.stats.stars + 1 },
      updatedAt: Date.now(),
    })
    return { starred: true }
  },
})

export const listByUser = query({
  args: { userId: v.id('users'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50
    const stars = await ctx.db
      .query('soulStars')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(limit)

    const souls: NonNullable<ReturnType<typeof toPublicSoul>>[] = []
    for (const star of stars) {
      const soul = await ctx.db.get(star.soulId)
      const publicSoul = toPublicSoul(soul)
      if (!publicSoul) continue
      souls.push(publicSoul)
    }
    return souls
  },
})
