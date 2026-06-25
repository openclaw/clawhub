import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const DEFAULT_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE = RETENTION_STANDARD_BATCH_SIZE;
const MAX_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE = 1_000;
const DEFAULT_HTTP_RATE_LIMIT_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRUNE_HTTP_RATE_LIMIT_KEYS_BATCH_SIZE = RETENTION_STANDARD_BATCH_SIZE;
const MAX_PRUNE_HTTP_RATE_LIMIT_KEYS_BATCH_SIZE = 1_000;
const HTTP_RATE_LIMIT_KEY_METADATA_SHARDS = 64;
const MAX_EXPIRED_HTTP_RATE_LIMIT_KEY_ROWS_PER_KEY = HTTP_RATE_LIMIT_KEY_METADATA_SHARDS * 2;
const fixedWindowRateLimitConfigValidator = v.object({
  kind: v.literal("fixed window"),
  rate: v.number(),
  period: v.number(),
  capacity: v.optional(v.number()),
  maxReserved: v.optional(v.number()),
  shards: v.optional(v.number()),
  start: v.optional(v.number()),
});
const rateLimitStatusValidator = v.union(
  v.object({
    ok: v.literal(true),
    retryAfter: v.optional(v.number()),
  }),
  v.object({
    ok: v.literal(false),
    retryAfter: v.number(),
  }),
);

type HttpRateLimitKeyWriteCtx = Pick<MutationCtx, "db">;

function clampBatchSize(
  requested: number | undefined,
  defaultBatchSize: number,
  maxBatchSize: number,
) {
  const requestedBatchSize = Number.isFinite(requested)
    ? Math.floor(requested ?? defaultBatchSize)
    : defaultBatchSize;
  return Math.max(1, Math.min(requestedBatchSize, maxBatchSize));
}

function normalizeHttpRateLimitKeyShard(shard: number | undefined) {
  const candidate = Number.isFinite(shard)
    ? Math.floor(shard ?? 0)
    : Math.floor(Math.random() * HTTP_RATE_LIMIT_KEY_METADATA_SHARDS);
  return (
    ((candidate % HTTP_RATE_LIMIT_KEY_METADATA_SHARDS) + HTTP_RATE_LIMIT_KEY_METADATA_SHARDS) %
    HTTP_RATE_LIMIT_KEY_METADATA_SHARDS
  );
}

async function touchHttpRateLimitKey(
  ctx: HttpRateLimitKeyWriteCtx,
  args: {
    name: string;
    key: string;
    shard?: number;
    now?: number;
    ttlMs?: number;
  },
) {
  const now = Number.isFinite(args.now) ? (args.now ?? Date.now()) : Date.now();
  const ttlMs =
    Number.isFinite(args.ttlMs) && (args.ttlMs ?? 0) > 0
      ? Math.floor(args.ttlMs ?? DEFAULT_HTTP_RATE_LIMIT_KEY_TTL_MS)
      : DEFAULT_HTTP_RATE_LIMIT_KEY_TTL_MS;
  const expiresAt = now + ttlMs;
  const shard = normalizeHttpRateLimitKeyShard(args.shard);
  const matches = await ctx.db
    .query("httpRateLimitKeys")
    .withIndex("by_name_and_key_and_shard", (q) =>
      q.eq("name", args.name).eq("key", args.key).eq("shard", shard),
    )
    .take(10);
  const [existing, ...duplicates] = matches;

  if (existing) {
    await ctx.db.patch(existing._id, { lastTouchedAt: now, expiresAt });
    for (const duplicate of duplicates) {
      await ctx.db.delete(duplicate._id);
    }
    return { action: "updated" as const, expiresAt, shard };
  }

  await ctx.db.insert("httpRateLimitKeys", {
    name: args.name,
    key: args.key,
    shard,
    lastTouchedAt: now,
    expiresAt,
  });
  return { action: "inserted" as const, expiresAt, shard };
}

export const consumeHttpRateLimitKeyInternal = internalMutation({
  args: {
    name: v.string(),
    key: v.string(),
    config: fixedWindowRateLimitConfigValidator,
    now: v.optional(v.number()),
    ttlMs: v.optional(v.number()),
    shard: v.optional(v.number()),
  },
  returns: rateLimitStatusValidator,
  handler: async (ctx, args) => {
    const status = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
      name: args.name,
      key: args.key,
      config: args.config,
    });
    await touchHttpRateLimitKey(ctx, args);
    return status;
  },
});

export const touchHttpRateLimitKeyInternal = internalMutation({
  args: {
    name: v.string(),
    key: v.string(),
    shard: v.optional(v.number()),
    now: v.optional(v.number()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await touchHttpRateLimitKey(ctx, args);
  },
});

async function hasActiveHttpRateLimitKeyMetadata(
  ctx: HttpRateLimitKeyWriteCtx,
  row: { name: string; key: string },
  now: number,
) {
  const activeRows = await ctx.db
    .query("httpRateLimitKeys")
    .withIndex("by_name_and_key_and_expires_at", (q) =>
      q.eq("name", row.name).eq("key", row.key).gte("expiresAt", now),
    )
    .take(1);
  return activeRows.length > 0;
}

async function deleteExpiredHttpRateLimitKeyMetadata(
  ctx: HttpRateLimitKeyWriteCtx,
  row: { name: string; key: string },
  now: number,
  deletedRowIds: Set<string>,
) {
  const expiredRows = await ctx.db
    .query("httpRateLimitKeys")
    .withIndex("by_name_and_key_and_expires_at", (q) =>
      q.eq("name", row.name).eq("key", row.key).lt("expiresAt", now),
    )
    .take(MAX_EXPIRED_HTTP_RATE_LIMIT_KEY_ROWS_PER_KEY);

  let deleted = 0;
  for (const expiredRow of expiredRows) {
    if (deletedRowIds.has(expiredRow._id)) continue;
    await ctx.db.delete(expiredRow._id);
    deletedRowIds.add(expiredRow._id);
    deleted += 1;
  }
  return deleted;
}

export const pruneHttpRateLimitKeysInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batchSize = clampBatchSize(
      args.batchSize,
      DEFAULT_PRUNE_HTTP_RATE_LIMIT_KEYS_BATCH_SIZE,
      MAX_PRUNE_HTTP_RATE_LIMIT_KEYS_BATCH_SIZE,
    );
    const stale = await ctx.db
      .query("httpRateLimitKeys")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(batchSize);

    const resetKeys = new Set<string>();
    const deletedRowIds = new Set<string>();
    let deleted = 0;

    for (const row of stale) {
      if (deletedRowIds.has(row._id)) continue;

      const key = `${row.name}\0${row.key}`;
      if (await hasActiveHttpRateLimitKeyMetadata(ctx, row, now)) {
        await ctx.db.delete(row._id);
        deletedRowIds.add(row._id);
        deleted += 1;
        continue;
      }

      if (!resetKeys.has(key)) {
        await ctx.runMutation(components.rateLimiter.lib.resetRateLimit, {
          name: row.name,
          key: row.key,
        });
        resetKeys.add(key);
      }
      deleted += await deleteExpiredHttpRateLimitKeyMetadata(ctx, row, now, deletedRowIds);
    }

    const hasMore = stale.length === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.rateLimits.pruneHttpRateLimitKeysInternal, {
        batchSize,
      });
    }

    return { deleted, hasMore };
  },
});

// The active HTTP limiter now uses @convex-dev/rate-limiter. Keep this cleanup
// while old rateLimitCounters rows from prior deployments age out.
export const pruneRateLimitCountersInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampBatchSize(
      args.batchSize,
      DEFAULT_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE,
      MAX_PRUNE_RATE_LIMIT_COUNTERS_BATCH_SIZE,
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
