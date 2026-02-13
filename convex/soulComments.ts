import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { assertModerator, requireUser } from './lib/access'
import { type PublicUser, toPublicUser } from './lib/public'

export const listBySoul = query({
  args: { soulId: v.id('souls'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50
    const comments = await ctx.db
      .query('soulComments')
      .withIndex('by_soul', (q) => q.eq('soulId', args.soulId))
      .order('desc')
      .take(limit)

    const results: Array<{ comment: Doc<'soulComments'>; user: PublicUser | null }> = []
    for (const comment of comments) {
      if (comment.softDeletedAt) continue
      const user = toPublicUser(await ctx.db.get(comment.userId))
      results.push({ comment, user })
    }
    return results
  },
})

export const add = mutation({
  args: { soulId: v.id('souls'), body: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const body = args.body.trim()
    if (!body) throw new Error('Comment body required')

    const soul = await ctx.db.get(args.soulId)
    if (!soul) throw new Error('Soul not found')

    await ctx.db.insert('soulComments', {
      soulId: args.soulId,
      userId,
      body,
      createdAt: Date.now(),
      softDeletedAt: undefined,
      deletedBy: undefined,
    })

    await ctx.db.patch(soul._id, {
      stats: { ...soul.stats, comments: soul.stats.comments + 1 },
      updatedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: { commentId: v.id('soulComments') },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    const comment = await ctx.db.get(args.commentId)
    if (!comment) throw new Error('Comment not found')
    if (comment.softDeletedAt) return

    const isOwner = comment.userId === user._id
    if (!isOwner) {
      assertModerator(user)
    }

    await ctx.db.patch(comment._id, {
      softDeletedAt: Date.now(),
      deletedBy: user._id,
    })

    const soul = await ctx.db.get(comment.soulId)
    if (soul) {
      await ctx.db.patch(soul._id, {
        stats: { ...soul.stats, comments: Math.max(0, soul.stats.comments - 1) },
        updatedAt: Date.now(),
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'soul.comment.delete',
      targetType: 'soulComment',
      targetId: comment._id,
      metadata: { soulId: comment.soulId },
      createdAt: Date.now(),
    })
  },
})
