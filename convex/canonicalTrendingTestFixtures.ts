import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { assertTestSeedAllowed } from "./lib/testSeed";

const CONFIRM = "manage-claw-590-canonical-trending-test-proof";
const PROOF_SNAPSHOT_PATTERN = /^claw-590-proof-[0-9a-f]{40}$/;
const CLEANUP_BATCH_SIZE = 200;
const CLEANUP_MAX_BATCHES = 100;
const SAMPLE_SIZE = 20;

const internalRefs = internal as unknown as {
  canonicalTrendingTestFixtures: {
    cleanupCanonicalTrendingProofBatch: unknown;
  };
};

const proofArgs = {
  confirm: v.literal(CONFIRM),
  snapshotId: v.string(),
};

function assertProofSnapshotId(snapshotId: string) {
  if (!PROOF_SNAPSHOT_PATTERN.test(snapshotId)) {
    throw new Error("Invalid CLAW-590 proof snapshot ID");
  }
}

function assertOwnedSnapshot(snapshot: Doc<"canonicalTrendingSnapshots">, snapshotId: string) {
  if (
    snapshot.snapshotId !== snapshotId ||
    snapshot.kind !== "skills" ||
    snapshot.rankingVersion !== "skills-trending-v1" ||
    snapshot.windowHours !== 24
  ) {
    throw new Error("CLAW-590 proof snapshot ownership mismatch");
  }
}

export const readCanonicalTrendingProof = internalQuery({
  args: proofArgs,
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    assertProofSnapshotId(args.snapshotId);
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    const items = await ctx.db
      .query("canonicalTrendingItems")
      .withIndex("by_snapshot_id_and_position", (q) => q.eq("snapshotId", args.snapshotId))
      .take(SAMPLE_SIZE);
    if (!snapshot) {
      if (items.length > 0) throw new Error("CLAW-590 proof snapshot has orphaned items");
      return { present: false as const };
    }
    assertOwnedSnapshot(snapshot, args.snapshotId);
    const sample = await Promise.all(
      items.map(async (item) => {
        if (item.sourceRef.kind === "clawhub") {
          const skillId = item.sourceRef.skillId;
          const digest = await ctx.db
            .query("skillSearchDigest")
            .withIndex("by_skill", (q) => q.eq("skillId", skillId))
            .unique();
          if (!digest) throw new Error("CLAW-590 proof native source is missing");
          return {
            rank: item.position + 1,
            id: item.card.id,
            lane: item.lane,
            publisherKey: String(digest.ownerPublisherId ?? digest.ownerUserId),
            upstreamRank: null,
            metrics: item.card.metrics,
          };
        }
        const externalId = item.sourceRef.externalId;
        const digest = await ctx.db
          .query("skillsShMirrorDigests")
          .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
          .unique();
        if (!digest) throw new Error("CLAW-590 proof external source is missing");
        return {
          rank: item.position + 1,
          id: item.card.id,
          lane: item.lane,
          publisherKey: digest.owner ?? digest.sourceHost ?? digest.externalId,
          upstreamRank: digest.trendingRank ?? null,
          metrics: item.card.metrics,
        };
      }),
    );
    return {
      present: true as const,
      snapshotId: snapshot.snapshotId,
      status: snapshot.status,
      generatedAt: snapshot.generatedAt,
      completedAt: snapshot.completedAt ?? null,
      totalItems: snapshot.totalItems ?? null,
      writtenItems: snapshot.writtenItems,
      sourceCounts: snapshot.sourceCounts ?? null,
      operations: snapshot.operations ?? null,
      sample,
    };
  },
});

export const cleanupCanonicalTrendingProofBatch = internalMutation({
  args: proofArgs,
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    assertProofSnapshotId(args.snapshotId);
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    const items = await ctx.db
      .query("canonicalTrendingItems")
      .withIndex("by_snapshot_id_and_position", (q) => q.eq("snapshotId", args.snapshotId))
      .take(CLEANUP_BATCH_SIZE);
    if (!snapshot) {
      if (items.length > 0) throw new Error("CLAW-590 cleanup found orphaned proof items");
      return { done: true as const, itemsDeleted: 0, snapshotDeleted: false };
    }
    assertOwnedSnapshot(snapshot, args.snapshotId);
    for (const item of items) await ctx.db.delete(item._id);
    const done = items.length < CLEANUP_BATCH_SIZE;
    if (done) await ctx.db.delete(snapshot._id);
    return { done, itemsDeleted: items.length, snapshotDeleted: done };
  },
});

export const cleanupCanonicalTrendingProof = internalAction({
  args: proofArgs,
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    assertProofSnapshotId(args.snapshotId);
    let itemsDeleted = 0;
    for (let batch = 1; batch <= CLEANUP_MAX_BATCHES; batch += 1) {
      const result = (await ctx.runMutation(
        internalRefs.canonicalTrendingTestFixtures.cleanupCanonicalTrendingProofBatch as never,
        args as never,
      )) as { done: boolean; itemsDeleted: number; snapshotDeleted: boolean };
      itemsDeleted += result.itemsDeleted;
      if (result.done) {
        return {
          ok: true as const,
          itemsDeleted,
          snapshotDeleted: result.snapshotDeleted,
          batches: batch,
        };
      }
    }
    throw new Error("CLAW-590 proof cleanup exceeded its bounded batch limit");
  },
});
