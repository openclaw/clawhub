import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalQuery } from "./functions";
import { isSkillHighlighted } from "./lib/badges";
import { generateEmbedding } from "./lib/embeddings";
import type { HydratableSkill, PublicPublisher } from "./lib/public";
import { toPublicPublisher, toPublicSkill, toPublicSoul } from "./lib/public";
import { SKILL_CAPABILITY_TAGS } from "./lib/skillCapabilityTags";
import { getOwnerPublisher } from "./lib/publishers";
import { matchesExactTokens, tokenize } from "./lib/searchText";
import { isSkillSuspicious } from "./lib/skillSafety";
import { digestToHydratableSkill, digestToOwnerInfo } from "./lib/skillSearchDigest";

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

type SearchResult = SkillSearchEntry & { score: number };

const SLUG_EXACT_BOOST = 1.4;
const SLUG_PREFIX_BOOST = 0.8;
const NAME_EXACT_BOOST = 1.1;
const NAME_PREFIX_BOOST = 0.6;
const POPULARITY_WEIGHT = 0.08;
const FALLBACK_SCAN_LIMIT = 500;
const SKILL_CAPABILITY_TAG_SET = new Set<string>(SKILL_CAPABILITY_TAGS);

function getNextCandidateLimit(current: number, max: number) {
  const next = Math.min(current * 2, max);
  return next > current ? next : null;
}

function matchesAllTokens(
  queryTokens: string[],
  candidateTokens: string[],
  matcher: (candidate: string, query: string) => boolean,
) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false;
  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => matcher(candidateToken, queryToken)),
  );
}

function getLexicalBoost(queryTokens: string[], displayName: string, slug: string) {
  const slugTokens = tokenize(slug);
  const nameTokens = tokenize(displayName);

  let boost = 0;
  if (matchesAllTokens(queryTokens, slugTokens, (candidate, query) => candidate === query)) {
    boost += SLUG_EXACT_BOOST;
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

function scoreSkillResult(
  queryTokens: string[],
  vectorScore: number,
  displayName: string,
  slug: string,
  downloads: number,
) {
  const lexicalBoost = getLexicalBoost(queryTokens, displayName, slug);
  const popularityBoost = Math.log1p(Math.max(downloads, 0)) * POPULARITY_WEIGHT;
  return vectorScore + lexicalBoost + popularityBoost;
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

function isSlugLikeQuery(query: string) {
  return /^[a-z0-9][a-z0-9-]*$/.test(query.trim().toLowerCase());
}

function matchesCapabilityTag(
  skill: Pick<HydratableSkill, "capabilityTags">,
  capabilityTag?: string,
) {
  if (!capabilityTag) return true;
  return (skill.capabilityTags ?? []).includes(capabilityTag);
}

export const searchSkills: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    highlightedOnly: v.optional(v.boolean()),
    nonSuspiciousOnly: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchResult[]> => {
    const query = args.query.trim();
    if (!query) return [];
    if (args.capabilityTag && !SKILL_CAPABILITY_TAG_SET.has(args.capabilityTag)) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const rawExactSlugMatch = isSlugLikeQuery(query)
      ? ((await ctx.runQuery(internal.search.getExactSkillSlugMatch, {
          slug: query.toLowerCase(),
          nonSuspiciousOnly: args.nonSuspiciousOnly,
        })) as SkillSearchEntry | null)
      : null;
    const exactSlugMatch =
      rawExactSlugMatch &&
      (!args.highlightedOnly || isSkillHighlighted(rawExactSlugMatch.skill)) &&
      matchesCapabilityTag(rawExactSlugMatch.skill, args.capabilityTag)
        ? rawExactSlugMatch
        : null;
    let vector: number[];
    try {
      vector = await generateEmbedding(query);
    } catch (error) {
      console.warn("Search embedding generation failed", error);
      return [];
    }
    const limit = args.limit ?? 10;
    // Convex vectorSearch max limit is 256; clamp candidate sizes accordingly.
    const maxCandidate = Math.min(Math.max(limit * 10, 200), 256);
    let candidateLimit = Math.min(Math.max(limit * 3, 50), 256);
    let hydrated: SkillSearchEntry[] = [];
    const seenEmbeddingIds = new Set<Id<"skillEmbeddings">>();
    let scoreById = new Map<Id<"skillEmbeddings">, number>();
    let exactMatches: SkillSearchEntry[] = [];

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
        })) as SkillSearchEntry[];
        hydrated = [...hydrated, ...newEntries];
      }

      scoreById = new Map<Id<"skillEmbeddings">, number>(
        results.map((result) => [result._id, result._score]),
      );

      // Skills already have badges from their docs (via toPublicSkill).
      // No need for a separate badge table lookup.
      const filtered = hydrated.filter(
        (entry) =>
          (!args.highlightedOnly || isSkillHighlighted(entry.skill)) &&
          matchesCapabilityTag(entry.skill, args.capabilityTag),
      );

      exactMatches = filtered.filter((entry) =>
        matchesExactTokens(queryTokens, [
          entry.skill.displayName,
          entry.skill.slug,
          entry.skill.summary,
        ]),
      );

      if (exactMatches.length >= limit || results.length < candidateLimit) {
        break;
      }

      const nextLimit = getNextCandidateLimit(candidateLimit, maxCandidate);
      if (!nextLimit) break;
      candidateLimit = nextLimit;
    }

    const primaryMatches = exactSlugMatch
      ? mergeUniqueBySkillId([exactSlugMatch], exactMatches)
      : exactMatches;

    const fallbackMatches =
      primaryMatches.length >= limit
        ? []
        : ((await ctx.runQuery(internal.search.lexicalFallbackSkills, {
            query,
            queryTokens,
            limit: Math.min(Math.max(limit * 4, 200), FALLBACK_SCAN_LIMIT),
            highlightedOnly: args.highlightedOnly,
            nonSuspiciousOnly: args.nonSuspiciousOnly,
            capabilityTag: args.capabilityTag,
            skipExactSlugLookup: true,
          })) as SkillSearchEntry[]);
    const mergedMatches = mergeUniqueBySkillId(primaryMatches, fallbackMatches);

    return mergedMatches
      .map((entry) => {
        const vectorScore = entry.embeddingId ? (scoreById.get(entry.embeddingId) ?? 0) : 0;
        return {
          ...entry,
          score: scoreSkillResult(
            queryTokens,
            vectorScore,
            entry.skill.displayName,
            entry.skill.slug,
            entry.skill.stats.downloads,
          ),
        };
      })
      .filter((entry) => entry.skill)
      .sort((a, b) => b.score - a.score || b.skill.stats.downloads - a.skill.stats.downloads)
      .slice(0, limit);
  },
});

export const getExactSkillSlugMatch = internalQuery({
  args: {
    slug: v.string(),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry | null> => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!skill || skill.softDeletedAt) return null;
    if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) return null;

    const getOwnerInfo = makeOwnerInfoGetter(ctx);
    const resolved = await getOwnerInfo(skill.ownerUserId, skill.ownerPublisherId);
    const publicSkill = toPublicSkill(skill);
    if (!publicSkill || !resolved.owner) return null;

    return {
      skill: publicSkill,
      version: null,
      ownerHandle: resolved.ownerHandle,
      owner: resolved.owner,
    };
  },
});

export const hydrateResults = internalQuery({
  args: {
    embeddingIds: v.array(v.id("skillEmbeddings")),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
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
    capabilityTag: v.optional(v.string()),
    skipExactSlugLookup: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SkillSearchEntry[]> => {
    if (args.capabilityTag && !SKILL_CAPABILITY_TAG_SET.has(args.capabilityTag)) return [];
    const limit = Math.min(Math.max(args.limit ?? 200, 10), FALLBACK_SCAN_LIMIT);
    const seenSkillIds = new Set<Id<"skills">>();
    const candidates: HydratableSkill[] = [];
    // Keep digest rows around so we can resolve owner info without hitting users table.
    const preResolvedOwners = new Map<
      Id<"skills">,
      { ownerHandle: string | null; owner: PublicPublisher | null }
    >();

    // Exact slug match via the skills table (only one row, cheap).
    const slugQuery = args.query.trim().toLowerCase();
    if (!args.skipExactSlugLookup && /^[a-z0-9][a-z0-9-]*$/.test(slugQuery)) {
      const exactSlugSkill = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", slugQuery))
        .unique();
      if (
        exactSlugSkill &&
        !exactSlugSkill.softDeletedAt &&
        (!args.nonSuspiciousOnly || !isSkillSuspicious(exactSlugSkill)) &&
        matchesCapabilityTag(exactSlugSkill, args.capabilityTag)
      ) {
        seenSkillIds.add(exactSlugSkill._id);
        candidates.push(exactSlugSkill);
      }
    }

    // Scan recent active digests (~800 bytes each) instead of full skill docs (~3-5KB).
    const recentDigests = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
      .order("desc")
      .take(FALLBACK_SCAN_LIMIT);

    for (const digest of recentDigests) {
      if (seenSkillIds.has(digest.skillId)) continue;
      const skill = digestToHydratableSkill(digest);
      if (args.nonSuspiciousOnly && isSkillSuspicious(skill)) continue;
      if (!matchesCapabilityTag(skill, args.capabilityTag)) continue;
      seenSkillIds.add(digest.skillId);
      candidates.push(skill);
      // Pre-resolve owner from digest to avoid users table reads.
      const ownerInfo = digestToOwnerInfo(digest);
      if (ownerInfo) preResolvedOwners.set(digest.skillId, ownerInfo);
    }

    const matched = candidates.filter((skill) =>
      matchesExactTokens(args.queryTokens, [skill.displayName, skill.slug, skill.summary]),
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

type HydratedSoulEntry = {
  embeddingId: Id<"soulEmbeddings">;
  soul: NonNullable<ReturnType<typeof toPublicSoul>>;
  version: Doc<"soulVersions"> | null;
};

type SoulSearchResult = HydratedSoulEntry & { score: number };

export const searchSouls: ReturnType<typeof action> = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SoulSearchResult[]> => {
    const query = args.query.trim();
    if (!query) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    let vector: number[];
    try {
      vector = await generateEmbedding(query);
    } catch (error) {
      console.warn("Search embedding generation failed", error);
      return [];
    }
    const limit = args.limit ?? 10;
    // Convex vectorSearch max limit is 256; clamp candidate sizes accordingly.
    const maxCandidate = Math.min(Math.max(limit * 10, 200), 256);
    let candidateLimit = Math.min(Math.max(limit * 3, 50), 256);
    let hydrated: HydratedSoulEntry[] = [];
    let scoreById = new Map<Id<"soulEmbeddings">, number>();
    let exactMatches: HydratedSoulEntry[] = [];

    while (candidateLimit <= maxCandidate) {
      const results = await ctx.vectorSearch("soulEmbeddings", "by_embedding", {
        vector,
        limit: candidateLimit,
        filter: (q) => q.or(q.eq("visibility", "latest"), q.eq("visibility", "latest-approved")),
      });

      hydrated = (await ctx.runQuery(internal.search.hydrateSoulResults, {
        embeddingIds: results.map((result) => result._id),
      })) as HydratedSoulEntry[];

      scoreById = new Map<Id<"soulEmbeddings">, number>(
        results.map((result) => [result._id, result._score]),
      );

      exactMatches = hydrated.filter((entry) =>
        matchesExactTokens(queryTokens, [
          entry.soul.displayName,
          entry.soul.slug,
          entry.soul.summary,
        ]),
      );

      if (exactMatches.length >= limit || results.length < candidateLimit) {
        break;
      }

      const nextLimit = getNextCandidateLimit(candidateLimit, maxCandidate);
      if (!nextLimit) break;
      candidateLimit = nextLimit;
    }

    return exactMatches
      .map((entry) => ({
        ...entry,
        score: scoreById.get(entry.embeddingId) ?? 0,
      }))
      .filter((entry) => entry.soul)
      .slice(0, limit);
  },
});

export const hydrateSoulResults = internalQuery({
  args: { embeddingIds: v.array(v.id("soulEmbeddings")) },
  handler: async (ctx, args): Promise<HydratedSoulEntry[]> => {
    const entries: HydratedSoulEntry[] = [];

    for (const embeddingId of args.embeddingIds) {
      const embedding = await ctx.db.get(embeddingId);
      if (!embedding) continue;
      const soul = await ctx.db.get(embedding.soulId);
      if (soul?.softDeletedAt) continue;
      const version = await ctx.db.get(embedding.versionId);
      const publicSoul = toPublicSoul(soul);
      if (!publicSoul) continue;
      entries.push({ embeddingId, soul: publicSoul, version });
    }

    return entries;
  },
});

export const __test = {
  getNextCandidateLimit,
  matchesAllTokens,
  getLexicalBoost,
  scoreSkillResult,
  mergeUniqueBySkillId,
};
