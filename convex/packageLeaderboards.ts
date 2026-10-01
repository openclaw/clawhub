import { getPluginDiscoveryExclusion, PACKAGE_TRENDING_LEADERBOARD_LIMIT } from "clawhub-schema";
import {
  type PaginationResult,
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { isPublicPluginDoc } from "./lib/globalStats";
import { toDayKey } from "./lib/leaderboards";
import { isEnglishPluginListing } from "./lib/pluginDiscovery";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";

const STAT_EVENTS_PAGE_SIZE = 1_000;
const KEEP_LEADERBOARD_ENTRIES = 3;
const DISCOVERY_BATCH_SIZE = 100;
export const PACKAGE_TRENDING_LEADERBOARD_KIND = "package_trending_24h";

export const getDiscoveryPackageIds = internalQuery({
  args: { packageIds: v.array(v.id("packages")) },
  returns: v.array(v.id("packages")),
  handler: async (ctx, { packageIds }) => {
    if (packageIds.length > DISCOVERY_BATCH_SIZE) throw new Error("Maximum 100 package identities");
    const eligible: Id<"packages">[] = [];
    for (const packageId of packageIds) {
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", packageId))
        .unique();
      if (
        isPublicPluginDoc(digest) &&
        !getPluginDiscoveryExclusion(digest.categories) &&
        isEnglishPluginListing(digest)
      )
        eligible.push(packageId);
    }
    return eligible;
  },
});

export const getStatEventsPage = internalQuery({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      packageId: v.id("packages"),
      kind: v.union(v.literal("download"), v.literal("install"), v.literal("install_clear")),
    }),
  ),
  handler: async (ctx, { startAt, endAt, paginationOpts }) => {
    const result = await ctx.db
      .query("packageStatEvents")
      .withIndex("by_occurred_at", (q) => q.gte("occurredAt", startAt).lt("occurredAt", endAt))
      .paginate(paginationOpts);
    return { ...result, page: result.page.map(({ packageId, kind }) => ({ packageId, kind })) };
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
    startAt: v.number(),
    endAt: v.number(),
  },
  returns: v.object({ ok: v.literal(true), count: v.number() }),
  handler: async (ctx, { items, startAt, endAt }) => {
    await ctx.db.insert("packageLeaderboards", {
      kind: PACKAGE_TRENDING_LEADERBOARD_KIND,
      generatedAt: Date.now(),
      rangeStartDay: toDayKey(startAt),
      rangeEndDay: toDayKey(endAt - 1),
      rangeStartAt: startAt,
      rangeEndAt: endAt,
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
  returns: v.object({ ok: v.literal(true), count: v.number() }),
  handler: async (ctx, args): Promise<{ ok: true; count: number }> => {
    const limit = Math.min(
      Math.max(args.limit ?? PACKAGE_TRENDING_LEADERBOARD_LIMIT, 1),
      PACKAGE_TRENDING_LEADERBOARD_LIMIT,
    );
    const now = Date.now();
    // Match Skills Trending: the 24 completed UTC hours before this rebuild.
    // Retained raw events preserve the boundary that daily totals cannot express.
    const { startAt, endAt } = getCompletedRolling24HourWindow(now);
    const totals = new Map<Id<"packages">, { installs: number; downloads: number }>();
    let cursor: string | null = null;
    do {
      const result: PaginationResult<{
        packageId: Id<"packages">;
        kind: "download" | "install" | "install_clear";
      }> = await ctx.runQuery(internal.packageLeaderboards.getStatEventsPage, {
        startAt,
        endAt,
        paginationOpts: { cursor, numItems: STAT_EVENTS_PAGE_SIZE },
      });
      for (const event of result.page) {
        const current = totals.get(event.packageId) ?? { installs: 0, downloads: 0 };
        if (event.kind === "download") current.downloads += 1;
        else current.installs += event.kind === "install" ? 1 : -1;
        totals.set(event.packageId, current);
      }
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);

    const entries = Array.from(totals, ([packageId, entry]) => ({
      packageId,
      installs: Math.max(0, entry.installs),
      downloads: entry.downloads,
      score: Math.max(0, entry.installs) * 3 + entry.downloads,
    }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.downloads - a.downloads ||
          b.installs - a.installs ||
          a.packageId.localeCompare(b.packageId),
      );

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
      startAt,
      endAt,
    });
    return { ok: true as const, count: items.length };
  },
});

export const rebuildTrendingLeaderboardInternal = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    ok: v.literal(true),
    count: v.number(),
    scheduled: v.literal(true),
    days: v.literal(1),
  }),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.packageLeaderboards.rebuildTrendingLeaderboardAction, {
      limit: Math.min(
        Math.max(args.limit ?? PACKAGE_TRENDING_LEADERBOARD_LIMIT, 1),
        PACKAGE_TRENDING_LEADERBOARD_LIMIT,
      ),
    });
    return { ok: true as const, count: 0, scheduled: true as const, days: 1 as const };
  },
});
