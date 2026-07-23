import {
  getCatalogTopicSlugs,
  INTERNAL_UNCATEGORIZED_CATEGORY,
  isSkillCategorySlug,
  normalizeCatalogTopic,
  resolveStoredSkillCategories,
  type SkillCategorySlug,
} from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { action, internalQuery } from "./functions";
import { isSkillHighlighted } from "./lib/badges";
import { generateEmbedding } from "./lib/embeddings";
import { loadAndRankMixedSkillCandidates, type MixedSkillCandidate } from "./lib/mixedSkillSearch";
import { hasOfficialPublisherRow, toPublicPublisherWithOfficial } from "./lib/officialPublishers";
import type { HydratableSkill, PublicPublisher } from "./lib/public";
import { toPublicSkill } from "./lib/public";
import {
  hasResolvablePublicBrowseVersionFromState,
  shouldExcludeSkillFromPublicBrowse,
} from "./lib/publicBrowse";
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
import {
  buildSkillsShMirrorSearchResult,
  type SkillsShMirrorDigest,
} from "./lib/skillsShMirrorPublic";
import { readCanonicalStat } from "./lib/skillStats";

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
    }).then(async (ownerDoc) => {
      const owner = await toPublicPublisherWithOfficial(ctx, ownerDoc);
      return {
        ownerHandle: owner?.handle ?? null,
        owner,
      };
    });
    ownerCache.set(cacheKey, ownerPromise);
    return ownerPromise;
  };
}

async function withOfficialOwnerInfo(ctx: Pick<QueryCtx, "db">, ownerInfo: OwnerInfo) {
  if (!ownerInfo.owner) return ownerInfo;
  if (ownerInfo.owner.official) return ownerInfo;
  const official = await hasOfficialPublisherRow(ctx, ownerInfo.owner._id);
  if (!official) return ownerInfo;
  return {
    ...ownerInfo,
    owner: {
      ...ownerInfo.owner,
      official: true,
    },
  };
}

type SkillSearchEntry = {
  embeddingId?: Id<"skillEmbeddings">;
  nativeDownloads: number;
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
type PublicNativeSearchResult = Omit<SkillSearchEntry, "nativeDownloads"> & {
  score: number;
};
type SkillsShSearchResult = NonNullable<ReturnType<typeof buildSkillsShMirrorSearchResult>> & {
  score: number;
};
type PublicSearchResult = PublicNativeSearchResult | SkillsShSearchResult;

type SearchSkillsArgs = {
  query: string;
  limit?: number;
  highlightedOnly?: boolean;
  nonSuspiciousOnly?: boolean;
  excludePendingScan?: boolean;
  categorySlug?: string;
  topic?: string;
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
// Scoped direct recall fans out across up to nine indexed reads in one query.
// Keep each source small enough that the aggregate stays below Convex read limits.
const MAX_FILTERED_DIRECT_SKILL_SCAN_CANDIDATES = 250;
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

function compareSkillTrustAndUsage(a: SkillSearchEntry, b: SkillSearchEntry) {
  return (
    Number(Boolean(b.owner?.official)) - Number(Boolean(a.owner?.official)) ||
    comparePopularityStats(
      { stars: a.skill.stats.stars, installsAllTime: a.skill.stats.installs },
      { stars: b.skill.stats.stars, installsAllTime: b.skill.stats.installs },
    ) ||
    b.nativeDownloads - a.nativeDownloads
  );
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

function normalizeSkillCategoryFilter(categorySlug: string | undefined) {
  if (categorySlug === undefined) return undefined;
  const normalized = categorySlug.trim().toLowerCase();
  return isSkillCategorySlug(normalized) ? normalized : null;
}

function matchesCatalogFilters(
  skill: Parameters<typeof resolveStoredSkillCategories>[0] & Pick<HydratableSkill, "topics">,
  categorySlug: SkillCategorySlug | undefined,
  topic: string | undefined,
) {
  return (
    (!categorySlug || resolveStoredSkillCategories(skill).includes(categorySlug)) &&
    matchesCatalogTopic(skill, topic)
  );
}

function toPublicSearchSkill(skill: HydratableSkill) {
  if (shouldExcludeSkillFromPublicBrowse(skill)) return null;
  return toPublicSkill({
    ...skill,
    categories: resolveStoredSkillCategories(skill),
  });
}

type SkillDigestCandidateQuery = {
  take: (limit: number) => Promise<Doc<"skillSearchDigest">[]>;
};
type SkillDigestCandidateQueryFactory = () => SkillDigestCandidateQuery;

async function collectFilteredSkillDigestCandidates(
  createQuery: SkillDigestCandidateQueryFactory,
  opts: {
    limit: number;
    scanLimit: number;
    matches: (digest: Doc<"skillSearchDigest">) => boolean;
  },
) {
  // Convex permits only one paginated read per query function. Use one bounded
  // take so the several recall indexes can be searched in the same transaction.
  const candidates = await createQuery().take(opts.scanLimit);
  return candidates.filter(opts.matches).slice(0, opts.limit);
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

function classifySkillsShMirrorMatch(
  query: string,
  queryTokens: string[],
  digest: Pick<Doc<"skillsShMirrorDigests">, "displayName" | "externalId" | "searchText" | "slug">,
): SearchMatch | null {
  const needle = normalizeSkillSearchText(query);
  const slug = normalizeSkillSearchText(digest.slug);
  const displayName = normalizeSkillSearchText(digest.displayName);
  const externalId = normalizeSkillSearchText(digest.externalId);
  if (
    needle === slug ||
    needle === displayName ||
    needle === externalId ||
    needle === `skills-sh:${externalId}`
  ) {
    return { rankTier: 0 };
  }
  if (slug.startsWith(needle) || displayName.startsWith(needle) || externalId.startsWith(needle)) {
    return { rankTier: 1 };
  }
  const identityTokens = tokenize(`${digest.slug} ${digest.displayName} ${digest.externalId}`);
  if (
    matchesAllTokens(queryTokens, identityTokens, (candidate, token) => candidate === token) ||
    matchesAllTokens(queryTokens, identityTokens, (candidate, token) => candidate.startsWith(token))
  ) {
    return { rankTier: 1 };
  }
  if (
    matchesAllTokens(queryTokens, tokenize(digest.searchText), (candidate, token) =>
      candidate.startsWith(token),
    )
  ) {
    return { rankTier: 3 };
  }
  return null;
}

async function loadSkillsShMirrorSearchCandidates(
  ctx: Pick<ActionCtx, "runQuery">,
  args: SearchSkillsArgs,
  limit: number,
): Promise<Array<MixedSkillCandidate<SkillsShSearchResult>>> {
  if (args.highlightedOnly) return [];
  const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
  if (categorySlug === null) return [];
  const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
  if (args.topic !== undefined && !topic) return [];
  const query = args.query.trim();
  const normalizedQuery = normalizeSkillSearchText(query);
  const firstToken = getFirstSearchToken(query);
  const queryTokens = tokenize(query);
  if (!normalizedQuery || queryTokens.length === 0 || limit <= 0) return [];
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const [
    exactSlug,
    exactDisplayName,
    slugPrefix,
    displayNamePrefix,
    slugFirstTokenPrefix,
    displayNameFirstTokenPrefix,
    fullText,
  ] = (await Promise.all([
    ctx.runQuery(internal.skillsShMirror.listActiveByNormalizedSlugInternal, {
      value: normalizedQuery,
      limit: boundedLimit,
    }),
    ctx.runQuery(internal.skillsShMirror.listActiveByNormalizedDisplayNameInternal, {
      value: normalizedQuery,
      limit: boundedLimit,
    }),
    ctx.runQuery(internal.skillsShMirror.listActiveByNormalizedSlugPrefixInternal, {
      prefix: normalizedQuery,
      limit: boundedLimit,
    }),
    ctx.runQuery(internal.skillsShMirror.listActiveByNormalizedDisplayNamePrefixInternal, {
      prefix: normalizedQuery,
      limit: boundedLimit,
    }),
    ctx.runQuery(internal.skillsShMirror.listActiveByNormalizedSlugFirstTokenPrefixInternal, {
      prefix: firstToken,
      limit: boundedLimit,
    }),
    ctx.runQuery(
      internal.skillsShMirror.listActiveByNormalizedDisplayNameFirstTokenPrefixInternal,
      {
        prefix: firstToken,
        limit: boundedLimit,
      },
    ),
    ctx.runQuery(internal.skillsShMirror.searchActiveBySearchTextInternal, {
      query,
      limit: boundedLimit,
    }),
  ])) as Array<Doc<"skillsShMirrorDigests">[]>;
  const digests = [
    ...exactSlug,
    ...exactDisplayName,
    ...slugPrefix,
    ...displayNamePrefix,
    ...slugFirstTokenPrefix,
    ...displayNameFirstTokenPrefix,
    ...fullText,
  ].filter(
    (digest, index, all) =>
      all.findIndex((candidate) => candidate.externalId === digest.externalId) === index,
  );

  return digests
    .map((digest): MixedSkillCandidate<SkillsShSearchResult> | null => {
      const publicResult = buildSkillsShMirrorSearchResult(
        digest as unknown as SkillsShMirrorDigest,
      );
      const match = classifySkillsShMirrorMatch(query, queryTokens, digest);
      if (!publicResult || !match) return null;
      if (
        (categorySlug && !publicResult.categories.includes(categorySlug)) ||
        (topic && !publicResult.topics.includes(topic))
      ) {
        return null;
      }
      const textScore = getLexicalBoost(queryTokens, digest.displayName, digest.slug);
      return {
        key: `skills-sh:${digest.externalId}`,
        value: { ...publicResult, score: textScore },
        source: "skills-sh",
        rankTier: match.rankTier,
        textScore,
        clawhubTrusted: false,
        popularity: Math.max(digest.upstreamInstalls, 0),
        freshness: digest.lastObservedAt,
      };
    })
    .filter(
      (candidate): candidate is MixedSkillCandidate<SkillsShSearchResult> => candidate !== null,
    );
}

export const listSkillsShMirrorBrowse: ReturnType<typeof action> = action({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: Array<NonNullable<ReturnType<typeof buildSkillsShMirrorSearchResult>>>;
    nextCursor: string | null;
    hasMore: boolean;
  }> => {
    const requestedLimit = Math.floor(args.limit ?? 25);
    if (requestedLimit <= 0) return { page: [], nextCursor: null, hasMore: false };
    const limit = Math.min(requestedLimit, 50);
    const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
    if (categorySlug === null) return { page: [], nextCursor: null, hasMore: false };
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) {
      return { page: [], nextCursor: null, hasMore: false };
    }

    type DigestPage = {
      page: Doc<"skillsShMirrorDigests">[];
      isDone: boolean;
      continueCursor: string;
    };
    const buildPage = (digests: Doc<"skillsShMirrorDigests">[]) =>
      digests.flatMap((digest) => {
        const result = buildSkillsShMirrorSearchResult(digest as unknown as SkillsShMirrorDigest);
        if (
          !result ||
          (categorySlug && !result.categories.includes(categorySlug)) ||
          (topic && !result.topics.includes(topic))
        ) {
          return [];
        }
        return [result];
      });

    if (!categorySlug && !topic) {
      const result = (await ctx.runQuery(
        internal.skillsShMirror.listActiveByUpstreamInstallsPageInternal,
        {
          paginationOpts: { numItems: limit, cursor: args.cursor ?? null },
        },
      )) as DigestPage;
      return {
        page: buildPage(result.page),
        nextCursor: result.isDone ? null : result.continueCursor,
        hasMore: !result.isDone,
      };
    }

    const page: Array<NonNullable<ReturnType<typeof buildSkillsShMirrorSearchResult>>> = [];
    let cursor = args.cursor ?? null;
    let isDone = false;
    let pagesRead = 0;
    // Bound one action invocation; nextCursor resumes the exact facet scan without dropping rows.
    while (page.length < limit && !isDone && pagesRead < 20) {
      const paginationOpts = { numItems: limit - page.length, cursor };
      const result =
        categorySlug === "other"
          ? ((await ctx.runQuery(internal.skillsShMirror.listActiveByUpstreamInstallsPageInternal, {
              paginationOpts,
            })) as DigestPage)
          : categorySlug
            ? ((await ctx.runQuery(internal.skillsShMirror.listActiveByCategoryInternal, {
                categorySlug,
                paginationOpts,
              })) as DigestPage)
            : ((await ctx.runQuery(internal.skillsShMirror.listActiveByTopicInternal, {
                topic: topic!,
                paginationOpts,
              })) as DigestPage);
      page.push(...buildPage(result.page));
      pagesRead += 1;
      isDone = result.isDone;
      const nextCursor = isDone ? null : result.continueCursor;
      if (!isDone && (!nextCursor || nextCursor === cursor)) {
        throw new Error("skills.sh mirror browse cursor did not advance");
      }
      cursor = nextCursor;
    }
    return {
      page,
      nextCursor: isDone ? null : cursor,
      hasMore: !isDone,
    };
  },
});

async function searchNativeSkillResults(
  ctx: ActionCtx,
  args: SearchSkillsArgs,
): Promise<SearchResult[]> {
  const query = args.query.trim();
  if (!query) return [];
  const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
  if (categorySlug === null) return [];
  const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
  if (args.topic !== undefined && !topic) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const rawExactSlugMatches = isSlugLikeQuery(query)
    ? ((await ctx.runQuery(internal.search.getExactSkillSlugMatch, {
        slug: query.toLowerCase(),
        nonSuspiciousOnly: args.nonSuspiciousOnly,
        categorySlug,
        topic,
      })) as SkillSearchEntry[] | SkillSearchEntry | null)
    : [];
  const exactSlugMatches = (
    Array.isArray(rawExactSlugMatches)
      ? rawExactSlugMatches
      : rawExactSlugMatches
        ? [rawExactSlugMatches]
        : []
  ).filter(
    (entry) =>
      (!args.highlightedOnly || isSkillHighlighted(entry.skill)) &&
      (!args.excludePendingScan || entry.skill.githubScanStatus !== "pending"),
  );
  const directPrefixMatches = (
    (await ctx.runQuery(internal.search.directPrefixSkillMatches, {
      query,
      highlightedOnly: args.highlightedOnly,
      nonSuspiciousOnly: args.nonSuspiciousOnly,
      categorySlug,
      topic,
    })) as SkillSearchEntry[]
  ).filter((entry) => !args.excludePendingScan || entry.skill.githubScanStatus !== "pending");
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
          categorySlug,
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
        (entry) =>
          (!args.highlightedOnly || isSkillHighlighted(entry.skill)) &&
          (!args.excludePendingScan || entry.skill.githubScanStatus !== "pending"),
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
          excludePendingScan: args.excludePendingScan,
          skipExactSlugLookup: true,
          categorySlug,
          topic,
        })) as SkillSearchEntry[]);
  const mergedMatches = mergeUniqueBySkillId(primaryMatches, fallbackMatches).filter(
    (entry) =>
      matchesCatalogFilters(entry.skill, categorySlug, topic) &&
      (!args.excludePendingScan || entry.skill.githubScanStatus !== "pending"),
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
            installsAllTime: entry.skill.stats.installs,
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
        compareSkillTrustAndUsage(a, b) ||
        b.skill.updatedAt - a.skill.updatedAt,
    )
    .slice(0, limit);
  return rankedMatches;
}

export const searchSkills: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
    excludePendingScan: v.optional(v.boolean()),
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PublicSearchResult[]> => {
    const resultLimit = Math.max(0, Math.floor(args.limit ?? 10));
    if (!args.query.trim() || resultLimit === 0) return [];
    const nativeLimit = resultLimit;
    const externalLimit = Math.min(Math.max(resultLimit * 2, 25), 50);
    const ranked = await loadAndRankMixedSkillCandidates({
      loadNative: async () => {
        const results = await searchNativeSkillResults(ctx, {
          ...args,
          limit: nativeLimit,
        });
        return results.map((entry): MixedSkillCandidate<PublicNativeSearchResult> => {
          const { nativeDownloads, rankTier, ...value } = entry;
          return {
            key: `native:${entry.skill._id}`,
            value,
            source: "native",
            rankTier,
            textScore: entry.score,
            clawhubTrusted: true,
            popularity: Math.max(entry.skill.stats.stars, 0),
            secondaryPopularity: Math.max(entry.skill.stats.installs, 0),
            tertiaryPopularity: Math.max(nativeDownloads, 0),
            freshness: entry.skill.updatedAt,
          };
        });
      },
      loadExternal: async () => await loadSkillsShMirrorSearchCandidates(ctx, args, externalLimit),
      nativeLimit,
      externalLimit,
      resultLimit,
    });
    return ranked.map((candidate) => candidate.value);
  },
});

export const getExactSkillSlugMatch = internalQuery({
  args: {
    slug: v.string(),
    nonSuspiciousOnly: v.optional(v.boolean()),
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
    if (categorySlug === null) return [];
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
        if (!matchesCatalogFilters(skill, categorySlug, topic)) return null;

        const resolved = await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        const publicSkill = toPublicSearchSkill(skill);
        if (!publicSkill || !resolved.owner) return null;

        const entry: SkillSearchEntry = {
          nativeDownloads: readCanonicalStat(skill, "downloads"),
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
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
    if (categorySlug === null) return [];
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
    const passesAllQueryTokens = (digest: Doc<"skillSearchDigest">) =>
      queryTokens.length === 0 ||
      matchesExactTokens(queryTokens, [
        digest.displayName,
        digest.slug,
        digest.summary,
        ...(digest.categories ?? []),
        ...(digest.topics ?? []),
      ]);
    const matchesDirectRecallFilters = (digest: Doc<"skillSearchDigest">) => {
      const skill = digestToHydratableSkill(digest);
      return (
        !shouldExcludeSkillFromPublicBrowse(skill) &&
        (!args.highlightedOnly || isSkillHighlighted(skill)) &&
        passesAllQueryTokens(digest) &&
        matchesCatalogFilters(skill, categorySlug, topic)
      );
    };
    const needsExpandedRecall = Boolean(
      categorySlug || topic || args.highlightedOnly || queryTokens.length > 1,
    );
    const directScanLimit = (candidateLimit: number) =>
      needsExpandedRecall ? MAX_FILTERED_DIRECT_SKILL_SCAN_CANDIDATES : candidateLimit;
    const loadTopicDigests = async (recallTopic: string, usePrefix: boolean, limit: number) => {
      const createQuery = () =>
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
              .order("desc");
      const scanLimit = needsExpandedRecall ? MAX_FILTERED_DIRECT_SKILL_SCAN_CANDIDATES : limit;
      const rows = await createQuery().take(scanLimit);
      const digests = await Promise.all(
        rows.map((row) =>
          ctx.db
            .query("skillSearchDigest")
            .withIndex("by_skill", (q) => q.eq("skillId", row.skillId))
            .unique(),
        ),
      );
      return digests
        .filter(
          (digest): digest is Doc<"skillSearchDigest"> =>
            digest !== null && matchesDirectRecallFilters(digest),
        )
        .slice(0, limit);
    };

    const upperBound = prefixUpperBound(normalizedQuery);
    const firstTokenUpperBound = firstToken ? prefixUpperBound(firstToken) : null;
    const collectDirectCandidates = (
      createQuery: SkillDigestCandidateQueryFactory,
      limit: number,
    ) =>
      collectFilteredSkillDigestCandidates(createQuery, {
        limit,
        scanLimit: directScanLimit(limit),
        matches: matchesDirectRecallFilters,
      });
    const [
      slugDigests,
      displayNameDigests,
      slugFirstTokenDigests,
      displayNameFirstTokenDigests,
      ftDisplayNameDigests,
      ftSlugDigests,
      exactTopicDigestPages,
    ] = await Promise.all([
      collectDirectCandidates(
        () =>
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
            : ctx.db
                .query("skillSearchDigest")
                .withIndex("by_active_normalized_slug", (q) =>
                  q
                    .eq("softDeletedAt", undefined)
                    .gte("normalizedSlug", normalizedQuery)
                    .lt("normalizedSlug", upperBound),
                ),
        MAX_DIRECT_SKILL_SEARCH_CANDIDATES,
      ),
      collectDirectCandidates(
        () =>
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
            : ctx.db
                .query("skillSearchDigest")
                .withIndex("by_active_normalized_display_name", (q) =>
                  q
                    .eq("softDeletedAt", undefined)
                    .gte("normalizedDisplayName", normalizedQuery)
                    .lt("normalizedDisplayName", upperBound),
                ),
        MAX_DIRECT_SKILL_SEARCH_CANDIDATES,
      ),
      firstTokenUpperBound
        ? collectDirectCandidates(
            () =>
              args.nonSuspiciousOnly
                ? ctx.db
                    .query("skillSearchDigest")
                    .withIndex("by_nonsuspicious_normalized_slug_first_token", (q) =>
                      q
                        .eq("softDeletedAt", undefined)
                        .eq("isSuspicious", false)
                        .gte("normalizedSlugFirstToken", firstToken)
                        .lt("normalizedSlugFirstToken", firstTokenUpperBound),
                    )
                : ctx.db
                    .query("skillSearchDigest")
                    .withIndex("by_active_normalized_slug_first_token", (q) =>
                      q
                        .eq("softDeletedAt", undefined)
                        .gte("normalizedSlugFirstToken", firstToken)
                        .lt("normalizedSlugFirstToken", firstTokenUpperBound),
                    ),
            MAX_DIRECT_SKILL_SEARCH_CANDIDATES,
          )
        : Promise.resolve([]),
      firstTokenUpperBound
        ? collectDirectCandidates(
            () =>
              args.nonSuspiciousOnly
                ? ctx.db
                    .query("skillSearchDigest")
                    .withIndex("by_nonsuspicious_normalized_display_name_first_token", (q) =>
                      q
                        .eq("softDeletedAt", undefined)
                        .eq("isSuspicious", false)
                        .gte("normalizedDisplayNameFirstToken", firstToken)
                        .lt("normalizedDisplayNameFirstToken", firstTokenUpperBound),
                    )
                : ctx.db
                    .query("skillSearchDigest")
                    .withIndex("by_active_normalized_display_name_first_token", (q) =>
                      q
                        .eq("softDeletedAt", undefined)
                        .gte("normalizedDisplayNameFirstToken", firstToken)
                        .lt("normalizedDisplayNameFirstToken", firstTokenUpperBound),
                    ),
            MAX_DIRECT_SKILL_SEARCH_CANDIDATES,
          )
        : Promise.resolve([]),
      // Full-text search on displayName — matches any token at any position.
      // Resolves Bug (non-first-token undiscoverable) by leveraging the
      // Convex inverted index added in `search_by_display_name`.
      collectDirectCandidates(
        () =>
          args.nonSuspiciousOnly
            ? ctx.db
                .query("skillSearchDigest")
                .withSearchIndex("search_by_display_name", (q) =>
                  q
                    .search("displayName", args.query)
                    .eq("softDeletedAt", undefined)
                    .eq("isSuspicious", false),
                )
            : ctx.db
                .query("skillSearchDigest")
                .withSearchIndex("search_by_display_name", (q) =>
                  q.search("displayName", args.query).eq("softDeletedAt", undefined),
                ),
        MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES,
      ),
      // Full-text search on slug — same rationale, covers slug middle/tail tokens
      // (e.g. "yijian" or "vision" inside "baidu-yijian-vision").
      collectDirectCandidates(
        () =>
          args.nonSuspiciousOnly
            ? ctx.db
                .query("skillSearchDigest")
                .withSearchIndex("search_by_slug", (q) =>
                  q
                    .search("slug", args.query)
                    .eq("softDeletedAt", undefined)
                    .eq("isSuspicious", false),
                )
            : ctx.db
                .query("skillSearchDigest")
                .withSearchIndex("search_by_slug", (q) =>
                  q.search("slug", args.query).eq("softDeletedAt", undefined),
                ),
        MAX_DIRECT_SKILL_FULL_TEXT_CANDIDATES,
      ),
      Promise.all(
        exactRecallTopics.map((recallTopic) =>
          loadTopicDigests(recallTopic, false, MAX_DIRECT_SKILL_TOPIC_CANDIDATES),
        ),
      ),
    ]);
    const queryExactTopicDigests = topicQuery
      ? (exactTopicDigestPages[exactRecallTopics.indexOf(topicQuery)] ?? [])
      : [];
    const prefixTopicDigests =
      topicQuery && queryExactTopicDigests.length < MAX_DIRECT_SKILL_TOPIC_CANDIDATES
        ? await loadTopicDigests(
            topicQuery,
            true,
            MAX_DIRECT_SKILL_TOPIC_CANDIDATES - queryExactTopicDigests.length,
          )
        : [];
    const topicDigests = [...exactTopicDigestPages.flat(), ...prefixTopicDigests]
      .flat()
      .filter(
        (digest, index, all) =>
          all.findIndex((candidate) => candidate.skillId === digest.skillId) === index,
      );
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
        if (!matchesCatalogFilters(skill, categorySlug, topic)) return null;
        const preResolved = digestToOwnerInfo(digest);
        const resolved = preResolved?.owner
          ? await withOfficialOwnerInfo(ctx, preResolved)
          : await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        const publicSkill = toPublicSearchSkill(skill);
        if (!publicSkill || !resolved.owner) return null;
        return {
          nativeDownloads: readCanonicalStat(skill, "downloads"),
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
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
    if (categorySlug === null) return [];
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
        if (!matchesCatalogFilters(skill, categorySlug, topic)) return null;
        // Use pre-resolved owner from digest to avoid reading the users table.
        // Fall back to live lookup when digest owner is null (deactivated/deleted user).
        const preResolved = digest ? digestToOwnerInfo(digest) : null;
        const resolved = preResolved?.owner
          ? await withOfficialOwnerInfo(ctx, preResolved)
          : await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        if (!resolved.owner) return null;
        if (
          !(await hasResolvablePublicBrowseVersionFromState(
            ctx,
            { ...skill, _id: skillId },
            digest?.publicVersion,
          ))
        )
          return null;
        const publicSkill = toPublicSearchSkill(skill);
        if (!publicSkill) return null;
        return {
          embeddingId,
          nativeDownloads: readCanonicalStat(skill, "downloads"),
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
    excludePendingScan: v.optional(v.boolean()),
    skipExactSlugLookup: v.optional(v.boolean()),
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    const categorySlug = normalizeSkillCategoryFilter(args.categorySlug);
    if (categorySlug === null) return [];
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
    const publicVersions = new Map<Id<"skills">, Doc<"skillSearchDigest">["publicVersion"]>();

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
          !shouldExcludeSkillFromPublicBrowse(exactSlugSkill) &&
          (!args.nonSuspiciousOnly || !isSkillSuspicious(exactSlugSkill)) &&
          (!args.excludePendingScan || exactSlugSkill.githubScanStatus !== "pending") &&
          matchesCatalogFilters(exactSlugSkill, categorySlug, topic)
        ) {
          seenSkillIds.add(exactSlugSkill._id);
          candidates.push(exactSlugSkill);
        }
      }
    }

    // Scan recent active digests (~800 bytes each) instead of full skill docs (~3-5KB).
    // Use updatedAt and createdAt windows so newly published skills are visible even
    // when they are not in the most recently updated slice.
    const createRecentByUpdatedQuery = () =>
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillSearchDigest")
            .withIndex("by_nonsuspicious_updated", (q) =>
              q.eq("softDeletedAt", undefined).eq("isSuspicious", false),
            )
            .order("desc")
        : ctx.db
            .query("skillSearchDigest")
            .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
            .order("desc");
    const createRecentByCreatedQuery = () =>
      args.nonSuspiciousOnly
        ? ctx.db
            .query("skillSearchDigest")
            .withIndex("by_nonsuspicious_created", (q) =>
              q.eq("softDeletedAt", undefined).eq("isSuspicious", false),
            )
            .order("desc")
        : ctx.db
            .query("skillSearchDigest")
            .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
            .order("desc");

    const filteredScanLimit =
      categorySlug || topic || args.highlightedOnly ? FALLBACK_SCAN_LIMIT : scanLimit;
    const matchesFallbackRecallFilters = (digest: Doc<"skillSearchDigest">) => {
      const skill = digestToHydratableSkill(digest);
      return (
        !shouldExcludeSkillFromPublicBrowse(skill) &&
        (!args.highlightedOnly || isSkillHighlighted(skill)) &&
        (!args.excludePendingScan || skill.githubScanStatus !== "pending") &&
        matchesCatalogFilters(skill, categorySlug, topic) &&
        matchesExactTokens(args.queryTokens, [
          skill.displayName,
          skill.slug,
          skill.summary,
          ...(skill.categories ?? []),
          ...(skill.topics ?? []),
        ])
      );
    };
    const [recentByUpdated, recentByCreated] = await Promise.all([
      collectFilteredSkillDigestCandidates(createRecentByUpdatedQuery, {
        limit: scanLimit,
        scanLimit: filteredScanLimit,
        matches: matchesFallbackRecallFilters,
      }),
      collectFilteredSkillDigestCandidates(createRecentByCreatedQuery, {
        limit: scanLimit,
        scanLimit: filteredScanLimit,
        matches: matchesFallbackRecallFilters,
      }),
    ]);

    const addDigestCandidates = (digests: typeof recentByUpdated) => {
      for (const digest of digests) {
        if (seenSkillIds.has(digest.skillId)) continue;
        const skill = digestToHydratableSkill(digest);
        if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) continue;
        if (args.excludePendingScan && skill.githubScanStatus === "pending") continue;
        if (!matchesCatalogFilters(skill, categorySlug, topic)) continue;
        seenSkillIds.add(digest.skillId);
        candidates.push(skill);
        // Pre-resolve owner from digest to avoid users table reads.
        const ownerInfo = digestToOwnerInfo(digest);
        if (ownerInfo) preResolvedOwners.set(digest.skillId, ownerInfo);
        publicVersions.set(digest.skillId, digest.publicVersion);
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
          ? await withOfficialOwnerInfo(ctx, preResolved)
          : await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
        if (!resolved.owner) return null;
        if (
          !(await hasResolvablePublicBrowseVersionFromState(
            ctx,
            { ...skill, _id: skill._id },
            publicVersions.get(skill._id),
          ))
        )
          return null;
        const publicSkill = toPublicSearchSkill(skill);
        if (!publicSkill) return null;
        return {
          nativeDownloads: readCanonicalStat(skill, "downloads"),
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
