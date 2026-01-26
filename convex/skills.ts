import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertRole, requireUser, requireUserFromAction } from './lib/access'
import { generateChangelogPreview as buildChangelogPreview } from './lib/changelog'
import { buildTrendingLeaderboard, getTrendingRange } from './lib/leaderboards'
import {
  fetchText,
  type PublishResult,
  publishVersionForUser,
  queueHighlightedWebhook,
} from './lib/skillPublish'
import { getFrontmatterValue, hashSkillFiles } from './lib/skills'

export { publishVersionForUser } from './lib/skillPublish'

type ReadmeResult = { path: string; text: string }
type FileTextResult = { path: string; text: string; size: number; sha256: string }

const MAX_DIFF_FILE_BYTES = 200 * 1024
const MAX_LIST_LIMIT = 50
const MAX_PUBLIC_LIST_LIMIT = 200
const MAX_LIST_BULK_LIMIT = 200
const MAX_LIST_TAKE = 1000

async function resolveOwnerHandle(ctx: QueryCtx, ownerUserId: Id<'users'>) {
  const owner = await ctx.db.get(ownerUserId)
  return owner?.handle ?? owner?._id ?? null
}

type PublicSkillEntry = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  ownerHandle: string | null
}

async function buildPublicSkillEntries(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const ownerHandleCache = new Map<Id<'users'>, Promise<string | null>>()

  const getOwnerHandle = (ownerUserId: Id<'users'>) => {
    const cached = ownerHandleCache.get(ownerUserId)
    if (cached) return cached
    const handlePromise = resolveOwnerHandle(ctx, ownerUserId)
    ownerHandleCache.set(ownerUserId, handlePromise)
    return handlePromise
  }

  return Promise.all(
    skills.map(async (skill) => {
      const [latestVersion, ownerHandle] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        getOwnerHandle(skill.ownerUserId),
      ])
      return { skill, latestVersion, ownerHandle }
    }),
  ) satisfies Promise<PublicSkillEntry[]>
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
    const owner = await ctx.db.get(skill.ownerUserId)

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null
    const forkOfOwner = forkOfSkill ? await ctx.db.get(forkOfSkill.ownerUserId) : null

    const canonicalSkill = skill.canonicalSkillId ? await ctx.db.get(skill.canonicalSkillId) : null
    const canonicalOwner = canonicalSkill ? await ctx.db.get(canonicalSkill.ownerUserId) : null

    return {
      skill,
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
      const entries = await ctx.db
        .query('skills')
        .withIndex('by_batch', (q) => q.eq('batch', args.batch))
        .order('desc')
        .take(takeLimit)
      return entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
    }
    const ownerUserId = args.ownerUserId
    if (ownerUserId) {
      const entries = await ctx.db
        .query('skills')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(takeLimit)
      return entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
    }
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    return entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
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
      entries = await ctx.db
        .query('skills')
        .withIndex('by_batch', (q) => q.eq('batch', args.batch))
        .order('desc')
        .take(takeLimit)
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

    const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
    const items = await Promise.all(
      filtered.map(async (skill) => ({
        skill,
        latestVersion: skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null,
      })),
    )
    return items
  },
})

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
  const now = Date.now()
  const { startDay, endDay } = getTrendingRange(now)
  const latest = await ctx.db
    .query('skillLeaderboards')
    .withIndex('by_kind', (q) => q.eq('kind', 'trending'))
    .order('desc')
    .take(1)

  const leaderboard = latest[0]
  if (leaderboard && leaderboard.rangeStartDay === startDay && leaderboard.rangeEndDay === endDay) {
    return leaderboard.items.slice(0, limit)
  }

  const fallback = await buildTrendingLeaderboard(ctx, { limit, now })
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
      assertRole(user, ['admin', 'moderator'])
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
    assertRole(user, ['admin', 'moderator'])

    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const badge = args.approved ? { byUserId: user._id, at: Date.now() } : undefined

    await ctx.db.patch(skill._id, {
      badges: { ...skill.badges, redactionApproved: badge },
      updatedAt: Date.now(),
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        isApproved: Boolean(badge),
        visibility: visibilityFor(embedding.isLatest, Boolean(badge)),
        updatedAt: Date.now(),
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.approved ? 'badge.set' : 'badge.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { badge: 'redactionApproved', approved: args.approved },
      createdAt: Date.now(),
    })
  },
})

export const setBatch = mutation({
  args: { skillId: v.id('skills'), batch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertRole(user, ['admin', 'moderator'])
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    const previousBatch = skill.batch ?? undefined
    const nextBatch = args.batch?.trim() || undefined
    await ctx.db.patch(skill._id, {
      batch: nextBatch,
      updatedAt: Date.now(),
    })
    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'batch.set',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { batch: args.batch?.trim() ?? null },
      createdAt: Date.now(),
    })

    if (nextBatch === 'highlighted' && previousBatch !== 'highlighted') {
      void queueHighlightedWebhook(ctx, skill._id)
    }
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
      const repoUrl =
        getFrontmatterValue(args.parsed.frontmatter, 'homepage') ??
        getFrontmatterValue(args.parsed.frontmatter, 'repository') ??
        getFrontmatterValue(args.parsed.frontmatter, 'repo')
      const skillId = await ctx.db.insert('skills', {
        slug: args.slug,
        displayName: args.displayName,
        summary: summary ?? undefined,
        repoUrl: repoUrl ?? undefined,
        ownerUserId: userId,
        canonicalSkillId,
        forkOf,
        latestVersionId: undefined,
        tags: {},
        softDeletedAt: undefined,
        badges: { redactionApproved: undefined },
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

    const updatedRepoUrl =
      getFrontmatterValue(args.parsed.frontmatter, 'homepage') ??
      getFrontmatterValue(args.parsed.frontmatter, 'repository') ??
      getFrontmatterValue(args.parsed.frontmatter, 'repo') ??
      skill.repoUrl

    await ctx.db.patch(skill._id, {
      displayName: args.displayName,
      summary: getFrontmatterValue(args.parsed.frontmatter, 'description') ?? skill.summary,
      repoUrl: updatedRepoUrl,
      latestVersionId: versionId,
      tags: nextTags,
      stats: { ...skill.stats, versions: skill.stats.versions + 1 },
      softDeletedAt: undefined,
      updatedAt: now,
    })

    const embeddingId = await ctx.db.insert('skillEmbeddings', {
      skillId: skill._id,
      versionId,
      ownerId: userId,
      embedding: args.embedding,
      isLatest: true,
      isApproved: Boolean(skill.badges.redactionApproved),
      visibility: visibilityFor(true, Boolean(skill.badges.redactionApproved)),
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
      assertRole(user, ['admin', 'moderator'])
    }

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      softDeletedAt: args.deleted ? now : undefined,
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
