import { v } from "convex/values";
import { query, internalMutation } from "./functions";
import { toDayKey } from "./lib/leaderboards";

const TRENDING_SEARCH_DAYS = 7;
const TRENDING_SEARCH_DAY_SCAN_LIMIT = 50;
const DEFAULT_TRENDING_SEARCH_LIMIT = 4;
const MAX_TRENDING_SEARCH_LIMIT = 8;
const MIN_PUBLIC_TRENDING_SEARCH_COUNT = 10;
const SEARCH_DEDUPE_RETENTION_DAYS = 14;
const DEFAULT_SEARCH_DEDUPE_PRUNE_BATCH_SIZE = 500;
const MAX_SEARCH_DEDUPE_PRUNE_BATCH_SIZE = 1_000;
const MIN_SEARCH_QUERY_LENGTH = 3;
const MAX_SEARCH_QUERY_LENGTH = 80;
const MAX_SEARCH_QUERY_TOKENS = 8;

type SearchStatRow = {
  normalizedQuery: string;
  displayQuery: string;
  count: number;
  lastSearchedAt: number;
};

type RankedSearch = {
  query: string;
  count: number;
};

export function normalizePublicSearchQuery(input: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  if (compact.length < MIN_SEARCH_QUERY_LENGTH || compact.length > MAX_SEARCH_QUERY_LENGTH) {
    return null;
  }

  const tokens = compact.split(" ");
  if (tokens.length > MAX_SEARCH_QUERY_TOKENS) return null;
  if (!/[a-z0-9]/i.test(compact)) return null;
  if (looksLikePrivateIdentifier(compact) || looksLikeUrl(compact) || looksLikeSecret(compact)) {
    return null;
  }

  const normalizedQuery = compact.toLowerCase();
  return {
    normalizedQuery,
    displayQuery: normalizedQuery,
  };
}

export function rankTrendingSearches(
  perDayRows: SearchStatRow[][],
  options?: { limit?: number; minCount?: number },
): RankedSearch[] {
  const limit = clampInt(
    options?.limit ?? DEFAULT_TRENDING_SEARCH_LIMIT,
    1,
    MAX_TRENDING_SEARCH_LIMIT,
  );
  const minCount = Math.max(1, Math.floor(options?.minCount ?? MIN_PUBLIC_TRENDING_SEARCH_COUNT));
  const totals = new Map<string, SearchStatRow>();

  for (const rows of perDayRows) {
    for (const row of rows) {
      const current = totals.get(row.normalizedQuery);
      if (!current) {
        totals.set(row.normalizedQuery, { ...row });
        continue;
      }
      current.count += row.count;
      if (row.lastSearchedAt >= current.lastSearchedAt) {
        current.displayQuery = row.displayQuery;
        current.lastSearchedAt = row.lastSearchedAt;
      }
    }
  }

  return [...totals.values()]
    .filter((row) => row.count >= minCount)
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.lastSearchedAt - a.lastSearchedAt ||
        a.displayQuery.localeCompare(b.displayQuery),
    )
    .slice(0, limit)
    .map((row) => ({ query: row.displayQuery, count: row.count }));
}

export const recordSearchInternal = internalMutation({
  args: {
    query: v.string(),
    bucketKey: v.string(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizePublicSearchQuery(args.query);
    if (!normalized) return { recorded: false };

    const now = args.occurredAt ?? Date.now();
    const day = toDayKey(now);
    const bucketKey = args.bucketKey.trim().slice(0, 96);
    if (!bucketKey) return { recorded: false };

    const existingBucket = await ctx.db
      .query("searchQueryDailyDedupe")
      .withIndex("by_query_day_bucket", (q) =>
        q
          .eq("normalizedQuery", normalized.normalizedQuery)
          .eq("day", day)
          .eq("bucketKey", bucketKey),
      )
      .unique();

    if (existingBucket) return { recorded: false };

    const existing = await ctx.db
      .query("searchQueryDailyStats")
      .withIndex("by_normalized_query_day", (q) =>
        q.eq("normalizedQuery", normalized.normalizedQuery).eq("day", day),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("searchQueryDailyStats", {
        ...normalized,
        day,
        count: 1,
        lastSearchedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        displayQuery: normalized.displayQuery,
        count: existing.count + 1,
        lastSearchedAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("searchQueryDailyDedupe", {
      normalizedQuery: normalized.normalizedQuery,
      day,
      bucketKey,
      createdAt: now,
    });
    return { recorded: true };
  },
});

export const listTrendingSearches = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(
      args.limit ?? DEFAULT_TRENDING_SEARCH_LIMIT,
      1,
      MAX_TRENDING_SEARCH_LIMIT,
    );
    const endDay = toDayKey(Date.now());
    const startDay = endDay - (TRENDING_SEARCH_DAYS - 1);
    const perDayRows: SearchStatRow[][] = [];

    for (let day = startDay; day <= endDay; day += 1) {
      const rows = await ctx.db
        .query("searchQueryDailyStats")
        .withIndex("by_day_count", (q) => q.eq("day", day))
        .order("desc")
        .take(TRENDING_SEARCH_DAY_SCAN_LIMIT);
      perDayRows.push(rows);
    }

    return rankTrendingSearches(perDayRows, {
      limit,
      minCount: MIN_PUBLIC_TRENDING_SEARCH_COUNT,
    });
  },
});

export const pruneSearchQueryDailyDedupeInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(
      args.batchSize ?? DEFAULT_SEARCH_DEDUPE_PRUNE_BATCH_SIZE,
      1,
      MAX_SEARCH_DEDUPE_PRUNE_BATCH_SIZE,
    );
    const cutoffDay = toDayKey(Date.now()) - SEARCH_DEDUPE_RETENTION_DAYS;
    const expired = await ctx.db
      .query("searchQueryDailyDedupe")
      .withIndex("by_day", (q) => q.lt("day", cutoffDay))
      .take(batchSize);

    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    return { deleted: expired.length };
  },
});

function looksLikeUrl(value: string) {
  return /(?:https?:\/\/|www\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/|\b))/i.test(value);
}

function looksLikePrivateIdentifier(value: string) {
  return /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i.test(value);
}

function looksLikeSecret(value: string) {
  return (
    /\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][a-z0-9_-]{16,}\b/i.test(value) ||
    /\b[a-z0-9_-]{32,}\b/i.test(value)
  );
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
