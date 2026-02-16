import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertModerator, requireUser, requireUserFromAction } from './lib/access'
import { embeddingVisibilityFor } from './lib/embeddingVisibility'
import { toPublicSoul, toPublicUser } from './lib/public'
import { getFrontmatterValue, hashSkillFiles } from './lib/skills'
import { generateSoulChangelogPreview } from './lib/soulChangelog'
import { fetchText, type PublishResult, publishSoulVersionForUser } from './lib/soulPublish'

export { publishSoulVersionForUser } from './lib/soulPublish'

type ReadmeResult = { path: string; text: string }

type FileTextResult = { path: string; text: string; size: number; sha256: string }

const MAX_DIFF_FILE_BYTES = 200 * 1024
const MAX_LIST_LIMIT = 50

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query('souls')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .order('desc')
      .take(2)
    const soul = matches[0] ?? null
    if (!soul || soul.softDeletedAt) return null
    const latestVersion = soul.latestVersionId ? await ctx.db.get(soul.latestVersionId) : null
    const owner = toPublicUser(await ctx.db.get(soul.ownerUserId))
    const publicSoul = toPublicSoul(soul)
    if (!publicSoul) return null

    return { soul: publicSoul, latestVersion, owner }
  },
})

export const getSoulBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query('souls')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .order('desc')
      .take(2)
    return matches[0] ?? null
  },
})

export const list = query({
  args: {
    ownerUserId: v.optional(v.id('users')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 24
    const ownerUserId = args.ownerUserId
    if (ownerUserId) {
      const entries = await ctx.db
        .query('souls')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(limit * 5)
      return entries
        .filter((soul) => !soul.softDeletedAt)
        .slice(0, limit)
        .map((soul) => toPublicSoul(soul))
        .filter((soul): soul is NonNullable<typeof soul> => Boolean(soul))
    }
    const entries = await ctx.db
      .query('souls')
      .order('desc')
      .take(limit * 5)
    return entries
      .filter((soul) => !soul.softDeletedAt)
      .slice(0, limit)
      .map((soul) => toPublicSoul(soul))
      .filter((soul): soul is NonNullable<typeof soul> => Boolean(soul))
  },
})

export const listPublicPage = query({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_LIMIT)
    const { page, isDone, continueCursor } = await ctx.db
      .query('souls')
      .withIndex('by_updated', (q) => q)
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: limit })

    const items: Array<{
      soul: NonNullable<ReturnType<typeof toPublicSoul>>
      latestVersion: Doc<'soulVersions'> | null
    }> = []

    for (const soul of page) {
      if (soul.softDeletedAt) continue
      const latestVersion = soul.latestVersionId ? await ctx.db.get(soul.latestVersionId) : null
      const publicSoul = toPublicSoul(soul)
      if (!publicSoul) continue
      items.push({ soul: publicSoul, latestVersion })
    }

    return { items, nextCursor: isDone ? null : continueCursor }
  },
})

export const listVersions = query({
  args: { soulId: v.id('souls'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20
    return ctx.db
      .query('soulVersions')
      .withIndex('by_soul', (q) => q.eq('soulId', args.soulId))
      .order('desc')
      .take(limit)
  },
})

export const listVersionsPage = query({
  args: {
    soulId: v.id('souls'),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_LIMIT)
    const { page, isDone, continueCursor } = await ctx.db
      .query('soulVersions')
      .withIndex('by_soul', (q) => q.eq('soulId', args.soulId))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: limit })
    const items = page.filter((version) => !version.softDeletedAt)
    return { items, nextCursor: isDone ? null : continueCursor }
  },
})

export const getVersionById = query({
  args: { versionId: v.id('soulVersions') },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
})

export const getVersionsByIdsInternal = internalQuery({
  args: { versionIds: v.array(v.id('soulVersions')) },
  handler: async (ctx, args) => {
    const versions = await Promise.all(args.versionIds.map((id) => ctx.db.get(id)))
    return versions.filter((v): v is NonNullable<typeof v> => v !== null)
  },
})

export const getVersionByIdInternal = internalQuery({
  args: { versionId: v.id('soulVersions') },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
})

export const getVersionBySoulAndVersion = query({
  args: { soulId: v.id('souls'), version: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('soulVersions')
      .withIndex('by_soul_version', (q) => q.eq('soulId', args.soulId).eq('version', args.version))
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
    source: v.optional(
      v.object({
        kind: v.literal('github'),
        url: v.string(),
        repo: v.string(),
        ref: v.string(),
        commit: v.string(),
        path: v.string(),
        importedAt: v.number(),
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
    return publishSoulVersionForUser(ctx, userId, args)
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
    const changelog = await generateSoulChangelogPreview(ctx, {
      slug: args.slug.trim().toLowerCase(),
      version: args.version.trim(),
      readmeText: args.readmeText,
      filePaths: args.filePaths?.map((value) => value.trim()).filter(Boolean),
    })
    return { changelog, source: 'auto' as const }
  },
})

export const getReadme: ReturnType<typeof action> = action({
  args: { versionId: v.id('soulVersions') },
  handler: async (ctx, args): Promise<ReadmeResult> => {
    const version = (await ctx.runQuery(internal.souls.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'soulVersions'> | null
    if (!version) throw new ConvexError('Version not found')
    const readmeFile = version.files.find((file) => file.path.toLowerCase() === 'soul.md')
    if (!readmeFile) throw new ConvexError('SOUL.md not found')
    const text = await fetchText(ctx, readmeFile.storageId)
    return { path: readmeFile.path, text }
  },
})

export const getFileText: ReturnType<typeof action> = action({
  args: { versionId: v.id('soulVersions'), path: v.string() },
  handler: async (ctx, args): Promise<FileTextResult> => {
    const version = (await ctx.runQuery(internal.souls.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'soulVersions'> | null
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

    const soulMatches = await ctx.db
      .query('souls')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .order('desc')
      .take(2)
    const soul = soulMatches[0] ?? null
    if (!soul || soul.softDeletedAt) return null

    const latestVersion = soul.latestVersionId ? await ctx.db.get(soul.latestVersionId) : null

    const fingerprintMatches = await ctx.db
      .query('soulVersionFingerprints')
      .withIndex('by_soul_fingerprint', (q) => q.eq('soulId', soul._id).eq('fingerprint', hash))
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
        .query('soulVersions')
        .withIndex('by_soul', (q) => q.eq('soulId', soul._id))
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
    soulId: v.id('souls'),
    tags: v.array(v.object({ tag: v.string(), versionId: v.id('soulVersions') })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    const soul = await ctx.db.get(args.soulId)
    if (!soul) throw new Error('Soul not found')
    if (soul.ownerUserId !== user._id) {
      assertModerator(user)
    }

    const nextTags = { ...soul.tags }
    for (const entry of args.tags) {
      nextTags[entry.tag] = entry.versionId
    }

    const latestEntry = args.tags.find((entry) => entry.tag === 'latest')
    await ctx.db.patch(soul._id, {
      tags: nextTags,
      latestVersionId: latestEntry ? latestEntry.versionId : soul.latestVersionId,
      updatedAt: Date.now(),
    })

    if (latestEntry) {
      const embeddings = await ctx.db
        .query('soulEmbeddings')
        .withIndex('by_soul', (q) => q.eq('soulId', soul._id))
        .collect()
      for (const embedding of embeddings) {
        const isLatest = embedding.versionId === latestEntry.versionId
        await ctx.db.patch(embedding._id, {
          isLatest,
          visibility: embeddingVisibilityFor(isLatest, embedding.isApproved),
          updatedAt: Date.now(),
        })
      }
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
    summary: v.optional(v.string()),
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
    }),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = args.userId
    const user = await ctx.db.get(userId)
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error('User not found')

    const soulMatches = await ctx.db
      .query('souls')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .order('desc')
      .take(2)
    let soul: Doc<'souls'> | null = soulMatches[0] ?? null

    if (soul && soul.ownerUserId !== userId) {
      throw new Error('Only the owner can publish updates')
    }

    const now = Date.now()
    if (!soul) {
      const summary = args.summary ?? getFrontmatterValue(args.parsed.frontmatter, 'description')
      const soulId = await ctx.db.insert('souls', {
        slug: args.slug,
        displayName: args.displayName,
        summary: summary ?? undefined,
        ownerUserId: userId,
        latestVersionId: undefined,
        tags: {},
        softDeletedAt: undefined,
        stats: {
          downloads: 0,
          stars: 0,
          versions: 0,
          comments: 0,
        },
        createdAt: now,
        updatedAt: now,
      })
      soul = await ctx.db.get(soulId)
    }

    if (!soul) throw new Error('Soul creation failed')

    const existingVersion = await ctx.db
      .query('soulVersions')
      .withIndex('by_soul_version', (q) => q.eq('soulId', soul._id).eq('version', args.version))
      .unique()
    if (existingVersion) {
      throw new Error('Version already exists')
    }

    const versionId = await ctx.db.insert('soulVersions', {
      soulId: soul._id,
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

    const nextTags: Record<string, Id<'soulVersions'>> = { ...soul.tags }
    nextTags.latest = versionId
    for (const tag of args.tags ?? []) {
      nextTags[tag] = versionId
    }

    const latestBefore = soul.latestVersionId

    await ctx.db.patch(soul._id, {
      displayName: args.displayName,
      summary:
        args.summary ?? getFrontmatterValue(args.parsed.frontmatter, 'description') ?? soul.summary,
      latestVersionId: versionId,
      tags: nextTags,
      stats: { ...soul.stats, versions: soul.stats.versions + 1 },
      softDeletedAt: undefined,
      updatedAt: now,
    })

    const embeddingId = await ctx.db.insert('soulEmbeddings', {
      soulId: soul._id,
      versionId,
      ownerId: userId,
      embedding: args.embedding,
      isLatest: true,
      isApproved: true,
      visibility: embeddingVisibilityFor(true, true),
      updatedAt: now,
    })

    if (latestBefore) {
      const previousEmbedding = await ctx.db
        .query('soulEmbeddings')
        .withIndex('by_version', (q) => q.eq('versionId', latestBefore))
        .unique()
      if (previousEmbedding) {
        await ctx.db.patch(previousEmbedding._id, {
          isLatest: false,
          visibility: embeddingVisibilityFor(false, previousEmbedding.isApproved),
          updatedAt: now,
        })
      }
    }

    await ctx.db.insert('soulVersionFingerprints', {
      soulId: soul._id,
      versionId,
      fingerprint: args.fingerprint,
      createdAt: now,
    })

    return { soulId: soul._id, versionId, embeddingId }
  },
})

export const setSoulSoftDeletedInternal = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    deleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error('User not found')

    const slug = args.slug.trim().toLowerCase()
    if (!slug) throw new Error('Slug required')

    const soulMatches = await ctx.db
      .query('souls')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .order('desc')
      .take(2)
    const soul = soulMatches[0] ?? null
    if (!soul) throw new Error('Soul not found')

    if (soul.ownerUserId !== args.userId) {
      assertModerator(user)
    }

    const now = Date.now()
    await ctx.db.patch(soul._id, {
      softDeletedAt: args.deleted ? now : undefined,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('soulEmbeddings')
      .withIndex('by_soul', (q) => q.eq('soulId', soul._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: args.deleted
          ? 'deleted'
          : embeddingVisibilityFor(embedding.isLatest, embedding.isApproved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: args.userId,
      action: args.deleted ? 'soul.delete' : 'soul.undelete',
      targetType: 'soul',
      targetId: soul._id,
      metadata: { slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    })

    return { ok: true as const }
  },
})

function clampInt(value: number, min: number, max: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : min
  return Math.min(max, Math.max(min, rounded))
}
