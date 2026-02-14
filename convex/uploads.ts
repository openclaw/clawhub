import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { requireUser } from './lib/access'

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return ctx.storage.generateUploadUrl()
  },
})

export const generateUploadUrlForUserInternal = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error('User not found')
    return ctx.storage.generateUploadUrl()
  },
})
