import {
  getCatalogTopicSlugs,
  INTERNAL_UNCATEGORIZED_CATEGORY,
  normalizeCatalogTopic,
} from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalQuery } from "./functions";
import { isSkillHighlighted } from "./lib/badges";
import { generateEmbedding } from "./lib/embeddings";
import type { HydratableSkill, PublicPublisher } from "./lib/public";
import { toPublicPublisher, toPublicSkill } from "./lib/public";
import { getOwnerPublisher } from "./lib/publishers";
import {
  matchesAllTokens,
  matchesExactTokens,
  matchesExploratoryTokenPrefixes,
  tokenize,
} from "./lib/searchText";
import { isSkillSuspicious } from "./lib/skillSafety";
import {
  digestToHydratableSkill,
  digestToOwnerInfo,
  getFirstSearchToken,
  normalizeSkillSearchText,
} from "./lib/skillSearchDigest";
import { isSearchableSkillSlugShape, normalizeSkillSlug } from "./lib/skillSlugValidator";

type OwnerInfo = { ownerHandle: string | null; owner: PublicPublisher | null };

function makeOwnerInfoGetter(ctx: Pick<QueryCtx, "db">) {
  const ownerCache = new Map<string, Promise<OwnerInfo>>();
  return (ownerUserId: Id<"users">, ownerPublisherId?: Id<"publishers"> | null) => {
    const cacheKey = String(ownerPublisherId ?? ownerUserId);
    const cached = ownerCache.get(cacheKey);
    if (cached) return cached;
    const ownerPromise = getOwnerPublisher(ctx, {
      ownerPublisherId,
      ownerUserId,
    }).then((ownerDoc) => {
      const owner = toPublicPublisher(ownerDoc);
      return {
        ownerHandle: owner?.handle ?? null,
        owner,
      };
    });
    ownerCache.set(cacheKey, ownerPromise);
    return ownerPromise;
  };
}

type SkillSearchEntry = {
  embeddingId?: Id<"skillEmbeddings">;
  skill: NonNullable<ReturnType<typeof toPublicSkill>>;
  version: Doc<"skillVersions"> | null;
  ownerHandle: string | null;
  owner: PublicPublisher | null;
};

type SearchMatch = {
  rankTier: number;
};

type SearchResult = SkillSearchEntry &
  SearchMatch & {
    score: number;
  };
type PublicSearchResult = SkillSearchEntry & {
  score: number;
};

const EXACT_SLUG_BOOST = 2.5;
const SLUG_TOKEN_BOOST = 1.4;
const SLUG_PREFIX_BOOST = 0.8;
const NAME_EXACT_BOOST = 1.1;
const NAME_PREFIX_BOOST = 0.6;
const STAR_POPULARITY_WEIGHT = 0.12;
const INSTALL_POPULARITY_WEIGHT = 0.005;
const MAX_POPULARITY_BOOST = 0.09;
const FALLBACK_SCAN_LIMIT = 2000;
const MIN_FALLBACK_SCAN_LIMIT = 100;
const FALLBACK_RECALL_MULTIPLIER = 2;
const MIN_STABLE_SEARCH_RECALL_LIMIT = 100;
const MAX_DIRECT_SKILL_SEARCH_CANDIDATES = 100;
const MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES = 40;
const MAX_DIRECT_SKILL_TOPIC_CANDIDATES = 100;
const MIN_VECTOR_SEARCH_CANDIDATES = 50;
const MAX_VECTOR_SEARCH_CANDIDATES = 128;
const MAX_EXACT_SLUG_MATCHES = 25;
const EXPLORATORY_SEARCH_MIN_TOKEN_LENGTH = 3;

function getNextCandidateLimit(current: number, max: number) {
  const next = Math.min(current * 2, max);
  return next > current ? next : null;
}

function getLexicalBoost(queryTokens: string[], displayName: string, slug: string) {
  const slugTokens = tokenize(slug);
  const nameTokens = tokenize(displayName);

  let boost = 0;
  const normalizedQuery = queryTokens.join("-");
  if (normalizedQuery === slug) {
    boost += EXACT_SLUG_BOOST;
  } else if (matchesAllTokens(queryTokens, slugTokens, (candidate, query) => candidate === query)) {
    boost += SLUG_TOKEN_BOOST;
  } else if (
    matchesAllTokens(queryTokens, slugTokens, (candidate, query) => candidate.startsWith(query))
  ) {
    boost += SLUG_PREFIX_BOOST;
  }

  if (matchesAllTokens(queryTokens, nameTokens, (candidate, query) => candidate === query)) {
    boost += NAME_EXACT_BOOST;
  } else if (
    matchesAllTokens(queryTokens, nameTokens, (candidate, query) => candidate.startsWith(query))
  ) {
    boost += NAME_PREFIX_BOOST;
  }

  return boost;
}

type PopularityStats = {
  installsAllTime?: number;
  stars: number;
};

function getPopularityBoost(stats: PopularityStats) {
  const rawBoost =
    Math.log1p(Math.max(stats.stars, 0)) * STAR_POPULARITY_WEIGHT +
    Math.log1p(Math.max(stats.installsAllTime ?? 0, 0)) * INSTALL_POPULARITY_WEIGHT;
  return Math.min(rawBoost, MAX_POPULARITY_BOOST);
}

function scoreSkillResult(
  queryTokens: string[],
  vectorScore: number,
  displayName: string,
  slug: string,
  stats: PopularityStats,
) {
  const lexicalBoost = getLexicalBoost(queryTokens, displayName, slug);
  const popularityBoost = getPopularityBoost(stats);
  return vectorScore + lexicalBoost + popularityBoost;
}

function classifySkillMatch(
  query: string,
  queryTokens: string[],
  skill: Pick<HydratableSkill, "displayName" | "slug" | "summary" | "categories" | "topics">,
): SearchMatch | null {
  const needle = query.toLowerCase();
  const normalizedSlugQuery = queryTokens.join("-");
  const slug = skill.slug.toLowerCase();
  const display = skill.displayName.toLowerCase();
  const slugTokens = tokenize(slug);
  const displayTokens = tokenize(display);

  if (slug === normalizedSlugQuery || slug === needle || display === needle) {
    return { rankTier: 0 };
  }
  if (slug.startsWith(normalizedSlugQuery) || slug.startsWith(needle)) {
    return { rankTier: 1 };
  }
  if (display.startsWith(needle)) {
    return { rankTier: 1 };
  }
  if (matchesAllTokens(queryTokens, [...slugTokens, ...displayTokens], (a, b) => a === b)) {
    return { rankTier: 1 };
  }
  if (matchesAllTokens(queryTokens, [...slugTokens, ...displayTokens], (a, b) => a.startsWith(b))) {
    return { rankTier: 1 };
  }
  const taxonomyQuery = normalizeCatalogTopic(query);
  const categories = (skill.categories ?? []).filter(
    (category) => category !== INTERNAL_UNCATEGORIZED_CATEGORY,
  );
  const topicSlugs = getCatalogTopicSlugs(skill.topics);
  if (taxonomyQuery && (categories.includes(taxonomyQuery) || topicSlugs.includes(taxonomyQuery))) {
    return { rankTier: 2 };
  }
  if (
    matchesExploratoryTokenPrefixes(
      queryTokens,
      [...categories, ...(skill.topics ?? [])],
      EXPLORATORY_SEARCH_MIN_TOKEN_LENGTH,
    )
  ) {
    return { rankTier: 2 };
  }
  if (
    matchesExploratoryTokenPrefixes(
      queryTokens,
      [skill.summary],
      EXPLORATORY_SEARCH_MIN_TOKEN_LENGTH,
    )
  ) {
    return { rankTier: 3 };
  }
  return null;
}

function comparePopularityStats(a: PopularityStats, b: PopularityStats) {
  return b.stars - a.stars || (b.installsAllTime ?? 0) - (a.installsAllTime ?? 0);
}

function mergeUniqueBySkillId(primary: SkillSearchEntry[], fallback: SkillSearchEntry[]) {
  if (fallback.length === 0) return primary;
  const out = [...primary];
  const seen = new Set(primary.map((entry) => entry.skill._id));
  for (const entry of fallback) {
    if (seen.has(entry.skill._id)) continue;
    seen.add(entry.skill._id);
    out.push(entry);
  }
  return out;
}

function matchesCatalogTopic(skill: Pick<HydratableSkill, "topics">, topic: string | undefined) {
  return !topic || getCatalogTopicSlugs(skill.topics).includes(topic);
}

function isSlugLikeQuery(query: string) {
  // Lenient shape check used by the read path: pattern + upper length cap only.
  // The min-length floor and reserved-word blocklist are intentionally omitted
  // so legacy rows (grandfathered short/reserved slugs) remain discoverable via
  // the exact-slug fast path. Write paths still go through assertValidSkillSlug.
  return isSearchableSkillSlugShape(query);
}

function prefixUpperBound(value: string) {
  return `${value}\uffff`;
}

export const searchSkills: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PublicSearchResult[]> => {
    const query = args.query.trim();
    if (!query) return [];
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const rawExactSlugMatches = isSlugLikeQuery(query)
      ? ((await ctx.runQuery(internal.search.getExactSkillSlugMatch, {
          slug: query.toLowerCase(),
          nonSuspiciousOnly: args.nonSuspiciousOnly,
          topic,
        })) as SkillSearchEntry[] | SkillSearchEntry | null)
      : [];
    const exactSlugMatches = (
      Array.isArray(rawExactSlugMatches)
        ? rawExactSlugMatches
        : rawExactSlugMatches
          ? [rawExactSlugMatches]
          : []
    ).filter((entry) => !args.highlightedOnly || isSkillHighlighted(entry.skill));
    const directPrefixMatches = (await ctx.runQuery(internal.search.directPrefixSkillMatches, {
      query,
      highlightedOnly: args.highlightedOnly,
      nonSuspiciousOnly: args.nonSuspiciousOnly,
      topic,
    })) as SkillSearchEntry[];
    let vector: number[] | null;
    try {
      vector = await generateEmbedding(query);
    } catch (error) {
      console.warn("Search embedding generation failed, falling back to lexical search", error);
      vector = null;
    }
    const limit = args.limit ?? 10;
    // Keep ordinary first-page and load-more requests ranking the same recall pool
    // before slicing, so expanding the display limit does not reshuffle the prefix.
    const recallLimit = Math.max(limit, MIN_STABLE_SEARCH_RECALL_LIMIT);
    // Keep the vector pool bounded; exact slug, prefix, and lexical fallback cover
    // literal recall without hydrating hundreds of semantic candidates per search.
    const maxCandidate = Math.min(
      Math.max(limit * 4, MIN_VECTOR_SEARCH_CANDIDATES),
      MAX_VECTOR_SEARCH_CANDIDATES,
    );
    let candidateLimit = Math.min(Math.max(limit * 2, MIN_VECTOR_SEARCH_CANDIDATES), maxCandidate);
    let hydrated: SkillSearchEntry[] = [];
    const seenEmbeddingIds = new Set<Id<"skillEmbeddings">>();
    let scoreById = new Map<Id<"skillEmbeddings">, number>();
    const scoreBySkillId = new Map<Id<"skills">, number>();
    let exactMatches: SkillSearchEntry[] = [];

    if (vector) {
      while (candidateLimit <= maxCandidate) {
        const results = await ctx.vectorSearch("skillEmbeddings", "by_embedding", {
          vector,
          limit: candidateLimit,
          filter: (q) => q.or(q.eq("visibility", "latest"), q.eq("visibility", "latest-approved")),
        });

        // Only hydrate embedding IDs we haven't seen yet (incremental).
        // Track all attempted IDs, not just successful hydrations, to avoid
        // re-hydrating filtered-out entries (soft-deleted, suspicious) each loop.
        const newEmbeddingIds = results.map((r) => r._id).filter((id) => !seenEmbeddingIds.has(id));
        for (const id of newEmbeddingIds) seenEmbeddingIds.add(id);

        if (newEmbeddingIds.length > 0) {
          const newEntries = (await ctx.runQuery(internal.search.hydrateResults, {
            embeddingIds: newEmbeddingIds,
            nonSuspiciousOnly: args.nonSuspiciousOnly,
            topic,
          })) as SkillSearchEntry[];
          hydrated = [...hydrated, ...newEntries];
        }

        for (const result of results) {
          scoreById.set(result._id, result._score);
        }

        for (const entry of hydrated) {
          if (!entry.embeddingId) continue;
          const score = scoreById.get(entry.embeddingId);
          if (score !== undefined) scoreBySkillId.set(entry.skill._id, score);
        }

        // Skills already have badges from their docs (via toPublicSkill).
        // No need for a separate badge table lookup.
        const filtered = hydrated.filter(
          (entry) => !args.highlightedOnly || isSkillHighlighted(entry.skill),
        );

        exactMatches = filtered.filter((entry) =>
          matchesExactTokens(queryTokens, [
            entry.skill.displayName,
            entry.skill.slug,
            entry.skill.summary,
            ...(entry.skill.categories ?? []),
            ...(entry.skill.topics ?? []),
          ]),
        );

        if (exactMatches.length >= recallLimit || results.length < candidateLimit) {
          break;
        }

        const nextLimit = getNextCandidateLimit(candidateLimit, maxCandidate);
        if (!nextLimit) break;
        candidateLimit = nextLimit;
      }
    }

    const directMatches =
      exactSlugMatches.length > 0
        ? mergeUniqueBySkillId(exactSlugMatches, directPrefixMatches)
        : directPrefixMatches;
    const primaryMatches = mergeUniqueBySkillId(directMatches, exactMatches);

    const fallbackMatches =
      primaryMatches.length >= recallLimit
        ? []
        : ((await ctx.runQuery(internal.search.lexicalFallbackSkills, {
            query,
            queryTokens,
            limit: Math.min(
              Math.max(recallLimit * FALLBACK_RECALL_MULTIPLIER, MIN_FALLBACK_SCAN_LIMIT),
              FALLBACK_SCAN_LIMIT,
            ),
            highlightedOnly: args.highlightedOnly,
            nonSuspiciousOnly: args.nonSuspiciousOnly,
            skipExactSlugLookup: true,
            topic,
          })) as SkillSearchEntry[]);
    const mergedMatches = mergeUniqueBySkillId(primaryMatches, fallbackMatches).filter((entry) =>
      matchesCatalogTopic(entry.skill, topic),
    );

    const rankedMatches = mergedMatches
      .map((entry): SearchResult | null => {
        const vectorScore = entry.embeddingId
          ? (scoreById.get(entry.embeddingId) ?? scoreBySkillId.get(entry.skill._id) ?? 0)
          : (scoreBySkillId.get(entry.skill._id) ?? 0);
        const match = classifySkillMatch(query, queryTokens, entry.skill);
        if (!match) return null;
        return {
          ...entry,
          ...match,
          score: scoreSkillResult(
            queryTokens,
            vectorScore,
            entry.skill.displayName,
            entry.skill.slug,
            {
              installsAllTime: entry.skill.stats.installsAllTime,
              stars: entry.skill.stats.stars,
            },
          ),
        };
      })
      .filter((entry): entry is SearchResult => Boolean(entry?.skill))
      .sort(
        (a, b) =>
          a.rankTier - b.rankTier ||
          b.score - a.score ||
          comparePopularityStats(a.skill.stats, b.skill.stats) ||
          b.skill.updatedAt - a.skill.updatedAt,
      )
      .slice(0, limit);
    return rankedMatches.map(({ rankTier: _rankTier, ...entry }) => entry);
  },
});

export const getExactSkillSlugMatch = internalQuery({
  args: {
    slug: v.string(),
    nonSuspiciousOnly: v.optional(v.boolean()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) return [];
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .take(MAX_EXACT_SLUG_MATCHES);
    const getOwnerInfo = makeOwnerInfoGetter(ctx);

    const entries = await Promise.all(
      skills.map(async (skill) => {
        if (skill.softDeletedAt) return null;
        if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) return null;
        if (!matchesCatalogTopic(skill, topic)) return null;

        const resolved = await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        const publicSkill = toPublicSkill(skill);
        if (!publicSkill || !resolved.owner) return null;

        const entry: SkillSearchEntry = {
          skill: publicSkill,
          version: null as Doc<"skillVersions"> | null,
          ownerHandle: resolved.ownerHandle,
          owner: resolved.owner,
        };
        return entry;
      }),
    );

    return entries.filter((entry): entry is SkillSearchEntry => entry !== null);
  },
});

export const directPrefixSkillMatches = internalQuery({
  args: {
    query: v.string(),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) return [];
    const normalizedQuery = normalizeSkillSearchText(args.query);
    if (!normalizedQuery) return [];
    const firstToken = getFirstSearchToken(args.query);
    const queryTokens = tokenize(args.query);
    const topicQuery = normalizeCatalogTopic(args.query);
    const exactRecallTopics = [
      ...new Set([topicQuery, topic].filter((value): value is string => !!value)),
    ];
    const loadTopicRows = (recallTopic: string, usePrefix: boolean, limit: number) =>
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillTopicSearchDigest")
            .withIndex("by_nonsuspicious_topic_updated", (q) =>
              usePrefix
                ? q
                    .eq("softDeletedAt", undefined)
                    .eq("isSuspicious", false)
                    .gte("topic", recallTopic)
                    .lt("topic", prefixUpperBound(recallTopic))
                : q
                    .eq("softDeletedAt", undefined)
                    .eq("isSuspicious", false)
                    .eq("topic", recallTopic),
            )
            .order("desc")
            .take(limit)
        : ctx.db
            .query("skillTopicSearchDigest")
            .withIndex("by_active_topic_updated", (q) =>
              usePrefix
                ? q
                    .eq("softDeletedAt", undefined)
                    .gte("topic", recallTopic)
                    .lt("topic", prefixUpperBound(recallTopic))
                : q.eq("softDeletedAt", undefined).eq("topic", recallTopic),
            )
            .order("desc")
            .take(limit);

    const upperBound = prefixUpperBound(normalizedQuery);
    const firstTokenUpperBound = firstToken ? prefixUpperBound(firstToken) : null;
    const [
      slugDigests,
      displayNameDigests,
      slugFirstTokenDigests,
      displayNameFirstTokenDigests,
      ftDisplayNameDigests,
      ftSlugDigests,
      exactTopicRowPages,
    ] = await Promise.all([
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillSearchDigest")
            .withIndex("by_nonsuspicious_normalized_slug", (q) =>
              q
                .eq("softDeletedAt", undefined)
                .eq("isSuspicious", false)
                .gte("normalizedSlug", normalizedQuery)
                .lt("normalizedSlug", upperBound),
            )
            .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES)
        : ctx.db
            .query("skillSearchDigest")
            .withIndex("by_active_normalized_slug", (q) =>
              q
                .eq("softDeletedAt", undefined)
                .gte("normalizedSlug", normalizedQuery)
                .lt("normalizedSlug", upperBound),
            )
            .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES),
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillSearchDigest")
            .withIndex("by_nonsuspicious_normalized_display_name", (q) =>
              q
                .eq("softDeletedAt", undefined)
                .eq("isSuspicious", false)
                .gte("normalizedDisplayName", normalizedQuery)
                .lt("normalizedDisplayName", upperBound),
            )
            .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES)
        : ctx.db
            .query("skillSearchDigest")
            .withIndex("by_active_normalized_display_name", (q) =>
              q
                .eq("softDeletedAt", undefined)
                .gte("normalizedDisplayName", normalizedQuery)
                .lt("normalizedDisplayName", upperBound),
            )
            .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES),
      firstTokenUpperBound
        ? args.nonSuspiciousOnly
          ? ctx.db
              .query("skillSearchDigest")
              .withIndex("by_nonsuspicious_normalized_slug_first_token", (q) =>
                q
                  .eq("softDeletedAt", undefined)
                  .eq("isSuspicious", false)
                  .gte("normalizedSlugFirstToken", firstToken)
                  .lt("normalizedSlugFirstToken", firstTokenUpperBound),
              )
              .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES)
          : ctx.db
              .query("skillSearchDigest")
              .withIndex("by_active_normalized_slug_first_token", (q) =>
                q
                  .eq("softDeletedAt", undefined)
                  .gte("normalizedSlugFirstToken", firstToken)
                  .lt("normalizedSlugFirstToken", firstTokenUpperBound),
              )
              .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES)
        : Promise.resolve([]),
      firstTokenUpperBound
        ? args.nonSuspiciousOnly
          ? ctx.db
              .query("skillSearchDigest")
              .withIndex("by_nonsuspicious_normalized_display_name_first_token", (q) =>
                q
                  .eq("softDeletedAt", undefined)
                  .eq("isSuspicious", false)
                  .gte("normalizedDisplayNameFirstToken", firstToken)
                  .lt("normalizedDisplayNameFirstToken", firstTokenUpperBound),
              )
              .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES)
          : ctx.db
              .query("skillSearchDigest")
              .withIndex("by_active_normalized_display_name_first_token", (q) =>
                q
                  .eq("softDeletedAt", undefined)
                  .gte("normalizedDisplayNameFirstToken", firstToken)
                  .lt("normalizedDisplayNameFirstToken", firstTokenUpperBound),
              )
              .take(MAX_DIRECT_SKILL_SEARCH_CANDIDATES)
        : Promise.resolve([]),
      // Full-text search on displayName — matches any token at any position.
      // Resolves Bug (non-first-token undiscoverable) by leveraging the
      // Convex inverted index added in `search_by_display_name`.
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillSearchDigest")
            .withSearchIndex("search_by_display_name", (q) =>
              q
                .search("displayName", args.query)
                .eq("softDeletedAt", undefined)
                .eq("isSuspicious", false),
            )
            .take(MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES)
        : ctx.db
            .query("skillSearchDigest")
            .withSearchIndex("search_by_display_name", (q) =>
              q.search("displayName", args.query).eq("softDeletedAt", undefined),
            )
            .take(MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES),
      // Full-text search on slug — same rationale, covers slug middle/tail tokens
      // (e.g. "yijian" or "vision" inside "baidu-yijian-vision").
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillSearchDigest")
            .withSearchIndex("search_by_slug", (q) =>
              q.search("slug", args.query).eq("softDeletedAt", undefined).eq("isSuspicious", false),
            )
            .take(MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES)
        : ctx.db
            .query("skillSearchDigest")
            .withSearchIndex("search_by_slug", (q) =>
              q.search("slug", args.query).eq("softDeletedAt", undefined),
            )
            .take(MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES),
      Promise.all(
        exactRecallTopics.map((recallTopic) =>
          loadTopicRows(recallTopic, false, MAX_DIRECT_SKILL_TOPIC_CANDIDATES),
        ),
      ),
    ]);
    const queryExactTopicRows = topicQuery
      ? (exactTopicRowPages[exactRecallTopics.indexOf(topicQuery)] ?? [])
      : [];
    const prefixTopicRows =
      topicQuery && queryExactTopicRows.length < MAX_DIRECT_SKILL_TOPIC_CANDIDATES
        ? await loadTopicRows(
            topicQuery,
            true,
            MAX_DIRECT_SKILL_TOPIC_CANDIDATES - queryExactTopicRows.length,
          )
        : [];
    const topicRows = [...exactTopicRowPages.flat(), ...prefixTopicRows]
      .flat()
      .filter(
        (row, index, all) =>
          all.findIndex((candidate) => candidate.skillId === row.skillId) === index,
      );
    const topicDigests = (
      await Promise.all(
        topicRows.map((row) =>
          ctx.db
            .query("skillSearchDigest")
            .withIndex("by_skill", (q) => q.eq("skillId", row.skillId))
            .unique(),
        ),
      )
    ).filter((digest): digest is Doc<"skillSearchDigest"> => digest !== null);
    // Mirrors the `matchesExactTokens` filter the vector path applies on
    // hydrated results, so every recall path shares one literal-match
    // contract. For single-token queries this gate is a no-op against the
    // existing prefix paths, since any prefix match also implies a token
    // match.
    const passesAllQueryTokens = (digest: Doc<"skillSearchDigest">) =>
      queryTokens.length === 0 ||
      matchesExactTokens(queryTokens, [
        digest.displayName,
        digest.slug,
        digest.summary,
        ...(digest.categories ?? []),
        ...(digest.topics ?? []),
      ]);

    const digests = [
      ...slugDigests,
      ...displayNameDigests,
      ...slugFirstTokenDigests,
      ...displayNameFirstTokenDigests,
      ...ftDisplayNameDigests,
      ...ftSlugDigests,
      ...topicDigests,
    ]
      .filter(
        (digest, index, all) =>
          all.findIndex((candidate) => candidate.skillId === digest.skillId) === index,
      )
      .filter(passesAllQueryTokens);
    if (digests.length === 0) return [];

    const getOwnerInfo = makeOwnerInfoGetter(ctx);
    const entries = await Promise.all(
      digests.map(async (digest): Promise<SkillSearchEntry | null> => {
        const skill = digestToHydratableSkill(digest);
        if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) return null;
        if (args.highlightedOnly && !isSkillHighlighted(skill)) return null;
        if (!matchesCatalogTopic(skill, topic)) return null;
        const preResolved = digestToOwnerInfo(digest);
        const resolved = preResolved?.owner
          ? preResolved
          : await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        const publicSkill = toPublicSkill(skill);
        if (!publicSkill || !resolved.owner) return null;
        return {
          skill: publicSkill,
          version: null as Doc<"skillVersions"> | null,
          ownerHandle: resolved.ownerHandle,
          owner: resolved.owner,
        };
      }),
    );

    return entries.filter((entry): entry is SkillSearchEntry => entry !== null);
  },
});

export const hydrateResults = internalQuery({
  args: {
    embeddingIds: v.array(v.id("skillEmbeddings")),
    nonSuspiciousOnly: v.optional(v.boolean()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) return [];
    // Only used as fallback when digest doesn't have owner data.
    const getOwnerInfo = makeOwnerInfoGetter(ctx);

    const entries: Array<SkillSearchEntry | null> = await Promise.all(
      args.embeddingIds.map(async (embeddingId) => {
        // Use lightweight lookup table (~100 bytes) instead of full embedding doc (~12KB).
        const lookup = await ctx.db
          .query("embeddingSkillMap")
          .withIndex("by_embedding", (q) => q.eq("embeddingId", embeddingId))
          .unique();
        // Fallback to full embedding doc for rows not yet backfilled.
        const skillId = lookup
          ? lookup.skillId
          : await ctx.db.get(embeddingId).then((e) => e?.skillId);
        if (!skillId) return null;
        // Use lightweight digest (~800 bytes) instead of full skill doc (~3-5KB).
        const digest = await ctx.db
          .query("skillSearchDigest")
          .withIndex("by_skill", (q) => q.eq("skillId", skillId))
          .unique();
        const skill: HydratableSkill | null = digest
          ? digestToHydratableSkill(digest)
          : await ctx.db.get(skillId);
        if (!skill || skill.softDeletedAt) return null;
        if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) return null;
        if (!matchesCatalogTopic(skill, topic)) return null;
        // Use pre-resolved owner from digest to avoid reading the users table.
        // Fall back to live lookup when digest owner is null (deactivated/deleted user).
        const preResolved = digest ? digestToOwnerInfo(digest) : null;
        const resolved = preResolved?.owner
          ? preResolved
          : await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        const publicSkill = toPublicSkill(skill);
        if (!publicSkill || !resolved.owner) return null;
        return {
          embeddingId,
          skill: publicSkill,
          version: null as Doc<"skillVersions"> | null,
          ownerHandle: resolved.ownerHandle,
          owner: resolved.owner,
        };
      }),
    );

    return entries.filter((entry): entry is SkillSearchEntry => entry !== null);
  },
});

export const lexicalFallbackSkills = internalQuery({
  args: {
    query: v.string(),
    queryTokens: v.array(v.string()),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
    skipExactSlugLookup: v.optional(v.boolean()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) return [];
    const limit = Math.min(Math.max(args.limit ?? 200, 10), FALLBACK_SCAN_LIMIT);
    const scanLimit = limit;
    const seenSkillIds = new Set<Id<"skills">>();
    const candidates: HydratableSkill[] = [];
    // Keep digest rows around so we can resolve owner info without hitting users table.
    const preResolvedOwners = new Map<
      Id<"skills">,
      { ownerHandle: string | null; owner: PublicPublisher | null }
    >();

    // Exact slug matches via the skills table. Slugs are unique per publisher,
    // so this read must tolerate multiple rows for the same global slug.
    // Use the lenient shape predicate so legacy rows with sub-min-length
    // slugs stay discoverable; the caller in searchSkills already passes
    // skipExactSlugLookup=true after running its own exact-slug lookup.
    const slugQuery = normalizeSkillSlug(args.query);
    if (!args.skipExactSlugLookup && isSearchableSkillSlugShape(slugQuery)) {
      const exactSlugSkills = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", slugQuery))
        .take(MAX_EXACT_SLUG_MATCHES);
      for (const exactSlugSkill of exactSlugSkills) {
        if (
          !exactSlugSkill.softDeletedAt &&
          (!args.nonSuspiciousOnly || !isSkillSuspicious(exactSlugSkill)) &&
          matchesCatalogTopic(exactSlugSkill, topic)
        ) {
          seenSkillIds.add(exactSlugSkill._id);
          candidates.push(exactSlugSkill);
        }
      }
    }

    // Scan recent active digests (~800 bytes each) instead of full skill docs (~3-5KB).
    // Use updatedAt and createdAt windows so newly published skills are visible even
    // when they are not in the most recently updated slice.
    const recentByUpdatedQuery = args.nonSuspiciousOnly
      ? ctx.db
          .query("skillSearchDigest")
          .withIndex("by_nonsuspicious_updated", (q) =>
            q.eq("softDeletedAt", undefined).eq("isSuspicious", false),
          )
      : ctx.db
          .query("skillSearchDigest")
          .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined));
    const recentByCreatedQuery = args.nonSuspiciousOnly
      ? ctx.db
          .query("skillSearchDigest")
          .withIndex("by_nonsuspicious_created", (q) =>
            q.eq("softDeletedAt", undefined).eq("isSuspicious", false),
          )
      : ctx.db
          .query("skillSearchDigest")
          .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined));

    const [recentByUpdated, recentByCreated] = await Promise.all([
      recentByUpdatedQuery.order("desc").take(scanLimit),
      recentByCreatedQuery.order("desc").take(scanLimit),
    ]);

    const addDigestCandidates = (digests: typeof recentByUpdated) => {
      for (const digest of digests) {
        if (seenSkillIds.has(digest.skillId)) continue;
        const skill = digestToHydratableSkill(digest);
        if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) continue;
        if (!matchesCatalogTopic(skill, topic)) continue;
        seenSkillIds.add(digest.skillId);
        candidates.push(skill);
        // Pre-resolve owner from digest to avoid users table reads.
        const ownerInfo = digestToOwnerInfo(digest);
        if (ownerInfo) preResolvedOwners.set(digest.skillId, ownerInfo);
      }
    };
    addDigestCandidates(recentByUpdated);
    addDigestCandidates(recentByCreated);

    const matched = candidates.filter((skill) =>
      matchesExactTokens(args.queryTokens, [
        skill.displayName,
        skill.slug,
        skill.summary,
        ...(skill.categories ?? []),
        ...(skill.topics ?? []),
      ]),
    );
    if (matched.length === 0) return [];

    // Only used as fallback for the exact slug match (no digest available).
    const getOwnerInfo = makeOwnerInfoGetter(ctx);

    const entries = await Promise.all(
      matched.map(async (skill) => {
        const preResolved = preResolvedOwners.get(skill._id);
        const resolved = preResolved?.owner
          ? preResolved
          : await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        const publicSkill = toPublicSkill(skill);
        if (!publicSkill || !resolved.owner) return null;
        return {
          skill: publicSkill,
          version: null as Doc<"skillVersions"> | null,
          ownerHandle: resolved.ownerHandle,
          owner: resolved.owner,
        };
      }),
    );
    const validEntries = entries.filter(Boolean) as SkillSearchEntry[];
    if (validEntries.length === 0) return [];

    const filtered = args.highlightedOnly
      ? validEntries.filter((entry) => isSkillHighlighted(entry.skill))
      : validEntries;
    return filtered.slice(0, limit);
  },
});

export const __test = {
  getNextCandidateLimit,
  matchesAllTokens,
  getLexicalBoost,
  scoreSkillResult,
  classifySkillMatch,
  mergeUniqueBySkillId,
};
