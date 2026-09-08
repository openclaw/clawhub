import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PRUNE_BATCH_SIZE = 1_000;

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) return RETENTION_STANDARD_BATCH_SIZE;
  return Math.max(
    1,
    Math.min(Math.trunc(value ?? RETENTION_STANDARD_BATCH_SIZE), MAX_PRUNE_BATCH_SIZE),
  );
}

export const recordInternal = internalMutation({
  args: {
    source: v.union(v.literal("clawhub-web"), v.literal("openclaw-control-ui")),
    artifactKind: v.literal("plugin"),
    normalizedQuery: v.string(),
    category: v.optional(v.string()),
    topic: v.optional(v.string()),
    resultCount: v.number(),
    officialResultCount: v.number(),
  },
  handler: async (ctx, args) => {
    const observedAt = Date.now();
    const id = await ctx.db.insert("pluginSearchObservations", { ...args, observedAt });
    return { id, observedAt };
  },
});

export const pruneExpiredInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cutoff: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = normalizeBatchSize(args.batchSize);
    const cutoff = args.cutoff ?? Date.now() - THIRTY_DAYS_MS;
    const rows = await ctx.db
      .query("pluginSearchObservations")
      .withIndex("by_observed_at", (q) => q.lte("observedAt", cutoff))
      .take(batchSize);
    for (const row of rows) await ctx.db.delete(row._id);

    const hasMore = rows.length === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.pluginSearchObservations.pruneExpiredInternal, {
        batchSize,
        cutoff,
      });
    }
    return { deleted: rows.length, hasMore };
  },
});
