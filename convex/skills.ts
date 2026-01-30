import { getAuthUserId } from '@convex-dev/auth/server'
import { paginationOptsValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { paginator } from 'convex-helpers/server/pagination'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAdmin, assertModerator, requireUser, requireUserFromAction } from './lib/access'
import { getResourceBadgeMap, getResourceBadgeMaps, isResourceHighlighted } from './lib/badges'
import { generateChangelogPreview as buildChangelogPreview } from './lib/changelog'
import { buildTrendingLeaderboard } from './lib/leaderboards'
import { deriveModerationFlags, isSkillPublic } from './lib/moderation'
import { toPublicSkill, toPublicUser } from './lib/public'
import { upsertResourceForSkill } from './lib/resource'
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
const AUTH_BYPASS = process.env.AUTH_BYPASS === 'true'

async function resolveOwnerHandle(ctx: QueryCtx, ownerUserId: Id<'users'>) {
  const owner = await ctx.db.get(ownerUserId)
  return owner?.handle ?? owner?._id ?? null
}

async function resolveSkillResourceId(ctx: MutationCtx, skill: Doc<'skills'>) {
  if (skill.resourceId) return skill.resourceId
  return upsertResourceForSkill(ctx, skill)
}

type BadgeContext = Pick<QueryCtx, 'db'>

async function getBadgesForSkill(ctx: BadgeContext, skill: Doc<'skills'>) {
  if (!skill.resourceId) return {}
  return getResourceBadgeMap(ctx, skill.resourceId)
}

async function getBadgeMapBySkillId(ctx: BadgeContext, skills: Doc<'skills'>[]) {
  const resourceIds = skills
    .map((skill) => skill.resourceId)
    .filter((resourceId): resourceId is Id<'resources'> => Boolean(resourceId))
  const badgeMapByResourceId = await getResourceBadgeMaps(ctx, resourceIds)
  return new Map(
    skills.map((skill) => [
      skill._id,
      skill.resourceId ? (badgeMapByResourceId.get(skill.resourceId) ?? {}) : {},
    ]),
  )
}

async function upsertSkillModeration(
  ctx: MutationCtx,
  skillId: Id<'skills'>,
  patch: Partial<
    Pick<Doc<'skillModeration'>, 'notes' | 'reason' | 'reviewedAt' | 'hiddenAt' | 'hiddenBy'>
  >,
) {
  const existing = await ctx.db
    .query('skillModeration')
    .withIndex('by_skill', (q) => q.eq('skillId', skillId))
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, patch)
    return
  }
  await ctx.db.insert('skillModeration', { skillId, ...patch })
}

async function upsertSkillReportStats(ctx: MutationCtx, skillId: Id<'skills'>, now: number) {
  const existing = await ctx.db
    .query('skillReportStats')
    .withIndex('by_skill', (q) => q.eq('skillId', skillId))
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, {
      reportCount: existing.reportCount + 1,
      lastReportedAt: now,
    })
    return
  }
  await ctx.db.insert('skillReportStats', {
    skillId,
    reportCount: 1,
    lastReportedAt: now,
  })
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

type ReportedSkillEntry = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | null
  reportStats: Doc<'skillReportStats'>
}

type BadgeKind = Doc<'resourceBadges'>['kind']

function mergeResourceIntoSkill(skill: Doc<'skills'>, resource: Doc<'resources'>) {
  return {
    ...skill,
    slug: resource.slug,
    displayName: resource.displayName,
    summary: resource.summary,
    ownerUserId: resource.ownerUserId,
    softDeletedAt: resource.softDeletedAt,
    statsDownloads: resource.statsDownloads,
    statsStars: resource.statsStars,
    statsInstallsCurrent: resource.statsInstallsCurrent,
    statsInstallsAllTime: resource.statsInstallsAllTime,
    stats: resource.stats,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  }
}

async function buildPublicSkillEntriesFromSkillResources(
  ctx: QueryCtx,
  entries: Array<{ skill: Doc<'skills'>; resource: Doc<'resources'> }>,
) {
  const ownerHandleCache = new Map<Id<'users'>, Promise<string | null>>()
  const badgeMapByResourceId = await getResourceBadgeMaps(
    ctx,
    entries.map((entry) => entry.resource._id),
  )

  const getOwnerHandle = (ownerUserId: Id<'users'>) => {
    const cached = ownerHandleCache.get(ownerUserId)
    if (cached) return cached
    const handlePromise = resolveOwnerHandle(ctx, ownerUserId)
    ownerHandleCache.set(ownerUserId, handlePromise)
    return handlePromise
  }

  const hydrated = await Promise.all(
    entries.map(async (entry) => {
      if (!isSkillPublic(entry.skill)) return null
      const mergedSkill = mergeResourceIntoSkill(entry.skill, entry.resource)
      const [latestVersion, ownerHandle] = await Promise.all([
        entry.skill.latestVersionId ? ctx.db.get(entry.skill.latestVersionId) : null,
        entry.resource.ownerHandle
          ? Promise.resolve(entry.resource.ownerHandle ?? null)
          : getOwnerHandle(entry.resource.ownerUserId),
      ])
      const badges = badgeMapByResourceId.get(entry.resource._id) ?? {}
      const publicSkill = toPublicSkill({ ...mergedSkill, badges })
      if (!publicSkill) return null
      return { skill: publicSkill, latestVersion, ownerHandle }
    }),
  )

  return hydrated.filter((entry): entry is PublicSkillEntry => entry !== null)
}

async function buildPublicSkillEntriesFromResources(ctx: QueryCtx, resources: Doc<'resources'>[]) {
  const skillEntries = await Promise.all(
    resources.map(async (resource) => {
      const skill = await ctx.db
        .query('skills')
        .withIndex('by_resource', (q) => q.eq('resourceId', resource._id))
        .unique()
      if (!skill || skill.softDeletedAt || resource.softDeletedAt || !isSkillPublic(skill))
        return null
      return { skill, resource }
    }),
  )

  const validEntries = skillEntries.filter(
    (entry): entry is { skill: Doc<'skills'>; resource: Doc<'resources'> } => Boolean(entry),
  )

  return buildPublicSkillEntriesFromSkillResources(ctx, validEntries)
}

async function buildManagementSkillEntries(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const ownerCache = new Map<Id<'users'>, Promise<Doc<'users'> | null>>()
  const badgeMapBySkillId = await getBadgeMapBySkillId(ctx, skills)

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
  const badgeMapBySkillId = await getBadgeMapBySkillId(ctx, skills)
  return skills.map((skill) => ({
    ...skill,
    badges: badgeMapBySkillId.get(skill._id) ?? {},
  }))
}

async function loadHighlightedSkills(ctx: QueryCtx, limit: number) {
  const entries = await ctx.db
    .query('resourceBadges')
    .withIndex('by_kind_at', (q) => q.eq('kind', 'highlighted'))
    .order('desc')
    .take(MAX_LIST_TAKE)

  const skills: Doc<'skills'>[] = []
  for (const badge of entries) {
    const resource = await ctx.db.get(badge.resourceId)
    if (!resource || resource.softDeletedAt || resource.type !== 'skill') continue
    const skill = await ctx.db
      .query('skills')
      .withIndex('by_resource', (q) => q.eq('resourceId', resource._id))
      .unique()
    if (!skill || skill.softDeletedAt || !isSkillPublic(skill)) continue
    skills.push(skill)
    if (skills.length >= limit) break
  }

  return skills
}

async function upsertSkillBadge(
  ctx: MutationCtx,
  skill: Doc<'skills'>,
  kind: BadgeKind,
  userId: Id<'users'>,
  at: number,
) {
  const resourceId = await resolveSkillResourceId(ctx, skill)
  const existing = await ctx.db
    .query('resourceBadges')
    .withIndex('by_resource_kind', (q) => q.eq('resourceId', resourceId).eq('kind', kind))
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, { byUserId: userId, at })
    return existing._id
  }
  return ctx.db.insert('resourceBadges', {
    resourceId,
    kind,
    byUserId: userId,
    at,
  })
}

async function removeSkillBadge(ctx: MutationCtx, skill: Doc<'skills'>, kind: BadgeKind) {
  const resourceId = skill.resourceId
  if (!resourceId) return
  const existing = await ctx.db
    .query('resourceBadges')
    .withIndex('by_resource_kind', (q) => q.eq('resourceId', resourceId).eq('kind', kind))
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
    if (!skill) return null
    if (skill.softDeletedAt) {
      if (!AUTH_BYPASS) {
        const userId = await getAuthUserId(ctx)
        if (!userId) return null
        const user = await ctx.db.get(userId)
        if (!user || (user.role !== 'admin' && user.role !== 'moderator')) return null
      }
    }
    if (!isSkillPublic(skill)) return null
    const [latestVersion, owner, resource, badges] = await Promise.all([
      skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
      ctx.db.get(skill.ownerUserId),
      skill.resourceId ? ctx.db.get(skill.resourceId) : null,
      getBadgesForSkill(ctx, skill),
    ])

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null
    const forkOfOwner = forkOfSkill ? await ctx.db.get(forkOfSkill.ownerUserId) : null

    const mergedSkill = resource ? mergeResourceIntoSkill(skill, resource) : skill
    const publicSkill = toPublicSkill({ ...mergedSkill, badges })
    if (!publicSkill) return null

    return {
      skill: publicSkill,
      latestVersion,
      owner: toPublicUser(owner),
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
      const filtered = entries
        .filter((skill) => !skill.softDeletedAt && isSkillPublic(skill))
        .slice(0, limit)
      const withBadges = await attachBadgesToSkills(ctx, filtered)
      return withBadges
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    }
    const ownerUserId = args.ownerUserId
    if (ownerUserId) {
      const resources = await ctx.db
        .query('resources')
        .withIndex('by_type_owner_updated', (q) =>
          q.eq('type', 'skill').eq('ownerUserId', ownerUserId),
        )
        .order('desc')
        .take(takeLimit)
      const entries = await buildPublicSkillEntriesFromResources(ctx, resources)
      return entries.map((entry) => entry.skill).slice(0, limit)
    }
    const resources = await ctx.db
      .query('resources')
      .withIndex('by_type_updated', (q) => q.eq('type', 'skill'))
      .order('desc')
      .take(takeLimit)
    const entries = await buildPublicSkillEntriesFromResources(ctx, resources)
    return entries.map((entry) => entry.skill).slice(0, limit)
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
      const resources = await ctx.db
        .query('resources')
        .withIndex('by_type_owner_updated', (q) =>
          q.eq('type', 'skill').eq('ownerUserId', ownerUserId),
        )
        .order('desc')
        .take(takeLimit)
      return buildPublicSkillEntriesFromResources(ctx, resources)
    } else {
      const resources = await ctx.db
        .query('resources')
        .withIndex('by_type_updated', (q) => q.eq('type', 'skill'))
        .order('desc')
        .take(takeLimit)
      return buildPublicSkillEntriesFromResources(ctx, resources)
    }

    const filtered = entries.filter((skill) => !skill.softDeletedAt && isSkillPublic(skill))
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

    const reportStats = await ctx.db
      .query('skillReportStats')
      .withIndex('by_last_reported', (q) => q)
      .order('desc')
      .take(takeLimit)

    const results: ReportedSkillEntry[] = []
    for (const stats of reportStats) {
      if (stats.reportCount <= 0) continue
      const skill = await ctx.db.get(stats.skillId)
      if (!skill || skill.softDeletedAt) continue
      const [latestVersion, owner] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        ctx.db.get(skill.ownerUserId),
      ])
      results.push({ skill, latestVersion, owner, reportStats: stats })
      if (results.length >= limit) break
    }

    return results
  },
})

export const getLatestSkillEmbeddingInternal = internalQuery({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .collect()
    return embeddings.find((entry) => entry.isLatest) ?? embeddings[0] ?? null
  },
})

export const findSimilarSkills = action({
  args: { skillId: v.id('skills'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 8, 1, 25)

    const sourceEmbedding = (await ctx.runQuery(internal.skills.getLatestSkillEmbeddingInternal, {
      skillId: args.skillId,
    })) as Doc<'skillEmbeddings'> | null

    if (!sourceEmbedding) return []

    const results = await ctx.vectorSearch('skillEmbeddings', 'by_embedding', {
      vector: sourceEmbedding.embedding,
      limit: Math.min(limit * 4, 50),
      filter: (q) => q.or(q.eq('visibility', 'latest'), q.eq('visibility', 'latest-approved')),
    })

    const filtered = results.filter((result) => result._id !== sourceEmbedding._id)
    if (filtered.length === 0) return []

    const hydrated = (await ctx.runQuery(internal.search.hydrateResults, {
      embeddingIds: filtered.map((result) => result._id),
    })) as Array<{
      embeddingId: Id<'skillEmbeddings'>
      skill: NonNullable<ReturnType<typeof toPublicSkill>>
      version: Doc<'skillVersions'> | null
      ownerHandle: string | null
      resourceId: Id<'resources'> | null
    }>

    const scoreById = new Map(filtered.map((result) => [result._id, result._score]))

    const entries = hydrated
      .filter((entry) => entry.skill._id !== args.skillId)
      .map((entry) => ({
        skill: entry.skill,
        latestVersion: entry.version,
        ownerHandle: entry.ownerHandle,
        score: scoreById.get(entry.embeddingId) ?? 0,
      }))

    return entries.slice(0, limit)
  },
})

async function createSkillReport(
  ctx: MutationCtx,
  args: { skillId: Id<'skills'>; userId: Id<'users'>; reason?: string },
) {
  const skill = await ctx.db.get(args.skillId)
  if (!skill || skill.softDeletedAt) throw new Error('Skill not found')

  const existing = await ctx.db
    .query('skillReports')
    .withIndex('by_skill_user', (q) => q.eq('skillId', args.skillId).eq('userId', args.userId))
    .unique()
  if (existing) return { ok: true as const, reported: false, alreadyReported: true }

  const now = Date.now()
  const reason = args.reason?.trim()
  await ctx.db.insert('skillReports', {
    skillId: args.skillId,
    userId: args.userId,
    reason: reason ? reason.slice(0, 500) : undefined,
    createdAt: now,
  })

  await upsertSkillReportStats(ctx, skill._id, now)
  await ctx.db.patch(skill._id, { updatedAt: now })
  await upsertResourceForSkill(ctx, skill, { updatedAt: now })

  return { ok: true as const, reported: true, alreadyReported: false }
}

export const report = mutation({
  args: { skillId: v.id('skills'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    return createSkillReport(ctx, { ...args, userId })
  },
})

export const reportInternal = internalMutation({
  args: { skillId: v.id('skills'), userId: v.id('users'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return createSkillReport(ctx, args)
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
        .query('resources')
        .withIndex('by_type_active_updated', (q) =>
          q.eq('type', 'skill').eq('softDeletedAt', undefined),
        )
        .order('desc')
        .paginate({ cursor: args.cursor ?? null, numItems: limit })

      const items = await buildPublicSkillEntriesFromResources(ctx, page)

      return { items, nextCursor: isDone ? null : continueCursor }
    }

    if (sort === 'trending') {
      const entries = await getTrendingEntries(ctx, limit)
      const pairs: Array<{ skill: Doc<'skills'>; resource: Doc<'resources'> }> = []

      for (const entry of entries) {
        const skill = await ctx.db.get(entry.skillId)
        if (!skill || skill.softDeletedAt || !skill.resourceId) continue
        const resource = await ctx.db.get(skill.resourceId)
        if (!resource || resource.softDeletedAt) continue
        pairs.push({ skill, resource })
        if (pairs.length >= limit) break
      }

      const items = await buildPublicSkillEntriesFromSkillResources(ctx, pairs)
      return { items, nextCursor: null }
    }

    const index = sortToResourceIndex(sort)
    const page = await ctx.db
      .query('resources')
      .withIndex(index, (q) => q.eq('type', 'skill').eq('softDeletedAt', undefined))
      .order('desc')
      .take(Math.min(limit, MAX_LIST_TAKE))

    const items = await buildPublicSkillEntriesFromResources(ctx, page)
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
  },
  handler: async (ctx, args) => {
    // Use the new index to filter out soft-deleted skills at query time.
    // softDeletedAt === undefined means active (non-deleted) skills only.
    const result = await paginator(ctx.db, schema)
      .query('resources')
      .withIndex('by_type_active_updated', (q) =>
        q.eq('type', 'skill').eq('softDeletedAt', undefined),
      )
      .order('desc')
      .paginate(args.paginationOpts)

    // Build the public skill entries (fetch latestVersion + ownerHandle)
    const items = await buildPublicSkillEntriesFromResources(ctx, result.page)

    return {
      ...result,
      page: items,
    }
  },
})

function sortToResourceIndex(
  sort: 'downloads' | 'stars' | 'installsCurrent' | 'installsAllTime',
):
  | 'by_type_active_stats_downloads'
  | 'by_type_active_stats_stars'
  | 'by_type_active_stats_installs_current'
  | 'by_type_active_stats_installs_all_time' {
  switch (sort) {
    case 'downloads':
      return 'by_type_active_stats_downloads'
    case 'stars':
      return 'by_type_active_stats_stars'
    case 'installsCurrent':
      return 'by_type_active_stats_installs_current'
    case 'installsAllTime':
      return 'by_type_active_stats_installs_all_time'
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
    const now = Date.now()
    await ctx.db.patch(skill._id, {
      tags: nextTags,
      latestVersionId: latestEntry ? latestEntry.versionId : skill.latestVersionId,
      updatedAt: now,
    })
    await upsertResourceForSkill(ctx, skill, { updatedAt: now })

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
      await upsertSkillBadge(ctx, skill, 'redactionApproved', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill, 'redactionApproved')
    }

    await ctx.db.patch(skill._id, { updatedAt: now })
    await upsertResourceForSkill(ctx, skill, { updatedAt: now })
    await upsertSkillModeration(ctx, skill._id, { reviewedAt: now })

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
    const existingBadges = await getBadgesForSkill(ctx, skill)
    const previousHighlighted = isResourceHighlighted({ badges: existingBadges })
    const nextBatch = args.batch?.trim() || undefined
    const nextHighlighted = nextBatch === 'highlighted'
    const now = Date.now()

    if (nextHighlighted) {
      await upsertSkillBadge(ctx, skill, 'highlighted', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill, 'highlighted')
    }

    await ctx.db.patch(skill._id, {
      batch: nextBatch,
      updatedAt: now,
    })
    await upsertResourceForSkill(ctx, skill, { updatedAt: now })
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
      updatedAt: now,
    })
    await upsertResourceForSkill(ctx, skill, {
      softDeletedAt: args.deleted ? now : undefined,
      updatedAt: now,
    })
    await upsertSkillModeration(ctx, skill._id, {
      reviewedAt: now,
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? user._id : undefined,
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

    if (args.deleted) {
      const [resource, owner] = await Promise.all([
        skill.resourceId ? ctx.db.get(skill.resourceId) : null,
        ctx.db.get(skill.ownerUserId),
      ])
      const ownerHandles = [
        resource?.ownerHandle,
        owner?.handle,
        owner?.displayName,
        owner?.name,
        owner?._id,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => String(value))
      if (ownerHandles.length > 0) {
        void ctx.scheduler.runAfter(0, internal.githubBackupsNode.deleteSkillBackupInternal, {
          slug: skill.slug,
          ownerHandles,
        })
      }
    }
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
      updatedAt: now,
    })
    await upsertResourceForSkill(ctx, skill, { ownerUserId: args.ownerUserId, updatedAt: now })
    await upsertSkillModeration(ctx, skill._id, { reviewedAt: now })

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

export const setOfficialBadge = mutation({
  args: { skillId: v.id('skills'), official: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.official) {
      await upsertSkillBadge(ctx, skill, 'official', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill, 'official')
    }

    await ctx.db.patch(skill._id, { updatedAt: now })
    await upsertResourceForSkill(ctx, skill, { updatedAt: now })
    await upsertSkillModeration(ctx, skill._id, { reviewedAt: now })

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
      await upsertSkillBadge(ctx, skill, 'deprecated', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill, 'deprecated')
    }

    await ctx.db.patch(skill._id, { updatedAt: now })
    await upsertResourceForSkill(ctx, skill, { updatedAt: now })
    await upsertSkillModeration(ctx, skill._id, { reviewedAt: now })

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

    const resourceId = skill.resourceId
    if (resourceId) {
      const badges = await ctx.db
        .query('resourceBadges')
        .withIndex('by_resource', (q) => q.eq('resourceId', resourceId))
        .collect()
      for (const badge of badges) {
        await ctx.db.delete(badge._id)
      }
    }

    const moderation = await ctx.db
      .query('skillModeration')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const entry of moderation) {
      await ctx.db.delete(entry._id)
    }

    const reportStats = await ctx.db
      .query('skillReportStats')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const entry of reportStats) {
      await ctx.db.delete(entry._id)
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
    for (const related of relatedSkills) {
      if (related._id === skill._id) continue
      if (related.forkOf?.skillId === skill._id) {
        await ctx.db.patch(related._id, {
          forkOf: undefined,
          updatedAt: Date.now(),
        })
      }
    }

    await ctx.db.delete(skill._id)
    if (skill.resourceId) {
      await ctx.db.delete(skill.resourceId)
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'skill.hard_delete',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { slug: skill.slug },
      createdAt: Date.now(),
    })
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

      let forkOf:
        | {
            skillId: Id<'skills'>
            kind: 'fork'
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
        forkOf = {
          skillId: upstream._id,
          kind: 'fork',
          version: forkOfVersion,
          at: now,
        }
      }

      const summary = getFrontmatterValue(args.parsed.frontmatter, 'description')
      const summaryValue = summary ?? undefined
      const moderationFlags = deriveModerationFlags({
        skill: { slug: args.slug, displayName: args.displayName, summary: summaryValue },
        parsed: args.parsed,
        files: args.files,
      })
      const resourceId = await ctx.db.insert('resources', {
        type: 'skill',
        slug: args.slug,
        displayName: args.displayName,
        summary: summaryValue,
        ownerUserId: userId,
        ownerHandle: user.handle ?? user._id,
        softDeletedAt: undefined,
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
      const skillId = await ctx.db.insert('skills', {
        resourceId,
        slug: args.slug,
        displayName: args.displayName,
        summary: summaryValue,
        ownerUserId: userId,
        forkOf,
        latestVersionId: undefined,
        tags: {},
        softDeletedAt: undefined,
        moderationStatus: 'active',
        moderationFlags: moderationFlags.length ? moderationFlags : undefined,
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

    const nextStats = { ...skill.stats, versions: skill.stats.versions + 1 }
    await ctx.db.patch(skill._id, {
      displayName: args.displayName,
      summary: nextSummary ?? undefined,
      latestVersionId: versionId,
      tags: nextTags,
      stats: nextStats,
      softDeletedAt: undefined,
      moderationStatus: skill.moderationStatus ?? 'active',
      moderationFlags: moderationFlags.length ? moderationFlags : undefined,
      updatedAt: now,
    })
    await upsertResourceForSkill(ctx, skill, {
      displayName: args.displayName,
      summary: nextSummary ?? undefined,
      softDeletedAt: undefined,
      stats: nextStats,
      statsDownloads: skill.statsDownloads,
      statsStars: skill.statsStars,
      statsInstallsCurrent: skill.statsInstallsCurrent,
      statsInstallsAllTime: skill.statsInstallsAllTime,
      updatedAt: now,
    })

    const badgeMap = await getBadgesForSkill(ctx, skill)
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
      updatedAt: now,
    })
    await upsertResourceForSkill(ctx, skill, {
      softDeletedAt: args.deleted ? now : undefined,
      updatedAt: now,
    })
    await upsertSkillModeration(ctx, skill._id, {
      reviewedAt: now,
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? args.userId : undefined,
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

    if (args.deleted) {
      const [resource, owner] = await Promise.all([
        skill.resourceId ? ctx.db.get(skill.resourceId) : null,
        ctx.db.get(skill.ownerUserId),
      ])
      const ownerHandles = [
        resource?.ownerHandle,
        owner?.handle,
        owner?.displayName,
        owner?.name,
        owner?._id,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => String(value))
      if (ownerHandles.length > 0) {
        void ctx.scheduler.runAfter(0, internal.githubBackupsNode.deleteSkillBackupInternal, {
          slug: skill.slug,
          ownerHandles,
        })
      }
    }

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
