import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './functions'
import {
  buildTrendingEntriesFromDailyRows,
  buildTrendingEntryCandidates,
  getTrendingRange,
  queryDailyStats,
  takeTopNonSuspiciousTrendingEntries,
  takeTopTrendingEntries,
  TRENDING_LEADERBOARD_KIND,
  TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND,
} from './lib/leaderboards'

const MAX_TRENDING_LIMIT = 200
const KEEP_LEADERBOARD_ENTRIES = 3

// ---------------------------------------------------------------------------
// Action → Query → Mutation pattern (avoids 32K document-read limit)
// ---------------------------------------------------------------------------

/** Reads a single day's skillDailyStats in its own query transaction. */
export const getDailyStats = internalQuery({
  args: { day: v.number() },
  handler: async (ctx, { day }) => {
    const rows = await queryDailyStats(ctx, day)
    return rows.map((r) => ({ skillId: r.skillId, installs: r.installs, downloads: r.downloads }))
  },
})

export const filterTopNonSuspiciousTrendingEntries = internalQuery({
  args: {
    entries: v.array(
      v.object({
        skillId: v.id('skills'),
        score: v.number(),
        installs: v.number(),
        downloads: v.number(),
      }),
    ),
    limit: v.number(),
  },
  handler: async (ctx, { entries, limit }) => {
    return takeTopNonSuspiciousTrendingEntries(ctx, entries, limit)
  },
})

/** Writes the pre-computed leaderboard and prunes old entries. */
export const writeTrendingLeaderboard = internalMutation({
  args: {
    kind: v.string(),
    items: v.array(
      v.object({
        skillId: v.id('skills'),
        score: v.number(),
        installs: v.number(),
        downloads: v.number(),
      }),
    ),
    startDay: v.number(),
    endDay: v.number(),
  },
  handler: async (ctx, { kind, items, startDay, endDay }) => {
    const now = Date.now()

    await ctx.db.insert('skillLeaderboards', {
      kind,
      generatedAt: now,
      rangeStartDay: startDay,
      rangeEndDay: endDay,
      items,
    })

    const recent = await ctx.db
      .query('skillLeaderboards')
      .withIndex('by_kind', (q) => q.eq('kind', kind))
      .order('desc')
      .take(KEEP_LEADERBOARD_ENTRIES + 5)

    for (const entry of recent.slice(KEEP_LEADERBOARD_ENTRIES)) {
      await ctx.db.delete(entry._id)
    }

    return { ok: true as const, count: items.length }
  },
})

/** Orchestrates the rebuild: queries each day separately, aggregates, writes. */
export const rebuildTrendingLeaderboardAction = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: true; count: number }> => {
    const limit = clampInt(args.limit ?? MAX_TRENDING_LIMIT, 1, MAX_TRENDING_LIMIT)
    const now = Date.now()
    const { startDay, endDay } = getTrendingRange(now)
    const dayKeys = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i)
    const perDayRows = await Promise.all(
      dayKeys.map((day) => ctx.runQuery(internal.leaderboards.getDailyStats, { day })),
    )
    const entries = buildTrendingEntriesFromDailyRows(perDayRows)
    const items = takeTopTrendingEntries(entries, limit)
    const nonSuspicious = await ctx.runQuery(
      internal.leaderboards.filterTopNonSuspiciousTrendingEntries,
      { entries, limit },
    )

    await ctx.runMutation(internal.leaderboards.writeTrendingLeaderboard, {
      kind: TRENDING_LEADERBOARD_KIND,
      items,
      startDay,
      endDay,
    })
    await ctx.runMutation(internal.leaderboards.writeTrendingLeaderboard, {
      kind: TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND,
      items: nonSuspicious,
      startDay,
      endDay,
    })
    return { ok: true as const, count: items.length }
  },
})

// ---------------------------------------------------------------------------
// Legacy single-mutation path (kept as fallback for under-32K workloads)
// ---------------------------------------------------------------------------

export const rebuildTrendingLeaderboardInternal = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? MAX_TRENDING_LIMIT, 1, MAX_TRENDING_LIMIT)
    const now = Date.now()
    const { startDay, endDay, entries } = await buildTrendingEntryCandidates(ctx, now)
    const items = takeTopTrendingEntries(entries, limit)
    const nonSuspicious = await takeTopNonSuspiciousTrendingEntries(ctx, entries, limit)

    await ctx.db.insert('skillLeaderboards', {
      kind: TRENDING_LEADERBOARD_KIND,
      generatedAt: now,
      rangeStartDay: startDay,
      rangeEndDay: endDay,
      items,
    })
    await ctx.db.insert('skillLeaderboards', {
      kind: TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND,
      generatedAt: now,
      rangeStartDay: startDay,
      rangeEndDay: endDay,
      items: nonSuspicious,
    })

    for (const kind of [
      TRENDING_LEADERBOARD_KIND,
      TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND,
    ]) {
      const entriesForKind = await ctx.db
        .query('skillLeaderboards')
        .withIndex('by_kind', (q) => q.eq('kind', kind))
        .order('desc')
        .take(KEEP_LEADERBOARD_ENTRIES + 5)
      for (const entry of entriesForKind.slice(KEEP_LEADERBOARD_ENTRIES)) {
        await ctx.db.delete(entry._id)
      }
    }

    return { ok: true as const, count: items.length }
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
