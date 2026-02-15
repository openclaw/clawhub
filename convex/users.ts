import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAdmin, assertModerator, requireUser } from './lib/access'
import { embeddingVisibilityFor } from './lib/embeddingVisibility'
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
    internal.users.applyBanToOwnedSkillsBatchInternal,
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
    internal.users.restoreOwnedSkillsForUnbanBatchInternal,
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
      internal.users.applyBanToOwnedSkillsBatchInternal,
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

const BAN_SKILLS_BATCH_SIZE = 25

export const applyBanToOwnedSkillsBatchInternal = internalMutation({
  args: {
    ownerUserId: v.id('users'),
    bannedAt: v.number(),
    hiddenBy: v.optional(v.id('users')),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: BAN_SKILLS_BATCH_SIZE })

    let hiddenCount = 0
    for (const skill of page) {
      if (skill.softDeletedAt) continue

      // Only overwrite moderation fields for active skills. Keep existing hidden/removed
      // moderation reasons intact.
      const shouldMarkModeration = skill.moderationStatus === 'active'

      const patch: Partial<Doc<'skills'>> = { softDeletedAt: args.bannedAt, updatedAt: args.bannedAt }
      if (shouldMarkModeration) {
        patch.moderationStatus = 'hidden'
        patch.moderationReason = 'user.banned'
        patch.hiddenAt = args.bannedAt
        patch.hiddenBy = args.hiddenBy
        patch.lastReviewedAt = args.bannedAt
        hiddenCount += 1
      }

      await ctx.db.patch(skill._id, patch)
      await markSkillEmbeddingsDeleted(ctx, skill._id, args.bannedAt)
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.users.applyBanToOwnedSkillsBatchInternal, {
        ...args,
        cursor: continueCursor,
      })
    }

    return { ok: true as const, hiddenCount, scheduled: !isDone }
  },
})

export const restoreOwnedSkillsForUnbanBatchInternal = internalMutation({
  args: {
    ownerUserId: v.id('users'),
    bannedAt: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: BAN_SKILLS_BATCH_SIZE })

    let restoredCount = 0
    for (const skill of page) {
      if (
        !skill.softDeletedAt ||
        skill.softDeletedAt !== args.bannedAt ||
        skill.moderationReason !== 'user.banned'
      ) {
        continue
      }

      await ctx.db.patch(skill._id, {
        softDeletedAt: undefined,
        moderationStatus: 'active',
        moderationReason: 'restored.unban',
        hiddenAt: undefined,
        hiddenBy: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      })

      await restoreSkillEmbeddingVisibility(ctx, skill._id, now)
      restoredCount += 1
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.users.restoreOwnedSkillsForUnbanBatchInternal, {
        ...args,
        cursor: continueCursor,
      })
    }

    return { ok: true as const, restoredCount, scheduled: !isDone }
  },
})

async function markSkillEmbeddingsDeleted(ctx: MutationCtx, skillId: Id<'skills'>, now: number) {
  const embeddings = await ctx.db
    .query('skillEmbeddings')
    .withIndex('by_skill', (q) => q.eq('skillId', skillId))
    .collect()
  for (const embedding of embeddings) {
    if (embedding.visibility === 'deleted') continue
    await ctx.db.patch(embedding._id, { visibility: 'deleted', updatedAt: now })
  }
}

async function restoreSkillEmbeddingVisibility(ctx: MutationCtx, skillId: Id<'skills'>, now: number) {
  const embeddings = await ctx.db
    .query('skillEmbeddings')
    .withIndex('by_skill', (q) => q.eq('skillId', skillId))
    .collect()
  for (const embedding of embeddings) {
    const visibility = embeddingVisibilityFor(embedding.isLatest, embedding.isApproved)
    await ctx.db.patch(embedding._id, { visibility, updatedAt: now })
  }
}
