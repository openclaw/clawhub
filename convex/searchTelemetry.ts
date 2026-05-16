import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import { toDayKey } from "./lib/leaderboards";

const SEARCH_TELEMETRY_RETENTION_DAYS = 14;
const DEFAULT_SEARCH_TELEMETRY_PRUNE_BATCH_SIZE = 500;
const MAX_SEARCH_TELEMETRY_PRUNE_BATCH_SIZE = 1_000;
const MIN_SEARCH_QUERY_LENGTH = 3;
const MAX_SEARCH_QUERY_LENGTH = 80;
const MAX_SEARCH_QUERY_TOKENS = 8;

type SearchStatRow = {
  normalizedQuery: string;
  displayQuery: string;
  count: number;
  lastSearchedAt: number;
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

export function mergeSearchStatRows(perDayRows: SearchStatRow[]) {
  const totals = new Map<string, SearchStatRow>();

  for (const row of perDayRows) {
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

  return [...totals.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.lastSearchedAt - a.lastSearchedAt ||
      a.displayQuery.localeCompare(b.displayQuery),
  );
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

export const pruneSearchQueryDailyDedupeInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(
      args.batchSize ?? DEFAULT_SEARCH_TELEMETRY_PRUNE_BATCH_SIZE,
      1,
      MAX_SEARCH_TELEMETRY_PRUNE_BATCH_SIZE,
    );
    const cutoffDay = toDayKey(Date.now()) - SEARCH_TELEMETRY_RETENTION_DAYS;
    const expired = await ctx.db
      .query("searchQueryDailyDedupe")
      .withIndex("by_day", (q) => q.lt("day", cutoffDay))
      .take(batchSize);
    const expiredStats = await ctx.db
      .query("searchQueryDailyStats")
      .withIndex("by_day_count", (q) => q.lt("day", cutoffDay))
      .take(batchSize);

    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    for (const row of expiredStats) {
      await ctx.db.delete(row._id);
    }

    if (expired.length === batchSize || expiredStats.length === batchSize) {
      await ctx.scheduler.runAfter(
        0,
        internal.searchTelemetry.pruneSearchQueryDailyDedupeInternal,
        {
          batchSize,
        },
      );
    }

    return {
      deleted: expired.length + expiredStats.length,
      dedupeDeleted: expired.length,
      statsDeleted: expiredStats.length,
    };
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
