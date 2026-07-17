import {
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SHARD_ROOT_MAX_ENTRIES,
  CATALOG_FEED_SHARD_ROOT_MAX_SHARDS,
  CATALOG_FEED_SHARD_SET_MAX_BYTES,
  CATALOG_SKILLS_FEED_ID,
  normalizeCatalogFeedEntries,
  parseCatalogFeedShard,
  serializeCatalogFeedShard,
  type CatalogFeedEntry,
} from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { sha256Hex } from "./lib/clawpack";

const SHARD_TARGET_ENTRY_COUNT = 250;
// Convex's 1 MiB document limit also includes this payload's containing row.
const SHARD_STORED_PAYLOAD_MAX_BYTES = 900 * 1024;
const SHARD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH_SIZE = 500;

const feedIdValidator = v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID));

type FeedId = typeof CATALOG_FEED_ID | typeof CATALOG_SKILLS_FEED_ID;

export type BuiltCatalogFeedShard = {
  index: number;
  payload: string;
  sha256: string;
  byteLength: number;
  entryCount: number;
};

function splitOversizedShard(args: {
  feedId: FeedId;
  sequence: number;
  entries: CatalogFeedEntry[];
}): CatalogFeedEntry[][] {
  const payload = serializeCatalogFeedShard({
    schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
    feedId: args.feedId,
    sequence: args.sequence,
    index: CATALOG_FEED_SHARD_ROOT_MAX_SHARDS - 1,
    entries: args.entries,
  });
  if (new TextEncoder().encode(payload).length <= SHARD_STORED_PAYLOAD_MAX_BYTES) {
    return [args.entries];
  }
  if (args.entries.length === 1) {
    throw new Error(`Catalog feed entry ${args.entries[0]!.id} exceeds the shard byte limit`);
  }
  const midpoint = Math.ceil(args.entries.length / 2);
  return [
    ...splitOversizedShard({ ...args, entries: args.entries.slice(0, midpoint) }),
    ...splitOversizedShard({ ...args, entries: args.entries.slice(midpoint) }),
  ];
}

export async function buildCatalogFeedShards(args: {
  feedId: FeedId;
  sequence: number;
  entries: CatalogFeedEntry[];
}): Promise<BuiltCatalogFeedShard[]> {
  if (args.entries.length > CATALOG_FEED_SHARD_ROOT_MAX_ENTRIES) {
    throw new Error("Catalog feed shard set exceeds its entry limit");
  }
  const entries = normalizeCatalogFeedEntries(args.entries);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.id === entries[index]!.id) {
      throw new Error(`Catalog feed shard set contains duplicate entry ${entries[index]!.id}`);
    }
  }
  const groups: CatalogFeedEntry[][] = [];
  for (let offset = 0; offset < entries.length; offset += SHARD_TARGET_ENTRY_COUNT) {
    groups.push(
      ...splitOversizedShard({
        ...args,
        entries: entries.slice(offset, offset + SHARD_TARGET_ENTRY_COUNT),
      }),
    );
  }
  const shards = await Promise.all(
    groups.map(async (shardEntries, index) => {
      const payload = serializeCatalogFeedShard({
        schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
        feedId: args.feedId,
        sequence: args.sequence,
        index,
        entries: shardEntries,
      });
      parseCatalogFeedShard(JSON.parse(payload));
      const bytes = new TextEncoder().encode(payload);
      if (bytes.length > SHARD_STORED_PAYLOAD_MAX_BYTES) {
        throw new Error("Catalog feed shard exceeds its final byte limit");
      }
      return {
        index,
        payload,
        sha256: await sha256Hex(bytes),
        byteLength: bytes.length,
        entryCount: shardEntries.length,
      };
    }),
  );
  const totalBytes = shards.reduce((sum, shard) => sum + shard.byteLength, 0);
  if (shards.length > CATALOG_FEED_SHARD_ROOT_MAX_SHARDS) {
    throw new Error("Catalog feed shard set exceeds its shard limit");
  }
  if (totalBytes > CATALOG_FEED_SHARD_SET_MAX_BYTES) {
    throw new Error("Catalog feed shard set exceeds its aggregate byte limit");
  }
  return shards;
}

export const beginCatalogFeedShardPublication = internalMutation({
  args: {
    feedId: feedIdValidator,
    requestedSequence: v.optional(v.number()),
    generatedAt: v.string(),
    expiresAt: v.string(),
    description: v.string(),
    entryCount: v.number(),
  },
  handler: async (ctx, args) => {
    const generatedAt = Date.parse(args.generatedAt);
    const expiresAt = Date.parse(args.expiresAt);
    if (
      !Number.isFinite(generatedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= generatedAt ||
      !Number.isSafeInteger(args.entryCount) ||
      args.entryCount < 0 ||
      args.entryCount > CATALOG_FEED_SHARD_ROOT_MAX_ENTRIES ||
      new TextEncoder().encode(args.description).length > 1024
    ) {
      throw new Error("Catalog feed shard publication bounds are invalid");
    }
    const latestShardPublication = await ctx.db
      .query("catalogFeedShardPublications")
      .withIndex("by_feed_and_sequence", (q) => q.eq("feedId", args.feedId))
      .order("desc")
      .first();
    const latestAtomicPublication = await ctx.db
      .query("catalogFeedPublications")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .unique();
    const latestSequence = Math.max(
      latestShardPublication?.sequence ?? 0,
      latestAtomicPublication?.sequence ?? 0,
    );
    const sequence = args.requestedSequence ?? latestSequence + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence < latestSequence) {
      throw new Error("Catalog feed shard publication sequence is invalid");
    }
    if (sequence === latestSequence && latestShardPublication?.sequence === sequence) {
      throw new Error("Catalog feed shard publication sequence already exists");
    }
    const publishedAt = Date.now();
    const expirationTime = publishedAt + SHARD_RETENTION_MS;
    const publicationId = await ctx.db.insert("catalogFeedShardPublications", {
      feedId: args.feedId,
      sequence,
      generatedAt: args.generatedAt,
      expiresAt: args.expiresAt,
      description: args.description,
      entryCount: args.entryCount,
      storedShardCount: 0,
      storedEntryCount: 0,
      storedByteCount: 0,
      status: "building",
      publishedAt,
      expirationTime,
    });
    return { publicationId, sequence, publishedAt, expirationTime };
  },
});

export const planCatalogFeedShardPublication = internalMutation({
  args: {
    publicationId: v.id("catalogFeedShardPublications"),
    expectedShardCount: v.number(),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (
      !publication ||
      publication.status !== "building" ||
      publication.expectedShardCount !== undefined ||
      !Number.isSafeInteger(args.expectedShardCount) ||
      args.expectedShardCount < 0 ||
      args.expectedShardCount > 1024 ||
      (publication.entryCount === 0) !== (args.expectedShardCount === 0)
    ) {
      throw new Error("Catalog feed shard publication plan is invalid");
    }
    await ctx.db.patch(publication._id, { expectedShardCount: args.expectedShardCount });
  },
});

export const storeCatalogFeedShard = internalMutation({
  args: {
    publicationId: v.id("catalogFeedShardPublications"),
    index: v.number(),
    payload: v.string(),
    sha256: v.string(),
    byteLength: v.number(),
    entryCount: v.number(),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (
      !publication ||
      publication.status !== "building" ||
      publication.expectedShardCount === undefined ||
      args.index !== publication.storedShardCount ||
      args.index >= publication.expectedShardCount ||
      !/^[a-f0-9]{64}$/u.test(args.sha256)
    ) {
      throw new Error("Catalog feed shard publication changed while storing");
    }
    const bytes = new TextEncoder().encode(args.payload);
    const shard = parseCatalogFeedShard(JSON.parse(args.payload));
    if (
      shard.feedId !== publication.feedId ||
      shard.sequence !== publication.sequence ||
      shard.index !== args.index ||
      shard.entries.length !== args.entryCount ||
      bytes.length !== args.byteLength ||
      args.byteLength > SHARD_STORED_PAYLOAD_MAX_BYTES ||
      publication.storedByteCount + args.byteLength > CATALOG_FEED_SHARD_SET_MAX_BYTES ||
      (await sha256Hex(bytes)) !== args.sha256
    ) {
      throw new Error("Catalog feed shard representation does not match its descriptor");
    }
    await ctx.db.insert("catalogFeedShards", {
      publicationId: publication._id,
      feedId: publication.feedId,
      sequence: publication.sequence,
      index: args.index,
      sha256: args.sha256,
      byteLength: args.byteLength,
      entryCount: args.entryCount,
      payload: args.payload,
      expirationTime: publication.expirationTime,
    });
    await ctx.db.insert("catalogFeedShardDescriptors", {
      publicationId: publication._id,
      index: args.index,
      sha256: args.sha256,
      byteLength: args.byteLength,
      entryCount: args.entryCount,
      expirationTime: publication.expirationTime,
    });
    await ctx.db.patch(publication._id, {
      storedShardCount: publication.storedShardCount + 1,
      storedEntryCount: publication.storedEntryCount + args.entryCount,
      storedByteCount: publication.storedByteCount + args.byteLength,
    });
  },
});

export const finalizeCatalogFeedShardPublication = internalMutation({
  args: { publicationId: v.id("catalogFeedShardPublications") },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (
      !publication ||
      publication.status !== "building" ||
      publication.expectedShardCount === undefined ||
      publication.storedShardCount !== publication.expectedShardCount ||
      publication.storedEntryCount !== publication.entryCount
    ) {
      throw new Error("Catalog feed shard publication is incomplete");
    }
    await ctx.db.patch(publication._id, { status: "ready" });
    return {
      feedId: publication.feedId,
      sequence: publication.sequence,
      entryCount: publication.entryCount,
      shardCount: publication.storedShardCount,
      publishedAt: publication.publishedAt,
    };
  },
});

export const getLatestCatalogFeedShardPublication = internalQuery({
  args: { feedId: feedIdValidator },
  handler: async (ctx, args) => {
    const publication = await ctx.db
      .query("catalogFeedShardPublications")
      .withIndex("by_feed_status_sequence", (q) =>
        q.eq("feedId", args.feedId).eq("status", "ready"),
      )
      .order("desc")
      .filter((q) => q.gt(q.field("expiresAt"), new Date().toISOString()))
      .first();
    if (!publication) return null;
    const shards = await ctx.db
      .query("catalogFeedShardDescriptors")
      .withIndex("by_publication_and_index", (q) => q.eq("publicationId", publication._id))
      .order("asc")
      .collect();
    if (
      publication.expectedShardCount === undefined ||
      shards.length !== publication.expectedShardCount
    ) {
      return null;
    }
    return {
      feedId: publication.feedId,
      sequence: publication.sequence,
      generatedAt: publication.generatedAt,
      expiresAt: publication.expiresAt,
      description: publication.description,
      entryCount: publication.entryCount,
      publishedAt: publication.publishedAt,
      shards: shards.map(({ index, sha256, byteLength, entryCount }) => ({
        index,
        sha256,
        byteLength,
        entryCount,
      })),
    };
  },
});

export const getCatalogFeedShardByDigest = internalQuery({
  args: { sha256: v.string() },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/u.test(args.sha256)) return null;
    const candidates = await ctx.db
      .query("catalogFeedShards")
      .withIndex("by_sha256", (q) => q.eq("sha256", args.sha256))
      .take(4);
    for (const shard of candidates) {
      const publication = await ctx.db.get(shard.publicationId);
      if (publication?.status === "ready" && publication.expirationTime > Date.now()) {
        return {
          payload: shard.payload,
          sha256: shard.sha256,
          byteLength: shard.byteLength,
          feedId: shard.feedId,
          sequence: shard.sequence,
          index: shard.index,
        };
      }
    }
    return null;
  },
});

export const pruneCatalogFeedShardsInternal = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? PRUNE_BATCH_SIZE;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > PRUNE_BATCH_SIZE) {
      throw new Error("Catalog feed shard prune batch size is invalid");
    }
    const now = Date.now();
    const descriptors = await ctx.db
      .query("catalogFeedShardDescriptors")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize);
    const shardLimit = batchSize - descriptors.length;
    const shards = await ctx.db
      .query("catalogFeedShards")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
      .take(shardLimit);
    const remaining = shardLimit - shards.length;
    const publications =
      remaining > 0
        ? await ctx.db
            .query("catalogFeedShardPublications")
            .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
            .take(remaining)
        : [];
    for (const row of [...descriptors, ...shards, ...publications]) await ctx.db.delete(row._id);
    const deleted = descriptors.length + shards.length + publications.length;
    const hasMore = deleted === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.catalogFeedShards.pruneCatalogFeedShardsInternal, {
        batchSize,
      });
    }
    return { deleted, hasMore };
  },
});
