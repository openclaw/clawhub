import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAdmin, assertModerator, requireUser } from './lib/access'
import { toPublicUser } from './lib/public'
import { buildUserSearchResults } from './lib/userSearch'

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

export const searchInternal = internalQuery({
  args: {
    actorUserId: v.id('users'),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('Unauthorized')
    assertAdmin(actor)

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 200)
    const users = await ctx.db.query('users').order('desc').collect()
    const result = buildUserSearchResults(users, args.query)
    const items = result.items.slice(0, limit).map((user) => ({
      userId: user._id,
      handle: user.handle ?? null,
      displayName: user.displayName ?? null,
      name: user.name ?? null,
      role: user.role ?? null,
    }))
    return { items, total: result.total }
  },
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
    if (!user || user.deletedAt || user.deactivatedAt) return null
    return user
  },
})

export const ensure = mutation({
  args: {},
  handler: ensureHandler,
})

export async function ensureHandler(ctx: MutationCtx) {
  const { userId, user } = await requireUser(ctx)
  const updates: Record<string, unknown> = {}

  const existingHandle = user.handle?.trim() || undefined
  const nameHandle = user.name?.trim() || undefined
  const emailHandle = user.email?.split('@')[0]?.trim() || undefined
  // `user.name` is the GitHub login (see convex/auth.ts profile mapping).
  // Only fall back to deriving from email if we don't already have a handle.
  const derivedHandle = nameHandle || (!existingHandle ? emailHandle : undefined)
  const baseHandle = derivedHandle ?? existingHandle

  if (derivedHandle && (!existingHandle || existingHandle !== derivedHandle)) {
    updates.handle = derivedHandle
  }

  const displayName = user.displayName?.trim() || undefined
  if (!displayName && baseHandle) {
    updates.displayName = baseHandle
  } else if (derivedHandle && displayName === existingHandle) {
    updates.displayName = derivedHandle
  }

  if (!user.role) {
    updates.role = baseHandle === ADMIN_HANDLE ? 'admin' : DEFAULT_ROLE
  }

  if (!user.createdAt) updates.createdAt = user._creationTime

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = Date.now()
    await ctx.db.patch(userId, updates)
  }

  return ctx.db.get(userId)
}

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
    const now = Date.now()

    const tokens = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    for (const token of tokens) {
      if (!token.revokedAt) {
        await ctx.db.patch(token._id, { revokedAt: now })
      }
    }

    await ctx.db.patch(userId, {
      deactivatedAt: now,
      purgedAt: now,
      deletedAt: undefined,
      banReason: undefined,
      role: 'user',
      handle: undefined,
      displayName: undefined,
      name: undefined,
      image: undefined,
      email: undefined,
      emailVerificationTime: undefined,
      phone: undefined,
      phoneVerificationTime: undefined,
      isAnonymous: undefined,
      bio: undefined,
      githubCreatedAt: undefined,
      githubFetchedAt: undefined,
      updatedAt: now,
    })
    await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId })
  },
})

export const list = query({
  args: { limit: v.optional(v.number()), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
    const query = args.search?.trim().toLowerCase()
    const users = await ctx.db.query('users').order('desc').collect()
    const result = buildUserSearchResults(users, query)
    return { items: result.items.slice(0, limit), total: result.total }
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
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('User not found')
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
  args: { userId: v.id('users'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    return banUserWithActor(ctx, user, args.userId, args.reason)
  },
})

export const banUserInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    targetUserId: v.id('users'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('User not found')
    return banUserWithActor(ctx, actor, args.targetUserId, args.reason)
  },
})

async function banUserWithActor(
  ctx: MutationCtx,
  actor: Doc<'users'>,
  targetUserId: Id<'users'>,
  reasonRaw?: string,
) {
  assertModerator(actor)

  if (targetUserId === actor._id) throw new Error('Cannot ban yourself')

  const target = await ctx.db.get(targetUserId)
  if (!target) throw new Error('User not found')
  if (target.role === 'admin' && actor.role !== 'admin') {
    throw new Error('Forbidden')
  }

  const now = Date.now()
  const reason = reasonRaw?.trim()
  if (reason && reason.length > 500) {
    throw new Error('Reason too long (max 500 chars)')
  }
  if (target.deletedAt || target.deactivatedAt) {
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
    banReason: reason || undefined,
  })

  await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId: targetUserId })

  await ctx.db.insert('auditLogs', {
    actorUserId: actor._id,
    action: 'user.ban',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { deletedSkills: skills.length, reason: reason || undefined },
    createdAt: now,
  })

  return { ok: true as const, alreadyBanned: false, deletedSkills: skills.length }
}

/**
 * Auto-ban a user whose skill was flagged malicious by VT.
 * Skips moderators/admins. No actor required — this is a system-level action.
 */
export const autobanMalwareAuthorInternal = internalMutation({
  args: {
    ownerUserId: v.id('users'),
    sha256hash: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId)
    if (!target) return { ok: false, reason: 'user_not_found' }
    if (target.deletedAt || target.deactivatedAt) return { ok: true, alreadyBanned: true }

    // Never auto-ban moderators or admins
    if (target.role === 'admin' || target.role === 'moderator') {
      console.log(`[autoban] Skipping ${target.handle ?? args.ownerUserId}: role=${target.role}`)
      return { ok: false, reason: 'protected_role' }
    }

    const now = Date.now()

    // Soft-delete all their skills
    const skills = await ctx.db
      .query('skills')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
      .collect()

    for (const skill of skills) {
      if (!skill.softDeletedAt) {
        await ctx.db.patch(skill._id, { softDeletedAt: now, updatedAt: now })
      }
    }

    // Revoke all API tokens
    const tokens = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', args.ownerUserId))
      .collect()
    for (const token of tokens) {
      if (!token.revokedAt) {
        await ctx.db.patch(token._id, { revokedAt: now })
      }
    }

    // Ban the user
    await ctx.db.patch(args.ownerUserId, {
      deletedAt: now,
      role: 'user',
      updatedAt: now,
      banReason: 'malware auto-ban',
    })

    await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, {
      userId: args.ownerUserId,
    })

    // Audit log — use the target as actor since there's no human actor
    await ctx.db.insert('auditLogs', {
      actorUserId: args.ownerUserId,
      action: 'user.autoban.malware',
      targetType: 'user',
      targetId: args.ownerUserId,
      metadata: {
        trigger: 'vt.malicious',
        sha256hash: args.sha256hash,
        slug: args.slug,
        deletedSkills: skills.length,
      },
      createdAt: now,
    })

    console.warn(
      `[autoban] Banned ${target.handle ?? args.ownerUserId} — malicious skill: ${args.slug}`,
    )

    return { ok: true, alreadyBanned: false, deletedSkills: skills.length }
  },
})
