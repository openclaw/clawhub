import { paginationOptsValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { paginator } from 'convex-helpers/server/pagination'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAdmin, assertModerator, requireUser, requireUserFromAction } from './lib/access'
import { getSkillBadgeMap, getSkillBadgeMaps, isSkillHighlighted } from './lib/badges'
import { generateChangelogPreview as buildChangelogPreview } from './lib/changelog'
import { buildTrendingLeaderboard } from './lib/leaderboards'
import { deriveModerationFlags } from './lib/moderation'
import { toPublicSkill, toPublicUser } from './lib/public'
import {
  fetchText,
  type PublishResult,
  publishVersionForUser,
  queueHighlightedWebhook,
} from './lib/skillPublish'
import { getFrontmatterValue, hashSkillFiles } from './lib/skills'
import schema from './schema'

export { publishVersionForUser } from './lib/skillPublish'

type ReadmeResult = { path: string; text: string }
type FileTextResult = { path: string; text: string; size: number; sha256: string }

const MAX_DIFF_FILE_BYTES = 200 * 1024
const MAX_LIST_LIMIT = 50
const MAX_PUBLIC_LIST_LIMIT = 200
const MAX_LIST_BULK_LIMIT = 200
const MAX_LIST_TAKE = 1000

function isSkillVersionId(
  value: Id<'skillVersions'> | null | undefined,
): value is Id<'skillVersions'> {
  return typeof value === 'string' && value.startsWith('skillVersions:')
}

function isUserId(value: Id<'users'> | null | undefined): value is Id<'users'> {
  return typeof value === 'string' && value.startsWith('users:')
}

async function resolveOwnerHandle(ctx: QueryCtx, ownerUserId: Id<'users'>) {
  const owner = await ctx.db.get(ownerUserId)
  return owner?.handle ?? owner?._id ?? null
}

async function hardDeleteSkill(
  ctx: MutationCtx,
  skill: Doc<'skills'>,
  actorUserId: Id<'users'> | null,
) {
  const versions = await ctx.db
    .query('skillVersions')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()

  for (const version of versions) {
    const versionFingerprints = await ctx.db
      .query('skillVersionFingerprints')
      .withIndex('by_version', (q) => q.eq('versionId', version._id))
      .collect()
    for (const fingerprint of versionFingerprints) {
      await ctx.db.delete(fingerprint._id)
    }

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_version', (q) => q.eq('versionId', version._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.delete(embedding._id)
    }

    await ctx.db.delete(version._id)
  }

  const remainingFingerprints = await ctx.db
    .query('skillVersionFingerprints')
    .withIndex('by_skill_fingerprint', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const fingerprint of remainingFingerprints) {
    await ctx.db.delete(fingerprint._id)
  }

  const remainingEmbeddings = await ctx.db
    .query('skillEmbeddings')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const embedding of remainingEmbeddings) {
    await ctx.db.delete(embedding._id)
  }

  const comments = await ctx.db
    .query('comments')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const comment of comments) {
    await ctx.db.delete(comment._id)
  }

  const stars = await ctx.db
    .query('stars')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const star of stars) {
    await ctx.db.delete(star._id)
  }

  const badges = await ctx.db
    .query('skillBadges')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const badge of badges) {
    await ctx.db.delete(badge._id)
  }

  const dailyStats = await ctx.db
    .query('skillDailyStats')
    .withIndex('by_skill_day', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const stat of dailyStats) {
    await ctx.db.delete(stat._id)
  }

  const statEvents = await ctx.db
    .query('skillStatEvents')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const statEvent of statEvents) {
    await ctx.db.delete(statEvent._id)
  }

  const installs = await ctx.db
    .query('userSkillInstalls')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const install of installs) {
    await ctx.db.delete(install._id)
  }

  const rootInstalls = await ctx.db
    .query('userSkillRootInstalls')
    .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
    .collect()
  for (const rootInstall of rootInstalls) {
    await ctx.db.delete(rootInstall._id)
  }

  const leaderboards = await ctx.db.query('skillLeaderboards').collect()
  for (const leaderboard of leaderboards) {
    const items = leaderboard.items.filter((item) => item.skillId !== skill._id)
    if (items.length !== leaderboard.items.length) {
      await ctx.db.patch(leaderboard._id, { items })
    }
  }

  const relatedSkills = await ctx.db.query('skills').collect()
  const now = Date.now()
  for (const related of relatedSkills) {
    if (related._id === skill._id) continue
    if (related.canonicalSkillId === skill._id || related.forkOf?.skillId === skill._id) {
      await ctx.db.patch(related._id, {
        canonicalSkillId: related.canonicalSkillId === skill._id ? undefined : related.canonicalSkillId,
        forkOf: related.forkOf?.skillId === skill._id ? undefined : related.forkOf,
        updatedAt: now,
      })
    }
  }

  await ctx.db.delete(skill._id)

  if (actorUserId) {
    await ctx.db.insert('auditLogs', {
      actorUserId,
      action: 'skill.hard_delete',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { slug: skill.slug },
      createdAt: now,
    })
  }
}

type PublicSkillEntry = {
  skill: NonNullable<ReturnType<typeof toPublicSkill>>
  latestVersion: Doc<'skillVersions'> | null
  ownerHandle: string | null
}

type ManagementSkillEntry = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | null
}

type BadgeKind = Doc<'skillBadges'>['kind']

async function buildPublicSkillEntries(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const ownerHandleCache = new Map<Id<'users'>, Promise<string | null>>()
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  )

  const getOwnerHandle = (ownerUserId: Id<'users'>) => {
    const cached = ownerHandleCache.get(ownerUserId)
    if (cached) return cached
    const handlePromise = resolveOwnerHandle(ctx, ownerUserId)
    ownerHandleCache.set(ownerUserId, handlePromise)
    return handlePromise
  }

  const entries = await Promise.all(
    skills.map(async (skill) => {
      const [latestVersion, ownerHandle] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        getOwnerHandle(skill.ownerUserId),
      ])
      const badges = badgeMapBySkillId.get(skill._id) ?? {}
      const publicSkill = toPublicSkill({ ...skill, badges })
      if (!publicSkill) return null
      return { skill: publicSkill, latestVersion, ownerHandle }
    }),
  )

  return entries.filter((entry): entry is PublicSkillEntry => entry !== null)
}

async function buildManagementSkillEntries(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const ownerCache = new Map<Id<'users'>, Promise<Doc<'users'> | null>>()
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  )

  const getOwner = (ownerUserId: Id<'users'>) => {
    const cached = ownerCache.get(ownerUserId)
    if (cached) return cached
    const ownerPromise = ctx.db.get(ownerUserId)
    ownerCache.set(ownerUserId, ownerPromise)
    return ownerPromise
  }

  return Promise.all(
    skills.map(async (skill) => {
      const [latestVersion, owner] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        getOwner(skill.ownerUserId),
      ])
      const badges = badgeMapBySkillId.get(skill._id) ?? {}
      return { skill: { ...skill, badges }, latestVersion, owner }
    }),
  ) satisfies Promise<ManagementSkillEntry[]>
}

async function attachBadgesToSkills(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  )
  return skills.map((skill) => ({
    ...skill,
    badges: badgeMapBySkillId.get(skill._id) ?? {},
  }))
}

async function loadHighlightedSkills(ctx: QueryCtx, limit: number) {
  const entries = await ctx.db
    .query('skillBadges')
    .withIndex('by_kind_at', (q) => q.eq('kind', 'highlighted'))
    .order('desc')
    .take(MAX_LIST_TAKE)

  const skills: Doc<'skills'>[] = []
  for (const badge of entries) {
    const skill = await ctx.db.get(badge.skillId)
    if (!skill || skill.softDeletedAt) continue
    skills.push(skill)
    if (skills.length >= limit) break
  }

  return skills
}

async function upsertSkillBadge(
  ctx: MutationCtx,
  skillId: Id<'skills'>,
  kind: BadgeKind,
  userId: Id<'users'>,
  at: number,
) {
  const existing = await ctx.db
    .query('skillBadges')
    .withIndex('by_skill_kind', (q) => q.eq('skillId', skillId).eq('kind', kind))
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, { byUserId: userId, at })
    return existing._id
  }
  return ctx.db.insert('skillBadges', {
    skillId,
    kind,
    byUserId: userId,
    at,
  })
}

async function removeSkillBadge(ctx: MutationCtx, skillId: Id<'skills'>, kind: BadgeKind) {
  const existing = await ctx.db
    .query('skillBadges')
    .withIndex('by_skill_kind', (q) => q.eq('skillId', skillId).eq('kind', kind))
    .unique()
  if (existing) {
    await ctx.db.delete(existing._id)
  }
}

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()
    if (!skill || skill.softDeletedAt) return null
    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null
    const owner = toPublicUser(await ctx.db.get(skill.ownerUserId))
    const badges = await getSkillBadgeMap(ctx, skill._id)

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null
    const forkOfOwner = forkOfSkill ? await ctx.db.get(forkOfSkill.ownerUserId) : null

    const canonicalSkill = skill.canonicalSkillId ? await ctx.db.get(skill.canonicalSkillId) : null
    const canonicalOwner = canonicalSkill ? await ctx.db.get(canonicalSkill.ownerUserId) : null

    const publicSkill = toPublicSkill({ ...skill, badges })
    if (!publicSkill) return null

    return {
      skill: publicSkill,
      latestVersion,
      owner,
      forkOf: forkOfSkill
        ? {
            kind: skill.forkOf?.kind ?? 'fork',
            version: skill.forkOf?.version ?? null,
            skill: {
              slug: forkOfSkill.slug,
              displayName: forkOfSkill.displayName,
            },
            owner: {
              handle: forkOfOwner?.handle ?? forkOfOwner?.name ?? null,
              userId: forkOfOwner?._id ?? null,
            },
          }
        : null,
      canonical: canonicalSkill
        ? {
            skill: {
              slug: canonicalSkill.slug,
              displayName: canonicalSkill.displayName,
            },
            owner: {
              handle: canonicalOwner?.handle ?? canonicalOwner?.name ?? null,
              userId: canonicalOwner?._id ?? null,
            },
          }
        : null,
    }
  },
})

export const getSkillBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()
  },
})

export const list = query({
  args: {
    batch: v.optional(v.string()),
    ownerUserId: v.optional(v.id('users')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    if (args.batch) {
      if (args.batch === 'highlighted') {
        const skills = await loadHighlightedSkills(ctx, limit)
        const withBadges = await attachBadgesToSkills(ctx, skills)
        return withBadges
          .map((skill) => toPublicSkill(skill))
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
      }
      const entries = await ctx.db
        .query('skills')
        .withIndex('by_batch', (q) => q.eq('batch', args.batch))
        .order('desc')
        .take(takeLimit)
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
      const withBadges = await attachBadgesToSkills(ctx, filtered)
      return withBadges
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    }
    const ownerUserId = args.ownerUserId
    if (ownerUserId) {
      const entries = await ctx.db
        .query('skills')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(takeLimit)
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
      const withBadges = await attachBadgesToSkills(ctx, filtered)
      return withBadges
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    }
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
    const withBadges = await attachBadgesToSkills(ctx, filtered)
    return withBadges
      .map((skill) => toPublicSkill(skill))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
  },
})

export const listWithLatest = query({
  args: {
    batch: v.optional(v.string()),
    ownerUserId: v.optional(v.id('users')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    let entries: Doc<'skills'>[] = []
    if (args.batch) {
      if (args.batch === 'highlighted') {
        entries = await loadHighlightedSkills(ctx, limit)
      } else {
        entries = await ctx.db
          .query('skills')
          .withIndex('by_batch', (q) => q.eq('batch', args.batch))
          .order('desc')
          .take(takeLimit)
      }
    } else if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId
      entries = await ctx.db
        .query('skills')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(takeLimit)
    } else {
      entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    }

    const filtered = entries.filter((skill) => !skill.softDeletedAt)
    const withBadges = await attachBadgesToSkills(ctx, filtered)
    const ordered =
      args.batch === 'highlighted'
        ? [...withBadges].sort(
            (a, b) => (b.badges?.highlighted?.at ?? 0) - (a.badges?.highlighted?.at ?? 0),
          )
        : withBadges
    const limited = ordered.slice(0, limit)
    const items = await Promise.all(
      limited.map(async (skill) => ({
        skill: toPublicSkill(skill),
        latestVersion: skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null,
      })),
    )
    return items.filter(
      (
        item,
      ): item is {
        skill: NonNullable<ReturnType<typeof toPublicSkill>>
        latestVersion: Doc<'skillVersions'> | null
      } => Boolean(item.skill),
    )
  },
})

export const listForManagement = query({
  args: {
    limit: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 50, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    const filtered = (
      args.includeDeleted ? entries : entries.filter((skill) => !skill.softDeletedAt)
    ).slice(0, limit)
    return buildManagementSkillEntries(ctx, filtered)
  },
})

export const listRecentVersions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_BULK_LIMIT)
    const versions = await ctx.db
      .query('skillVersions')
      .order('desc')
      .take(limit * 2)
    const entries = versions.filter((version) => !version.softDeletedAt).slice(0, limit)

    const results: Array<{
      version: Doc<'skillVersions'>
      skill: Doc<'skills'> | null
      owner: Doc<'users'> | null
    }> = []

    for (const version of entries) {
      const skill = await ctx.db.get(version.skillId)
      if (!skill) {
        results.push({ version, skill: null, owner: null })
        continue
      }
      const owner = await ctx.db.get(skill.ownerUserId)
      results.push({ version, skill, owner })
    }

    return results
  },
})

export const listReportedSkills = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 25, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    const reported = entries
      .filter((skill) => (skill.reportCount ?? 0) > 0)
      .sort((a, b) => (b.lastReportedAt ?? 0) - (a.lastReportedAt ?? 0))
      .slice(0, limit)
    return buildManagementSkillEntries(ctx, reported)
  },
})

export const listDuplicateCandidates = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    const skills = await ctx.db.query('skills').order('desc').take(takeLimit)
    const entries = skills.filter((skill) => !skill.softDeletedAt).slice(0, limit)

    const results: Array<{
      skill: Doc<'skills'>
      latestVersion: Doc<'skillVersions'> | null
      fingerprint: string | null
      matches: Array<{ skill: Doc<'skills'>; owner: Doc<'users'> | null }>
      owner: Doc<'users'> | null
    }> = []

    for (const skill of entries) {
      const latestVersion = isSkillVersionId(skill.latestVersionId)
        ? await ctx.db.get(skill.latestVersionId)
        : null
      const fingerprint = latestVersion?.fingerprint ?? null
      if (!fingerprint) continue

      let matchedFingerprints: Doc<'skillVersionFingerprints'>[] = []
      try {
        matchedFingerprints = await ctx.db
          .query('skillVersionFingerprints')
          .withIndex('by_fingerprint', (q) => q.eq('fingerprint', fingerprint))
          .take(10)
      } catch (error) {
        console.error('listDuplicateCandidates: fingerprint lookup failed', error)
        continue
      }

      const matchEntries: Array<{ skill: Doc<'skills'>; owner: Doc<'users'> | null }> = []
      for (const match of matchedFingerprints) {
        if (match.skillId === skill._id) continue
        const matchSkill = await ctx.db.get(match.skillId)
        if (!matchSkill || matchSkill.softDeletedAt) continue
        const matchOwner = await ctx.db.get(matchSkill.ownerUserId)
        matchEntries.push({ skill: matchSkill, owner: matchOwner })
      }

      if (matchEntries.length === 0) continue

      const owner = isUserId(skill.ownerUserId) ? await ctx.db.get(skill.ownerUserId) : null
      results.push({
        skill,
        latestVersion,
        fingerprint,
        matches: matchEntries,
        owner,
      })
    }

    return results
  },
})

export const report = mutation({
  args: { skillId: v.id('skills'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const skill = await ctx.db.get(args.skillId)
    if (!skill || skill.softDeletedAt) throw new Error('Skill not found')

    const existing = await ctx.db
      .query('skillReports')
      .withIndex('by_skill_user', (q) => q.eq('skillId', args.skillId).eq('userId', userId))
      .unique()
    if (existing) return { ok: true as const, reported: false, alreadyReported: true }

    const now = Date.now()
    const reason = args.reason?.trim()
    await ctx.db.insert('skillReports', {
      skillId: args.skillId,
      userId,
      reason: reason ? reason.slice(0, 500) : undefined,
      createdAt: now,
    })

    await ctx.db.patch(skill._id, {
      reportCount: (skill.reportCount ?? 0) + 1,
      lastReportedAt: now,
      updatedAt: now,
    })

    return { ok: true as const, reported: true, alreadyReported: false }
  },
})

// TODO: Delete listPublicPage once all clients have migrated to listPublicPageV2
export const listPublicPage = query({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    sort: v.optional(
      v.union(
        v.literal('updated'),
        v.literal('downloads'),
        v.literal('stars'),
        v.literal('installsCurrent'),
        v.literal('installsAllTime'),
        v.literal('trending'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? 'updated'
    const limit = clampInt(args.limit ?? 24, 1, MAX_PUBLIC_LIST_LIMIT)

    if (sort === 'updated') {
      const { page, isDone, continueCursor } = await ctx.db
        .query('skills')
        .withIndex('by_updated', (q) => q)
        .order('desc')
        .paginate({ cursor: args.cursor ?? null, numItems: limit })

      const skills = page.filter((skill) => !skill.softDeletedAt)
      const items = await buildPublicSkillEntries(ctx, skills)

      return { items, nextCursor: isDone ? null : continueCursor }
    }

    if (sort === 'trending') {
      const entries = await getTrendingEntries(ctx, limit)
      const skills: Doc<'skills'>[] = []

      for (const entry of entries) {
        const skill = await ctx.db.get(entry.skillId)
        if (!skill || skill.softDeletedAt) continue
        skills.push(skill)
        if (skills.length >= limit) break
      }

      const items = await buildPublicSkillEntries(ctx, skills)
      return { items, nextCursor: null }
    }

    const index = sortToIndex(sort)
    const page = await ctx.db
      .query('skills')
      .withIndex(index, (q) => q)
      .order('desc')
      .take(Math.min(limit * 5, MAX_LIST_TAKE))

    const filtered = page.filter((skill) => !skill.softDeletedAt).slice(0, limit)
    const items = await buildPublicSkillEntries(ctx, filtered)
    return { items, nextCursor: null }
  },
})

/**
 * V2 of listPublicPage using convex-helpers paginator for better cache behavior.
 *
 * Key differences from V1:
 * - Uses `paginator` from convex-helpers (doesn't track end-cursor internally, better caching)
 * - Uses `by_active_updated` index to filter soft-deleted skills at query level
 * - Returns standard pagination shape compatible with usePaginatedQuery
 */
export const listPublicPageV2 = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.optional(
      v.union(
        v.literal('newest'),
        v.literal('updated'),
        v.literal('downloads'),
        v.literal('installs'),
        v.literal('stars'),
        v.literal('name'),
      ),
    ),
    dir: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? 'newest'
    const dir = args.dir ?? 'desc'

    const indexName =
      sort === 'newest'
        ? 'by_active_created'
        : sort === 'updated'
          ? 'by_active_updated'
          : sort === 'name'
            ? 'by_active_name'
            : sort === 'downloads'
              ? 'by_active_stats_downloads'
              : sort === 'stars'
                ? 'by_active_stats_stars'
                : 'by_active_stats_installs_all_time'

    const result = await paginator(ctx.db, schema)
      .query('skills')
      .withIndex(indexName, (q) => q.eq('softDeletedAt', undefined))
      .order(dir)
      .paginate(args.paginationOpts)

    const items = await buildPublicSkillEntries(ctx, result.page)

    return { ...result, page: items }
  },
})

function sortToIndex(
  sort: 'downloads' | 'stars' | 'installsCurrent' | 'installsAllTime',
):
  | 'by_stats_downloads'
  | 'by_stats_stars'
  | 'by_stats_installs_current'
  | 'by_stats_installs_all_time' {
  switch (sort) {
    case 'downloads':
      return 'by_stats_downloads'
    case 'stars':
      return 'by_stats_stars'
    case 'installsCurrent':
      return 'by_stats_installs_current'
    case 'installsAllTime':
      return 'by_stats_installs_all_time'
  }
}

async function getTrendingEntries(ctx: QueryCtx, limit: number) {
  // Use the pre-computed leaderboard from the hourly cron job.
  // Avoid Date.now() here to keep the query deterministic and cacheable.
  const latest = await ctx.db
    .query('skillLeaderboards')
    .withIndex('by_kind', (q) => q.eq('kind', 'trending'))
    .order('desc')
    .take(1)

  if (latest[0]) {
    return latest[0].items.slice(0, limit)
  }

  // No leaderboard exists yet (cold start) - compute on the fly
  const fallback = await buildTrendingLeaderboard(ctx, { limit, now: Date.now() })
  return fallback.items
}

export const listVersions = query({
  args: { skillId: v.id('skills'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20
    return ctx.db
      .query('skillVersions')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .take(limit)
  },
})

export const listVersionsPage = query({
  args: {
    skillId: v.id('skills'),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_LIMIT)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skillVersions')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: limit })
    const items = page.filter((version) => !version.softDeletedAt)
    return { items, nextCursor: isDone ? null : continueCursor }
  },
})

export const getVersionById = query({
  args: { versionId: v.id('skillVersions') },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
})

export const getVersionByIdInternal = internalQuery({
  args: { versionId: v.id('skillVersions') },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
})

export const getVersionBySkillAndVersion = query({
  args: { skillId: v.id('skills'), version: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('skillVersions')
      .withIndex('by_skill_version', (q) =>
        q.eq('skillId', args.skillId).eq('version', args.version),
      )
      .unique()
  },
})

export const publishVersion: ReturnType<typeof action> = action({
  args: {
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    changelog: v.string(),
    tags: v.optional(v.array(v.string())),
    forkOf: v.optional(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id('_storage'),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<PublishResult> => {
    const { userId } = await requireUserFromAction(ctx)
    return publishVersionForUser(ctx, userId, args)
  },
})

export const generateChangelogPreview = action({
  args: {
    slug: v.string(),
    version: v.string(),
    readmeText: v.string(),
    filePaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireUserFromAction(ctx)
    const changelog = await buildChangelogPreview(ctx, {
      slug: args.slug.trim().toLowerCase(),
      version: args.version.trim(),
      readmeText: args.readmeText,
      filePaths: args.filePaths?.map((value) => value.trim()).filter(Boolean),
    })
    return { changelog, source: 'auto' as const }
  },
})

export const getReadme: ReturnType<typeof action> = action({
  args: { versionId: v.id('skillVersions') },
  handler: async (ctx, args): Promise<ReadmeResult> => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'skillVersions'> | null
    if (!version) throw new ConvexError('Version not found')
    const readmeFile = version.files.find(
      (file) => file.path.toLowerCase() === 'skill.md' || file.path.toLowerCase() === 'skills.md',
    )
    if (!readmeFile) throw new ConvexError('SKILL.md not found')
    const text = await fetchText(ctx, readmeFile.storageId)
    return { path: readmeFile.path, text }
  },
})

export const getFileText: ReturnType<typeof action> = action({
  args: { versionId: v.id('skillVersions'), path: v.string() },
  handler: async (ctx, args): Promise<FileTextResult> => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'skillVersions'> | null
    if (!version) throw new ConvexError('Version not found')

    const normalizedPath = args.path.trim()
    const normalizedLower = normalizedPath.toLowerCase()
    const file =
      version.files.find((entry) => entry.path === normalizedPath) ??
      version.files.find((entry) => entry.path.toLowerCase() === normalizedLower)
    if (!file) throw new ConvexError('File not found')
    if (file.size > MAX_DIFF_FILE_BYTES) {
      throw new ConvexError('File exceeds 200KB limit')
    }

    const text = await fetchText(ctx, file.storageId)
    return { path: file.path, text, size: file.size, sha256: file.sha256 }
  },
})

export const resolveVersionByHash = query({
  args: { slug: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase()
    const hash = args.hash.trim().toLowerCase()
    if (!slug || !/^[a-f0-9]{64}$/.test(hash)) return null

    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!skill || skill.softDeletedAt) return null

    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null

    const fingerprintMatches = await ctx.db
      .query('skillVersionFingerprints')
      .withIndex('by_skill_fingerprint', (q) => q.eq('skillId', skill._id).eq('fingerprint', hash))
      .take(25)

    let match: { version: string } | null = null
    if (fingerprintMatches.length > 0) {
      const newest = fingerprintMatches.reduce(
        (best, entry) => (entry.createdAt > best.createdAt ? entry : best),
        fingerprintMatches[0] as (typeof fingerprintMatches)[number],
      )
      const version = await ctx.db.get(newest.versionId)
      if (version && !version.softDeletedAt) {
        match = { version: version.version }
      }
    }

    if (!match) {
      const versions = await ctx.db
        .query('skillVersions')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .order('desc')
        .take(200)

      for (const version of versions) {
        if (version.softDeletedAt) continue
        if (typeof version.fingerprint === 'string' && version.fingerprint === hash) {
          match = { version: version.version }
          break
        }

        const fingerprint = await hashSkillFiles(
          version.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
        )
        if (fingerprint === hash) {
          match = { version: version.version }
          break
        }
      }
    }

    return {
      match,
      latestVersion: latestVersion ? { version: latestVersion.version } : null,
    }
  },
})

export const updateTags = mutation({
  args: {
    skillId: v.id('skills'),
    tags: v.array(v.object({ tag: v.string(), versionId: v.id('skillVersions') })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    if (skill.ownerUserId !== user._id) {
      assertModerator(user)
    }

    const nextTags = { ...skill.tags }
    for (const entry of args.tags) {
      nextTags[entry.tag] = entry.versionId
    }

    const latestEntry = args.tags.find((entry) => entry.tag === 'latest')
    await ctx.db.patch(skill._id, {
      tags: nextTags,
      latestVersionId: latestEntry ? latestEntry.versionId : skill.latestVersionId,
      updatedAt: Date.now(),
    })

    if (latestEntry) {
      const embeddings = await ctx.db
        .query('skillEmbeddings')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .collect()
      for (const embedding of embeddings) {
        const isLatest = embedding.versionId === latestEntry.versionId
        await ctx.db.patch(embedding._id, {
          isLatest,
          visibility: visibilityFor(isLatest, embedding.isApproved),
          updatedAt: Date.now(),
        })
      }
    }
  },
})

export const setRedactionApproved = mutation({
  args: { skillId: v.id('skills'), approved: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)

    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.approved) {
      await upsertSkillBadge(ctx, skill._id, 'redactionApproved', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'redactionApproved')
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        isApproved: args.approved,
        visibility: visibilityFor(embedding.isLatest, args.approved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.approved ? 'badge.set' : 'badge.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { badge: 'redactionApproved', approved: args.approved },
      createdAt: now,
    })
  },
})

export const setBatch = mutation({
  args: { skillId: v.id('skills'), batch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    const existingBadges = await getSkillBadgeMap(ctx, skill._id)
    const previousHighlighted = isSkillHighlighted({ badges: existingBadges })
    const nextBatch = args.batch?.trim() || undefined
    const nextHighlighted = nextBatch === 'highlighted'
    const now = Date.now()

    if (nextHighlighted) {
      await upsertSkillBadge(ctx, skill._id, 'highlighted', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'highlighted')
    }

    await ctx.db.patch(skill._id, {
      batch: nextBatch,
      updatedAt: now,
    })
    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'badge.highlighted',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { highlighted: nextHighlighted },
      createdAt: now,
    })

    if (nextHighlighted && !previousHighlighted) {
      void queueHighlightedWebhook(ctx, skill._id)
    }
  },
})

export const setSoftDeleted = mutation({
  args: { skillId: v.id('skills'), deleted: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? 'hidden' : 'active',
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? user._id : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: args.deleted
          ? 'deleted'
          : visibilityFor(embedding.isLatest, embedding.isApproved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.deleted ? 'skill.delete' : 'skill.undelete',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { slug: skill.slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    })
  },
})

export const changeOwner = mutation({
  args: { skillId: v.id('skills'), ownerUserId: v.id('users') },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const nextOwner = await ctx.db.get(args.ownerUserId)
    if (!nextOwner || nextOwner.deletedAt) throw new Error('User not found')

    if (skill.ownerUserId === args.ownerUserId) return

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      ownerUserId: args.ownerUserId,
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        ownerId: args.ownerUserId,
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'skill.owner.change',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { from: skill.ownerUserId, to: args.ownerUserId },
      createdAt: now,
    })
  },
})

export const setDuplicate = mutation({
  args: { skillId: v.id('skills'), canonicalSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    const canonicalSlug = args.canonicalSlug?.trim().toLowerCase()

    if (!canonicalSlug) {
      await ctx.db.patch(skill._id, {
        canonicalSkillId: undefined,
        forkOf: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('auditLogs', {
        actorUserId: user._id,
        action: 'skill.duplicate.clear',
        targetType: 'skill',
        targetId: skill._id,
        metadata: { canonicalSlug: null },
        createdAt: now,
      })
      return
    }

    const canonical = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', canonicalSlug))
      .unique()
    if (!canonical) throw new Error('Canonical skill not found')
    if (canonical._id === skill._id) throw new Error('Cannot duplicate a skill onto itself')

    const canonicalVersion = canonical.latestVersionId
      ? await ctx.db.get(canonical.latestVersionId)
      : null

    await ctx.db.patch(skill._id, {
      canonicalSkillId: canonical._id,
      forkOf: {
        skillId: canonical._id,
        kind: 'duplicate',
        version: canonicalVersion?.version,
        at: now,
      },
      lastReviewedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'skill.duplicate.set',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { canonicalSlug },
      createdAt: now,
    })
  },
})

export const setOfficialBadge = mutation({
  args: { skillId: v.id('skills'), official: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.official) {
      await upsertSkillBadge(ctx, skill._id, 'official', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'official')
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.official ? 'badge.official.set' : 'badge.official.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { official: args.official },
      createdAt: now,
    })
  },
})

export const setDeprecatedBadge = mutation({
  args: { skillId: v.id('skills'), deprecated: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.deprecated) {
      await upsertSkillBadge(ctx, skill._id, 'deprecated', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'deprecated')
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.deprecated ? 'badge.deprecated.set' : 'badge.deprecated.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { deprecated: args.deprecated },
      createdAt: now,
    })
  },
})

export const hardDelete = mutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    await hardDeleteSkill(ctx, skill, user._id)
  },
})

export const hardDeleteInternal = internalMutation({
  args: { skillId: v.id('skills'), actorUserId: v.id('users') },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt) throw new Error('User not found')
    assertAdmin(actor)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    await hardDeleteSkill(ctx, skill, actor._id)
  },
})

export const insertVersion = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    changelog: v.string(),
    changelogSource: v.optional(v.union(v.literal('auto'), v.literal('user'))),
    tags: v.optional(v.array(v.string())),
    fingerprint: v.string(),
    forkOf: v.optional(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id('_storage'),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    parsed: v.object({
      frontmatter: v.record(v.string(), v.any()),
      metadata: v.optional(v.any()),
      clawdis: v.optional(v.any()),
    }),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = args.userId
    const user = await ctx.db.get(userId)
    if (!user || user.deletedAt) throw new Error('User not found')

    let skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()

    if (skill && skill.ownerUserId !== userId) {
      throw new Error('Only the owner can publish updates')
    }

    const now = Date.now()
    if (!skill) {
      const forkOfSlug = args.forkOf?.slug.trim().toLowerCase() || ''
      const forkOfVersion = args.forkOf?.version?.trim() || undefined

      let canonicalSkillId: Id<'skills'> | undefined
      let forkOf:
        | {
            skillId: Id<'skills'>
            kind: 'fork' | 'duplicate'
            version?: string
            at: number
          }
        | undefined

      if (forkOfSlug) {
        const upstream = await ctx.db
          .query('skills')
          .withIndex('by_slug', (q) => q.eq('slug', forkOfSlug))
          .unique()
        if (!upstream || upstream.softDeletedAt) throw new Error('Upstream skill not found')
        canonicalSkillId = upstream.canonicalSkillId ?? upstream._id
        forkOf = {
          skillId: upstream._id,
          kind: 'fork',
          version: forkOfVersion,
          at: now,
        }
      } else {
        const match = await findCanonicalSkillForFingerprint(ctx, args.fingerprint)
        if (match) {
          canonicalSkillId = match.canonicalSkillId ?? match._id
          forkOf = {
            skillId: match._id,
            kind: 'duplicate',
            at: now,
          }
        }
      }

      const summary = getFrontmatterValue(args.parsed.frontmatter, 'description')
      const summaryValue = summary ?? undefined
      const moderationFlags = deriveModerationFlags({
        skill: { slug: args.slug, displayName: args.displayName, summary: summaryValue },
        parsed: args.parsed,
        files: args.files,
      })
      const skillId = await ctx.db.insert('skills', {
        slug: args.slug,
        displayName: args.displayName,
        summary: summaryValue,
        ownerUserId: userId,
        canonicalSkillId,
        forkOf,
        latestVersionId: undefined,
        tags: {},
        softDeletedAt: undefined,
        badges: {
          redactionApproved: undefined,
          highlighted: undefined,
          official: undefined,
          deprecated: undefined,
        },
        moderationStatus: 'active',
        moderationFlags: moderationFlags.length ? moderationFlags : undefined,
        reportCount: 0,
        lastReportedAt: undefined,
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        stats: {
          downloads: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          stars: 0,
          versions: 0,
          comments: 0,
        },
        createdAt: now,
        updatedAt: now,
      })
      skill = await ctx.db.get(skillId)
    }

    if (!skill) throw new Error('Skill creation failed')

    const existingVersion = await ctx.db
      .query('skillVersions')
      .withIndex('by_skill_version', (q) => q.eq('skillId', skill._id).eq('version', args.version))
      .unique()
    if (existingVersion) {
      throw new Error('Version already exists')
    }

    const versionId = await ctx.db.insert('skillVersions', {
      skillId: skill._id,
      version: args.version,
      fingerprint: args.fingerprint,
      changelog: args.changelog,
      changelogSource: args.changelogSource,
      files: args.files,
      parsed: args.parsed,
      createdBy: userId,
      createdAt: now,
      softDeletedAt: undefined,
    })

    const nextTags: Record<string, Id<'skillVersions'>> = { ...skill.tags }
    nextTags.latest = versionId
    for (const tag of args.tags ?? []) {
      nextTags[tag] = versionId
    }

    const latestBefore = skill.latestVersionId

    const nextSummary = getFrontmatterValue(args.parsed.frontmatter, 'description') ?? skill.summary
    const moderationFlags = deriveModerationFlags({
      skill: { slug: skill.slug, displayName: args.displayName, summary: nextSummary ?? undefined },
      parsed: args.parsed,
      files: args.files,
    })

    await ctx.db.patch(skill._id, {
      displayName: args.displayName,
      summary: nextSummary ?? undefined,
      latestVersionId: versionId,
      tags: nextTags,
      stats: { ...skill.stats, versions: skill.stats.versions + 1 },
      softDeletedAt: undefined,
      moderationStatus: skill.moderationStatus ?? 'active',
      moderationFlags: moderationFlags.length ? moderationFlags : undefined,
      updatedAt: now,
    })

    const badgeMap = await getSkillBadgeMap(ctx, skill._id)
    const isApproved = Boolean(badgeMap.redactionApproved)

    const embeddingId = await ctx.db.insert('skillEmbeddings', {
      skillId: skill._id,
      versionId,
      ownerId: userId,
      embedding: args.embedding,
      isLatest: true,
      isApproved,
      visibility: visibilityFor(true, isApproved),
      updatedAt: now,
    })

    if (latestBefore) {
      const previousEmbedding = await ctx.db
        .query('skillEmbeddings')
        .withIndex('by_version', (q) => q.eq('versionId', latestBefore))
        .unique()
      if (previousEmbedding) {
        await ctx.db.patch(previousEmbedding._id, {
          isLatest: false,
          visibility: visibilityFor(false, previousEmbedding.isApproved),
          updatedAt: now,
        })
      }
    }

    await ctx.db.insert('skillVersionFingerprints', {
      skillId: skill._id,
      versionId,
      fingerprint: args.fingerprint,
      createdAt: now,
    })

    return { skillId: skill._id, versionId, embeddingId }
  },
})

export const setSkillSoftDeletedInternal = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    deleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user || user.deletedAt) throw new Error('User not found')

    const slug = args.slug.trim().toLowerCase()
    if (!slug) throw new Error('Slug required')

    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!skill) throw new Error('Skill not found')

    if (skill.ownerUserId !== args.userId) {
      assertModerator(user)
    }

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? 'hidden' : 'active',
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? args.userId : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: args.deleted
          ? 'deleted'
          : visibilityFor(embedding.isLatest, embedding.isApproved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: args.userId,
      action: args.deleted ? 'skill.delete' : 'skill.undelete',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    })

    return { ok: true as const }
  },
})

function visibilityFor(isLatest: boolean, isApproved: boolean) {
  if (isLatest && isApproved) return 'latest-approved'
  if (isLatest) return 'latest'
  if (isApproved) return 'archived-approved'
  return 'archived'
}

function clampInt(value: number, min: number, max: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : min
  return Math.min(max, Math.max(min, rounded))
}

async function findCanonicalSkillForFingerprint(
  ctx: { db: MutationCtx['db'] },
  fingerprint: string,
) {
  const matches = await ctx.db
    .query('skillVersionFingerprints')
    .withIndex('by_fingerprint', (q) => q.eq('fingerprint', fingerprint))
    .take(25)

  for (const entry of matches) {
    const skill = await ctx.db.get(entry.skillId)
    if (!skill || skill.softDeletedAt) continue
    return skill
  }

  return null
}
