import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { assertModerator, requireUser } from './lib/access'
import { type PublicUser, toPublicUser } from './lib/public'
import { insertStatEvent } from './skillStatEvents'

async function addHandler(
  ctx: import('./_generated/server').MutationCtx,
  args: { skillId: Id<'skills'>; body: string },
) {
  const { userId } = await requireUser(ctx)
  const body = args.body.trim()
  if (!body) throw new Error('Comment body required')

  const skill = await ctx.db.get(args.skillId)
  if (!skill) throw new Error('Skill not found')

  await ctx.db.insert('comments', {
    skillId: args.skillId,
    userId,
    body,
    createdAt: Date.now(),
    softDeletedAt: undefined,
    deletedBy: undefined,
  })

  await insertStatEvent(ctx, { skillId: skill._id, kind: 'comment' })
}

async function removeHandler(
  ctx: import('./_generated/server').MutationCtx,
  args: { commentId: Id<'comments'> },
) {
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

  await insertStatEvent(ctx, { skillId: comment.skillId, kind: 'uncomment' })

  await ctx.db.insert('auditLogs', {
    actorUserId: user._id,
    action: 'comment.delete',
    targetType: 'comment',
    targetId: comment._id,
    metadata: { skillId: comment.skillId },
    createdAt: Date.now(),
  })
}

export const listBySkill = query({
  args: { skillId: v.id('skills'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .take(limit)

    const results: Array<{ comment: Doc<'comments'>; user: PublicUser | null }> = []
    for (const comment of comments) {
      if (comment.softDeletedAt) continue
      const user = toPublicUser(await ctx.db.get(comment.userId))
      results.push({ comment, user })
    }
    return results
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

export const __test = {
  addHandler,
  removeHandler,
}
