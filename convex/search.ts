import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalQuery } from './_generated/server'
import { getSkillBadgeMaps, isSkillHighlighted, type SkillBadgeMap } from './lib/badges'
import { generateEmbedding } from './lib/embeddings'
import { toPublicSkill, toPublicSoul, toPublicUser } from './lib/public'
import { matchesExactTokens, tokenize } from './lib/searchText'
import { isSkillSuspicious } from './lib/skillSafety'

type SkillSearchEntry = {
  embeddingId?: Id<'skillEmbeddings'>
  skill: NonNullable<ReturnType<typeof toPublicSkill>>
  version: Doc<'skillVersions'> | null
  ownerHandle: string | null
  owner: ReturnType<typeof toPublicUser> | null
}

type SearchResult = SkillSearchEntry & { score: number }

const SLUG_EXACT_BOOST = 1.4
const SLUG_PREFIX_BOOST = 0.8
const NAME_EXACT_BOOST = 1.1
const NAME_PREFIX_BOOST = 0.6
const POPULARITY_WEIGHT = 0.08
const FALLBACK_SCAN_LIMIT = 1200

function getNextCandidateLimit(current: number, max: number) {
  const next = Math.min(current * 2, max)
  return next > current ? next : null
}

function matchesAllTokens(
  queryTokens: string[],
  candidateTokens: string[],
  matcher: (candidate: string, query: string) => boolean,
) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false
  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => matcher(candidateToken, queryToken)),
  )
}

function getLexicalBoost(queryTokens: string[], displayName: string, slug: string) {
  const slugTokens = tokenize(slug)
  const nameTokens = tokenize(displayName)

  let boost = 0
  if (matchesAllTokens(queryTokens, slugTokens, (candidate, query) => candidate === query)) {
    boost += SLUG_EXACT_BOOST
  } else if (
    matchesAllTokens(queryTokens, slugTokens, (candidate, query) => candidate.startsWith(query))
  ) {
    boost += SLUG_PREFIX_BOOST
  }

  if (matchesAllTokens(queryTokens, nameTokens, (candidate, query) => candidate === query)) {
    boost += NAME_EXACT_BOOST
  } else if (
    matchesAllTokens(queryTokens, nameTokens, (candidate, query) => candidate.startsWith(query))
  ) {
    boost += NAME_PREFIX_BOOST
  }

  return boost
}

function scoreSkillResult(
  queryTokens: string[],
  vectorScore: number,
  displayName: string,
  slug: string,
  downloads: number,
) {
  const lexicalBoost = getLexicalBoost(queryTokens, displayName, slug)
  const popularityBoost = Math.log1p(Math.max(downloads, 0)) * POPULARITY_WEIGHT
  return vectorScore + lexicalBoost + popularityBoost
}

function mergeUniqueBySkillId(primary: SkillSearchEntry[], fallback: SkillSearchEntry[]) {
  if (fallback.length === 0) return primary
  const out = [...primary]
  const seen = new Set(primary.map((entry) => entry.skill._id))
  for (const entry of fallback) {
    if (seen.has(entry.skill._id)) continue
    seen.add(entry.skill._id)
    out.push(entry)
  }
  return out
}

export const searchSkills: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
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
    let hydrated: SkillSearchEntry[] = []
    let scoreById = new Map<Id<'skillEmbeddings'>, number>()
    let exactMatches: SkillSearchEntry[] = []

    while (candidateLimit <= maxCandidate) {
      const results = await ctx.vectorSearch('skillEmbeddings', 'by_embedding', {
        vector,
        limit: candidateLimit,
        filter: (q) => q.or(q.eq('visibility', 'latest'), q.eq('visibility', 'latest-approved')),
      })

      hydrated = (await ctx.runQuery(internal.search.hydrateResults, {
        embeddingIds: results.map((result) => result._id),
        nonSuspiciousOnly: args.nonSuspiciousOnly,
      })) as SkillSearchEntry[]

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

    const fallbackMatches =
      exactMatches.length >= limit
        ? []
        : ((await ctx.runQuery(internal.search.lexicalFallbackSkills, {
            query,
            queryTokens,
            limit: Math.min(Math.max(limit * 4, 200), FALLBACK_SCAN_LIMIT),
            highlightedOnly: args.highlightedOnly,
            nonSuspiciousOnly: args.nonSuspiciousOnly,
          })) as SkillSearchEntry[])

    const mergedMatches = mergeUniqueBySkillId(exactMatches, fallbackMatches)

    return mergedMatches
      .map((entry) => {
        const vectorScore = entry.embeddingId ? (scoreById.get(entry.embeddingId) ?? 0) : 0
        return {
          ...entry,
          score: scoreSkillResult(
            queryTokens,
            vectorScore,
            entry.skill.displayName,
            entry.skill.slug,
            entry.skill.stats.downloads,
          ),
        }
      })
      .filter((entry) => entry.skill)
      .sort((a, b) => b.score - a.score || b.skill.stats.downloads - a.skill.stats.downloads)
      .slice(0, limit)
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
  args: {
    embeddingIds: v.array(v.id('skillEmbeddings')),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const ownerCache = new Map<
      Id<'users'>,
      Promise<{ handle: string | null; owner: ReturnType<typeof toPublicUser> | null }>
    >()

    const getOwnerInfo = (ownerUserId: Id<'users'>) => {
      const cached = ownerCache.get(ownerUserId)
      if (cached) return cached
      const ownerPromise = ctx.db.get(ownerUserId).then((ownerDoc) => ({
        handle: ownerDoc?.handle ?? (ownerDoc?._id ? String(ownerDoc._id) : null),
        owner: toPublicUser(ownerDoc),
      }))
      ownerCache.set(ownerUserId, ownerPromise)
      return ownerPromise
    }

    const entries: Array<SkillSearchEntry | null> = await Promise.all(
      args.embeddingIds.map(async (embeddingId) => {
        const embedding = await ctx.db.get(embeddingId)
        if (!embedding) return null
        const skill = await ctx.db.get(embedding.skillId)
        if (!skill || skill.softDeletedAt) return null
        if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) return null
        const [version, ownerInfo] = await Promise.all([
          ctx.db.get(embedding.versionId),
          getOwnerInfo(skill.ownerUserId),
        ])
        const publicSkill = toPublicSkill(skill)
        if (!publicSkill) return null
        return {
          embeddingId,
          skill: publicSkill,
          version,
          ownerHandle: ownerInfo.handle,
          owner: ownerInfo.owner,
        }
      }),
    )

    return entries.filter((entry): entry is SkillSearchEntry => entry !== null)
  },
})

export const lexicalFallbackSkills = internalQuery({
  args: {
    query: v.string(),
    queryTokens: v.array(v.string()),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const limit = Math.min(Math.max(args.limit ?? 200, 10), FALLBACK_SCAN_LIMIT)
    const seenSkillIds = new Set<Id<'skills'>>()
    const candidateSkills: Doc<'skills'>[] = []

    const slugQuery = args.query.trim().toLowerCase()
    if (/^[a-z0-9][a-z0-9-]*$/.test(slugQuery)) {
      const exactSlugSkill = await ctx.db
        .query('skills')
        .withIndex('by_slug', (q) => q.eq('slug', slugQuery))
        .unique()
      if (
        exactSlugSkill &&
        !exactSlugSkill.softDeletedAt &&
        (!args.nonSuspiciousOnly || !isSkillSuspicious(exactSlugSkill))
      ) {
        seenSkillIds.add(exactSlugSkill._id)
        candidateSkills.push(exactSlugSkill)
      }
    }

    const recentSkills = await ctx.db
      .query('skills')
      .withIndex('by_active_updated', (q) => q.eq('softDeletedAt', undefined))
      .order('desc')
      .take(FALLBACK_SCAN_LIMIT)

    for (const skill of recentSkills) {
      if (seenSkillIds.has(skill._id)) continue
      if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) continue
      seenSkillIds.add(skill._id)
      candidateSkills.push(skill)
    }

    const matched = candidateSkills.filter((skill) =>
      matchesExactTokens(args.queryTokens, [skill.displayName, skill.slug, skill.summary]),
    )
    if (matched.length === 0) return []

    const ownerCache = new Map<
      Id<'users'>,
      Promise<{ handle: string | null; owner: ReturnType<typeof toPublicUser> | null }>
    >()
    const getOwnerInfo = (ownerUserId: Id<'users'>) => {
      const cached = ownerCache.get(ownerUserId)
      if (cached) return cached
      const ownerPromise = ctx.db.get(ownerUserId).then((ownerDoc) => ({
        handle: ownerDoc?.handle ?? (ownerDoc?._id ? String(ownerDoc._id) : null),
        owner: toPublicUser(ownerDoc),
      }))
      ownerCache.set(ownerUserId, ownerPromise)
      return ownerPromise
    }

    const entries = await Promise.all(
      matched.map(async (skill) => {
        const [version, ownerInfo] = await Promise.all([
          skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : Promise.resolve(null),
          getOwnerInfo(skill.ownerUserId),
        ])
        const publicSkill = toPublicSkill(skill)
        if (!publicSkill) return null
        return {
          skill: publicSkill,
          version,
          ownerHandle: ownerInfo.handle,
          owner: ownerInfo.owner,
        }
      }),
    )
    const validEntries = entries.filter((entry): entry is SkillSearchEntry => entry !== null)
    if (validEntries.length === 0) return []

    const badgeMap = await getSkillBadgeMaps(
      ctx,
      validEntries.map((entry) => entry.skill._id),
    )
    const withBadges = validEntries.map((entry) => ({
      ...entry,
      skill: {
        ...entry.skill,
        badges: badgeMap.get(entry.skill._id) ?? {},
      },
    }))

    const filtered = args.highlightedOnly
      ? withBadges.filter((entry) => isSkillHighlighted(entry.skill))
      : withBadges
    return filtered.slice(0, limit)
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

export const __test = {
  getNextCandidateLimit,
  matchesAllTokens,
  getLexicalBoost,
  scoreSkillResult,
  mergeUniqueBySkillId,
}
