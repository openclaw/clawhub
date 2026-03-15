import { v } from 'convex/values'
import { internalMutation, internalQuery } from './functions'

const SHARD_COUNT = 8

/**
 * Read-only rate limit check. Returns current status without writing anything.
 * Reads all shards + legacy unsharded key and sums counts.
 * As a query (not mutation), this doesn't participate in OCC.
 */
export const getRateLimitStatusInternal = internalQuery({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const windowStart = Math.floor(now / args.windowMs) * args.windowMs
    const resetAt = windowStart + args.windowMs
    if (args.limit <= 0) {
      return { allowed: false, remaining: 0, limit: args.limit, resetAt }
    }

    // Read all shards + legacy unsharded key in parallel
    const keys = [
      args.key, // legacy unsharded key
      ...Array.from({ length: SHARD_COUNT }, (_, i) => `${args.key}:s${i}`),
    ]

    const docs = await Promise.all(
      keys.map((k) =>
        ctx.db
          .query('rateLimits')
          .withIndex('by_key_window', (q) => q.eq('key', k).eq('windowStart', windowStart))
          .unique(),
      ),
    )

    let count = 0
    for (const doc of docs) {
      if (doc) count += doc.count
    }

    const allowed = count < args.limit
    return {
      allowed,
      remaining: Math.max(0, args.limit - count),
      limit: args.limit,
      resetAt,
    }
  },
})

/**
 * Consume one rate limit token. Only call this after getRateLimitStatusInternal
 * returns allowed=true. Writes to a random shard to reduce OCC contention —
 * two concurrent mutations only conflict if they land on the same shard (1/8).
 */
export const consumeRateLimitInternal = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const windowStart = Math.floor(now / args.windowMs) * args.windowMs
    const shard = Math.floor(Math.random() * SHARD_COUNT)
    const shardKey = `${args.key}:s${shard}`

    const existing = await ctx.db
      .query('rateLimits')
      .withIndex('by_key_window', (q) => q.eq('key', shardKey).eq('windowStart', windowStart))
      .unique()

    if (!existing) {
      await ctx.db.insert('rateLimits', {
        key: shardKey,
        windowStart,
        count: 1,
        limit: args.limit,
        updatedAt: now,
      })
      return { allowed: true, remaining: args.limit - 1 }
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      limit: args.limit,
      updatedAt: now,
    })
    return {
      allowed: true,
      remaining: Math.max(0, args.limit - existing.count - 1),
    }
  },
})
