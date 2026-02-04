import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalQuery } from './_generated/server'
import { getSkillBadgeMaps, isSkillHighlighted, type SkillBadgeMap } from './lib/badges'
import { generateEmbedding } from './lib/embeddings'
import { toPublicSkill, toPublicSoul } from './lib/public'
import { matchesExactTokens, tokenize } from './lib/searchText'

type HydratedEntry = {
  embeddingId: Id<'skillEmbeddings'>
  skill: NonNullable<ReturnType<typeof toPublicSkill>>
  version: Doc<'skillVersions'> | null
  ownerHandle: string | null
}

type DirectMatchEntry = {
  skill: NonNullable<ReturnType<typeof toPublicSkill>>
  version: Doc<'skillVersions'> | null
  ownerHandle: string | null
}

type SearchResult = (HydratedEntry | (DirectMatchEntry & { embeddingId: null })) & { score: number }

function getNextCandidateLimit(current: number, max: number) {
  const next = Math.min(current * 2, max)
  return next > current ? next : null
}

export const searchSkills: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SearchResult[]> => {
    const query = args.query.trim()
    if (!query) return []
    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    const limit = args.limit ?? 10

    // Run direct name/slug match in parallel with vector search
    // This ensures exact name matches are found even with low semantic similarity
    const directMatchPromise = ctx.runQuery(internal.search.findDirectMatches, {
      query,
      queryTokens,
      limit,
    }) as Promise<DirectMatchEntry[]>

    let vector: number[]
    try {
      vector = await generateEmbedding(query)
    } catch (error) {
      console.warn('Search embedding generation failed', error)
      // Fall back to direct matches only
      const directMatches = await directMatchPromise
      return directMatches.map((entry) => ({
        ...entry,
        embeddingId: null,
        score: 1.0, // Exact matches get high score
      }))
    }

    // Convex vectorSearch max limit is 256; clamp candidate sizes accordingly.
    const maxCandidate = Math.min(Math.max(limit * 10, 200), 256)
    let candidateLimit = Math.min(Math.max(limit * 3, 50), 256)
    let hydrated: HydratedEntry[] = []
    let scoreById = new Map<Id<'skillEmbeddings'>, number>()
    let exactMatches: HydratedEntry[] = []

    while (candidateLimit <= maxCandidate) {
      const results = await ctx.vectorSearch('skillEmbeddings', 'by_embedding', {
        vector,
        limit: candidateLimit,
        filter: (q) => q.or(q.eq('visibility', 'latest'), q.eq('visibility', 'latest-approved')),
      })

      hydrated = (await ctx.runQuery(internal.search.hydrateResults, {
        embeddingIds: results.map((result) => result._id),
      })) as HydratedEntry[]

      scoreById = new Map<Id<'skillEmbeddings'>, number>(
        results.map((result) => [result._id, result._score]),
      )

      const badgeMapEntries = (await ctx.runQuery(internal.search.getSkillBadgeMapsInternal, {
        skillIds: hydrated.map((entry) => entry.skill._id),
      })) as Array<[Id<'skills'>, SkillBadgeMap]>
      const badgeMapBySkillId = new Map(badgeMapEntries)
      const hydratedWithBadges = hydrated.map((entry) => ({
        ...entry,
        skill: {
          ...entry.skill,
          badges: badgeMapBySkillId.get(entry.skill._id) ?? {},
        },
      }))

      const filtered = args.highlightedOnly
        ? hydratedWithBadges.filter((entry) => isSkillHighlighted(entry.skill))
        : hydratedWithBadges

      exactMatches = filtered.filter((entry) =>
        matchesExactTokens(queryTokens, [
          entry.skill.displayName,
          entry.skill.slug,
          entry.skill.summary,
        ]),
      )

      if (exactMatches.length >= limit || results.length < candidateLimit) {
        break
      }

      const nextLimit = getNextCandidateLimit(candidateLimit, maxCandidate)
      if (!nextLimit) break
      candidateLimit = nextLimit
    }

    // Merge vector search results with direct matches
    const directMatches = await directMatchPromise
    const seenSkillIds = new Set<string>()
    const mergedResults: SearchResult[] = []

    // Add direct matches first with boosted score (exact name matches are highly relevant)
    for (const entry of directMatches) {
      if (args.highlightedOnly && !isSkillHighlighted(entry.skill)) continue
      if (!seenSkillIds.has(entry.skill._id)) {
        seenSkillIds.add(entry.skill._id)
        mergedResults.push({
          ...entry,
          embeddingId: null,
          score: 1.0, // Exact name/slug matches get top score
        })
      }
    }

    // Add vector search results
    for (const entry of exactMatches) {
      if (!seenSkillIds.has(entry.skill._id)) {
        seenSkillIds.add(entry.skill._id)
        mergedResults.push({
          ...entry,
          score: scoreById.get(entry.embeddingId) ?? 0,
        })
      }
    }

    return mergedResults.filter((entry) => entry.skill).slice(0, limit)
  },
})

export const findDirectMatches = internalQuery({
  args: {
    query: v.string(),
    queryTokens: v.array(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<DirectMatchEntry[]> => {
    const { query, queryTokens, limit } = args
    const normalizedQuery = query.toLowerCase().trim()

    // Try exact slug match first
    const exactSlugMatch = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', normalizedQuery))
      .filter((q) => q.eq(q.field('softDeletedAt'), undefined))
      .first()

    // Also try slug with hyphens (e.g., "guardian angel" -> "guardian-angel")
    const hyphenatedSlug = normalizedQuery.replace(/\s+/g, '-')
    const hyphenatedMatch =
      hyphenatedSlug !== normalizedQuery
        ? await ctx.db
            .query('skills')
            .withIndex('by_slug', (q) => q.eq('slug', hyphenatedSlug))
            .filter((q) => q.eq(q.field('softDeletedAt'), undefined))
            .first()
        : null

    // Collect unique matches
    const matchedSkills: Doc<'skills'>[] = []
    const seenIds = new Set<string>()

    for (const skill of [exactSlugMatch, hyphenatedMatch]) {
      if (skill && !seenIds.has(skill._id)) {
        seenIds.add(skill._id)
        matchedSkills.push(skill)
      }
    }

    // Also search for partial matches in displayName
    // Query recent active skills and filter by name match
    if (matchedSkills.length < limit) {
      const recentSkills = await ctx.db
        .query('skills')
        .withIndex('by_active_updated', (q) => q.eq('softDeletedAt', undefined))
        .order('desc')
        .take(500) // Check recent skills for name matches

      for (const skill of recentSkills) {
        if (seenIds.has(skill._id)) continue
        if (matchedSkills.length >= limit) break

        // Check if query tokens match displayName or slug
        const nameTokens = tokenize(skill.displayName)
        const slugTokens = tokenize(skill.slug)
        const allTokens = [...nameTokens, ...slugTokens]

        const isMatch = queryTokens.every((qt) => allTokens.some((t) => t.includes(qt)))

        if (isMatch) {
          seenIds.add(skill._id)
          matchedSkills.push(skill)
        }
      }
    }

    // Hydrate results
    const results: DirectMatchEntry[] = []
    const ownerCache = new Map<Id<'users'>, string | null>()

    for (const skill of matchedSkills) {
      const publicSkill = toPublicSkill(skill)
      if (!publicSkill) continue

      let ownerHandle = ownerCache.get(skill.ownerUserId)
      if (ownerHandle === undefined) {
        const owner = await ctx.db.get(skill.ownerUserId)
        ownerHandle = owner?.handle ?? owner?.name ?? null
        ownerCache.set(skill.ownerUserId, ownerHandle)
      }

      const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null

      results.push({
        skill: publicSkill,
        version,
        ownerHandle,
      })
    }

    return results
  },
})

export const getBadgeMapsForSkills = internalQuery({
  args: { skillIds: v.array(v.id('skills')) },
  handler: async (ctx, args): Promise<Array<[Id<'skills'>, SkillBadgeMap]>> => {
    const badgeMap = await getSkillBadgeMaps(ctx, args.skillIds)
    return Array.from(badgeMap.entries())
  },
})

export const hydrateResults = internalQuery({
  args: { embeddingIds: v.array(v.id('skillEmbeddings')) },
  handler: async (ctx, args): Promise<HydratedEntry[]> => {
    const ownerHandleCache = new Map<Id<'users'>, Promise<string | null>>()

    const getOwnerHandle = (ownerUserId: Id<'users'>) => {
      const cached = ownerHandleCache.get(ownerUserId)
      if (cached) return cached
      const handlePromise = ctx.db
        .get(ownerUserId)
        .then((owner) => owner?.handle ?? owner?._id ?? null)
      ownerHandleCache.set(ownerUserId, handlePromise)
      return handlePromise
    }

    const entries = await Promise.all(
      args.embeddingIds.map(async (embeddingId) => {
        const embedding = await ctx.db.get(embeddingId)
        if (!embedding) return null
        const skill = await ctx.db.get(embedding.skillId)
        if (!skill || skill.softDeletedAt) return null
        const [version, ownerHandle] = await Promise.all([
          ctx.db.get(embedding.versionId),
          getOwnerHandle(skill.ownerUserId),
        ])
        const publicSkill = toPublicSkill(skill)
        if (!publicSkill) return null
        return { embeddingId, skill: publicSkill, version, ownerHandle }
      }),
    )

    return entries.filter((entry): entry is HydratedEntry => entry !== null)
  },
})

type HydratedSoulEntry = {
  embeddingId: Id<'soulEmbeddings'>
  soul: NonNullable<ReturnType<typeof toPublicSoul>>
  version: Doc<'soulVersions'> | null
}

type SoulSearchResult = HydratedSoulEntry & { score: number }

export const searchSouls: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SoulSearchResult[]> => {
    const query = args.query.trim()
    if (!query) return []
    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []
    let vector: number[]
    try {
      vector = await generateEmbedding(query)
    } catch (error) {
      console.warn('Search embedding generation failed', error)
      return []
    }
    const limit = args.limit ?? 10
    // Convex vectorSearch max limit is 256; clamp candidate sizes accordingly.
    const maxCandidate = Math.min(Math.max(limit * 10, 200), 256)
    let candidateLimit = Math.min(Math.max(limit * 3, 50), 256)
    let hydrated: HydratedSoulEntry[] = []
    let scoreById = new Map<Id<'soulEmbeddings'>, number>()
    let exactMatches: HydratedSoulEntry[] = []

    while (candidateLimit <= maxCandidate) {
      const results = await ctx.vectorSearch('soulEmbeddings', 'by_embedding', {
        vector,
        limit: candidateLimit,
        filter: (q) => q.or(q.eq('visibility', 'latest'), q.eq('visibility', 'latest-approved')),
      })

      hydrated = (await ctx.runQuery(internal.search.hydrateSoulResults, {
        embeddingIds: results.map((result) => result._id),
      })) as HydratedSoulEntry[]

      scoreById = new Map<Id<'soulEmbeddings'>, number>(
        results.map((result) => [result._id, result._score]),
      )

      exactMatches = hydrated.filter((entry) =>
        matchesExactTokens(queryTokens, [
          entry.soul.displayName,
          entry.soul.slug,
          entry.soul.summary,
        ]),
      )

      if (exactMatches.length >= limit || results.length < candidateLimit) {
        break
      }

      const nextLimit = getNextCandidateLimit(candidateLimit, maxCandidate)
      if (!nextLimit) break
      candidateLimit = nextLimit
    }

    return exactMatches
      .map((entry) => ({
        ...entry,
        score: scoreById.get(entry.embeddingId) ?? 0,
      }))
      .filter((entry) => entry.soul)
      .slice(0, limit)
  },
})

export const hydrateSoulResults = internalQuery({
  args: { embeddingIds: v.array(v.id('soulEmbeddings')) },
  handler: async (ctx, args): Promise<HydratedSoulEntry[]> => {
    const entries: HydratedSoulEntry[] = []

    for (const embeddingId of args.embeddingIds) {
      const embedding = await ctx.db.get(embeddingId)
      if (!embedding) continue
      const soul = await ctx.db.get(embedding.soulId)
      if (soul?.softDeletedAt) continue
      const version = await ctx.db.get(embedding.versionId)
      const publicSoul = toPublicSoul(soul)
      if (!publicSoul) continue
      entries.push({ embeddingId, soul: publicSoul, version })
    }

    return entries
  },
})

export const getSkillBadgeMapsInternal = internalQuery({
  args: { skillIds: v.array(v.id('skills')) },
  handler: async (ctx, args) => {
    const badgeMap = await getSkillBadgeMaps(ctx, args.skillIds)
    return Array.from(badgeMap.entries())
  },
})

export const __test = { getNextCandidateLimit }
