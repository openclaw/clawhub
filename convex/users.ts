import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAdmin, assertModerator, requireUser } from './lib/access'
import { toPublicUser } from './lib/public'

const DEFAULT_ROLE = 'user'
const ADMIN_HANDLE = 'steipete'

export const getById = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => toPublicUser(await ctx.db.get(args.userId)),
})

export const getByIdInternal = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => ctx.db.get(args.userId),
})

export const updateGithubMetaInternal = internalMutation({
  args: {
    userId: v.id('users'),
    githubCreatedAt: v.number(),
    githubFetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      githubCreatedAt: args.githubCreatedAt,
      githubFetchedAt: args.githubFetchedAt,
      updatedAt: args.githubFetchedAt,
    })
  },
})

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user || user.deletedAt) return null
    return user
  },
})

export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await requireUser(ctx)
    const now = Date.now()
    const updates: Record<string, unknown> = {}

    const handle = user.handle ?? user.name ?? user.email?.split('@')[0]
    if (!user.handle && handle) updates.handle = handle
    if (!user.displayName) updates.displayName = handle
    if (!user.role) {
      updates.role = handle === ADMIN_HANDLE ? 'admin' : DEFAULT_ROLE
    }
    if (!user.createdAt) updates.createdAt = user._creationTime
    updates.updatedAt = now

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates)
    }

    return ctx.db.get(userId)
  },
})

export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    await ctx.db.patch(userId, {
      displayName: args.displayName.trim(),
      bio: args.bio?.trim(),
      updatedAt: Date.now(),
    })
  },
})

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    await ctx.db.patch(userId, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
    await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId })
  },
})

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const limit = args.limit ?? 50
    return ctx.db.query('users').order('desc').take(limit)
  },
})

export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('handle', (q) => q.eq('handle', args.handle))
      .unique()
    return toPublicUser(user)
  },
})

export const setRole = mutation({
  args: {
    userId: v.id('users'),
    role: v.union(v.literal('admin'), v.literal('moderator'), v.literal('user')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    return setRoleWithActor(ctx, user, args.userId, args.role)
  },
})

export const setRoleInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    targetUserId: v.id('users'),
    role: v.union(v.literal('admin'), v.literal('moderator'), v.literal('user')),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt) throw new Error('User not found')
    return setRoleWithActor(ctx, actor, args.targetUserId, args.role)
  },
})

async function setRoleWithActor(
  ctx: MutationCtx,
  actor: Doc<'users'>,
  targetUserId: Id<'users'>,
  role: 'admin' | 'moderator' | 'user',
) {
  assertAdmin(actor)
  const target = await ctx.db.get(targetUserId)
  if (!target) throw new Error('User not found')
  const now = Date.now()
  await ctx.db.patch(targetUserId, { role, updatedAt: now })
  await ctx.db.insert('auditLogs', {
    actorUserId: actor._id,
    action: 'role.change',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { role },
    createdAt: now,
  })
  return { ok: true as const, role }
}

export const banUser = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    return banUserWithActor(ctx, user, args.userId)
  },
})

export const banUserInternal = internalMutation({
  args: { actorUserId: v.id('users'), targetUserId: v.id('users') },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt) throw new Error('User not found')
    return banUserWithActor(ctx, actor, args.targetUserId)
  },
})

async function banUserWithActor(ctx: MutationCtx, actor: Doc<'users'>, targetUserId: Id<'users'>) {
  assertModerator(actor)

  if (targetUserId === actor._id) throw new Error('Cannot ban yourself')

  const target = await ctx.db.get(targetUserId)
  if (!target) throw new Error('User not found')
  if (target.role === 'admin' && actor.role !== 'admin') {
    throw new Error('Forbidden')
  }

  const now = Date.now()
  if (target.deletedAt) {
    return { ok: true as const, alreadyBanned: true, deletedSkills: 0 }
  }

  const skills = await ctx.db
    .query('skills')
    .withIndex('by_owner', (q) => q.eq('ownerUserId', targetUserId))
    .collect()

  for (const skill of skills) {
    await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
      skillId: skill._id,
      actorUserId: actor._id,
    })
  }

  const tokens = await ctx.db
    .query('apiTokens')
    .withIndex('by_user', (q) => q.eq('userId', targetUserId))
    .collect()
  for (const token of tokens) {
    await ctx.db.patch(token._id, { revokedAt: now })
  }

  await ctx.db.patch(targetUserId, {
    deletedAt: now,
    role: 'user',
    updatedAt: now,
  })

  await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId: targetUserId })

  await ctx.db.insert('auditLogs', {
    actorUserId: actor._id,
    action: 'user.ban',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { deletedSkills: skills.length },
    createdAt: now,
  })

  return { ok: true as const, alreadyBanned: false, deletedSkills: skills.length }
}
