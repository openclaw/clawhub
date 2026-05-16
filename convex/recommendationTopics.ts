import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, query } from "./functions";
import { getTrendingRange } from "./lib/leaderboards";
import { isPackageBlockedFromPublic } from "./lib/packageSecurity";
import { normalizePublicSearchQuery } from "./searchTelemetry";

const HOMEPAGE_SURFACE = "homepage-search";
const DEFAULT_TOPIC_LIMIT = 4;
const MAX_TOPIC_LIMIT = 20;
const SEARCH_ROWS_PER_DAY = 100;
const DAILY_STATS_PAGE_SIZE = 1_000;
const SIGNAL_HYDRATION_LIMIT = 100;
const MIN_PUBLIC_SEARCH_COUNT = 10;
const SEARCH_SCORE_WEIGHT = 5;
const INSTALL_SCORE_WEIGHT = 4;
const PLUGIN_FAMILIES = ["code-plugin", "bundle-plugin"] as const;

type PluginFamily = (typeof PLUGIN_FAMILIES)[number];

type RecommendationKind = "search" | "skill-topic" | "plugin-topic";

export type RecommendationSearchRow = {
  query: string;
  count: number;
  lastSearchedAt?: number;
};

export type RecommendationSignal = {
  text: string;
  downloads: number;
  installs: number;
  source: "skill" | "plugin";
};

export type RecommendationTopic = {
  query: string;
  kind: RecommendationKind;
  score: number;
  reason: string;
};

type CandidateTopic = RecommendationTopic & {
  primaryScore: number;
};

const TOPIC_PATTERNS: Array<{ query: string; pattern: RegExp }> = [
  { query: "github integration", pattern: /\b(github|pull requests?|prs?|repository|repo)\b/i },
  { query: "mcp tools", pattern: /\bmcp\b/i },
  {
    query: "security scanner",
    pattern: /\b(security|scanner|scan|auth|oauth|secret|credential)\b/i,
  },
  { query: "dashboard builder", pattern: /\b(dashboard|analytics|charts?|reports?|metrics)\b/i },
  { query: "agent workflow", pattern: /\b(agents?|workflow|automation|cron|schedule|bots?)\b/i },
  { query: "data api", pattern: /\b(api|graphql|rest|database|postgres|sql|data)\b/i },
  { query: "browser tools", pattern: /\b(browser|chrome|playwright|web)\b/i },
  { query: "documentation", pattern: /\b(docs?|documentation|readme|knowledge base)\b/i },
  { query: "prompt templates", pattern: /\b(prompts?|templates?|system prompt)\b/i },
];

export function buildRecommendationTopics(args: {
  searchRows?: RecommendationSearchRow[];
  skillSignals?: RecommendationSignal[];
  pluginSignals?: RecommendationSignal[];
  limit?: number;
  minSearchCount?: number;
}): RecommendationTopic[] {
  const limit = clampInt(args.limit ?? DEFAULT_TOPIC_LIMIT, 1, MAX_TOPIC_LIMIT);
  const minSearchCount = Math.max(1, Math.floor(args.minSearchCount ?? MIN_PUBLIC_SEARCH_COUNT));
  const candidates = new Map<string, CandidateTopic>();
  const searchTotals = new Map<
    string,
    { query: string; count: number; lastSearchedAt: number | undefined }
  >();

  for (const row of args.searchRows ?? []) {
    const normalized = normalizePublicSearchQuery(row.query);
    if (!normalized) continue;
    const current = searchTotals.get(normalized.normalizedQuery);
    if (!current) {
      searchTotals.set(normalized.normalizedQuery, {
        query: normalized.displayQuery,
        count: row.count,
        lastSearchedAt: row.lastSearchedAt,
      });
      continue;
    }
    current.count += row.count;
    if ((row.lastSearchedAt ?? 0) >= (current.lastSearchedAt ?? 0)) {
      current.query = normalized.displayQuery;
      current.lastSearchedAt = row.lastSearchedAt;
    }
  }

  for (const row of searchTotals.values()) {
    if (row.count < minSearchCount) continue;
    addCandidate(candidates, {
      query: row.query,
      kind: "search",
      score: row.count * SEARCH_SCORE_WEIGHT,
      reason: "Trending search",
    });
  }

  for (const signal of args.skillSignals ?? []) {
    addSignalTopics(candidates, signal);
  }
  for (const signal of args.pluginSignals ?? []) {
    addSignalTopics(candidates, signal);
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query))
    .slice(0, limit)
    .map(({ primaryScore: _primaryScore, ...topic }) => topic);
}

export const listHomepageTopics = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? DEFAULT_TOPIC_LIMIT, 1, MAX_TOPIC_LIMIT);
    const rows = await ctx.db
      .query("recommendationTopics")
      .withIndex("by_surface_score", (q) => q.eq("surface", HOMEPAGE_SURFACE))
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      query: row.query,
      kind: row.kind,
      score: row.score,
      reason: row.reason,
    }));
  },
});

export const getSearchStatsForDay = internalQuery({
  args: {
    day: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? SEARCH_ROWS_PER_DAY, 1, SEARCH_ROWS_PER_DAY);
    const rows = await ctx.db
      .query("searchQueryDailyStats")
      .withIndex("by_day_count", (q) => q.eq("day", args.day))
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      query: row.displayQuery,
      count: row.count,
      lastSearchedAt: row.lastSearchedAt,
    }));
  },
});

export const getPackageDailyStatsPage = internalQuery({
  args: {
    day: v.number(),
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("packageDailyStats")
      .withIndex("by_family_day", (q) => q.eq("family", args.family).eq("day", args.day))
      .paginate({
        cursor: args.cursor,
        numItems: Math.min(args.limit ?? DAILY_STATS_PAGE_SIZE, DAILY_STATS_PAGE_SIZE),
      });

    return {
      rows: page.page.map((row) => ({
        packageId: row.packageId,
        downloads: row.downloads,
        installs: row.installs,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const getSkillTopicSignals = internalQuery({
  args: {
    entries: v.array(
      v.object({
        skillId: v.id("skills"),
        downloads: v.number(),
        installs: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const signals: RecommendationSignal[] = [];
    for (const entry of args.entries.slice(0, SIGNAL_HYDRATION_LIMIT)) {
      const digest = await ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", entry.skillId))
        .unique();
      if (!digest || digest.softDeletedAt || digest.isSuspicious) continue;
      if (digest.moderationStatus === "hidden" || digest.moderationStatus === "removed") continue;
      signals.push({
        source: "skill",
        text: [
          digest.displayName,
          digest.slug,
          digest.summary,
          ...Object.keys(digest.tags),
          ...(digest.capabilityTags ?? []),
        ]
          .filter(Boolean)
          .join(" "),
        downloads: entry.downloads,
        installs: entry.installs,
      });
    }
    return signals;
  },
});

export const getPackageTopicSignals = internalQuery({
  args: {
    entries: v.array(
      v.object({
        packageId: v.id("packages"),
        downloads: v.number(),
        installs: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const signals: RecommendationSignal[] = [];
    for (const entry of args.entries.slice(0, SIGNAL_HYDRATION_LIMIT)) {
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", entry.packageId))
        .unique();
      if (!digest || digest.softDeletedAt || digest.family === "skill") continue;
      if (digest.channel === "private" || isPackageBlockedFromPublic(digest.scanStatus)) continue;
      signals.push({
        source: "plugin",
        text: [
          digest.displayName,
          digest.name,
          digest.normalizedName,
          digest.summary,
          digest.runtimeId,
          ...(digest.capabilityTags ?? []),
          ...(digest.pluginCategoryTags ?? []),
        ]
          .filter(Boolean)
          .join(" "),
        downloads: entry.downloads,
        installs: entry.installs,
      });
    }
    return signals;
  },
});

export const writeHomepageRecommendationTopics = internalMutation({
  args: {
    topics: v.array(
      v.object({
        query: v.string(),
        kind: v.union(v.literal("search"), v.literal("skill-topic"), v.literal("plugin-topic")),
        score: v.number(),
        reason: v.string(),
      }),
    ),
    rangeStartDay: v.number(),
    rangeEndDay: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("recommendationTopics")
      .withIndex("by_surface_generatedAt", (q) => q.eq("surface", HOMEPAGE_SURFACE))
      .take(500);

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    for (const topic of args.topics.slice(0, MAX_TOPIC_LIMIT)) {
      await ctx.db.insert("recommendationTopics", {
        surface: HOMEPAGE_SURFACE,
        ...topic,
        generatedAt: now,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      });
    }

    return { ok: true as const, count: args.topics.length };
  },
});

export const rebuildHomepageRecommendationTopicsAction = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: true; count: number }> => {
    const limit = clampInt(args.limit ?? MAX_TOPIC_LIMIT, 1, MAX_TOPIC_LIMIT);
    const { startDay, endDay } = getTrendingRange(Date.now());
    const days = Array.from({ length: endDay - startDay + 1 }, (_, index) => startDay + index);

    const searchRows: RecommendationSearchRow[] = [];
    const skillTotals = new Map<Id<"skills">, { downloads: number; installs: number }>();
    const packageTotals = new Map<Id<"packages">, { downloads: number; installs: number }>();

    for (const day of days) {
      const rows: RecommendationSearchRow[] = await ctx.runQuery(
        internal.recommendationTopics.getSearchStatsForDay,
        { day, limit: SEARCH_ROWS_PER_DAY },
      );
      searchRows.push(...rows);

      await collectSkillDailyStats(ctx, day, skillTotals);
      for (const family of PLUGIN_FAMILIES) {
        await collectPackageDailyStats(ctx, day, family, packageTotals);
      }
    }

    const skillEntries = takeTopSignalEntries(skillTotals, SIGNAL_HYDRATION_LIMIT).map(
      ([skillId, stats]) => ({ skillId, ...stats }),
    );
    const packageEntries = takeTopSignalEntries(packageTotals, SIGNAL_HYDRATION_LIMIT).map(
      ([packageId, stats]) => ({ packageId, ...stats }),
    );

    const skillSignals: RecommendationSignal[] = await ctx.runQuery(
      internal.recommendationTopics.getSkillTopicSignals,
      { entries: skillEntries },
    );
    const pluginSignals: RecommendationSignal[] = await ctx.runQuery(
      internal.recommendationTopics.getPackageTopicSignals,
      { entries: packageEntries },
    );

    const topics = buildRecommendationTopics({
      searchRows,
      skillSignals,
      pluginSignals,
      limit,
    });

    await ctx.runMutation(internal.recommendationTopics.writeHomepageRecommendationTopics, {
      topics,
      rangeStartDay: startDay,
      rangeEndDay: endDay,
    });

    return { ok: true as const, count: topics.length };
  },
});

function addSignalTopics(candidates: Map<string, CandidateTopic>, signal: RecommendationSignal) {
  const score = signal.installs * INSTALL_SCORE_WEIGHT + signal.downloads;
  if (score <= 0) return;

  for (const topic of TOPIC_PATTERNS) {
    if (!topic.pattern.test(signal.text)) continue;
    addCandidate(candidates, {
      query: topic.query,
      kind: signal.source === "plugin" ? "plugin-topic" : "skill-topic",
      score,
      reason: signal.source === "plugin" ? "Active plugin demand" : "Active skill demand",
    });
  }
}

function addCandidate(candidates: Map<string, CandidateTopic>, topic: RecommendationTopic) {
  const normalized = normalizePublicSearchQuery(topic.query);
  if (!normalized) return;
  const existing = candidates.get(normalized.normalizedQuery);
  if (!existing) {
    candidates.set(normalized.normalizedQuery, {
      ...topic,
      query: normalized.displayQuery,
      primaryScore: topic.score,
    });
    return;
  }

  existing.score += topic.score;
  if (topic.score > existing.primaryScore) {
    existing.kind = topic.kind;
    existing.reason = topic.reason;
    existing.primaryScore = topic.score;
  }
}

async function collectSkillDailyStats(
  ctx: ActionCtx,
  day: number,
  totals: Map<Id<"skills">, { downloads: number; installs: number }>,
) {
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      rows: Array<{ skillId: Id<"skills">; downloads: number; installs: number }>;
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.leaderboards.getDailyStatsPage, {
      day,
      cursor,
      limit: DAILY_STATS_PAGE_SIZE,
    });
    for (const row of page.rows) {
      const current = totals.get(row.skillId) ?? { downloads: 0, installs: 0 };
      current.downloads += row.downloads;
      current.installs += row.installs;
      totals.set(row.skillId, current);
    }
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
}

async function collectPackageDailyStats(
  ctx: ActionCtx,
  day: number,
  family: PluginFamily,
  totals: Map<Id<"packages">, { downloads: number; installs: number }>,
) {
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      rows: Array<{ packageId: Id<"packages">; downloads: number; installs: number }>;
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.recommendationTopics.getPackageDailyStatsPage, {
      day,
      family,
      cursor,
      limit: DAILY_STATS_PAGE_SIZE,
    });
    for (const row of page.rows) {
      const current = totals.get(row.packageId) ?? { downloads: 0, installs: 0 };
      current.downloads += row.downloads;
      current.installs += row.installs;
      totals.set(row.packageId, current);
    }
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
}

function takeTopSignalEntries<TId extends Id<"skills"> | Id<"packages">>(
  totals: Map<TId, { downloads: number; installs: number }>,
  limit: number,
) {
  return [...totals.entries()]
    .sort(([, a], [, b]) => signalScore(b) - signalScore(a))
    .slice(0, limit);
}

function signalScore(stats: { downloads: number; installs: number }) {
  return stats.installs * INSTALL_SCORE_WEIGHT + stats.downloads;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
