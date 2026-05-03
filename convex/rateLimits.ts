import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";

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

    const legacyRows = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_window", (q) => q.eq("key", args.key).eq("windowStart", windowStart))
      .collect();
    const shardRows = await ctx.db
      .query("rateLimitShards")
      .withIndex("by_key_window", (q) => q.eq("key", args.key).eq("windowStart", windowStart))
      .collect();

    const count = [...legacyRows, ...shardRows].reduce((sum, row) => sum + row.count, 0);
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
    const shard = Math.max(0, Math.floor(args.shard ?? 0));

    const existing = await ctx.db
      .query("rateLimitShards")
      .withIndex("by_key_window_shard", (q) =>
        q.eq("key", args.key).eq("windowStart", windowStart).eq("shard", shard),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("rateLimitShards", {
        key: args.key,
        windowStart,
        shard,
        count: 1,
        limit: args.limit,
        updatedAt: now,
      });
      return { allowed: true, remaining: Math.max(0, args.limit - 1) };
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      limit: args.limit,
      updatedAt: now,
    });
    return {
      allowed: true,
      remaining: Math.max(0, args.limit - 1),
    };
  },
});
