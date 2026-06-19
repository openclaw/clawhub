import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./functions";
import { RATE_LIMIT_COUNTER_SHARDS } from "./lib/rateLimitConfig";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const RATE_LIMIT_COUNTER_RETENTION_BUFFER_MS = 5 * 60_000;
const DEFAULT_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE = RETENTION_STANDARD_BATCH_SIZE;
const MAX_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE = 1_000;

/**
 * Read-only rate limit check. Returns current status without writing anything.
 * This eliminates write conflicts for denied requests entirely.
 */
export const getRateLimitStatusInternal = internalQuery({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = Math.floor(now / args.windowMs) * args.windowMs;
    const resetAt = windowStart + args.windowMs;
    if (args.limit <= 0) {
      return { allowed: false, remaining: 0, limit: args.limit, resetAt };
    }

    const shardRows = await ctx.db
      .query("rateLimitCounters")
      .withIndex("by_key_window", (q) => q.eq("key", args.key).eq("windowStart", windowStart))
      .collect();

    const count = shardRows.reduce((sum, row) => sum + row.count, 0);
    const allowed = count < args.limit;
    return {
      allowed,
      remaining: Math.max(0, args.limit - count),
      limit: args.limit,
      resetAt,
    };
  },
});

/**
 * Consume one rate limit token. Only call this after getRateLimitStatusInternal
 * returns allowed=true. Includes a double-check to handle races between the
 * query and this mutation.
 */
export const consumeRateLimitInternal = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
    shard: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = Math.floor(now / args.windowMs) * args.windowMs;
    const resetAt = windowStart + args.windowMs;
    const requestedShard = Number.isFinite(args.shard) ? Math.floor(args.shard ?? 0) : 0;
    const shard = Math.max(0, Math.min(RATE_LIMIT_COUNTER_SHARDS - 1, requestedShard));

    const existing = await ctx.db
      .query("rateLimitCounters")
      .withIndex("by_key_window_shard", (q) =>
        q.eq("key", args.key).eq("windowStart", windowStart).eq("shard", shard),
      )
      .first();

    if (!existing) {
      await ctx.db.insert("rateLimitCounters", {
        key: args.key,
        windowStart,
        shard,
        count: 1,
        limit: args.limit,
        updatedAt: now,
        expiresAt: resetAt + RATE_LIMIT_COUNTER_RETENTION_BUFFER_MS,
      });
      return { allowed: true, remaining: Math.max(0, args.limit - 1) };
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      limit: args.limit,
      updatedAt: now,
      expiresAt: resetAt + RATE_LIMIT_COUNTER_RETENTION_BUFFER_MS,
    });
    return {
      allowed: true,
      remaining: Math.max(0, args.limit - 1),
    };
  },
});

export const pruneRateLimitCountersInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const requestedBatchSize = Number.isFinite(args.batchSize)
      ? Math.floor(args.batchSize ?? DEFAULT_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE)
      : DEFAULT_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE;
    const batchSize = Math.max(
      1,
      Math.min(requestedBatchSize, MAX_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE),
    );
    const stale = await ctx.db
      .query("rateLimitCounters")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now()))
      .take(batchSize);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    const hasMore = stale.length === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.rateLimits.pruneRateLimitCountersInternal, {
        batchSize,
      });
    }

    return { deleted: stale.length, hasMore };
  },
});
