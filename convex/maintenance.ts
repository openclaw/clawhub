import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery } from "./functions";
import { assertRole, requireUserFromAction } from "./lib/access";
import {
  derivePersonalPublisherHandle,
  ensurePersonalPublisherForUser,
  getPersonalPublisherForUser,
  getPublisherByHandle,
  getUserByHandleOrPersonalPublisher,
  isPublisherActive,
} from "./lib/publishers";
import { recomputePublisherStats } from "./lib/publisherStats";
import { buildSkillSummaryBackfillPatch, type ParsedSkillData } from "./lib/skillBackfill";
import { isSkillCardPath } from "./lib/skillCards";
import {
  computeQualitySignals,
  evaluateQuality,
  getTrustTier,
  type TrustTier,
} from "./lib/skillQuality";
import { getFrontmatterValue, hashSkillFiles } from "./lib/skills";
import { computeIsSuspicious } from "./lib/skillSafety";
import { generateSkillSummary } from "./lib/skillSummary";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;
const MAX_MAX_BATCHES = 200;
const DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_CONFIRM_TABLE = "rateLimitShards";
const DEFAULT_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_BATCH_SIZE = 500;
const MAX_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_BATCH_SIZE = 1_000;
const DEFAULT_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_MAX_BATCHES = 1;
const MAX_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_MAX_BATCHES = 100;
const DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE = "downloadDedupes";
const DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE = 1_000;
const MAX_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE = 2_000;
const DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_MAX_BATCHES = 1;
const MAX_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_MAX_BATCHES = 100;
const DEFAULT_EMPTY_SKILL_MAX_README_BYTES = 8000;
const DEFAULT_EMPTY_SKILL_NOMINATION_THRESHOLD = 3;
const PLATFORM_SKILL_LICENSE = "MIT-0" as const;

type BackfillStats = {
  skillsScanned: number;
  skillsPatched: number;
  aiSummariesPatched: number;
  versionsPatched: number;
  missingLatestVersion: number;
  missingReadme: number;
  missingStorageBlob: number;
};

type UserStatsBackfillStats = {
  usersScanned: number;
  usersPatched: number;
};

type PublisherStatsBackfillStats = {
  publishersScanned: number;
  publishersPatched: number;
};

type BackfillPageItem =
  | {
      kind: "ok";
      skillId: Id<"skills">;
      skillSlug: string;
      skillDisplayName: string;
      versionId: Id<"skillVersions">;
      skillSummary: Doc<"skills">["summary"];
      versionParsed: Doc<"skillVersions">["parsed"];
      readmeStorageId: Id<"_storage">;
    }
  | { kind: "missingLatestVersion"; skillId: Id<"skills"> }
  | { kind: "missingVersionDoc"; skillId: Id<"skills">; versionId: Id<"skillVersions"> }
  | { kind: "missingReadme"; skillId: Id<"skills">; versionId: Id<"skillVersions"> };

type BackfillPageResult = {
  items: BackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type UserStatsBackfillPageResult = {
  items: Array<Pick<Doc<"users">, "_id">>;
  cursor: string | null;
  isDone: boolean;
};

type PublisherStatsBackfillPageResult = {
  items: Array<Pick<Doc<"publishers">, "_id">>;
  cursor: string | null;
  isDone: boolean;
};

type DeprecatedDownloadDedupeCleanupBatchResult = {
  ok: true;
  dryRun: boolean;
  scanned: number;
  deleted: number;
  isDone: boolean;
  oldestHourStart: number | null;
  newestHourStart: number | null;
};

type DeprecatedDownloadDedupeCleanupBatchTiming = DeprecatedDownloadDedupeCleanupBatchResult & {
  batch: number;
  elapsedMs: number;
};

type DeprecatedDownloadDedupeCleanupResult = {
  ok: true;
  dryRun: boolean;
  batchSize: number;
  maxBatches: number;
  batches: number;
  scanned: number;
  deleted: number;
  isDone: boolean;
  scheduledNext: boolean;
  elapsedMs: number;
  batchTimings: DeprecatedDownloadDedupeCleanupBatchTiming[];
};

type UserOwnedSkillsBackfillPageResult = {
  items: Array<Pick<Doc<"skills">, "stats" | "softDeletedAt">>;
  cursor: string | null;
  isDone: boolean;
};

type DeprecatedRateLimitShardCleanupBatchResult = {
  ok: true;
  dryRun: boolean;
  scanned: number;
  deleted: number;
  isDone: boolean;
  firstWindowStart: number | null;
  lastWindowStart: number | null;
};

type DeprecatedRateLimitShardCleanupBatchTiming = DeprecatedRateLimitShardCleanupBatchResult & {
  batch: number;
  elapsedMs: number;
};

type DeprecatedRateLimitShardCleanupActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  continueOnIncomplete?: boolean;
  confirmTable?: string;
};

type DeprecatedRateLimitShardCleanupResult = {
  ok: true;
  dryRun: boolean;
  batchSize: number;
  maxBatches: number;
  batches: number;
  scanned: number;
  deleted: number;
  isDone: boolean;
  scheduledNext: boolean;
  elapsedMs: number;
  batchTimings: DeprecatedRateLimitShardCleanupBatchTiming[];
};

type LegacyPublisherOwnershipTargetPhase = "skills" | "packages";

type LegacyPublisherOwnershipForUserRepairResult = {
  phase: LegacyPublisherOwnershipTargetPhase;
  dryRun: boolean;
  userId: Id<"users">;
  handle?: string;
  publisherId: Id<"publishers"> | null;
  scanned: number;
  repaired: number;
  skipped: number;
  errors: string[];
  cursor: string | null;
  isDone: boolean;
  nextPhase?: LegacyPublisherOwnershipTargetPhase;
};

export const getSkillBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: BackfillPageItem[] = [];
    for (const skill of page) {
      if (!skill.latestVersionId) {
        items.push({ kind: "missingLatestVersion", skillId: skill._id });
        continue;
      }

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) {
        items.push({
          kind: "missingVersionDoc",
          skillId: skill._id,
          versionId: skill.latestVersionId,
        });
        continue;
      }

      const readmeFile = version.files.find(
        (file) => file.path.toLowerCase() === "skill.md" || file.path.toLowerCase() === "skills.md",
      );
      if (!readmeFile) {
        items.push({ kind: "missingReadme", skillId: skill._id, versionId: version._id });
        continue;
      }

      items.push({
        kind: "ok",
        skillId: skill._id,
        skillSlug: skill.slug,
        skillDisplayName: skill.displayName,
        versionId: version._id,
        skillSummary: skill.summary,
        versionParsed: version.parsed,
        readmeStorageId: readmeFile.storageId,
      });
    }

    return { items, cursor: continueCursor, isDone };
  },
});

export const applySkillBackfillPatchInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    summary: v.optional(v.string()),
    parsed: v.optional(
      v.object({
        frontmatter: v.record(v.string(), v.any()),
        metadata: v.optional(v.any()),
        clawdis: v.optional(v.any()),
        license: v.optional(v.literal(PLATFORM_SKILL_LICENSE)),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (typeof args.summary === "string") {
      await ctx.db.patch(args.skillId, { summary: args.summary, updatedAt: now });
    }
    if (args.parsed) {
      await ctx.db.patch(args.versionId, { parsed: args.parsed });
    }
    return { ok: true as const };
  },
});

export async function deleteDeprecatedRateLimitShardsBatchInternalHandler(
  ctx: Pick<MutationCtx, "db">,
  args: {
    dryRun?: boolean;
    batchSize?: number;
    confirmTable?: string;
  },
): Promise<DeprecatedRateLimitShardCleanupBatchResult> {
  const dryRun = Boolean(args.dryRun);
  if (!dryRun && args.confirmTable !== DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_CONFIRM_TABLE) {
    throw new ConvexError(
      `Refusing to delete deprecated rate limit shard rows without confirmTable="${DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_CONFIRM_TABLE}"`,
    );
  }

  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_BATCH_SIZE,
    1,
    MAX_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_BATCH_SIZE,
  );
  const rows = await ctx.db.query("rateLimitShards").order("asc").take(batchSize);

  if (!dryRun) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }

  return {
    ok: true as const,
    dryRun,
    scanned: rows.length,
    deleted: dryRun ? 0 : rows.length,
    isDone: rows.length < batchSize,
    firstWindowStart: rows[0]?.windowStart ?? null,
    lastWindowStart: rows.at(-1)?.windowStart ?? null,
  };
}

export const deleteDeprecatedRateLimitShardsBatchInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    confirmTable: v.optional(v.string()),
  },
  handler: deleteDeprecatedRateLimitShardsBatchInternalHandler,
});

export async function cleanupDeprecatedRateLimitShardsInternalHandler(
  ctx: Pick<ActionCtx, "runMutation" | "scheduler">,
  args: DeprecatedRateLimitShardCleanupActionArgs,
): Promise<DeprecatedRateLimitShardCleanupResult> {
  const dryRun = Boolean(args.dryRun);
  if (!dryRun && args.confirmTable !== DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_CONFIRM_TABLE) {
    throw new ConvexError(
      `Refusing to delete deprecated rate limit shard rows without confirmTable="${DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_CONFIRM_TABLE}"`,
    );
  }

  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_BATCH_SIZE,
    1,
    MAX_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_BATCH_SIZE,
  );
  const maxBatches = dryRun
    ? 1
    : clampInt(
        args.maxBatches ?? DEFAULT_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_MAX_BATCHES,
        1,
        MAX_DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_MAX_BATCHES,
      );
  const startedAt = Date.now();
  const batchTimings: DeprecatedRateLimitShardCleanupBatchTiming[] = [];
  let scanned = 0;
  let deleted = 0;
  let isDone = false;

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const batchStartedAt = Date.now();
    const result = (await ctx.runMutation(
      internal.maintenance.deleteDeprecatedRateLimitShardsBatchInternal,
      {
        dryRun,
        batchSize,
        confirmTable: args.confirmTable,
      },
    )) as DeprecatedRateLimitShardCleanupBatchResult;
    batchTimings.push({
      ...result,
      batch,
      elapsedMs: Date.now() - batchStartedAt,
    });
    scanned += result.scanned;
    deleted += result.deleted;
    isDone = result.isDone;
    if (result.isDone || result.scanned === 0) break;
  }

  const scheduledNext = !dryRun && !isDone && Boolean(args.continueOnIncomplete);
  if (scheduledNext) {
    await ctx.scheduler.runAfter(0, internal.maintenance.cleanupDeprecatedRateLimitShardsInternal, {
      dryRun: false,
      batchSize,
      maxBatches,
      continueOnIncomplete: true,
      confirmTable: DEPRECATED_RATE_LIMIT_SHARD_CLEANUP_CONFIRM_TABLE,
    });
  }

  return {
    ok: true as const,
    dryRun,
    batchSize,
    maxBatches,
    batches: batchTimings.length,
    scanned,
    deleted,
    isDone,
    scheduledNext,
    elapsedMs: Date.now() - startedAt,
    batchTimings,
  };
}

export const cleanupDeprecatedRateLimitShardsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    continueOnIncomplete: v.optional(v.boolean()),
    confirmTable: v.optional(v.string()),
  },
  handler: cleanupDeprecatedRateLimitShardsInternalHandler,
});

export const cleanupDeprecatedRateLimitShards: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    continueOnIncomplete: v.optional(v.boolean()),
    confirmTable: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DeprecatedRateLimitShardCleanupResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.cleanupDeprecatedRateLimitShardsInternal,
      args,
    ) as Promise<DeprecatedRateLimitShardCleanupResult>;
  },
});

export const getUserStatsBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UserStatsBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("users")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    return {
      items: page.map((user) => ({ _id: user._id })),
      cursor: continueCursor,
      isDone,
    };
  },
});

export const getPublisherStatsBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublisherStatsBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("publishers")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    return {
      items: page.map((publisher) => ({ _id: publisher._id })),
      cursor: continueCursor,
      isDone,
    };
  },
});

export const getUserOwnedSkillsBackfillPageInternal = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UserOwnedSkillsBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    return {
      items: page.map((skill) => ({
        stats: skill.stats,
        softDeletedAt: skill.softDeletedAt,
      })),
      cursor: continueCursor,
      isDone,
    };
  },
});

export const applyUserStatsBackfillPatchInternal = internalMutation({
  args: {
    userId: v.id("users"),
    publishedSkills: v.number(),
    totalStars: v.number(),
    totalDownloads: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      publishedSkills: args.publishedSkills,
      totalStars: args.totalStars,
      totalDownloads: args.totalDownloads,
    });
    return { ok: true as const };
  },
});

export const recomputePublisherStatsInternal = internalMutation({
  args: {
    publisherId: v.id("publishers"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const stats = await recomputePublisherStats(ctx, args.publisherId);
    if (!args.dryRun) {
      await ctx.db.patch(args.publisherId, stats);
    }
    return { ok: true as const, stats };
  },
});

export type BackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  useAi?: boolean;
  cursor?: string;
};

export type BackfillActionResult = {
  ok: true;
  stats: BackfillStats;
  isDone: boolean;
  cursor: string | null;
};

export type UserStatsBackfillActionArgs = {
  batchSize?: number;
  skillBatchSize?: number;
  maxBatches?: number;
  cursor?: string;
};

export type UserStatsBackfillActionResult = {
  ok: true;
  stats: UserStatsBackfillStats;
  isDone: boolean;
  cursor: string | null;
};

export type PublisherStatsBackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  cursor?: string;
};

export type PublisherStatsBackfillActionResult = {
  ok: true;
  stats: PublisherStatsBackfillStats;
  isDone: boolean;
  cursor: string | null;
};

export type DeprecatedDownloadDedupesCleanupActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  continueOnIncomplete?: boolean;
  confirmTable?: string;
};

export async function deleteDeprecatedDownloadDedupesBatchInternalHandler(
  ctx: Pick<MutationCtx, "db">,
  args: {
    dryRun?: boolean;
    batchSize?: number;
    confirmTable?: string;
  },
): Promise<DeprecatedDownloadDedupeCleanupBatchResult> {
  const dryRun = Boolean(args.dryRun);
  if (!dryRun && args.confirmTable !== DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE) {
    throw new ConvexError(
      `Refusing to delete deprecated download dedupe rows without confirmTable="${DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE}"`,
    );
  }

  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE,
    1,
    MAX_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE,
  );
  const rows = await ctx.db
    .query("downloadDedupes")
    .withIndex("by_hour", (q) => q)
    .order("asc")
    .take(batchSize);

  if (!dryRun) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }

  return {
    ok: true as const,
    dryRun,
    scanned: rows.length,
    deleted: dryRun ? 0 : rows.length,
    isDone: rows.length < batchSize,
    oldestHourStart: rows[0]?.hourStart ?? null,
    newestHourStart: rows.at(-1)?.hourStart ?? null,
  };
}

export const deleteDeprecatedDownloadDedupesBatchInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    confirmTable: v.optional(v.string()),
  },
  handler: deleteDeprecatedDownloadDedupesBatchInternalHandler,
});

export async function cleanupDeprecatedDownloadDedupesInternalHandler(
  ctx: ActionCtx,
  args: DeprecatedDownloadDedupesCleanupActionArgs,
): Promise<DeprecatedDownloadDedupeCleanupResult> {
  const dryRun = Boolean(args.dryRun);
  if (!dryRun && args.confirmTable !== DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE) {
    throw new ConvexError(
      `Refusing to delete deprecated download dedupe rows without confirmTable="${DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE}"`,
    );
  }

  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE,
    1,
    MAX_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE,
  );
  const maxBatches = dryRun
    ? 1
    : clampInt(
        args.maxBatches ?? DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_MAX_BATCHES,
        1,
        MAX_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_MAX_BATCHES,
      );
  const startedAt = Date.now();
  const batchTimings: DeprecatedDownloadDedupeCleanupBatchTiming[] = [];
  let scanned = 0;
  let deleted = 0;
  let isDone = false;

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const batchStartedAt = Date.now();
    const result = (await ctx.runMutation(
      internal.maintenance.deleteDeprecatedDownloadDedupesBatchInternal,
      {
        dryRun,
        batchSize,
        confirmTable: args.confirmTable,
      },
    )) as DeprecatedDownloadDedupeCleanupBatchResult;
    const timing = {
      ...result,
      batch,
      elapsedMs: Date.now() - batchStartedAt,
    };
    batchTimings.push(timing);
    scanned += result.scanned;
    deleted += result.deleted;
    isDone = result.isDone;
    if (result.isDone || result.scanned === 0) break;
  }

  const shouldContinue = !dryRun && !isDone && Boolean(args.continueOnIncomplete);
  if (shouldContinue) {
    await ctx.scheduler.runAfter(0, internal.maintenance.cleanupDeprecatedDownloadDedupesInternal, {
      dryRun: false,
      batchSize,
      maxBatches,
      continueOnIncomplete: true,
      confirmTable: DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE,
    });
  }

  return {
    ok: true as const,
    dryRun,
    batchSize,
    maxBatches,
    batches: batchTimings.length,
    scanned,
    deleted,
    isDone,
    scheduledNext: shouldContinue,
    elapsedMs: Date.now() - startedAt,
    batchTimings,
  };
}

export const cleanupDeprecatedDownloadDedupesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    continueOnIncomplete: v.optional(v.boolean()),
    confirmTable: v.optional(v.string()),
  },
  handler: cleanupDeprecatedDownloadDedupesInternalHandler,
});

export const cleanupDeprecatedDownloadDedupes: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    continueOnIncomplete: v.optional(v.boolean()),
    confirmTable: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DeprecatedDownloadDedupeCleanupResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.cleanupDeprecatedDownloadDedupesInternal,
      args,
    ) as Promise<DeprecatedDownloadDedupeCleanupResult>;
  },
});

export const scheduleDeprecatedDownloadDedupesCleanup: ReturnType<typeof action> = action({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    confirmTable: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    if (args.confirmTable !== DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE) {
      throw new ConvexError(
        `Refusing to schedule deprecated download dedupe cleanup without confirmTable="${DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE}"`,
      );
    }
    await ctx.scheduler.runAfter(0, internal.maintenance.cleanupDeprecatedDownloadDedupesInternal, {
      dryRun: false,
      batchSize: args.batchSize ?? DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_BATCH_SIZE,
      maxBatches: args.maxBatches ?? DEFAULT_DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_MAX_BATCHES,
      continueOnIncomplete: true,
      confirmTable: DEPRECATED_DOWNLOAD_DEDUPE_CLEANUP_CONFIRM_TABLE,
    });
    return { ok: true as const };
  },
});

export async function backfillSkillSummariesInternalHandler(
  ctx: ActionCtx,
  args: BackfillActionArgs,
): Promise<BackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const useAi = Boolean(args.useAi);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: BackfillStats = {
    skillsScanned: 0,
    skillsPatched: 0,
    aiSummariesPatched: 0,
    versionsPatched: 0,
    missingLatestVersion: 0,
    missingReadme: 0,
    missingStorageBlob: 0,
  };

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      if (item.kind === "missingLatestVersion") {
        totals.missingLatestVersion++;
        continue;
      }
      if (item.kind === "missingVersionDoc") {
        totals.missingLatestVersion++;
        continue;
      }
      if (item.kind === "missingReadme") {
        totals.missingReadme++;
        continue;
      }

      const blob = await ctx.storage.get(item.readmeStorageId);
      if (!blob) {
        totals.missingStorageBlob++;
        continue;
      }

      const readmeText = await blob.text();
      const patch = buildSkillSummaryBackfillPatch({
        readmeText,
        currentSummary: item.skillSummary ?? undefined,
        currentParsed: item.versionParsed as ParsedSkillData,
      });

      let nextSummary = patch.summary;
      const missingSummary = !item.skillSummary?.trim();
      if (!nextSummary && useAi && missingSummary) {
        nextSummary = await generateSkillSummary({
          slug: item.skillSlug,
          displayName: item.skillDisplayName,
          readmeText,
        });
      }

      const shouldPatchSummary =
        typeof nextSummary === "string" && nextSummary.trim() && nextSummary !== item.skillSummary;

      if (!shouldPatchSummary && !patch.parsed) continue;
      if (shouldPatchSummary) {
        totals.skillsPatched++;
        if (!patch.summary) totals.aiSummariesPatched++;
      }
      if (patch.parsed) totals.versionsPatched++;

      if (dryRun) continue;

      await ctx.runMutation(internal.maintenance.applySkillBackfillPatchInternal, {
        skillId: item.skillId,
        versionId: item.versionId,
        summary: shouldPatchSummary ? nextSummary : undefined,
        parsed: patch.parsed,
      });
    }

    if (isDone) break;
  }

  return { ok: true as const, stats: totals, isDone, cursor };
}

export async function backfillUserStatsInternalHandler(
  ctx: ActionCtx,
  args: UserStatsBackfillActionArgs,
): Promise<UserStatsBackfillActionResult> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const skillBatchSize = clampInt(args.skillBatchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const totals: UserStatsBackfillStats = {
    usersScanned: 0,
    usersPatched: 0,
  };

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getUserStatsBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as UserStatsBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const user of page.items) {
      totals.usersScanned++;
      let ownedSkillsCursor: string | null = null;
      let userPublishedSkills = 0;
      let userTotalStars = 0;
      let userTotalDownloads = 0;

      while (true) {
        const skillPage = (await ctx.runQuery(
          internal.maintenance.getUserOwnedSkillsBackfillPageInternal,
          {
            ownerUserId: user._id,
            cursor: ownedSkillsCursor ?? undefined,
            batchSize: skillBatchSize,
          },
        )) as UserOwnedSkillsBackfillPageResult;

        for (const skill of skillPage.items) {
          if (skill.softDeletedAt) continue;
          userPublishedSkills += 1;
          userTotalStars += skill.stats?.stars ?? 0;
          userTotalDownloads += skill.stats?.downloads ?? 0;
        }

        if (skillPage.isDone) break;
        ownedSkillsCursor = skillPage.cursor;
      }

      await ctx.runMutation(internal.maintenance.applyUserStatsBackfillPatchInternal, {
        userId: user._id,
        publishedSkills: userPublishedSkills,
        totalStars: userTotalStars,
        totalDownloads: userTotalDownloads,
      });
      totals.usersPatched++;
    }

    if (isDone) break;
  }

  return { ok: true as const, stats: totals, isDone, cursor };
}

export async function backfillPublisherStatsInternalHandler(
  ctx: ActionCtx,
  args: PublisherStatsBackfillActionArgs,
): Promise<PublisherStatsBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const totals: PublisherStatsBackfillStats = {
    publishersScanned: 0,
    publishersPatched: 0,
  };

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getPublisherStatsBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as PublisherStatsBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const publisher of page.items) {
      totals.publishersScanned++;
      await ctx.runMutation(internal.maintenance.recomputePublisherStatsInternal, {
        publisherId: publisher._id,
        dryRun,
      });
      if (!dryRun) totals.publishersPatched++;
    }

    if (isDone) break;
  }

  return { ok: true as const, stats: totals, isDone, cursor };
}

export const backfillSkillSummariesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    useAi: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
  },
  handler: backfillSkillSummariesInternalHandler,
});

export const backfillUserStatsInternal = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    skillBatchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: backfillUserStatsInternalHandler,
});

export const backfillPublisherStatsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: backfillPublisherStatsInternalHandler,
});

export const backfillSkillSummaries: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    useAi: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillSummariesInternal,
      args,
    ) as Promise<BackfillActionResult>;
  },
});

export const backfillPublisherStats: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PublisherStatsBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillPublisherStatsInternal,
      args,
    ) as Promise<PublisherStatsBackfillActionResult>;
  },
});

export const scheduleBackfillPublisherStats: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillPublisherStatsInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

export const scheduleBackfillSkillSummaries: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()), useAi: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillSummariesInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
      useAi: Boolean(args.useAi),
    });
    return { ok: true as const };
  },
});

export const continueSkillSummaryBackfillJobInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    useAi: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillActionResult> => {
    const result = await backfillSkillSummariesInternalHandler(ctx, {
      dryRun: false,
      cursor: args.cursor,
      batchSize: args.batchSize ?? DEFAULT_BATCH_SIZE,
      maxBatches: 1,
      useAi: Boolean(args.useAi),
    });

    if (!result.isDone && result.cursor) {
      await ctx.scheduler.runAfter(
        0,
        internal.maintenance.continueSkillSummaryBackfillJobInternal,
        {
          cursor: result.cursor,
          batchSize: args.batchSize ?? DEFAULT_BATCH_SIZE,
          useAi: Boolean(args.useAi),
        },
      );
    }

    return result;
  },
});

type FingerprintBackfillStats = {
  versionsScanned: number;
  versionsPatched: number;
  fingerprintsInserted: number;
  fingerprintMismatches: number;
};

type FingerprintBackfillPageItem = {
  skillId: Id<"skills">;
  versionId: Id<"skillVersions">;
  versionFingerprint?: string;
  files: Array<{ path: string; sha256: string }>;
  hasGeneratedBundleFingerprint?: boolean;
  existingEntries: Array<{
    id: Id<"skillVersionFingerprints">;
    fingerprint: string;
    kind?: "source" | "generated-bundle";
  }>;
};

type FingerprintBackfillPageResult = {
  items: FingerprintBackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type BadgeBackfillStats = {
  skillsScanned: number;
  skillsPatched: number;
  highlightsPatched: number;
};

type SkillBadgeTableBackfillStats = {
  skillsScanned: number;
  recordsInserted: number;
};

type BadgeBackfillPageItem = {
  skillId: Id<"skills">;
  ownerUserId: Id<"users">;
  createdAt?: number;
  updatedAt?: number;
  batch?: string;
  badges?: Doc<"skills">["badges"];
};

type BadgeBackfillPageResult = {
  items: BadgeBackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type BadgeKind = Doc<"skillBadges">["kind"];

export const getSkillFingerprintBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FingerprintBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skillVersions")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: FingerprintBackfillPageItem[] = [];
    for (const version of page) {
      const existingEntries = await ctx.db
        .query("skillVersionFingerprints")
        .withIndex("by_version", (q) => q.eq("versionId", version._id))
        .take(20);

      const hasGeneratedBundleFingerprint = existingEntries.some(
        (entry) => entry.kind === "generated-bundle",
      );
      const normalizedFiles = version.files
        .filter((file) => !hasGeneratedBundleFingerprint || !isSkillCardPath(file.path))
        .map((file) => ({
          path: file.path,
          sha256: file.sha256,
        }));
      const sourceFingerprintEntries = existingEntries.filter(
        (entry) => entry.kind !== "generated-bundle",
      );

      const hasAnyEntry = sourceFingerprintEntries.length > 0;
      const entryFingerprints = new Set(sourceFingerprintEntries.map((entry) => entry.fingerprint));
      const hasFingerprintMismatch =
        typeof version.fingerprint === "string" &&
        hasAnyEntry &&
        (entryFingerprints.size !== 1 || !entryFingerprints.has(version.fingerprint));
      const needsFingerprintField = !version.fingerprint;
      const needsFingerprintEntry = !hasAnyEntry;

      if (!needsFingerprintField && !needsFingerprintEntry && !hasFingerprintMismatch) continue;

      items.push({
        skillId: version.skillId,
        versionId: version._id,
        versionFingerprint: version.fingerprint ?? undefined,
        files: normalizedFiles,
        hasGeneratedBundleFingerprint,
        existingEntries: sourceFingerprintEntries.map((entry) => ({
          id: entry._id,
          fingerprint: entry.fingerprint,
          kind: entry.kind === "source" ? "source" : undefined,
        })),
      });
    }

    return { items, cursor: continueCursor, isDone };
  },
});

export const applySkillFingerprintBackfillPatchInternal = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    fingerprint: v.string(),
    patchVersion: v.boolean(),
    replaceEntries: v.boolean(),
    existingEntryIds: v.optional(v.array(v.id("skillVersionFingerprints"))),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return { ok: false as const, reason: "missingVersion" as const };

    const now = Date.now();

    if (args.patchVersion) {
      await ctx.db.patch(version._id, { fingerprint: args.fingerprint });
    }

    if (args.replaceEntries) {
      const existing = args.existingEntryIds ?? [];
      for (const id of existing) {
        await ctx.db.delete(id);
      }

      await ctx.db.insert("skillVersionFingerprints", {
        skillId: version.skillId,
        versionId: version._id,
        fingerprint: args.fingerprint,
        kind: "source",
        createdAt: now,
      });
    }

    return { ok: true as const };
  },
});

export type FingerprintBackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
};

export type FingerprintBackfillActionResult = { ok: true; stats: FingerprintBackfillStats };

export async function backfillSkillFingerprintsInternalHandler(
  ctx: ActionCtx,
  args: FingerprintBackfillActionArgs,
): Promise<FingerprintBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: FingerprintBackfillStats = {
    versionsScanned: 0,
    versionsPatched: 0,
    fingerprintsInserted: 0,
    fingerprintMismatches: 0,
  };

  let cursor: string | null = null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillFingerprintBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as FingerprintBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.versionsScanned++;

      const fingerprint = await hashSkillFiles(
        item.files.filter(
          (file) => !item.hasGeneratedBundleFingerprint || !isSkillCardPath(file.path),
        ),
      );

      const sourceEntries = item.existingEntries.filter(
        (entry) => entry.kind !== "generated-bundle",
      );
      const existingFingerprints = new Set(sourceEntries.map((entry) => entry.fingerprint));
      const hasAnyEntry = sourceEntries.length > 0;
      const entryIsCorrect =
        hasAnyEntry && existingFingerprints.size === 1 && existingFingerprints.has(fingerprint);
      const versionFingerprintIsCorrect = item.versionFingerprint === fingerprint;

      if (hasAnyEntry && !entryIsCorrect) totals.fingerprintMismatches++;

      const shouldPatchVersion = !versionFingerprintIsCorrect;
      const shouldReplaceEntries = !entryIsCorrect;
      if (!shouldPatchVersion && !shouldReplaceEntries) continue;

      if (shouldPatchVersion) totals.versionsPatched++;
      if (shouldReplaceEntries) totals.fingerprintsInserted++;

      if (dryRun) continue;

      await ctx.runMutation(internal.maintenance.applySkillFingerprintBackfillPatchInternal, {
        versionId: item.versionId,
        fingerprint,
        patchVersion: shouldPatchVersion,
        replaceEntries: shouldReplaceEntries,
        existingEntryIds: shouldReplaceEntries ? sourceEntries.map((entry) => entry.id) : [],
      });
    }

    if (isDone) break;
  }

  if (!isDone) {
    throw new ConvexError("Backfill incomplete (maxBatches reached)");
  }

  return { ok: true as const, stats: totals };
}

export const backfillSkillFingerprintsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillFingerprintsInternalHandler,
});

export const backfillSkillFingerprints: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FingerprintBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillFingerprintsInternal,
      args,
    ) as Promise<FingerprintBackfillActionResult>;
  },
});

export const scheduleBackfillSkillFingerprints: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillFingerprintsInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

export const getSkillBadgeBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BadgeBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: BadgeBackfillPageItem[] = page.map((skill) => ({
      skillId: skill._id,
      ownerUserId: skill.ownerUserId,
      createdAt: skill.createdAt ?? undefined,
      updatedAt: skill.updatedAt ?? undefined,
      batch: skill.batch ?? undefined,
      badges: skill.badges ?? undefined,
    }));

    return { items, cursor: continueCursor, isDone };
  },
});

export const applySkillBadgeBackfillPatchInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    badges: v.optional(
      v.object({
        redactionApproved: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
        highlighted: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
        official: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
        deprecated: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.skillId, { badges: args.badges ?? undefined, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const upsertSkillBadgeRecordInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    kind: v.union(
      v.literal("highlighted"),
      v.literal("official"),
      v.literal("deprecated"),
      v.literal("redactionApproved"),
    ),
    byUserId: v.id("users"),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const syncDenormalizedBadge = async () => {
      const skill = await ctx.db.get(args.skillId);
      if (!skill) return;
      await ctx.db.patch(args.skillId, {
        badges: {
          ...(skill.badges as Record<string, unknown> | undefined),
          [args.kind]: { byUserId: args.byUserId, at: args.at },
        },
      });
    };

    const existing = await ctx.db
      .query("skillBadges")
      .withIndex("by_skill_kind", (q) => q.eq("skillId", args.skillId).eq("kind", args.kind))
      .unique();
    if (existing) {
      await syncDenormalizedBadge();
      return { inserted: false as const };
    }
    await ctx.db.insert("skillBadges", {
      skillId: args.skillId,
      kind: args.kind,
      byUserId: args.byUserId,
      at: args.at,
    });
    await syncDenormalizedBadge();
    return { inserted: true as const };
  },
});

export type BadgeBackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
};

export type BadgeBackfillActionResult = { ok: true; stats: BadgeBackfillStats };

export async function backfillSkillBadgesInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<BadgeBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: BadgeBackfillStats = {
    skillsScanned: 0,
    skillsPatched: 0,
    highlightsPatched: 0,
  };

  let cursor: string | null = null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBadgeBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BadgeBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;

      const shouldHighlight = item.batch === "highlighted" && !item.badges?.highlighted;
      if (!shouldHighlight) continue;

      totals.skillsPatched++;
      totals.highlightsPatched++;

      if (dryRun) continue;

      const at = item.updatedAt ?? item.createdAt ?? Date.now();
      await ctx.runMutation(internal.maintenance.applySkillBadgeBackfillPatchInternal, {
        skillId: item.skillId,
        badges: {
          ...item.badges,
          highlighted: {
            byUserId: item.ownerUserId,
            at,
          },
        },
      });
    }

    if (isDone) break;
  }

  if (!isDone) {
    throw new ConvexError("Backfill incomplete (maxBatches reached)");
  }

  return { ok: true as const, stats: totals };
}

export const backfillSkillBadgesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillBadgesInternalHandler,
});

export const backfillSkillBadges: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BadgeBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillBadgesInternal,
      args,
    ) as Promise<BadgeBackfillActionResult>;
  },
});

export const scheduleBackfillSkillBadges: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillBadgesInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

export type SkillBadgeTableBackfillActionResult = {
  ok: true;
  stats: SkillBadgeTableBackfillStats;
};

export async function backfillSkillBadgeTableInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<SkillBadgeTableBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: SkillBadgeTableBackfillStats = {
    skillsScanned: 0,
    recordsInserted: 0,
  };

  let cursor: string | null = null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBadgeBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BadgeBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      const badges = item.badges ?? {};
      const entries: Array<{ kind: BadgeKind; byUserId: Id<"users">; at: number }> = [];

      if (badges.redactionApproved) {
        entries.push({
          kind: "redactionApproved",
          byUserId: badges.redactionApproved.byUserId,
          at: badges.redactionApproved.at,
        });
      }

      if (badges.official) {
        entries.push({
          kind: "official",
          byUserId: badges.official.byUserId,
          at: badges.official.at,
        });
      }

      if (badges.deprecated) {
        entries.push({
          kind: "deprecated",
          byUserId: badges.deprecated.byUserId,
          at: badges.deprecated.at,
        });
      }

      const highlighted =
        badges.highlighted ??
        (item.batch === "highlighted"
          ? {
              byUserId: item.ownerUserId,
              at: item.updatedAt ?? item.createdAt ?? Date.now(),
            }
          : undefined);

      if (highlighted) {
        entries.push({
          kind: "highlighted",
          byUserId: highlighted.byUserId,
          at: highlighted.at,
        });
      }

      if (dryRun) continue;

      for (const entry of entries) {
        const result = await ctx.runMutation(internal.maintenance.upsertSkillBadgeRecordInternal, {
          skillId: item.skillId,
          kind: entry.kind,
          byUserId: entry.byUserId,
          at: entry.at,
        });
        if (result.inserted) {
          totals.recordsInserted++;
        }
      }
    }

    if (isDone) break;
  }

  if (!isDone) {
    throw new ConvexError("Backfill incomplete (maxBatches reached)");
  }

  return { ok: true as const, stats: totals };
}

export const backfillSkillBadgeTableInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillBadgeTableInternalHandler,
});

export const backfillSkillBadgeTable: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillBadgeTableBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillBadgeTableInternal,
      args,
    ) as Promise<SkillBadgeTableBackfillActionResult>;
  },
});

export const scheduleBackfillSkillBadgeTable: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillBadgeTableInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

type EmptySkillCleanupPageItem = {
  skillId: Id<"skills">;
  slug: string;
  ownerUserId: Id<"users">;
  latestVersionId?: Id<"skillVersions">;
  softDeletedAt?: number;
  moderationReason?: string;
  summary?: string;
};

type EmptySkillCleanupPageResult = {
  items: EmptySkillCleanupPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type EmptySkillCleanupStats = {
  skillsScanned: number;
  skillsEvaluated: number;
  emptyDetected: number;
  skillsDeleted: number;
  missingLatestVersion: number;
  missingVersionDoc: number;
  missingReadme: number;
  missingStorageBlob: number;
  skippedLargeReadme: number;
};

type EmptySkillCleanupNomination = {
  userId: Id<"users">;
  handle: string | null;
  emptySkillCount: number;
  sampleSlugs: string[];
};

export type EmptySkillCleanupActionArgs = {
  cursor?: string;
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  maxReadmeBytes?: number;
  nominationThreshold?: number;
};

export type EmptySkillCleanupActionResult = {
  ok: true;
  cursor: string | null;
  isDone: boolean;
  stats: EmptySkillCleanupStats;
  nominations: EmptySkillCleanupNomination[];
};

export const getEmptySkillCleanupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmptySkillCleanupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    return {
      items: page.map((skill) => ({
        skillId: skill._id,
        slug: skill.slug,
        ownerUserId: skill.ownerUserId,
        latestVersionId: skill.latestVersionId,
        softDeletedAt: skill.softDeletedAt,
        moderationReason: skill.moderationReason,
        summary: skill.summary,
      })),
      cursor: continueCursor,
      isDone,
    };
  },
});

export const applyEmptySkillCleanupInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    reason: v.string(),
    quality: v.object({
      score: v.number(),
      trustTier: v.union(v.literal("low"), v.literal("medium"), v.literal("trusted")),
      signals: v.object({
        bodyChars: v.number(),
        bodyWords: v.number(),
        uniqueWordRatio: v.number(),
        headingCount: v.number(),
        bulletCount: v.number(),
        templateMarkerHits: v.number(),
        genericSummary: v.boolean(),
        cjkChars: v.optional(v.number()),
      }),
    }),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return { deleted: false as const, reason: "missing_skill" as const };
    if (skill.softDeletedAt) return { deleted: false as const, reason: "already_deleted" as const };

    const now = Date.now();
    await ctx.db.patch(skill._id, {
      softDeletedAt: now,
      moderationStatus: "hidden",
      moderationReason: "quality.empty.backfill",
      moderationNotes: args.reason,
      quality: {
        score: args.quality.score,
        decision: "reject",
        trustTier: args.quality.trustTier,
        similarRecentCount: 0,
        reason: args.reason,
        signals: args.quality.signals,
        evaluatedAt: now,
      },
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: skill.ownerUserId,
      action: "skill.delete.empty.backfill",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug: skill.slug,
        score: args.quality.score,
        trustTier: args.quality.trustTier,
        signals: args.quality.signals,
      },
      createdAt: now,
    });

    return {
      deleted: true as const,
      ownerUserId: skill.ownerUserId,
      slug: skill.slug,
    };
  },
});

export const nominateUserForEmptySkillSpamInternal = internalMutation({
  args: {
    userId: v.id("users"),
    emptySkillCount: v.number(),
    sampleSlugs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("auditLogs")
      .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", args.userId))
      .filter((q) => q.eq(q.field("action"), "user.ban.nomination.empty-skill-spam"))
      .first();
    if (existing) return { created: false as const };

    const now = Date.now();
    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      action: "user.ban.nomination.empty-skill-spam",
      targetType: "user",
      targetId: args.userId,
      metadata: {
        emptySkillCount: args.emptySkillCount,
        sampleSlugs: args.sampleSlugs.slice(0, 10),
      },
      createdAt: now,
    });

    return { created: true as const };
  },
});

export async function cleanupEmptySkillsInternalHandler(
  ctx: ActionCtx,
  args: EmptySkillCleanupActionArgs,
): Promise<EmptySkillCleanupActionResult> {
  const dryRun = args.dryRun !== false;
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const maxReadmeBytes = clampInt(
    args.maxReadmeBytes ?? DEFAULT_EMPTY_SKILL_MAX_README_BYTES,
    256,
    65536,
  );
  const nominationThreshold = clampInt(
    args.nominationThreshold ?? DEFAULT_EMPTY_SKILL_NOMINATION_THRESHOLD,
    1,
    100,
  );

  const totals: EmptySkillCleanupStats = {
    skillsScanned: 0,
    skillsEvaluated: 0,
    emptyDetected: 0,
    skillsDeleted: 0,
    missingLatestVersion: 0,
    missingVersionDoc: 0,
    missingReadme: 0,
    missingStorageBlob: 0,
    skippedLargeReadme: 0,
  };

  const ownerTrustCache = new Map<string, { trustTier: TrustTier; handle: string | null }>();
  const emptyByOwner = new Map<string, EmptySkillCleanupNomination>();

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;
  const now = Date.now();

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getEmptySkillCleanupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as EmptySkillCleanupPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      if (item.softDeletedAt) continue;

      if (!item.latestVersionId) {
        totals.missingLatestVersion++;
        continue;
      }

      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: item.latestVersionId,
      })) as Doc<"skillVersions"> | null;
      if (!version) {
        totals.missingVersionDoc++;
        continue;
      }

      const readmeFile = version.files.find((file) => {
        const lower = file.path.toLowerCase();
        return lower === "skill.md" || lower === "skills.md";
      });
      if (!readmeFile) {
        totals.missingReadme++;
        continue;
      }

      if (readmeFile.size > maxReadmeBytes) {
        totals.skippedLargeReadme++;
        continue;
      }

      const blob = await ctx.storage.get(readmeFile.storageId);
      if (!blob) {
        totals.missingStorageBlob++;
        continue;
      }
      const readmeText = await blob.text();
      totals.skillsEvaluated++;

      const ownerKey = String(item.ownerUserId);
      let ownerTrust = ownerTrustCache.get(ownerKey);
      if (!ownerTrust) {
        const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
          userId: item.ownerUserId,
        })) as Doc<"users"> | null;
        const ownerActivity = (await ctx.runQuery(internal.skills.getOwnerSkillActivityInternal, {
          ownerUserId: item.ownerUserId,
          limit: 60,
        })) as Array<{
          slug: string;
          summary?: string;
          createdAt: number;
          latestVersionId?: Id<"skillVersions">;
        }>;

        const ownerCreatedAt = owner?.createdAt ?? owner?._creationTime ?? now;
        ownerTrust = {
          trustTier: getTrustTier(now - ownerCreatedAt, ownerActivity.length),
          handle: owner?.handle ?? null,
        };
        ownerTrustCache.set(ownerKey, ownerTrust);
      }

      const qualitySignals = computeQualitySignals({
        readmeText,
        summary: item.summary ?? undefined,
      });
      const quality = evaluateQuality({
        signals: qualitySignals,
        trustTier: ownerTrust.trustTier,
        similarRecentCount: 0,
      });
      if (quality.decision !== "reject") continue;

      totals.emptyDetected++;

      const nomination = emptyByOwner.get(ownerKey) ?? {
        userId: item.ownerUserId,
        handle: ownerTrust.handle,
        emptySkillCount: 0,
        sampleSlugs: [],
      };
      nomination.emptySkillCount += 1;
      if (nomination.sampleSlugs.length < 10 && !nomination.sampleSlugs.includes(item.slug)) {
        nomination.sampleSlugs.push(item.slug);
      }
      emptyByOwner.set(ownerKey, nomination);

      if (dryRun) continue;

      const result = await ctx.runMutation(internal.maintenance.applyEmptySkillCleanupInternal, {
        skillId: item.skillId,
        reason: quality.reason,
        quality: {
          score: quality.score,
          trustTier: quality.trustTier,
          signals: quality.signals,
        },
      });
      if (result.deleted) totals.skillsDeleted++;
    }

    if (isDone) break;
  }

  const nominations = Array.from(emptyByOwner.values())
    .filter((entry) => entry.emptySkillCount >= nominationThreshold)
    .sort((a, b) => b.emptySkillCount - a.emptySkillCount);

  return {
    ok: true as const,
    cursor,
    isDone,
    stats: totals,
    nominations: nominations.slice(0, 200),
  };
}

export const cleanupEmptySkillsInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    maxReadmeBytes: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: cleanupEmptySkillsInternalHandler,
});

export const cleanupEmptySkills: ReturnType<typeof action> = action({
  args: {
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    maxReadmeBytes: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmptySkillCleanupActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(internal.maintenance.cleanupEmptySkillsInternal, args);
  },
});

type EmptySkillBanNominationStats = {
  skillsScanned: number;
  usersFlagged: number;
  nominationsCreated: number;
  nominationsExisting: number;
};

export type EmptySkillBanNominationActionArgs = {
  cursor?: string;
  batchSize?: number;
  maxBatches?: number;
  nominationThreshold?: number;
};

export type EmptySkillBanNominationActionResult = {
  ok: true;
  cursor: string | null;
  isDone: boolean;
  stats: EmptySkillBanNominationStats;
  nominations: EmptySkillCleanupNomination[];
};

export async function nominateEmptySkillSpammersInternalHandler(
  ctx: ActionCtx,
  args: EmptySkillBanNominationActionArgs,
): Promise<EmptySkillBanNominationActionResult> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const nominationThreshold = clampInt(
    args.nominationThreshold ?? DEFAULT_EMPTY_SKILL_NOMINATION_THRESHOLD,
    1,
    100,
  );

  const totals: EmptySkillBanNominationStats = {
    skillsScanned: 0,
    usersFlagged: 0,
    nominationsCreated: 0,
    nominationsExisting: 0,
  };

  const ownerHandleCache = new Map<string, string | null>();
  const emptyByOwner = new Map<string, EmptySkillCleanupNomination>();

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getEmptySkillCleanupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as EmptySkillCleanupPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      if (!item.softDeletedAt) continue;
      if (item.moderationReason !== "quality.empty.backfill") continue;

      const ownerKey = String(item.ownerUserId);
      let handle = ownerHandleCache.get(ownerKey);
      if (handle === undefined) {
        const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
          userId: item.ownerUserId,
        })) as Doc<"users"> | null;
        handle = owner?.handle ?? null;
        ownerHandleCache.set(ownerKey, handle);
      }

      const nomination = emptyByOwner.get(ownerKey) ?? {
        userId: item.ownerUserId,
        handle,
        emptySkillCount: 0,
        sampleSlugs: [],
      };
      nomination.emptySkillCount += 1;
      if (nomination.sampleSlugs.length < 10 && !nomination.sampleSlugs.includes(item.slug)) {
        nomination.sampleSlugs.push(item.slug);
      }
      emptyByOwner.set(ownerKey, nomination);
    }

    if (isDone) break;
  }

  const nominations = Array.from(emptyByOwner.values())
    .filter((entry) => entry.emptySkillCount >= nominationThreshold)
    .sort((a, b) => b.emptySkillCount - a.emptySkillCount);
  totals.usersFlagged = nominations.length;

  if (isDone) {
    for (const nomination of nominations) {
      const result = await ctx.runMutation(
        internal.maintenance.nominateUserForEmptySkillSpamInternal,
        {
          userId: nomination.userId,
          emptySkillCount: nomination.emptySkillCount,
          sampleSlugs: nomination.sampleSlugs,
        },
      );
      if (result.created) totals.nominationsCreated++;
      else totals.nominationsExisting++;
    }
  }

  return {
    ok: true as const,
    cursor,
    isDone,
    stats: totals,
    nominations: nominations.slice(0, 200),
  };
}

export const nominateEmptySkillSpammersInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: nominateEmptySkillSpammersInternalHandler,
});

export const nominateEmptySkillSpammers: ReturnType<typeof action> = action({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmptySkillBanNominationActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(internal.maintenance.nominateEmptySkillSpammersInternal, args);
  },
});

// Sync skillBadges table → denormalized skill.badges field.
// Run after deploying the badge-read removal to ensure all skills
// have up-to-date badges on the skill doc itself.
export const backfillDenormalizedBadgesInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      const records = await ctx.db
        .query("skillBadges")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(10);

      // Build canonical badge map from the table
      const canonical: Record<string, { byUserId: Id<"users">; at: number }> = {};
      for (const r of records) {
        canonical[r.kind] = { byUserId: r.byUserId, at: r.at };
      }

      // Compare with existing denormalized badges (keys + values)
      const existing = (skill.badges ?? {}) as Record<
        string,
        { byUserId?: Id<"users">; at?: number } | undefined
      >;
      const canonicalKeys = Object.keys(canonical);
      const existingKeys = Object.keys(existing).filter((k) => existing[k] !== undefined);
      const needsPatch =
        canonicalKeys.length !== existingKeys.length ||
        canonicalKeys.some((k) => {
          const current = existing[k];
          const next = canonical[k];
          return !current || current.byUserId !== next.byUserId || current.at !== next.at;
        });

      if (needsPatch) {
        await ctx.db.patch(skill._id, { badges: canonical });
        patched++;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillDenormalizedBadgesInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

/**
 * Backfill `latestVersionSummary` on all skills. Cursor-based paginated mutation
 * that self-schedules until done. Reads each skill's latestVersionId, extracts
 * the summary fields, and patches the skill.
 *
 * Always reconciles against the current `latestVersionId` — if the summary is
 * stale (e.g. from a tag retarget), it will be rewritten. To force a full
 * re-backfill, simply re-run the function; every row is re-evaluated.
 */
export const backfillLatestVersionSummaryInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 50, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) continue;

      const expected = {
        version: version.version,
        createdAt: version.createdAt,
        changelog: version.changelog,
        changelogSource: version.changelogSource,
        description: version.parsed?.frontmatter
          ? getFrontmatterValue(version.parsed.frontmatter, "description")?.trim() || undefined
          : undefined,
        clawdis: version.parsed?.clawdis,
      };

      // Skip if already in sync
      const existing = skill.latestVersionSummary;
      if (
        existing &&
        existing.version === expected.version &&
        existing.createdAt === expected.createdAt &&
        existing.changelog === expected.changelog &&
        existing.changelogSource === expected.changelogSource &&
        existing.description === expected.description &&
        JSON.stringify(existing.clawdis ?? null) === JSON.stringify(expected.clawdis ?? null)
      ) {
        continue;
      }

      await ctx.db.patch(skill._id, { latestVersionSummary: expected });
      patched++;
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillLatestVersionSummaryInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

export const backfillSkillSearchDigestModerationVerdictsInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const dryRun = args.dryRun ?? false;
    const { page, continueCursor, isDone } = await ctx.db
      .query("skillSearchDigest")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    let missingSkills = 0;
    for (const digest of page) {
      const skill = await ctx.db.get(digest.skillId);
      if (!skill) {
        missingSkills++;
        continue;
      }
      if (digest.moderationVerdict === skill.moderationVerdict) continue;

      patched++;
      if (!dryRun) {
        await ctx.db.patch(digest._id, {
          moderationVerdict: skill.moderationVerdict,
          updatedAt: skill.updatedAt,
        });
      }
    }

    if (!dryRun && !isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.maintenance.backfillSkillSearchDigestModerationVerdictsInternal,
        {
          cursor: continueCursor,
          batchSize: args.batchSize,
          dryRun,
        },
      );
    }

    return {
      scanned: page.length,
      patched,
      missingSkills,
      cursor: continueCursor,
      isDone,
      dryRun,
    };
  },
});

export const backfillSkillSearchDigestModerationVerdicts: ReturnType<typeof action> = action({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return await ctx.runMutation(
      internal.maintenance.backfillSkillSearchDigestModerationVerdictsInternal,
      args,
    );
  },
});

// Repair stale skill-level moderation that was sourced from a non-latest version.
// Run once after deploying the latest-version moderation fix:
//   npx convex run maintenance:backfillLatestSkillModeration --prod
export const backfillLatestSkillModeration: ReturnType<typeof action> = action({
  args: {
    batchSize: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return await ctx.runMutation(internal.skills.backfillLatestSkillModerationInternal, args);
  },
});

/**
 * Backfill `isSuspicious` on all skills. Cursor-based paginated mutation
 * that self-schedules until done.
 */
export const backfillIsSuspiciousInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      const expected = computeIsSuspicious(skill);
      if (skill.isSuspicious !== expected) {
        await ctx.db.patch(skill._id, { isSuspicious: expected });
        patched++;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillIsSuspiciousInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

function isActiveLegacyPublisherRepairUser(
  user: Doc<"users"> | null | undefined,
): user is Doc<"users"> {
  return Boolean(user && !user.deletedAt && !user.deactivatedAt && !user.purgedAt);
}

function nextLegacyPublisherOwnershipTargetPhase(
  phase: LegacyPublisherOwnershipTargetPhase,
): LegacyPublisherOwnershipTargetPhase | undefined {
  return phase === "skills" ? "packages" : undefined;
}

async function getExistingActivePersonalPublisher(
  ctx: Pick<MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.personalPublisherId) {
    const publisher = await ctx.db.get(user.personalPublisherId);
    if (isPublisherActive(publisher)) return publisher;
  }
  const publisher = await getPersonalPublisherForUser(ctx, user._id);
  return isPublisherActive(publisher) ? publisher : null;
}

async function resolvePersonalPublisherForOwnershipRepair(
  ctx: Pick<MutationCtx, "db">,
  user: Doc<"users">,
  dryRun: boolean,
) {
  if (dryRun) {
    const existing = await getExistingActivePersonalPublisher(ctx, user);
    if (existing) return existing;
    const handle = derivePersonalPublisherHandle(user);
    const conflict = await getPublisherByHandle(ctx, handle);
    if (conflict && conflict.linkedUserId !== user._id) {
      throw new ConvexError(`Publisher handle "@${handle}" is already claimed`);
    }
    return null;
  }
  return await ensurePersonalPublisherForUser(ctx, user, {
    source: "maintenance.legacy_publisher_ownership",
  });
}

async function resolveLegacyPublisherOwnershipTargetUser(
  ctx: Pick<MutationCtx, "db">,
  args: { userId?: Id<"users">; handle?: string },
) {
  const user = args.userId
    ? await ctx.db.get(args.userId)
    : await getUserByHandleOrPersonalPublisher(ctx, args.handle);
  if (!user) throw new ConvexError("Target user not found");
  if (!isActiveLegacyPublisherRepairUser(user)) throw new ConvexError("Target user is inactive");
  return user;
}

async function patchLegacySkillOwnerPublisher(
  ctx: Pick<MutationCtx, "db">,
  skill: Doc<"skills">,
  publisherId: Id<"publishers">,
) {
  await ctx.db.patch(skill._id, { ownerPublisherId: publisherId });

  const aliases = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
    .collect();
  for (const alias of aliases) {
    if (alias.ownerPublisherId === publisherId) continue;
    await ctx.db.patch(alias._id, { ownerPublisherId: publisherId });
  }
}

async function patchLegacyPackageOwnerPublisher(
  ctx: Pick<MutationCtx, "db">,
  pkg: Doc<"packages">,
  publisherId: Id<"publishers">,
) {
  await ctx.db.patch(pkg._id, { ownerPublisherId: publisherId });
}

export async function repairLegacyPublisherOwnershipForUserHandler(
  ctx: MutationCtx,
  args: {
    userId?: Id<"users">;
    handle?: string;
    phase?: LegacyPublisherOwnershipTargetPhase;
    cursor?: string;
    batchSize?: number;
    delayMs?: number;
    dryRun?: boolean;
    scheduleNext?: boolean;
  },
): Promise<LegacyPublisherOwnershipForUserRepairResult> {
  const phase = args.phase ?? "skills";
  const dryRun = args.dryRun === true;
  const batchSize = clampInt(args.batchSize ?? 50, 1, 200);
  const delayMs = clampInt(args.delayMs ?? 500, 0, 60_000);
  const user = await resolveLegacyPublisherOwnershipTargetUser(ctx, args);
  const publisher = await resolvePersonalPublisherForOwnershipRepair(ctx, user, dryRun);
  if (!dryRun && !isPublisherActive(publisher)) {
    throw new ConvexError("Target personal publisher could not be repaired");
  }

  let scanned = 0;
  let repaired = 0;
  let skipped = 0;

  const page =
    phase === "skills"
      ? await ctx.db
          .query("skills")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
          .paginate({ cursor: args.cursor ?? null, numItems: batchSize })
      : await ctx.db
          .query("packages")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
          .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

  for (const item of page.page) {
    scanned++;
    if (item.ownerPublisherId) {
      skipped++;
      continue;
    }
    if (dryRun) {
      repaired++;
      continue;
    }
    if (phase === "skills") {
      await patchLegacySkillOwnerPublisher(ctx, item as Doc<"skills">, publisher!._id);
    } else {
      await patchLegacyPackageOwnerPublisher(ctx, item as Doc<"packages">, publisher!._id);
    }
    repaired++;
  }

  const nextPhase = page.isDone ? nextLegacyPublisherOwnershipTargetPhase(phase) : phase;
  if (!dryRun && args.scheduleNext !== false && nextPhase) {
    await ctx.scheduler.runAfter(
      delayMs,
      internal.maintenance.repairLegacyPublisherOwnershipForUser,
      {
        userId: user._id,
        phase: nextPhase,
        cursor: page.isDone ? undefined : (page.continueCursor ?? undefined),
        batchSize: args.batchSize,
        delayMs: args.delayMs,
        scheduleNext: args.scheduleNext,
      },
    );
  }

  return {
    phase,
    dryRun,
    userId: user._id,
    handle: user.handle,
    publisherId: publisher?._id ?? null,
    scanned,
    repaired,
    skipped,
    errors: [],
    cursor: page.continueCursor,
    isDone: page.isDone,
    ...(nextPhase ? { nextPhase } : {}),
  };
}

// Targeted variant for production canaries and one-off account repair.
// Example:
//   npx convex run maintenance:repairLegacyPublisherOwnershipForUser '{"handle":"harrylabsj","dryRun":true,"scheduleNext":false}' --prod
export const repairLegacyPublisherOwnershipForUser = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    handle: v.optional(v.string()),
    phase: v.optional(v.union(v.literal("skills"), v.literal("packages"))),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    scheduleNext: v.optional(v.boolean()),
  },
  handler: repairLegacyPublisherOwnershipForUserHandler,
});

function clampInt(value: number, min: number, max: number) {
  const rounded = Math.trunc(value);
  if (!Number.isFinite(rounded)) return min;
  return Math.min(max, Math.max(min, rounded));
}
