import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { assertModerator, requireUser } from './lib/access'
import { insertStatEvent } from './skillStatEvents'

export async function addHandler(ctx: MutationCtx, args: { skillId: Id<'skills'>; body: string }) {
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

export async function removeHandler(ctx: MutationCtx, args: { commentId: Id<'comments'> }) {
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
