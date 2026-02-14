import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { internalMutation, mutation, query } from './_generated/server'
import { requireUser } from './lib/access'
import { insertStatEvent } from './skillStatEvents'

const TELEMETRY_STALE_MS = 120 * 24 * 60 * 60 * 1000

type RootPayload = {
  rootId: string
  label: string
  skills: Array<{ slug: string; version?: string | null }>
}

export const reportCliSyncInternal = internalMutation({
  args: {
    userId: v.id('users'),
    roots: v.array(
      v.object({
        rootId: v.string(),
        label: v.string(),
        skills: v.array(
          v.object({
            slug: v.string(),
            version: v.optional(v.string()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const stalenessCutoff = now - TELEMETRY_STALE_MS

    await expireStaleRoots(ctx, { userId: args.userId, stalenessCutoff, now })

    const roots = normalizeRoots(args.roots)
    const skillsBySlug = await resolveSkillsBySlug(ctx, roots)

    for (const root of roots) {
      await upsertRoot(ctx, { userId: args.userId, rootId: root.rootId, now, label: root.label })
      await applyRootReport(ctx, {
        userId: args.userId,
        root,
        skillsBySlug,
        now,
      })
    }
  },
})

export const clearMyTelemetry = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    await clearTelemetryForUser(ctx, { userId })
  },
})

export const clearUserTelemetryInternal = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    await clearTelemetryForUser(ctx, { userId: args.userId })
  },
})

export const getMyInstalled = query({
  args: {
    includeRemoved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const roots = await ctx.db
      .query('userSyncRoots')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .take(200)

    const includeRemoved = Boolean(args.includeRemoved)
    const resultRoots: Array<{
      rootId: string
      label: string
      firstSeenAt: number
      lastSeenAt: number
      expiredAt?: number
      skills: Array<{
        skill: {
          slug: string
          displayName: string
          summary?: string
          stats: unknown
          ownerUserId: Id<'users'>
        }
        firstSeenAt: number
        lastSeenAt: number
        lastVersion?: string
        removedAt?: number
      }>
    }> = []

    for (const root of roots) {
      const installs = await ctx.db
        .query('userSkillRootInstalls')
        .withIndex('by_user_root', (q) => q.eq('userId', userId).eq('rootId', root.rootId))
        .order('desc')
        .take(2000)

      const filtered = includeRemoved ? installs : installs.filter((entry) => !entry.removedAt)
      const skills: Array<{
        skill: {
          slug: string
          displayName: string
          summary?: string
          stats: unknown
          ownerUserId: Id<'users'>
        }
        firstSeenAt: number
        lastSeenAt: number
        lastVersion?: string
        removedAt?: number
      }> = []

      for (const entry of filtered) {
        const skill = await ctx.db.get(entry.skillId)
        if (!skill) continue
        skills.push({
          skill: {
            slug: skill.slug,
            displayName: skill.displayName,
            summary: skill.summary,
            stats: skill.stats,
            ownerUserId: skill.ownerUserId,
          },
          firstSeenAt: entry.firstSeenAt,
          lastSeenAt: entry.lastSeenAt,
          lastVersion: entry.lastVersion,
          removedAt: entry.removedAt,
        })
      }

      resultRoots.push({
        rootId: root.rootId,
        label: root.label,
        firstSeenAt: root.firstSeenAt,
        lastSeenAt: root.lastSeenAt,
        expiredAt: root.expiredAt,
        skills,
      })
    }

    return {
      roots: resultRoots,
      cutoffDays: 120,
    }
  },
})

async function clearTelemetryForUser(ctx: MutationCtx, params: { userId: Id<'users'> }) {
  const installs = await ctx.db
    .query('userSkillInstalls')
    .withIndex('by_user', (q) => q.eq('userId', params.userId))
    .take(5000)

  for (const entry of installs) {
    const skill = await ctx.db.get(entry.skillId)
    if (!skill) {
      await ctx.db.delete(entry._id)
      continue
    }
    await insertStatEvent(ctx, {
      skillId: skill._id,
      kind: 'install_clear',
      delta: {
        allTime: -1,
        current: entry.activeRoots > 0 ? -1 : 0,
      },
    })
    await ctx.db.delete(entry._id)
  }

  const roots = await ctx.db
    .query('userSyncRoots')
    .withIndex('by_user', (q) => q.eq('userId', params.userId))
    .take(5000)
  for (const root of roots) {
    await ctx.db.delete(root._id)
  }

  const rootInstalls = await ctx.db
    .query('userSkillRootInstalls')
    .withIndex('by_user', (q) => q.eq('userId', params.userId))
    .take(10000)
  for (const entry of rootInstalls) {
    await ctx.db.delete(entry._id)
  }
}

function normalizeRoots(roots: RootPayload[]): RootPayload[] {
  const seen = new Set<string>()
  const unique: RootPayload[] = []
  for (const root of roots) {
    const id = root.rootId.trim()
    if (!id) continue
    if (seen.has(id)) continue
    seen.add(id)
    unique.push({
      rootId: id,
      label: root.label.trim() || 'Unknown',
      skills: root.skills
        .map((skill) => ({
          slug: skill.slug.trim().toLowerCase(),
          version: skill.version ?? null,
        }))
        .filter((skill) => Boolean(skill.slug)),
    })
  }
  return unique
}

async function upsertRoot(
  ctx: MutationCtx,
  params: { userId: Id<'users'>; rootId: string; now: number; label: string },
) {
  const existing = await ctx.db
    .query('userSyncRoots')
    .withIndex('by_user_root', (q) => q.eq('userId', params.userId).eq('rootId', params.rootId))
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, {
      label: params.label,
      lastSeenAt: params.now,
      expiredAt: undefined,
    })
    return
  }
  await ctx.db.insert('userSyncRoots', {
    userId: params.userId,
    rootId: params.rootId,
    label: params.label,
    firstSeenAt: params.now,
    lastSeenAt: params.now,
    expiredAt: undefined,
  })
}

async function applyRootReport(
  ctx: MutationCtx,
  params: {
    userId: Id<'users'>
    root: RootPayload
    skillsBySlug: Map<string, { skillId: Id<'skills'> }>
    now: number
  },
) {
  const expected = new Set<Id<'skills'>>()
  const versionsBySkill = new Map<Id<'skills'>, string | undefined>()
  for (const entry of params.root.skills) {
    const resolved = params.skillsBySlug.get(entry.slug)
    if (!resolved) continue
    expected.add(resolved.skillId)
    const version = entry.version?.trim() || undefined
    if (version) versionsBySkill.set(resolved.skillId, version)
  }

  const previous = await ctx.db
    .query('userSkillRootInstalls')
    .withIndex('by_user_root', (q) =>
      q.eq('userId', params.userId).eq('rootId', params.root.rootId),
    )
    .take(5000)

  const active = previous.filter((entry) => !entry.removedAt)

  for (const skillId of expected) {
    const existing = await ctx.db
      .query('userSkillRootInstalls')
      .withIndex('by_user_root_skill', (q) =>
        q.eq('userId', params.userId).eq('rootId', params.root.rootId).eq('skillId', skillId),
      )
      .unique()

    const reportedVersion = versionsBySkill.get(skillId)

    if (existing) {
      const wasRemoved = Boolean(existing.removedAt)
      await ctx.db.patch(existing._id, {
        lastSeenAt: params.now,
        lastVersion: reportedVersion ?? existing.lastVersion,
        removedAt: undefined,
      })
      if (wasRemoved) {
        await incrementActiveRoots(ctx, {
          userId: params.userId,
          skillId,
          now: params.now,
          version: reportedVersion,
        })
      }
      continue
    }

    await ctx.db.insert('userSkillRootInstalls', {
      userId: params.userId,
      rootId: params.root.rootId,
      skillId,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      lastVersion: reportedVersion,
    })
    await incrementActiveRoots(ctx, {
      userId: params.userId,
      skillId,
      now: params.now,
      version: reportedVersion,
    })
  }

  for (const entry of active) {
    if (expected.has(entry.skillId)) continue
    await ctx.db.patch(entry._id, { removedAt: params.now })
    await decrementActiveRoots(ctx, { userId: params.userId, skillId: entry.skillId })
  }
}

async function incrementActiveRoots(
  ctx: MutationCtx,
  params: { userId: Id<'users'>; skillId: Id<'skills'>; now: number; version?: string },
) {
  const existing = await ctx.db
    .query('userSkillInstalls')
    .withIndex('by_user_skill', (q) => q.eq('userId', params.userId).eq('skillId', params.skillId))
    .unique()

  if (!existing) {
    await ctx.db.insert('userSkillInstalls', {
      userId: params.userId,
      skillId: params.skillId,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      activeRoots: 1,
      lastVersion: params.version,
    })
    await bumpSkillInstallCounts(ctx, { skillId: params.skillId, deltaAllTime: 1, deltaCurrent: 1 })
    return
  }

  const nextActive = Math.max(0, (existing.activeRoots ?? 0) + 1)
  await ctx.db.patch(existing._id, {
    activeRoots: nextActive,
    lastSeenAt: params.now,
    lastVersion: params.version ?? existing.lastVersion,
  })
  if ((existing.activeRoots ?? 0) === 0 && nextActive > 0) {
    await bumpSkillInstallCounts(ctx, { skillId: params.skillId, deltaAllTime: 0, deltaCurrent: 1 })
  }
}

async function decrementActiveRoots(
  ctx: MutationCtx,
  params: { userId: Id<'users'>; skillId: Id<'skills'> },
) {
  const existing = await ctx.db
    .query('userSkillInstalls')
    .withIndex('by_user_skill', (q) => q.eq('userId', params.userId).eq('skillId', params.skillId))
    .unique()
  if (!existing) return

  const nextActive = Math.max(0, (existing.activeRoots ?? 0) - 1)
  await ctx.db.patch(existing._id, { activeRoots: nextActive })
  if ((existing.activeRoots ?? 0) > 0 && nextActive === 0) {
    await bumpSkillInstallCounts(ctx, {
      skillId: params.skillId,
      deltaAllTime: 0,
      deltaCurrent: -1,
    })
  }
}

async function bumpSkillInstallCounts(
  ctx: MutationCtx,
  params: { skillId: Id<'skills'>; deltaAllTime: number; deltaCurrent: number },
) {
  if (params.deltaAllTime === 1 && params.deltaCurrent === 1) {
    await insertStatEvent(ctx, { skillId: params.skillId, kind: 'install_new' })
  } else if (params.deltaAllTime === 0 && params.deltaCurrent === 1) {
    await insertStatEvent(ctx, { skillId: params.skillId, kind: 'install_reactivate' })
  } else if (params.deltaAllTime === 0 && params.deltaCurrent === -1) {
    await insertStatEvent(ctx, { skillId: params.skillId, kind: 'install_deactivate' })
  }
}

async function expireStaleRoots(
  ctx: MutationCtx,
  params: { userId: Id<'users'>; stalenessCutoff: number; now: number },
) {
  const roots = await ctx.db
    .query('userSyncRoots')
    .withIndex('by_user', (q) => q.eq('userId', params.userId))
    .take(5000)

  const stale = roots.filter((root) => !root.expiredAt && root.lastSeenAt < params.stalenessCutoff)
  for (const root of stale) {
    await ctx.db.patch(root._id, { expiredAt: params.now })
    const installs = await ctx.db
      .query('userSkillRootInstalls')
      .withIndex('by_user_root', (q) => q.eq('userId', params.userId).eq('rootId', root.rootId))
      .take(5000)
    for (const entry of installs) {
      if (entry.removedAt) continue
      await ctx.db.patch(entry._id, { removedAt: params.now })
      await decrementActiveRoots(ctx, { userId: params.userId, skillId: entry.skillId })
    }
  }
}

async function resolveSkillsBySlug(ctx: QueryCtx | MutationCtx, roots: RootPayload[]) {
  const slugs = new Set<string>()
  for (const root of roots) {
    for (const entry of root.skills) slugs.add(entry.slug)
  }
  const map = new Map<string, { skillId: Id<'skills'> }>()
  for (const slug of slugs) {
    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (skill && !skill.softDeletedAt) map.set(slug, { skillId: skill._id })
  }
  return map
}
