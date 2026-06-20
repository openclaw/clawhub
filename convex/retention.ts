import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const RETENTION_MAX_BATCH_SIZE = 1_000;

function normalizeRetentionBatchSize(batchSize: number | undefined) {
  const requested = Number.isFinite(batchSize)
    ? Math.floor(batchSize ?? RETENTION_STANDARD_BATCH_SIZE)
    : RETENTION_STANDARD_BATCH_SIZE;
  return Math.max(1, Math.min(requested, RETENTION_MAX_BATCH_SIZE));
}

export const pruneExpiredAuthSessionsInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = normalizeRetentionBatchSize(args.batchSize);
    const now = Date.now();
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize);

    let deletedSessions = 0;
    let deletedRefreshTokens = 0;
    let deletedDocuments = 0;
    for (const session of sessions) {
      const remainingBatchSize = batchSize - deletedDocuments;
      if (remainingBatchSize <= 0) break;
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .take(remainingBatchSize);
      for (const refreshToken of refreshTokens) {
        await ctx.db.delete(refreshToken._id);
        deletedRefreshTokens += 1;
        deletedDocuments += 1;
      }

      if (refreshTokens.length === remainingBatchSize) break;

      await ctx.db.delete(session._id);
      deletedSessions += 1;
      deletedDocuments += 1;
    }

    const hasMore = sessions.length === batchSize || deletedDocuments >= batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.retention.pruneExpiredAuthSessionsInternal, {
        batchSize,
      });
    }

    return { deletedSessions, deletedRefreshTokens, hasMore };
  },
});

export const pruneExpiredAuthRefreshTokensInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = normalizeRetentionBatchSize(args.batchSize);
    const stale = await ctx.db
      .query("authRefreshTokens")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", Date.now()))
      .take(batchSize);

    for (const refreshToken of stale) {
      await ctx.db.delete(refreshToken._id);
    }

    const hasMore = stale.length === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.retention.pruneExpiredAuthRefreshTokensInternal, {
        batchSize,
      });
    }

    return { deleted: stale.length, hasMore };
  },
});
