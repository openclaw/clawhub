import { getPluginDiscoveryExclusion, PACKAGE_TRENDING_LEADERBOARD_LIMIT } from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { isPublicPluginDoc } from "./lib/globalStats";
import { getTrendingRange, TRENDING_DAYS } from "./lib/leaderboards";

const DAILY_STATS_PAGE_SIZE = 1_000;
const KEEP_LEADERBOARD_ENTRIES = 3;
const DISCOVERY_BATCH_SIZE = 100;
export const PACKAGE_TRENDING_LEADERBOARD_KIND = "package_trending";

export const getDiscoveryPackageIds = internalQuery({
  args: { packageIds: v.array(v.id("packages")) },
  handler: async (ctx, { packageIds }) => {
    if (packageIds.length > DISCOVERY_BATCH_SIZE) throw new Error("Maximum 100 package identities");
    const eligible: Id<"packages">[] = [];
    for (const packageId of packageIds) {
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", packageId))
        .unique();
      if (isPublicPluginDoc(digest) && !getPluginDiscoveryExclusion(digest.categories))
        eligible.push(packageId);
    }
    return eligible;
  },
});

export const getDailyStatsPage = internalQuery({
  args: {
    day: v.number(),
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { day, cursor, limit }) => {
    const page = await ctx.db
      .query("packageDailyStats")
      .withIndex("by_day", (q) => q.eq("day", day))
      .paginate({
        cursor,
        numItems: Math.min(limit ?? DAILY_STATS_PAGE_SIZE, DAILY_STATS_PAGE_SIZE),
      });

    return {
      rows: page.page.map((row) => ({
        packageId: row.packageId,
        installs: row.installs,
        downloads: row.downloads,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const writeTrendingLeaderboard = internalMutation({
  args: {
    items: v.array(
      v.object({
        packageId: v.id("packages"),
        score: v.number(),
        installs: v.number(),
        downloads: v.number(),
      }),
    ),
    startDay: v.number(),
    endDay: v.number(),
  },
  handler: async (ctx, { items, startDay, endDay }) => {
    await ctx.db.insert("packageLeaderboards", {
      kind: PACKAGE_TRENDING_LEADERBOARD_KIND,
      generatedAt: Date.now(),
      rangeStartDay: startDay,
      rangeEndDay: endDay,
      items,
    });

    const recent = await ctx.db
      .query("packageLeaderboards")
      .withIndex("by_kind", (q) => q.eq("kind", PACKAGE_TRENDING_LEADERBOARD_KIND))
      .order("desc")
      .take(KEEP_LEADERBOARD_ENTRIES + 5);
    for (const entry of recent.slice(KEEP_LEADERBOARD_ENTRIES)) {
      await ctx.db.delete(entry._id);
    }
    return { ok: true as const, count: items.length };
  },
});

export const rebuildTrendingLeaderboardAction = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: true; count: number }> => {
    const limit = Math.min(
      Math.max(args.limit ?? PACKAGE_TRENDING_LEADERBOARD_LIMIT, 1),
      PACKAGE_TRENDING_LEADERBOARD_LIMIT,
    );
    const now = Date.now();
    const { startDay, endDay } = getTrendingRange(now);
    const totals = new Map<Id<"packages">, { installs: number; downloads: number }>();

    for (let day = startDay; day <= endDay; day += 1) {
      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const page = (await ctx.runQuery(internal.packageLeaderboards.getDailyStatsPage, {
          day,
          cursor,
          limit: DAILY_STATS_PAGE_SIZE,
        })) as {
          rows: Array<{ packageId: Id<"packages">; installs: number; downloads: number }>;
          isDone: boolean;
          continueCursor: string;
        };
        for (const row of page.rows) {
          const current = totals.get(row.packageId) ?? { installs: 0, downloads: 0 };
          current.installs += row.installs;
          current.downloads += row.downloads;
          totals.set(row.packageId, current);
        }
        cursor = page.continueCursor;
        isDone = page.isDone;
      }
    }

    const entries = Array.from(totals, ([packageId, entry]) => ({
      packageId,
      installs: entry.installs,
      downloads: entry.downloads,
      score: entry.installs * 3 + entry.downloads,
    })).sort((a, b) => b.score - a.score || b.downloads - a.downloads || b.installs - a.installs);

    // Apply discovery visibility before the top-N budget. Otherwise setup plugins
    // with high adoption crowd out tools even when the public reader hides them.
    const items: typeof entries = [];
    for (
      let offset = 0;
      offset < entries.length && items.length < limit;
      offset += DISCOVERY_BATCH_SIZE
    ) {
      const batch = entries.slice(offset, offset + DISCOVERY_BATCH_SIZE);
      const eligible = new Set<Id<"packages">>(
        await ctx.runQuery(internal.packageLeaderboards.getDiscoveryPackageIds, {
          packageIds: batch.map(({ packageId }) => packageId),
        }),
      );
      items.push(
        ...batch.filter(({ packageId }) => eligible.has(packageId)).slice(0, limit - items.length),
      );
    }

    await ctx.runMutation(internal.packageLeaderboards.writeTrendingLeaderboard, {
      items,
      startDay,
      endDay,
    });
    return { ok: true as const, count: items.length };
  },
});

export const rebuildTrendingLeaderboardInternal = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.packageLeaderboards.rebuildTrendingLeaderboardAction, {
      limit: Math.min(
        Math.max(args.limit ?? PACKAGE_TRENDING_LEADERBOARD_LIMIT, 1),
        PACKAGE_TRENDING_LEADERBOARD_LIMIT,
      ),
    });
    return { ok: true as const, count: 0, scheduled: true as const, days: TRENDING_DAYS };
  },
});
