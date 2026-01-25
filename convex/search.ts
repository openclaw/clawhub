import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalQuery } from './_generated/server'
import { generateEmbedding } from './lib/embeddings'
import { matchesExactTokens, tokenize } from './lib/searchText'

type HydratedEntry = {
  embeddingId: Id<'skillEmbeddings'>
  skill: Doc<'skills'> | null
  version: Doc<'skillVersions'> | null
  ownerHandle: string | null
}

type SearchResult = HydratedEntry & { score: number }

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

      const filtered = args.highlightedOnly
        ? hydrated.filter((entry) => entry.skill?.batch === 'highlighted')
        : hydrated

      exactMatches = filtered.filter((entry) =>
        matchesExactTokens(queryTokens, [
          entry.skill?.displayName,
          entry.skill?.slug,
          entry.skill?.summary,
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
      .filter((entry) => entry.skill)
      .slice(0, limit)
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
        return { embeddingId, skill, version, ownerHandle }
      }),
    )

    return entries.filter((entry): entry is HydratedEntry => entry !== null)
  },
})

type HydratedSoulEntry = {
  embeddingId: Id<'soulEmbeddings'>
  soul: Doc<'souls'> | null
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
          entry.soul?.displayName,
          entry.soul?.slug,
          entry.soul?.summary,
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
      entries.push({ embeddingId, soul, version })
    }

    return entries
  },
})

export const __test = { getNextCandidateLimit }
