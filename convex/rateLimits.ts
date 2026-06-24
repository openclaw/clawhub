import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const DEFAULT_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE = RETENTION_STANDARD_BATCH_SIZE;
const MAX_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE = 1_000;

// The active HTTP limiter now uses @convex-dev/rate-limiter. Keep this cleanup
// while old rateLimitCounters rows from prior deployments age out.
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
