import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requireUser } from './lib/access'

/** Transfer request expires after 7 days */
const TRANSFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Request to transfer a skill to another user.
 * The recipient must accept the transfer for it to complete.
 */
export const requestTransfer = mutation({
  args: {
    skillId: v.id('skills'),
    toUserHandle: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx)
    const now = Date.now()

    // Get the skill
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    if (skill.softDeletedAt) throw new Error('Cannot transfer deleted skill')
    if (skill.ownerUserId !== userId) {
      throw new Error('You can only transfer skills you own')
    }

    // Find the recipient by handle
    const toUser = await ctx.db
      .query('users')
      .withIndex('handle', (q) => q.eq('handle', args.toUserHandle.toLowerCase()))
      .first()
    if (!toUser) throw new Error(`User @${args.toUserHandle} not found`)
    if (toUser.deletedAt) throw new Error(`User @${args.toUserHandle} has deleted their account`)
    if (toUser._id === userId) throw new Error('Cannot transfer skill to yourself')

    // Check for existing pending transfer for this skill
    const existing = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_skill_status', (q) => q.eq('skillId', args.skillId).eq('status', 'pending'))
      .first()
    if (existing) {
      throw new Error('A transfer is already pending for this skill. Cancel it first.')
    }

    // Create the transfer request
    const transferId = await ctx.db.insert('skillOwnershipTransfers', {
      skillId: args.skillId,
      fromUserId: userId,
      toUserId: toUser._id,
      status: 'pending',
      message: args.message,
      requestedAt: now,
      expiresAt: now + TRANSFER_EXPIRY_MS,
    })

    // Log the action
    await ctx.db.insert('auditLogs', {
      actorUserId: userId,
      action: 'skill.transfer.request',
      targetType: 'skill',
      targetId: skill._id,
      metadata: {
        transferId,
        toUserId: toUser._id,
        toUserHandle: toUser.handle,
      },
      createdAt: now,
    })

    return { transferId, toUserHandle: toUser.handle }
  },
})

/**
 * Accept a pending transfer request.
 */
export const acceptTransfer = mutation({
  args: {
    transferId: v.id('skillOwnershipTransfers'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()

    const transfer = await ctx.db.get(args.transferId)
    if (!transfer) throw new Error('Transfer not found')
    if (transfer.toUserId !== userId) {
      throw new Error('This transfer is not addressed to you')
    }
    if (transfer.status !== 'pending') {
      throw new Error(`Transfer is ${transfer.status}, not pending`)
    }
    if (transfer.expiresAt < now) {
      await ctx.db.patch(args.transferId, { status: 'expired', respondedAt: now })
      throw new Error('Transfer has expired')
    }

    const skill = await ctx.db.get(transfer.skillId)
    if (!skill) throw new Error('Skill not found')

    // Transfer ownership
    await ctx.db.patch(transfer.skillId, {
      ownerUserId: userId,
      updatedAt: now,
    })

    // Mark transfer as accepted
    await ctx.db.patch(args.transferId, {
      status: 'accepted',
      respondedAt: now,
    })

    // Log the action
    await ctx.db.insert('auditLogs', {
      actorUserId: userId,
      action: 'skill.transfer.accept',
      targetType: 'skill',
      targetId: skill._id,
      metadata: {
        transferId: args.transferId,
        fromUserId: transfer.fromUserId,
      },
      createdAt: now,
    })

    return { skillSlug: skill.slug }
  },
})

/**
 * Reject a pending transfer request.
 */
export const rejectTransfer = mutation({
  args: {
    transferId: v.id('skillOwnershipTransfers'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()

    const transfer = await ctx.db.get(args.transferId)
    if (!transfer) throw new Error('Transfer not found')
    if (transfer.toUserId !== userId) {
      throw new Error('This transfer is not addressed to you')
    }
    if (transfer.status !== 'pending') {
      throw new Error(`Transfer is ${transfer.status}, not pending`)
    }

    await ctx.db.patch(args.transferId, {
      status: 'rejected',
      respondedAt: now,
    })

    // Log the action
    await ctx.db.insert('auditLogs', {
      actorUserId: userId,
      action: 'skill.transfer.reject',
      targetType: 'skill',
      targetId: transfer.skillId,
      metadata: { transferId: args.transferId },
      createdAt: now,
    })

    return { ok: true }
  },
})

/**
 * Cancel a pending transfer request (by the sender).
 */
export const cancelTransfer = mutation({
  args: {
    transferId: v.id('skillOwnershipTransfers'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()

    const transfer = await ctx.db.get(args.transferId)
    if (!transfer) throw new Error('Transfer not found')
    if (transfer.fromUserId !== userId) {
      throw new Error('Only the sender can cancel a transfer')
    }
    if (transfer.status !== 'pending') {
      throw new Error(`Transfer is ${transfer.status}, not pending`)
    }

    await ctx.db.patch(args.transferId, {
      status: 'cancelled',
      respondedAt: now,
    })

    return { ok: true }
  },
})

/**
 * Get pending incoming transfers for the current user.
 */
export const listIncoming = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()

    const transfers = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_to_user_status', (q) => q.eq('toUserId', userId).eq('status', 'pending'))
      .collect()

    // Filter out expired and enrich with skill/user info
    const results = []
    for (const transfer of transfers) {
      if (transfer.expiresAt < now) continue

      const skill = await ctx.db.get(transfer.skillId)
      const fromUser = await ctx.db.get(transfer.fromUserId)
      if (!skill || !fromUser) continue

      results.push({
        _id: transfer._id,
        skill: {
          _id: skill._id,
          slug: skill.slug,
          displayName: skill.displayName,
        },
        fromUser: {
          _id: fromUser._id,
          handle: fromUser.handle,
          displayName: fromUser.displayName,
        },
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      })
    }

    return results
  },
})

/**
 * Get pending outgoing transfers for the current user.
 */
export const listOutgoing = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()

    const transfers = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect()

    const results = []
    for (const transfer of transfers) {
      if (transfer.expiresAt < now) continue

      const skill = await ctx.db.get(transfer.skillId)
      const toUser = await ctx.db.get(transfer.toUserId)
      if (!skill || !toUser) continue

      results.push({
        _id: transfer._id,
        skill: {
          _id: skill._id,
          slug: skill.slug,
          displayName: skill.displayName,
        },
        toUser: {
          _id: toUser._id,
          handle: toUser.handle,
          displayName: toUser.displayName,
        },
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      })
    }

    return results
  },
})

/**
 * Get transfer history for a skill (for skill detail page).
 */
export const getSkillTransferHistory = query({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const transfers = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .take(20)

    const results = []
    for (const transfer of transfers) {
      const fromUser = await ctx.db.get(transfer.fromUserId)
      const toUser = await ctx.db.get(transfer.toUserId)

      results.push({
        _id: transfer._id,
        status: transfer.status,
        fromUser: fromUser ? { handle: fromUser.handle } : null,
        toUser: toUser ? { handle: toUser.handle } : null,
        requestedAt: transfer.requestedAt,
        respondedAt: transfer.respondedAt,
      })
    }

    return results
  },
})

/**
 * Count pending incoming transfers (for notification badge).
 */
export const countIncoming = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()

    const transfers = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_to_user_status', (q) => q.eq('toUserId', userId).eq('status', 'pending'))
      .collect()

    return transfers.filter((t) => t.expiresAt >= now).length
  },
})

/**
 * Internal: Get pending transfer for a skill to a specific user.
 * Used by HTTP API handlers.
 */
export const getPendingTransferBySkillAndUser = internalQuery({
  args: {
    skillId: v.id('skills'),
    toUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const transfer = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_skill_status', (q) => q.eq('skillId', args.skillId).eq('status', 'pending'))
      .filter((q) => q.eq(q.field('toUserId'), args.toUserId))
      .first()

    if (!transfer || transfer.expiresAt < now) return null
    return transfer
  },
})

/**
 * Internal: Get pending transfer for a skill from a specific user.
 * Used by HTTP API handlers for cancel.
 */
export const getPendingTransferBySkillAndFromUser = internalQuery({
  args: {
    skillId: v.id('skills'),
    fromUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const transfer = await ctx.db
      .query('skillOwnershipTransfers')
      .withIndex('by_skill_status', (q) => q.eq('skillId', args.skillId).eq('status', 'pending'))
      .filter((q) => q.eq(q.field('fromUserId'), args.fromUserId))
      .first()

    if (!transfer || transfer.expiresAt < now) return null
    return transfer
  },
})
