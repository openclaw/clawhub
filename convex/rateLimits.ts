import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

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
    const now = Date.now()
    const windowStart = Math.floor(now / args.windowMs) * args.windowMs
    const resetAt = windowStart + args.windowMs
    if (args.limit <= 0) {
      return { allowed: false, remaining: 0, limit: args.limit, resetAt }
    }

    const existing = await ctx.db
      .query('rateLimits')
      .withIndex('by_key_window', (q) => q.eq('key', args.key).eq('windowStart', windowStart))
      .unique()

    const count = existing?.count ?? 0
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
 * returns allowed=true. Includes a double-check to handle races between the
 * query and this mutation.
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

    const existing = await ctx.db
      .query('rateLimits')
      .withIndex('by_key_window', (q) => q.eq('key', args.key).eq('windowStart', windowStart))
      .unique()

    // Double-check: another request may have consumed the last token
    // between our query and this mutation
    if (existing && existing.count >= args.limit) {
      return { allowed: false, remaining: 0 }
    }

    if (!existing) {
      await ctx.db.insert('rateLimits', {
        key: args.key,
        windowStart,
        count: 1,
        limit: args.limit,
        updatedAt: now,
      })
      return { allowed: true, remaining: Math.max(0, args.limit - 1) }
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
