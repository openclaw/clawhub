import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { addHandler, removeHandler } from './comments.handlers'
import { type PublicUser, toPublicUser } from './lib/public'

export const listBySkill = query({
  args: { skillId: v.id('skills'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .take(limit)

    const visible = comments.filter((comment) => !comment.softDeletedAt)
    return Promise.all(
      visible.map(
        async (comment): Promise<{ comment: Doc<'comments'>; user: PublicUser | null }> => ({
          comment,
          user: toPublicUser(await ctx.db.get(comment.userId)),
        }),
      ),
    )
  },
})

export const add = mutation({
  args: { skillId: v.id('skills'), body: v.string() },
  handler: addHandler,
})

export const remove = mutation({
  args: { commentId: v.id('comments') },
  handler: removeHandler,
})
