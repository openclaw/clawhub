import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  CANONICAL_TRENDING_FIRST_PAGE_SIZE,
  CANONICAL_TRENDING_LANE_LIMIT,
  CANONICAL_TRENDING_PUBLISHER_CAP,
  CANONICAL_TRENDING_RANKING_VERSION,
  CANONICAL_TRENDING_WINDOW_HOURS,
  blendCanonicalTrendingPools,
  buildExternalCanonicalTrendingCandidate,
  buildNativeCanonicalTrendingCandidate,
  canonicalTrendingCardValidator,
  canonicalTrendingSourceRefValidator,
  decodeCanonicalTrendingCursor,
  encodeCanonicalTrendingCursor,
  isFreshExternalTrendingRun,
  retainTopCanonicalTrendingCandidates,
  type CanonicalTrendingMaterializationCandidate,
} from "./lib/canonicalTrending";
import { forEachCanonicalTrendingSourcePage } from "./lib/canonicalTrendingPagination";
import { shouldExcludeSkillFromPublicBrowse } from "./lib/publicBrowse";
import { getRuntimeRolloutCapabilities } from "./lib/rolloutCapabilities";
import {
  accumulateRollingHourlyStats,
  finalizeRollingHourlyStats,
  getCompletedRolling24HourWindow,
  type RollingHourlyStatTotals,
} from "./lib/skillHourlyStats";
import { isPublicSkillsShMirrorDigest } from "./lib/skillsShMirrorPublic";
import { assertTestSeedAllowed } from "./lib/testSeed";
import { getSkillsShPublicCatalogEnabledHandler } from "./rolloutCapabilities";

const WRITE_BATCH_SIZE = 100;
const NATIVE_SOURCE_BATCH_SIZE = 100;
const SNAPSHOT_RETENTION_MS = 48 * 60 * 60 * 1_000;
const SNAPSHOT_MAX_SERVING_AGE_MS = 2 * 60 * 60 * 1_000;
const EXTERNAL_SOURCE_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const RISING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const PRUNE_BATCH_SIZE = 500;
const PRUNE_MAX_BATCHES = 20;

const internalRefs = internal as unknown as {
  canonicalTrending: {
    failSnapshotInternal: unknown;
    finalizeSnapshotInternal: unknown;
    getExternalSourcePageInternal: unknown;
    getHourlySourcePageInternal: unknown;
    getMaterializationModeInternal: unknown;
    getNativeSourceBatchInternal: unknown;
    getLatestCompletedTrendingRunInternal: unknown;
    pruneExpiredInternal: unknown;
    pruneExpiredActionInternal: unknown;
    startSnapshotInternal: unknown;
    writeItemsInternal: unknown;
  };
  skillHourlyStats: {
    sealForSnapshotInternal: unknown;
  };
};

async function pruneExpiredRows(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  now: number,
) {
  let itemsDeleted = 0;
  let snapshotsDeleted = 0;
  let batches = 0;
  for (; batches < PRUNE_MAX_BATCHES; batches += 1) {
    const pruned = (await ctx.runMutation(
      internalRefs.canonicalTrending.pruneExpiredInternal as never,
      { now, batchSize: PRUNE_BATCH_SIZE } as never,
    )) as { itemsDeleted: number; snapshotsDeleted: number; fullBatch: boolean };
    itemsDeleted += pruned.itemsDeleted;
    snapshotsDeleted += pruned.snapshotsDeleted;
    if (!pruned.fullBatch) return { itemsDeleted, snapshotsDeleted, batches: batches + 1 };
  }
  return { itemsDeleted, snapshotsDeleted, batches };
}

const laneValidator = v.union(
  v.literal("clawhub-trending"),
  v.literal("clawhub-rising"),
  v.literal("skills-sh-trending"),
);

const sourceCountsValidator = v.object({
  clawhubTrending: v.number(),
  clawhubRising: v.number(),
  skillsShTrending: v.number(),
});

const operationsValidator = v.object({
  documentsRead: v.number(),
  documentsWritten: v.number(),
  functionCalls: v.number(),
});

const LANE_DIVERSITY_RESERVE = {
  size: CANONICAL_TRENDING_FIRST_PAGE_SIZE,
  publisherCap: CANONICAL_TRENDING_PUBLISHER_CAP,
};

export const getNativeSourceBatchInternal = internalQuery({
  args: { skillIds: v.array(v.id("skills")) },
  handler: async (ctx, args) => {
    if (args.skillIds.length < 1 || args.skillIds.length > NATIVE_SOURCE_BATCH_SIZE) {
      throw new Error("Invalid native Trending source batch size");
    }
    const digests = await Promise.all(
      args.skillIds.map((skillId) =>
        ctx.db
          .query("skillSearchDigest")
          .withIndex("by_skill", (q) => q.eq("skillId", skillId))
          .unique(),
      ),
    );
    const page = digests.filter(
      (digest): digest is Doc<"skillSearchDigest"> =>
        digest !== null &&
        !shouldExcludeSkillFromPublicBrowse(digest) &&
        digest.publicVersion?.status === "available",
    );
    return {
      page,
      documentsRead: digests.filter((digest) => digest !== null).length,
    };
  },
});

export const getHourlySourcePageInternal = internalQuery({
  args: {
    startHour: v.number(),
    endHour: v.number(),
    maxGeneration: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("skillHourlyStats")
      .withIndex("by_hour", (q) => q.gte("hour", args.startHour).lte("hour", args.endHour))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.filter((row) => row.generation <= args.maxGeneration),
      documentsRead: result.page.length,
    };
  },
});

export const getExternalSourcePageInternal = internalQuery({
  args: {
    activationLockToken: v.optional(v.string()),
    allowHiddenProof: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.allowHiddenProof) assertTestSeedAllowed();
    const mirrorControl = args.activationLockToken
      ? await ctx.db
          .query("skillsShMirrorControls")
          .withIndex("by_key", (q) => q.eq("key", "global"))
          .unique()
      : null;
    const activationAuthorized = Boolean(
      args.activationLockToken && mirrorControl?.activationLockToken === args.activationLockToken,
    );
    if (
      !activationAuthorized &&
      !args.allowHiddenProof &&
      !(await getSkillsShPublicCatalogEnabledHandler(ctx))
    ) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        documentsRead: 1,
      };
    }
    const result = await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_visible_installable_fresh_slug", (q) =>
        q
          .eq("active", true)
          .eq("publicVisible", true)
          .eq("installable", true)
          .eq("sourceFreshnessStatus", "observed-only"),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.filter(
        (digest) => isPublicSkillsShMirrorDigest(digest) && digest.trendingRank !== undefined,
      ),
      documentsRead: result.page.length,
    };
  },
});

export const getMaterializationModeInternal = internalQuery({
  args: {
    activationLockToken: v.optional(v.string()),
    skillsShMode: v.optional(v.literal("native-only")),
  },
  handler: async (ctx, args) => {
    const control = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (args.activationLockToken) {
      if (control?.activationLockToken !== args.activationLockToken) {
        throw new Error("skills.sh activation lock is not current");
      }
      return { includeHiddenSkillsSh: true as const };
    }
    if (control?.activationLockToken) {
      throw new Error("skills.sh public activation is in progress");
    }
    return { includeHiddenSkillsSh: false as const };
  },
});

export const getLatestCompletedTrendingRunInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const run = await ctx.db
      .query("skillsShMirrorRuns")
      .withIndex("by_started_at")
      .order("desc")
      .filter((q) =>
        q.and(q.eq(q.field("sourceView"), "trending"), q.eq(q.field("status"), "completed")),
      )
      .first();
    return {
      runId: run?._id ?? null,
      completedAt: run?.completedAt ?? null,
      documentsRead: Number(Boolean(run)),
    };
  },
});

export const startSnapshotInternal = internalMutation({
  args: {
    snapshotId: v.string(),
    generatedAt: v.number(),
    expiresAt: v.number(),
    windowStartDay: v.number(),
    windowEndDay: v.number(),
    windowStartHour: v.optional(v.number()),
    windowEndHour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    if (existing) throw new Error("Trending snapshot already exists");
    return await ctx.db.insert("canonicalTrendingSnapshots", {
      snapshotId: args.snapshotId,
      kind: "skills",
      status: "building",
      rankingVersion: CANONICAL_TRENDING_RANKING_VERSION,
      generatedAt: args.generatedAt,
      expiresAt: args.expiresAt,
      windowHours: CANONICAL_TRENDING_WINDOW_HOURS,
      windowStartDay: args.windowStartDay,
      windowEndDay: args.windowEndDay,
      windowStartHour: args.windowStartHour,
      windowEndHour: args.windowEndHour,
      writtenItems: 0,
    });
  },
});

export const writeItemsInternal = internalMutation({
  args: {
    snapshotId: v.string(),
    items: v.array(
      v.object({
        position: v.number(),
        lane: laneValidator,
        sourceRef: canonicalTrendingSourceRefValidator,
        card: canonicalTrendingCardValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    if (!snapshot || snapshot.status !== "building") {
      throw new Error("Trending snapshot is not writable");
    }
    for (const item of args.items) {
      if (!Number.isSafeInteger(item.position) || item.position < 0) {
        throw new Error("Invalid Trending position");
      }
      await ctx.db.insert("canonicalTrendingItems", {
        snapshotId: args.snapshotId,
        position: item.position,
        lane: item.lane,
        sourceRef: item.sourceRef,
        card: item.card,
        expiresAt: snapshot.expiresAt,
      });
    }
    await ctx.db.patch(snapshot._id, { writtenItems: snapshot.writtenItems + args.items.length });
    return { writtenItems: snapshot.writtenItems + args.items.length };
  },
});

export const finalizeSnapshotInternal = internalMutation({
  args: {
    snapshotId: v.string(),
    completedAt: v.number(),
    totalItems: v.number(),
    sourceCounts: sourceCountsValidator,
    operations: operationsValidator,
    activationLockToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    if (!snapshot || snapshot.status !== "building") {
      throw new Error("Trending snapshot cannot be finalized");
    }
    if (snapshot.writtenItems !== args.totalItems) {
      throw new Error("Trending snapshot item count mismatch");
    }
    const mirrorControl = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (args.activationLockToken) {
      if (mirrorControl?.activationLockToken !== args.activationLockToken) {
        throw new Error("skills.sh activation lock changed before Trending publication");
      }
    } else if (mirrorControl?.activationLockToken) {
      throw new Error("skills.sh activation started before Trending publication");
    }
    await ctx.db.patch(snapshot._id, {
      status: "ready",
      completedAt: args.completedAt,
      totalItems: args.totalItems,
      sourceCounts: args.sourceCounts,
      operations: args.operations,
    });
    return { snapshotId: args.snapshotId, status: "ready" as const };
  },
});

export const failSnapshotInternal = internalMutation({
  args: {
    snapshotId: v.string(),
    error: v.string(),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    if (!snapshot || snapshot.status !== "building") return { changed: false };
    await ctx.db.patch(snapshot._id, {
      status: "failed",
      completedAt: args.completedAt,
      error: args.error.slice(0, 500),
    });
    return { changed: true };
  },
});

export const pruneExpiredInternal = internalMutation({
  args: { now: v.number(), batchSize: v.number() },
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(Math.trunc(args.batchSize), 1), PRUNE_BATCH_SIZE);
    const items = await ctx.db
      .query("canonicalTrendingItems")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", args.now))
      .take(batchSize);
    for (const item of items) await ctx.db.delete(item._id);
    const remaining = batchSize - items.length;
    const snapshots =
      remaining > 0
        ? await ctx.db
            .query("canonicalTrendingSnapshots")
            .withIndex("by_expires_at", (q) => q.lte("expiresAt", args.now))
            .take(remaining)
        : [];
    for (const snapshot of snapshots) await ctx.db.delete(snapshot._id);
    return {
      itemsDeleted: items.length,
      snapshotsDeleted: snapshots.length,
      fullBatch: items.length + snapshots.length === batchSize,
    };
  },
});

export const pruneExpiredActionInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await pruneExpiredRows(ctx, Date.now());
    const continuationScheduled = result.batches === PRUNE_MAX_BATCHES;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internalRefs.canonicalTrending.pruneExpiredActionInternal as never,
        {},
      );
    }
    return { ...result, continuationScheduled };
  },
});

export const materializeInternal = internalAction({
  args: {
    proofSnapshotId: v.optional(v.string()),
    activationLockToken: v.optional(v.string()),
    skillsShMode: v.optional(v.literal("native-only")),
  },
  handler: async (ctx, args) => {
    if (args.proofSnapshotId !== undefined) {
      assertTestSeedAllowed();
      if (!/^claw-590-proof-[0-9a-f]{40}$/.test(args.proofSnapshotId)) {
        throw new Error("Invalid CLAW-590 proof snapshot ID");
      }
    }
    if (args.skillsShMode === "native-only" && !args.activationLockToken) {
      throw new Error("native-only Trending materialization requires a visibility lock");
    }
    const startedAt = Date.now();
    const snapshotId = args.proofSnapshotId ?? `skills-${startedAt}`;
    let snapshotStarted = false;
    let functionCalls = 0;
    let documentsRead = 0;
    let documentsWritten = 0;

    try {
      await ctx.runQuery(
        internalRefs.canonicalTrending.getMaterializationModeInternal as never,
        {
          activationLockToken: args.activationLockToken,
          skillsShMode: args.skillsShMode,
        } as never,
      );
      functionCalls += 1;
      type HourlyWindow = {
        startHour: number;
        endHour: number;
        startAt: number;
        endAt: number;
        lastAggregationCompletedAt: number;
        sealedGeneration: number;
      };
      const proofWindow =
        args.proofSnapshotId !== undefined
          ? {
              ...getCompletedRolling24HourWindow(startedAt),
              lastAggregationCompletedAt: startedAt,
              sealedGeneration: 0,
            }
          : null;
      const hourlyWindow = proofWindow
        ? proofWindow
        : ((await ctx.runMutation(
            internalRefs.skillHourlyStats.sealForSnapshotInternal as never,
            { now: startedAt } as never,
          )) as HourlyWindow | null);
      if (!proofWindow) functionCalls += 1;
      if (!hourlyWindow) {
        return { status: "unavailable" as const, reason: "hourly-stats-not-ready" as const };
      }

      const usageBySkill: RollingHourlyStatTotals = new Map();
      const hourlySource = await forEachCanonicalTrendingSourcePage(
        ctx,
        internalRefs.canonicalTrending.getHourlySourcePageInternal,
        {
          startHour: hourlyWindow.startHour,
          endHour: hourlyWindow.endHour,
          maxGeneration: hourlyWindow.sealedGeneration,
        },
        (page) => accumulateRollingHourlyStats(usageBySkill, page as Doc<"skillHourlyStats">[]),
      );
      finalizeRollingHourlyStats(usageBySkill);

      let nativeCandidates: CanonicalTrendingMaterializationCandidate[] = [];
      let risingCandidates: CanonicalTrendingMaterializationCandidate[] = [];
      const nativeSource = { documentsRead: 0, functionCalls: 0 };
      const risingCutoff = startedAt - RISING_MAX_AGE_MS;
      let pendingNativeSkillIds: Id<"skills">[] = [];
      const flushNativeSourceBatch = async () => {
        if (pendingNativeSkillIds.length === 0) return;
        const skillIds = pendingNativeSkillIds;
        pendingNativeSkillIds = [];
        const sourceBatch = (await ctx.runQuery(
          internalRefs.canonicalTrending.getNativeSourceBatchInternal as never,
          { skillIds } as never,
        )) as { page: Doc<"skillSearchDigest">[]; documentsRead: number };
        nativeSource.documentsRead += sourceBatch.documentsRead;
        nativeSource.functionCalls += 1;
        for (const digest of sourceBatch.page) {
          const usage = usageBySkill.get(String(digest.skillId));
          if (!usage || usage.downloads + usage.installs + usage.bookmarks <= 0) continue;
          const candidate = buildNativeCanonicalTrendingCandidate(digest, usage);
          if (!candidate) continue;
          nativeCandidates.push(candidate);
          if (candidate.createdAt >= risingCutoff) {
            risingCandidates.push({ ...candidate, lane: "clawhub-rising" });
          }
        }
        // The fetched batch is capped at 100, so each lane stays within 100 rows of its limit.
        nativeCandidates = retainTopCanonicalTrendingCandidates(
          nativeCandidates,
          "clawhub-trending",
          CANONICAL_TRENDING_LANE_LIMIT,
          LANE_DIVERSITY_RESERVE,
        );
        risingCandidates = retainTopCanonicalTrendingCandidates(
          risingCandidates,
          "clawhub-rising",
          CANONICAL_TRENDING_LANE_LIMIT,
          LANE_DIVERSITY_RESERVE,
        );
        // Each digest is unique by skill, so its rolling totals are no longer needed.
        for (const skillId of skillIds) usageBySkill.delete(String(skillId));
      };
      for (const skillId of usageBySkill.keys()) {
        pendingNativeSkillIds.push(skillId as Id<"skills">);
        if (pendingNativeSkillIds.length === NATIVE_SOURCE_BATCH_SIZE) {
          await flushNativeSourceBatch();
        }
      }
      await flushNativeSourceBatch();
      type TrendingRun = {
        runId: Doc<"skillsShMirrorRuns">["_id"] | null;
        completedAt: number | null;
        documentsRead: number;
      };
      let latestTrendingRun: TrendingRun | null = null;
      let externalSource = {
        documentsRead: 0,
        functionCalls: 0,
      };
      let externalCandidates: CanonicalTrendingMaterializationCandidate[] = [];
      if (
        args.skillsShMode !== "native-only" &&
        getRuntimeRolloutCapabilities().skillsSh.runtimeEnabled
      ) {
        const candidateRun = (await ctx.runQuery(
          internalRefs.canonicalTrending.getLatestCompletedTrendingRunInternal as never,
          {},
        )) as TrendingRun;
        documentsRead += candidateRun.documentsRead;
        functionCalls += 1;
        if (isFreshExternalTrendingRun(candidateRun, startedAt, EXTERNAL_SOURCE_MAX_AGE_MS)) {
          latestTrendingRun = candidateRun;
          externalSource = await forEachCanonicalTrendingSourcePage(
            ctx,
            internalRefs.canonicalTrending.getExternalSourcePageInternal,
            {
              activationLockToken: args.activationLockToken,
              allowHiddenProof: args.proofSnapshotId !== undefined,
            },
            (page) => {
              for (const digest of page as Doc<"skillsShMirrorDigests">[]) {
                if (digest.trendingObservedRunId !== latestTrendingRun?.runId) continue;
                const candidate = buildExternalCanonicalTrendingCandidate(digest);
                if (candidate) externalCandidates.push(candidate);
              }
              externalCandidates = retainTopCanonicalTrendingCandidates(
                externalCandidates,
                "skills-sh-trending",
                CANONICAL_TRENDING_LANE_LIMIT,
                LANE_DIVERSITY_RESERVE,
              );
            },
          );
        }
      }
      documentsRead +=
        nativeSource.documentsRead + hourlySource.documentsRead + externalSource.documentsRead;
      functionCalls +=
        nativeSource.functionCalls + hourlySource.functionCalls + externalSource.functionCalls;

      if (latestTrendingRun) {
        const confirmedTrendingRun = (await ctx.runQuery(
          internalRefs.canonicalTrending.getLatestCompletedTrendingRunInternal as never,
          {},
        )) as TrendingRun;
        documentsRead += confirmedTrendingRun.documentsRead;
        functionCalls += 1;
        if (confirmedTrendingRun.runId !== latestTrendingRun.runId) {
          throw new Error("skills.sh Trending run changed during materialization");
        }
      }

      const blended = blendCanonicalTrendingPools({
        clawhubTrending: nativeCandidates,
        clawhubRising: risingCandidates,
        skillsShTrending: externalCandidates,
      });

      const expiresAt = startedAt + SNAPSHOT_RETENTION_MS;
      await ctx.runMutation(
        internalRefs.canonicalTrending.startSnapshotInternal as never,
        {
          snapshotId,
          generatedAt: startedAt,
          expiresAt,
          windowStartDay: Math.floor(hourlyWindow.startHour / 24),
          windowEndDay: Math.floor(hourlyWindow.endHour / 24),
          windowStartHour: hourlyWindow.startHour,
          windowEndHour: hourlyWindow.endHour,
        } as never,
      );
      snapshotStarted = true;
      functionCalls += 1;
      documentsWritten += 1;

      for (let index = 0; index < blended.length; index += WRITE_BATCH_SIZE) {
        const batch = blended.slice(index, index + WRITE_BATCH_SIZE);
        await ctx.runMutation(
          internalRefs.canonicalTrending.writeItemsInternal as never,
          {
            snapshotId,
            items: batch.map((candidate, batchIndex) => ({
              position: index + batchIndex,
              lane: candidate.lane,
              sourceRef: candidate.sourceRef,
              card: candidate.card,
            })),
          } as never,
        );
        functionCalls += 1;
        documentsWritten += batch.length + 1;
      }

      const sourceCounts = {
        clawhubTrending: nativeCandidates.length,
        clawhubRising: risingCandidates.length,
        skillsShTrending: externalCandidates.length,
      };
      const operations = {
        documentsRead,
        documentsWritten: documentsWritten + 1,
        functionCalls: functionCalls + 1,
      };
      await ctx.runMutation(
        internalRefs.canonicalTrending.finalizeSnapshotInternal as never,
        {
          snapshotId,
          completedAt: Date.now(),
          totalItems: blended.length,
          sourceCounts,
          operations,
          activationLockToken: args.activationLockToken,
        } as never,
      );
      functionCalls += 1;
      documentsWritten += 1;

      return {
        status: "ready" as const,
        snapshotId,
        generatedAt: new Date(startedAt).toISOString(),
        windowHours: CANONICAL_TRENDING_WINDOW_HOURS,
        rankingVersion: CANONICAL_TRENDING_RANKING_VERSION,
        totalItems: blended.length,
        sourceCounts,
        operations: {
          documentsRead,
          documentsWritten,
          functionCalls,
        },
        durationMs: Date.now() - startedAt,
        sample: blended.slice(0, 20).map((candidate, index) => ({
          rank: index + 1,
          lane: candidate.lane,
          id: candidate.card.id,
          displayName: candidate.card.displayName,
          trending24hDownloads: candidate.card.metrics.trending24hDownloads ?? null,
          trending24hInstalls: candidate.card.metrics.trending24hInstalls,
          lifetimeInstalls: candidate.card.metrics.lifetimeInstalls,
        })),
      };
    } catch (error) {
      if (snapshotStarted) {
        await ctx.runMutation(
          internalRefs.canonicalTrending.failSnapshotInternal as never,
          {
            snapshotId,
            completedAt: Date.now(),
            error:
              error instanceof Error ? error.message : "Unknown Trending materialization failure",
          } as never,
        );
      }
      throw error;
    }
  },
});

export const getReadyNativeSnapshotInternal = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_kind_and_status_and_expires_at", (q) =>
        q.eq("kind", "skills").eq("status", "ready").gt("expiresAt", args.now),
      )
      .order("desc")
      .first();
    if (
      !snapshot ||
      snapshot.generatedAt + SNAPSHOT_MAX_SERVING_AGE_MS <= args.now ||
      snapshot.rankingVersion !== CANONICAL_TRENDING_RANKING_VERSION ||
      snapshot.totalItems === undefined ||
      !snapshot.sourceCounts ||
      snapshot.sourceCounts.skillsShTrending !== 0 ||
      !snapshot.operations
    ) {
      return null;
    }
    return {
      status: "ready" as const,
      snapshotId: snapshot.snapshotId,
      generatedAt: new Date(snapshot.generatedAt).toISOString(),
      windowHours: snapshot.windowHours,
      rankingVersion: snapshot.rankingVersion,
      totalItems: snapshot.totalItems,
      sourceCounts: snapshot.sourceCounts,
      operations: snapshot.operations,
      reused: true as const,
    };
  },
});

export const getPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100) {
      throw new Error("Invalid Trending page limit");
    }
    let decoded = null;
    if (args.cursor) {
      try {
        decoded = decodeCanonicalTrendingCursor(args.cursor);
      } catch {
        return { status: "invalid-cursor" as const };
      }
    }
    const now = Date.now();
    const snapshot = decoded
      ? await ctx.db
          .query("canonicalTrendingSnapshots")
          .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", decoded.snapshotId))
          .unique()
      : await ctx.db
          .query("canonicalTrendingSnapshots")
          .withIndex("by_kind_and_status_and_expires_at", (q) =>
            q.eq("kind", "skills").eq("status", "ready").gt("expiresAt", now),
          )
          .order("desc")
          .first();
    if (!snapshot && !decoded) return { status: "unavailable" as const };
    if (snapshot && snapshot.generatedAt + SNAPSHOT_MAX_SERVING_AGE_MS <= now) {
      return { status: decoded ? ("expired" as const) : ("unavailable" as const) };
    }
    if (snapshot && snapshot.rankingVersion !== CANONICAL_TRENDING_RANKING_VERSION) {
      return { status: decoded ? ("expired" as const) : ("unavailable" as const) };
    }
    if (
      !snapshot ||
      snapshot.status !== "ready" ||
      snapshot.totalItems === undefined ||
      snapshot.expiresAt <= now
    ) {
      return { status: "expired" as const };
    }
    const offset = decoded?.offset ?? 0;
    const skillsShPublicCatalogEnabled = await getSkillsShPublicCatalogEnabledHandler(ctx);
    if (
      decoded &&
      ((decoded.skillsShPublic ?? false) !== skillsShPublicCatalogEnabled ||
        // Pre-CLAW-603 page cursors did not record emitted rows, so a nonzero
        // offset cannot be ranked correctly once hidden rows are filtered.
        (decoded.emitted === undefined && decoded.offset > 0))
    ) {
      return { status: "invalid-cursor" as const };
    }
    const visibleTotal = skillsShPublicCatalogEnabled
      ? snapshot.totalItems
      : Math.max(0, snapshot.totalItems - (snapshot.sourceCounts?.skillsShTrending ?? 0));
    if (
      decoded &&
      (decoded.offset > snapshot.totalItems ||
        (decoded.emitted !== undefined && decoded.emitted > visibleTotal))
    ) {
      return { status: "invalid-cursor" as const };
    }
    const emittedBefore = decoded?.emitted ?? 0;
    const visibleRows: Array<Doc<"canonicalTrendingItems">> = [];
    let nextOffset = offset;
    while (
      emittedBefore + visibleRows.length < visibleTotal &&
      visibleRows.length < args.limit &&
      nextOffset < snapshot.totalItems
    ) {
      const batchSize = Math.min(100, snapshot.totalItems - nextOffset);
      const rows = await ctx.db
        .query("canonicalTrendingItems")
        .withIndex("by_snapshot_id_and_position", (q) =>
          q
            .eq("snapshotId", snapshot.snapshotId)
            .gte("position", nextOffset)
            .lt("position", nextOffset + batchSize),
        )
        .take(batchSize);
      if (rows.length === 0) break;
      const eligibility = await Promise.all(
        rows.map(async (row) => {
          const sourceRef = row.sourceRef;
          if (sourceRef.kind === "clawhub") {
            const digest = await ctx.db
              .query("skillSearchDigest")
              .withIndex("by_skill", (q) => q.eq("skillId", sourceRef.skillId))
              .unique();
            return Boolean(
              digest &&
              !shouldExcludeSkillFromPublicBrowse(digest) &&
              digest.publicVersion?.status === "available",
            );
          }
          if (!skillsShPublicCatalogEnabled) return false;
          const digest = await ctx.db
            .query("skillsShMirrorDigests")
            .withIndex("by_external_id", (q) => q.eq("externalId", sourceRef.externalId))
            .unique();
          return Boolean(digest && isPublicSkillsShMirrorDigest(digest));
        }),
      );
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        nextOffset = row.position + 1;
        if (eligibility[index]) visibleRows.push(row);
        if (visibleRows.length >= args.limit) break;
      }
    }
    const emitted = emittedBefore + visibleRows.length;
    return {
      status: "ok" as const,
      page: {
        kind: "skills" as const,
        snapshotId: snapshot.snapshotId,
        snapshotCursor: encodeCanonicalTrendingCursor({
          snapshotId: snapshot.snapshotId,
          offset: 0,
          emitted: 0,
          skillsShPublic: skillsShPublicCatalogEnabled,
        }),
        generatedAt: new Date(snapshot.generatedAt).toISOString(),
        windowHours: snapshot.windowHours,
        rankingVersion: snapshot.rankingVersion,
        totalItems: visibleTotal,
        items: visibleRows.map((row, index) => ({
          ...row.card,
          rank: skillsShPublicCatalogEnabled ? row.position + 1 : emittedBefore + index + 1,
          lane: row.lane,
        })),
        nextCursor:
          emitted < visibleTotal && nextOffset < snapshot.totalItems
            ? encodeCanonicalTrendingCursor({
                snapshotId: snapshot.snapshotId,
                offset: nextOffset,
                emitted,
                skillsShPublic: skillsShPublicCatalogEnabled,
              })
            : null,
      },
    };
  },
});
