import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { ActionCtx, MutationCtx } from './_generated/server'
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAdmin, assertModerator, requireUser } from './lib/access'
import { syncGitHubProfile } from './lib/githubAccount'
import { toPublicUser } from './lib/public'
import { buildUserSearchResults } from './lib/userSearch'

const DEFAULT_ROLE = 'user'
const ADMIN_HANDLE = 'steipete'
const MAX_USER_LIST_LIMIT = 200
const MAX_USER_SEARCH_SCAN = 5_000
const MIN_USER_SEARCH_SCAN = 500

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

    const limit = clampInt(args.limit ?? 20, 1, MAX_USER_LIST_LIMIT)
    const result = await queryUsersForAdminList(ctx, { limit, search: args.query })
    const items = result.items.map((user) => ({
      userId: user._id,
      handle: user.handle ?? null,
      displayName: user.displayName ?? null,
      name: user.name ?? null,
      role: user.role ?? null,
    }))
    return { items, total: result.total }
  },
})

export const setGitHubCreatedAtInternal = internalMutation({
  args: {
    userId: v.id('users'),
    githubCreatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      githubCreatedAt: args.githubCreatedAt,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Sync the user's GitHub profile (username, avatar) when it changes.
 * This handles the case where a user renames their GitHub account.
 */
export const syncGitHubProfileInternal = internalMutation({
  args: {
    userId: v.id('users'),
    name: v.string(),
    image: v.optional(v.string()),
    profileName: v.optional(v.string()),
    syncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user || user.deletedAt || user.deactivatedAt) return

    const updates: Partial<Doc<'users'>> = { githubProfileSyncedAt: args.syncedAt }
    let didChangeProfile = false

    if (user.name !== args.name) {
      updates.name = args.name
      didChangeProfile = true
    }

    // Update handle if it was derived from the old username
    if (user.handle === user.name && user.name !== args.name) {
      updates.handle = args.name
      didChangeProfile = true
    }

    // Update displayName if it was derived from the old username
    if (
      (user.displayName === user.name || user.displayName === user.handle) &&
      user.name !== args.name
    ) {
      updates.displayName = args.name
      didChangeProfile = true
    }

    // If displayName is derived/missing, prefer the GitHub profile "name" (full name).
    const profileName = args.profileName?.trim()
    if (profileName && profileName !== args.name) {
      const currentDisplay = user.displayName?.trim()
      const currentHandle = user.handle?.trim()
      const currentLogin = user.name?.trim()
      const isDerivedOrMissing =
        !currentDisplay || currentDisplay === currentHandle || currentDisplay === currentLogin
      if (isDerivedOrMissing && currentDisplay !== profileName) {
        updates.displayName = profileName
        didChangeProfile = true
      }
    }

    // Update avatar if provided
    if (args.image && args.image !== user.image) {
      updates.image = args.image
      didChangeProfile = true
    }

    if (didChangeProfile) {
      updates.updatedAt = Date.now()
    }
    await ctx.db.patch(args.userId, updates)
  },
})

/**
 * Internal action to sync GitHub profile from the GitHub API.
 * This is called after login to ensure the username is up-to-date.
 */
export const syncGitHubProfileAction = internalAction({
  args: { userId: v.id('users') },
  handler: async (ctx: ActionCtx, args) => {
    await syncGitHubProfile(ctx, args.userId)
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

function normalizeHandle(handle: string | undefined) {
  const normalized = handle?.trim()
  return normalized ? normalized : undefined
}

function deriveHandle(args: { existingHandle?: string; githubLogin?: string; email?: string }) {
  // Prefer the GitHub login; only fall back to email-derived handle when we don't already have one.
  if (args.githubLogin) return args.githubLogin
  if (!args.existingHandle && args.email) return args.email.split('@')[0]?.trim() || undefined
  return undefined
}

function computeEnsureUpdates(user: Doc<'users'>) {
  const updates: Record<string, unknown> = {}

  const existingHandle = normalizeHandle(user.handle)
  const githubLogin = normalizeHandle(user.name)
  const derivedHandle = deriveHandle({
    existingHandle,
    githubLogin,
    email: user.email,
  })
  const baseHandle = derivedHandle ?? existingHandle

  if (derivedHandle && existingHandle !== derivedHandle) {
    updates.handle = derivedHandle
  }

  const displayName = normalizeHandle(user.displayName)
  if (!displayName && baseHandle) {
    updates.displayName = baseHandle
  } else if (derivedHandle && displayName === existingHandle) {
    updates.displayName = derivedHandle
  }

  if (!user.role) {
    updates.role = baseHandle === ADMIN_HANDLE ? 'admin' : DEFAULT_ROLE
  }

  if (!user.createdAt) updates.createdAt = user._creationTime

  return updates
}

export async function ensureHandler(ctx: MutationCtx) {
  const { userId, user } = await requireUser(ctx)
  const updates = computeEnsureUpdates(user)

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
    const limit = clampInt(args.limit ?? 50, 1, MAX_USER_LIST_LIMIT)
    return queryUsersForAdminList(ctx, { limit, search: args.search })
  },
})

function normalizeSearchQuery(search?: string) {
  const trimmed = search?.trim().toLowerCase()
  return trimmed ? trimmed : undefined
}

function computeUserSearchScanLimit(limit: number) {
  return clampInt(limit * 10, MIN_USER_SEARCH_SCAN, MAX_USER_SEARCH_SCAN)
}

async function queryUsersForAdminList(
  ctx: { db: { query: (table: 'users') => { order: (order: 'desc') => { take: (n: number) => Promise<Doc<'users'>[]> } } } },
  args: { limit: number; search?: string },
) {
  const normalizedSearch = normalizeSearchQuery(args.search)
  const orderedUsers = ctx.db.query('users').order('desc')

  if (!normalizedSearch) {
    const items = await orderedUsers.take(args.limit)
    return { items, total: items.length }
  }

  const scannedUsers = await orderedUsers.take(computeUserSearchScanLimit(args.limit))
  const result = buildUserSearchResults(scannedUsers, normalizedSearch)
  return { items: result.items.slice(0, args.limit), total: result.total }
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max)
}

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

export const unbanUser = mutation({
  args: { userId: v.id('users'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    return unbanUserWithActor(ctx, user, args.userId, args.reason)
  },
})

export const unbanUserInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    targetUserId: v.id('users'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('User not found')
    return unbanUserWithActor(ctx, actor, args.targetUserId, args.reason)
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

  const banSkillsResult = (await ctx.runMutation(
    internal.skills.applyBanToOwnedSkillsBatchInternal,
    {
      ownerUserId: targetUserId,
      bannedAt: now,
      hiddenBy: actor._id,
      cursor: undefined,
    },
  )) as { hiddenCount?: number; scheduled?: boolean }
  const hiddenCount = banSkillsResult.hiddenCount ?? 0
  const scheduledSkills = banSkillsResult.scheduled ?? false

  const tokens = await ctx.db
    .query('apiTokens')
    .withIndex('by_user', (q) => q.eq('userId', targetUserId))
    .collect()
  for (const token of tokens) {
    if (!token.revokedAt) {
      await ctx.db.patch(token._id, { revokedAt: now })
    }
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
    metadata: { hiddenSkills: hiddenCount, reason: reason || undefined },
    createdAt: now,
  })

  return { ok: true as const, alreadyBanned: false, deletedSkills: hiddenCount, scheduledSkills }
}

async function unbanUserWithActor(
  ctx: MutationCtx,
  actor: Doc<'users'>,
  targetUserId: Id<'users'>,
  reasonRaw?: string,
) {
  assertAdmin(actor)
  if (targetUserId === actor._id) throw new Error('Cannot unban yourself')

  const target = await ctx.db.get(targetUserId)
  if (!target) throw new Error('User not found')
  if (target.deactivatedAt) {
    throw new Error('Cannot unban a permanently deleted account')
  }
  if (!target.deletedAt) {
    return { ok: true as const, alreadyUnbanned: true }
  }

  const reason = reasonRaw?.trim()
  if (reason && reason.length > 500) {
    throw new Error('Reason too long (max 500 chars)')
  }

  const now = Date.now()
  const bannedAt = target.deletedAt
  await ctx.db.patch(targetUserId, {
    deletedAt: undefined,
    banReason: undefined,
    role: 'user',
    updatedAt: now,
  })

  const restoreSkillsResult = (await ctx.runMutation(
    internal.skills.restoreOwnedSkillsForUnbanBatchInternal,
    {
      ownerUserId: targetUserId,
      bannedAt,
      cursor: undefined,
    },
  )) as { restoredCount?: number; scheduled?: boolean }
  const restoredCount = restoreSkillsResult.restoredCount ?? 0
  const scheduledSkills = restoreSkillsResult.scheduled ?? false

  await ctx.db.insert('auditLogs', {
    actorUserId: actor._id,
    action: 'user.unban',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { reason: reason || undefined, restoredSkills: restoredCount },
    createdAt: now,
  })

  return { ok: true as const, alreadyUnbanned: false, restoredSkills: restoredCount, scheduledSkills }
}

/**
 * Admin-only: set or unset the trustedPublisher flag for a user.
 * Trusted publishers bypass the pending.scan auto-hide for new skill publishes.
 */
export const setTrustedPublisher = mutation({
  args: {
    userId: v.id('users'),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)

    const target = await ctx.db.get(args.userId)
    if (!target) throw new Error('User not found')

    const now = Date.now()
    await ctx.db.patch(args.userId, {
      trustedPublisher: args.trusted || undefined,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.trusted ? 'user.trusted.set' : 'user.trusted.unset',
      targetType: 'user',
      targetId: args.userId,
      metadata: { trusted: args.trusted },
      createdAt: now,
    })

    return { ok: true as const, trusted: args.trusted }
  },
})

export const setTrustedPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    targetUserId: v.id('users'),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('User not found')
    assertAdmin(actor)

    const target = await ctx.db.get(args.targetUserId)
    if (!target) throw new Error('User not found')

    const now = Date.now()
    await ctx.db.patch(args.targetUserId, {
      trustedPublisher: args.trusted || undefined,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: args.actorUserId,
      action: args.trusted ? 'user.trusted.set' : 'user.trusted.unset',
      targetType: 'user',
      targetId: args.targetUserId,
      metadata: { trusted: args.trusted },
      createdAt: now,
    })

    return { ok: true as const, trusted: args.trusted }
  },
})

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

    const banSkillsResult = (await ctx.runMutation(
      internal.skills.applyBanToOwnedSkillsBatchInternal,
      {
        ownerUserId: args.ownerUserId,
        bannedAt: now,
        cursor: undefined,
      },
    )) as { hiddenCount?: number; scheduled?: boolean }
    const hiddenCount = banSkillsResult.hiddenCount ?? 0
    const scheduledSkills = banSkillsResult.scheduled ?? false

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

    // Audit log -- use the target as actor since there's no human actor
    await ctx.db.insert('auditLogs', {
      actorUserId: args.ownerUserId,
      action: 'user.autoban.malware',
      targetType: 'user',
      targetId: args.ownerUserId,
      metadata: {
        trigger: 'vt.malicious',
        sha256hash: args.sha256hash,
        slug: args.slug,
        hiddenSkills: hiddenCount,
      },
      createdAt: now,
    })

    console.warn(
      `[autoban] Banned ${target.handle ?? args.ownerUserId} — malicious skill: ${args.slug}`,
    )

    return { ok: true, alreadyBanned: false, deletedSkills: hiddenCount, scheduledSkills }
  },
})
