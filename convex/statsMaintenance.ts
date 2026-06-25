import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import {
  isPublicPluginDoc,
  isPublicSkillDoc,
  setGlobalPublicPluginsCount,
  setGlobalPublicSkillsCount,
} from "./lib/globalStats";
import {
  computeRecommendationScore,
  RECOMMENDATION_SCORE_VERSION,
} from "./lib/recommendationScore";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES = 5;
const MAX_MAX_BATCHES = 50;
const BACKFILL_STATE_KEY = "default";

export const backfillSkillStatFieldsInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      const next = buildSkillStatPatch(skill);
      if (!next) continue;
      await ctx.db.patch(skill._id, next);
      patched += 1;
    }

    return {
      ok: true as const,
      scanned: page.length,
      patched,
      cursor: isDone ? null : continueCursor,
      isDone,
    };
  },
});

type BackfillState = {
  cursor: string | null;
  doneAt?: number;
};

type BackfillActionArgs = {
  batchSize?: number;
  maxBatches?: number;
  resetCursor?: boolean;
};

type BackfillStats = {
  scanned: number;
  patched: number;
  batches: number;
};

type BackfillActionResult = {
  ok: true;
  isDone: boolean;
  cursor: string | null;
  stats: BackfillStats;
};

export const getSkillStatBackfillStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackfillState> => {
    const state = await ctx.db
      .query("skillStatBackfillState")
      .withIndex("by_key", (q) => q.eq("key", BACKFILL_STATE_KEY))
      .unique();
    return { cursor: state?.cursor ?? null, doneAt: state?.doneAt };
  },
});

export const setSkillStatBackfillStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    doneAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("skillStatBackfillState")
      .withIndex("by_key", (q) => q.eq("key", BACKFILL_STATE_KEY))
      .unique();

    if (!state) {
      await ctx.db.insert("skillStatBackfillState", {
        key: BACKFILL_STATE_KEY,
        cursor: args.cursor,
        doneAt: args.doneAt,
        updatedAt: now,
      });
      return { ok: true as const };
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      doneAt: args.doneAt,
      updatedAt: now,
    });

    return { ok: true as const };
  },
});

async function runSkillStatBackfillInternalHandler(
  ctx: ActionCtx,
  args: BackfillActionArgs,
): Promise<BackfillActionResult> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  if (args.resetCursor) {
    await ctx.runMutation(internal.statsMaintenance.setSkillStatBackfillStateInternal, {
      cursor: undefined,
      doneAt: undefined,
    });
  }

  const state = (await ctx.runQuery(
    internal.statsMaintenance.getSkillStatBackfillStateInternal,
    {},
  )) as BackfillState;
  if (state.doneAt && !args.resetCursor) {
    return {
      ok: true,
      isDone: true,
      cursor: null,
      stats: { scanned: 0, patched: 0, batches: 0 },
    };
  }

  let cursor: string | null = state.cursor ?? null;
  const stats: BackfillStats = { scanned: 0, patched: 0, batches: 0 };

  for (let i = 0; i < maxBatches; i += 1) {
    const result = (await ctx.runMutation(
      internal.statsMaintenance.backfillSkillStatFieldsInternal,
      {
        cursor: cursor ?? undefined,
        batchSize,
      },
    )) as { scanned: number; patched: number; cursor: string | null; isDone: boolean };
    stats.scanned += result.scanned;
    stats.patched += result.patched;
    stats.batches += 1;
    cursor = result.cursor;

    if (result.isDone) {
      await ctx.runMutation(internal.statsMaintenance.setSkillStatBackfillStateInternal, {
        cursor: undefined,
        doneAt: Date.now(),
      });
      return { ok: true, isDone: true, cursor: null, stats };
    }

    await ctx.runMutation(internal.statsMaintenance.setSkillStatBackfillStateInternal, {
      cursor: cursor ?? undefined,
      doneAt: undefined,
    });
  }

  return { ok: true, isDone: false, cursor, stats };
}

export const runSkillStatBackfillInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: runSkillStatBackfillInternalHandler,
});

export const backfillSkillDigestRecommendationScoresInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skillSearchDigest")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const digest of page) {
      const recommendedScore = computeSkillDigestRecommendationScore(digest);
      if (
        digest.recommendedScore === recommendedScore &&
        digest.recommendedScoreVersion === RECOMMENDATION_SCORE_VERSION
      ) {
        continue;
      }
      patched += 1;
      if (!args.dryRun) {
        await ctx.db.patch(digest._id, {
          recommendedScore,
          recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
        });
      }
    }

    return {
      ok: true as const,
      dryRun: args.dryRun === true,
      scanned: page.length,
      patched,
      cursor: isDone ? null : continueCursor,
      isDone,
    };
  },
});

export const backfillPackageRecommendationScoresInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("packages")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const pkg of page) {
      const recommendedScore = computePackageRecommendationScore(pkg);
      if (
        pkg.recommendedScore === recommendedScore &&
        pkg.recommendedScoreVersion === RECOMMENDATION_SCORE_VERSION
      ) {
        continue;
      }
      patched += 1;
      if (!args.dryRun) {
        await ctx.db.patch(pkg._id, {
          recommendedScore,
          recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
        });
      }
    }

    return {
      ok: true as const,
      dryRun: args.dryRun === true,
      scanned: page.length,
      patched,
      cursor: isDone ? null : continueCursor,
      isDone,
    };
  },
});

type RecommendationScoreBackfillArgs = {
  skillCursor?: string;
  packageCursor?: string;
  skillsDone?: boolean;
  packagesDone?: boolean;
  batchSize?: number;
  maxBatches?: number;
  dryRun?: boolean;
};

type RecommendationScoreBackfillTotals = {
  scanned: number;
  patched: number;
  batches: number;
};

export const runRecommendationScoreBackfillInternal: ReturnType<typeof internalAction> =
  internalAction({
    args: {
      skillCursor: v.optional(v.string()),
      packageCursor: v.optional(v.string()),
      skillsDone: v.optional(v.boolean()),
      packagesDone: v.optional(v.boolean()),
      batchSize: v.optional(v.number()),
      maxBatches: v.optional(v.number()),
      dryRun: v.optional(v.boolean()),
    },
    handler: async (ctx, args: RecommendationScoreBackfillArgs) => {
      const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
      const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
      const dryRun = args.dryRun === true;
      let skillsDone = args.skillsDone === true;
      let packagesDone = args.packagesDone === true;
      let skillCursor: string | null = skillsDone ? null : (args.skillCursor ?? null);
      let packageCursor: string | null = packagesDone ? null : (args.packageCursor ?? null);
      const skills: RecommendationScoreBackfillTotals = { scanned: 0, patched: 0, batches: 0 };
      const packages: RecommendationScoreBackfillTotals = { scanned: 0, patched: 0, batches: 0 };

      for (let i = 0; i < maxBatches && (!skillsDone || !packagesDone); i += 1) {
        if (!skillsDone) {
          const result = (await ctx.runMutation(
            internal.statsMaintenance.backfillSkillDigestRecommendationScoresInternal,
            {
              cursor: skillCursor ?? undefined,
              batchSize,
              dryRun,
            },
          )) as { scanned: number; patched: number; cursor: string | null; isDone: boolean };
          skills.scanned += result.scanned;
          skills.patched += result.patched;
          skills.batches += 1;
          skillCursor = result.cursor;
          skillsDone = result.isDone;
        }

        if (!packagesDone) {
          const result = (await ctx.runMutation(
            internal.statsMaintenance.backfillPackageRecommendationScoresInternal,
            {
              cursor: packageCursor ?? undefined,
              batchSize,
              dryRun,
            },
          )) as { scanned: number; patched: number; cursor: string | null; isDone: boolean };
          packages.scanned += result.scanned;
          packages.patched += result.patched;
          packages.batches += 1;
          packageCursor = result.cursor;
          packagesDone = result.isDone;
        }
      }

      return {
        ok: true as const,
        dryRun,
        scoreVersion: RECOMMENDATION_SCORE_VERSION,
        isDone: skillsDone && packagesDone,
        skillsDone,
        packagesDone,
        skillCursor,
        packageCursor,
        stats: { skills, packages },
      };
    },
  });

function buildSkillStatPatch(skill: Doc<"skills">) {
  const stats = skill.stats;

  // Prefer the top-level stat fields when they exist (they are kept up-to-date
  // by applySkillStatDeltas on every event flush).  Fall back to the legacy
  // nested `stats` object only for documents that pre-date the migration.
  const nextDownloads =
    typeof skill.statsDownloads === "number" ? skill.statsDownloads : stats.downloads;
  const nextStars = typeof skill.statsStars === "number" ? skill.statsStars : stats.stars;
  const nextInstallsCurrent =
    typeof skill.statsInstallsCurrent === "number"
      ? skill.statsInstallsCurrent
      : (stats.installsCurrent ?? 0);
  const nextInstallsAllTime =
    typeof skill.statsInstallsAllTime === "number"
      ? skill.statsInstallsAllTime
      : (stats.installsAllTime ?? 0);

  // Check whether both sets of fields are already in sync.
  const topLevelInSync =
    skill.statsDownloads === nextDownloads &&
    skill.statsStars === nextStars &&
    skill.statsInstallsCurrent === nextInstallsCurrent &&
    skill.statsInstallsAllTime === nextInstallsAllTime;

  const nestedInSync =
    stats.downloads === nextDownloads &&
    stats.stars === nextStars &&
    (stats.installsCurrent ?? 0) === nextInstallsCurrent &&
    (stats.installsAllTime ?? 0) === nextInstallsAllTime;

  if (topLevelInSync && nestedInSync) {
    return null;
  }

  // Write both sets of fields so they stay in sync.
  return {
    statsDownloads: nextDownloads,
    statsStars: nextStars,
    statsInstallsCurrent: nextInstallsCurrent,
    statsInstallsAllTime: nextInstallsAllTime,
    stats: {
      ...stats,
      downloads: nextDownloads,
      stars: nextStars,
      installsCurrent: nextInstallsCurrent,
      installsAllTime: nextInstallsAllTime,
    },
  };
}

function computeSkillDigestRecommendationScore(digest: Doc<"skillSearchDigest">) {
  return computeRecommendationScore(
    {
      downloads: digest.statsDownloads ?? digest.stats.downloads,
      installs: digest.statsInstallsAllTime ?? digest.stats.installsAllTime ?? 0,
      stars: digest.statsStars ?? digest.stats.stars,
    },
    {
      createdAt: digest.createdAt,
      updatedAt: digest.updatedAt,
    },
  );
}

function computePackageRecommendationScore(pkg: Doc<"packages">) {
  return computeRecommendationScore(
    {
      downloads: pkg.stats.downloads,
      installs: pkg.stats.installs,
      stars: pkg.stats.stars,
    },
    {
      createdAt: pkg.createdAt ?? pkg._creationTime,
      updatedAt: pkg.updatedAt,
    },
  );
}

/**
 * Reconcile skill stats by counting actual records in source-of-truth tables.
 *
 * This fixes stats that got out of sync due to missed events, cursor issues,
 * or bugs in the event processing pipeline. It counts:
 * - stars: actual records in the `stars` table for each skill
 *
 * Downloads and installs are event-sourced only (no separate table to count from),
 * so they cannot be reconciled this way.
 *
 * Exported as a standalone function so it can be unit-tested directly without
 * going through the Convex internalMutation wrapper.
 */
export async function reconcileSkillStarCountsHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { db: { query: any; patch: any } },
  args: { cursor?: string; batchSize?: number },
) {
  const batchSize = clampInt(args.batchSize ?? 50, 1, 200);
  const now = Date.now();

  const { page, isDone, continueCursor } = await ctx.db
    .query("skills")
    .order("asc")
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

  let scanned = 0;
  let patched = 0;
  for (const skill of page) {
    if (skill.softDeletedAt) continue;
    scanned += 1;
    // Count actual star records for this skill
    const starRecords = await ctx.db
      .query("stars")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .withIndex("by_skill_user", (q: any) => q.eq("skillId", skill._id))
      .collect();
    const actualStars = starRecords.length;

    // Check if stats are out of sync (compare against the canonical value
    // used by toPublicSkill: prefer top-level field, fall back to nested).
    const currentStars =
      typeof skill.statsStars === "number" ? skill.statsStars : skill.stats.stars;

    if (currentStars !== actualStars) {
      const updatedStats = {
        ...skill.stats,
        stars: actualStars,
      };
      // Keep both the top-level index field and the legacy nested field in sync.
      await ctx.db.patch(skill._id, {
        statsStars: actualStars,
        stats: updatedStats,
        updatedAt: now,
      });
      patched += 1;
    }
  }

  return {
    scanned,
    patched,
    cursor: isDone ? null : continueCursor,
    isDone,
  };
}

export const reconcileSkillStarCounts = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: reconcileSkillStarCountsHandler,
});

export const runReconcileSkillStarCountsInternal = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 50, 1, 200);
    const maxBatches = clampInt(args.maxBatches ?? 10, 1, 50);

    let cursor: string | undefined;
    let totalScanned = 0;
    let totalPatched = 0;

    for (let i = 0; i < maxBatches; i++) {
      const result = (await ctx.runMutation(internal.statsMaintenance.reconcileSkillStarCounts, {
        cursor,
        batchSize,
      })) as { scanned: number; patched: number; cursor: string | null; isDone: boolean };

      totalScanned += result.scanned;
      totalPatched += result.patched;

      if (result.isDone) break;
      cursor = result.cursor ?? undefined;
    }

    return { scanned: totalScanned, patched: totalPatched };
  },
});

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Exported for unit testing only — not part of the public API.
export const __test = {
  buildSkillStatPatch,
  computeSkillDigestRecommendationScore,
  computePackageRecommendationScore,
};

/**
 * Count a page of skillSearchDigest docs and return the partial public count.
 * Each query runs in its own transaction (~1000 docs, ~900 KB), well under limits.
 *
 * Paginates by _creationTime (default ordering) which is immutable and stable.
 * The isPublicSkillDoc filter handles softDeletedAt checks in JS.
 */
export const countPublicDigestPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = clampInt(args.pageSize ?? 1000, 100, 2000);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skillSearchDigest")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });

    let count = 0;
    for (const digest of page) {
      if (isPublicSkillDoc(digest)) count++;
    }
    return { count, isDone, cursor: continueCursor };
  },
});

export const countPublicPackageDigestPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = clampInt(args.pageSize ?? 1000, 100, 2000);
    const { page, isDone, continueCursor } = await ctx.db
      .query("packageSearchDigest")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });

    let count = 0;
    for (const digest of page) {
      if (isPublicPluginDoc(digest)) count++;
    }
    return { count, isDone, cursor: continueCursor };
  },
});

/** Write the reconciled global stats count. */
export const writeGlobalStatsInternal = internalMutation({
  args: {
    count: v.optional(v.number()),
    activeSkillsCount: v.optional(v.number()),
    activePluginsCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.activeSkillsCount !== undefined) {
      await setGlobalPublicSkillsCount(ctx, args.activeSkillsCount);
    } else if (args.count !== undefined) {
      await setGlobalPublicSkillsCount(ctx, args.count);
    }
    if (args.activePluginsCount !== undefined) {
      await setGlobalPublicPluginsCount(ctx, args.activePluginsCount);
    }
  },
});

/**
 * Action-based global stats update that splits the full table scan across
 * multiple queries (each in its own transaction) to avoid the bytes-read limit.
 * Replaces the old single-mutation version.
 */
export const updateGlobalStatsAction = internalAction({
  args: {},
  handler: async (ctx) => {
    let activeSkillsCount = 0;
    let skillCursor: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = (await ctx.runQuery(internal.statsMaintenance.countPublicDigestPageInternal, {
        cursor: skillCursor,
        pageSize: 1000,
      })) as { count: number; isDone: boolean; cursor: string };

      activeSkillsCount += result.count;
      if (result.isDone) break;
      skillCursor = result.cursor;
    }

    let activePluginsCount = 0;
    let pluginCursor: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = (await ctx.runQuery(
        internal.statsMaintenance.countPublicPackageDigestPageInternal,
        {
          cursor: pluginCursor,
          pageSize: 1000,
        },
      )) as { count: number; isDone: boolean; cursor: string };

      activePluginsCount += result.count;
      if (result.isDone) break;
      pluginCursor = result.cursor;
    }

    await ctx.runMutation(internal.statsMaintenance.writeGlobalStatsInternal, {
      activeSkillsCount,
      activePluginsCount,
    });
    return { activeSkillsCount, activePluginsCount };
  },
});
