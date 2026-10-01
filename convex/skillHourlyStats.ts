import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import {
  ensureHourlyStatsState,
  getCompletedRolling24HourWindow,
  HOURLY_STATS_STATE_KEY,
} from "./lib/skillHourlyStats";

const MAX_PRUNE_BATCH_SIZE = 1_000;
const HOURLY_AGGREGATION_MAX_AGE_MS = 2 * 60 * 60 * 1_000;

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) return RETENTION_STANDARD_BATCH_SIZE;
  return Math.max(
    1,
    Math.min(Math.trunc(value ?? RETENTION_STANDARD_BATCH_SIZE), MAX_PRUNE_BATCH_SIZE),
  );
}

export const initializeInternal = internalMutation({
  args: {},
  handler: async (ctx) => await ensureHourlyStatsState(ctx),
});

export const getStateInternal = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("skillHourlyStatStates")
      .withIndex("by_key", (q) => q.eq("key", HOURLY_STATS_STATE_KEY))
      .unique(),
});

export const sealForSnapshotInternal = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("skillHourlyStatStates")
      .withIndex("by_key", (q) => q.eq("key", HOURLY_STATS_STATE_KEY))
      .unique();
    if (
      !state?.backfillCompletedAt ||
      !state.lastAggregationCompletedAt ||
      state.lastAggregationCompletedAt <= args.now - HOURLY_AGGREGATION_MAX_AGE_MS
    ) {
      return null;
    }

    const sealedGeneration = state.activeGeneration;
    await ctx.db.patch(state._id, {
      activeGeneration: sealedGeneration + 1,
      updatedAt: args.now,
    });
    return {
      ...getCompletedRolling24HourWindow(Math.min(args.now, state.lastAggregationCompletedAt)),
      lastAggregationCompletedAt: state.lastAggregationCompletedAt,
      sealedGeneration,
    };
  },
});

export const markBackfillCompletedInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureHourlyStatsState(ctx);
    const now = Date.now();
    await ctx.db.patch(state._id, { backfillCompletedAt: now, updatedAt: now });
    return { backfillCompletedAt: now };
  },
});

export const markAggregationCompletedInternal = internalMutation({
  args: { cursorCreationTime: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = await ensureHourlyStatsState(ctx);
    const now = Date.now();
    await ctx.db.patch(state._id, {
      lastAggregationCompletedAt: now,
      lastProcessedEventCreationTime:
        args.cursorCreationTime ?? state.lastProcessedEventCreationTime,
      updatedAt: now,
    });
    return { completedAt: now };
  },
});

export const pruneExpiredInternal = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = normalizeBatchSize(args.batchSize);
    const rows = await ctx.db
      .query("skillHourlyStats")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", Date.now()))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);

    const hasMore = rows.length === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.skillHourlyStats.pruneExpiredInternal, {
        batchSize,
      });
    }
    return { deleted: rows.length, hasMore };
  },
});
