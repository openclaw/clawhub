import { Migrations, runToCompletion } from "@convex-dev/migrations";
import { normalizeInferredCatalogTopics } from "clawhub-schema";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { syncPackageSearchDigestForPackageId } from "./functions";
import { adjustPublisherStatsForSkillChange } from "./lib/publisherStats";
import {
  buildSkillInstallBackfillPatch,
  INSTALL_BACKFILL_CLEAN_WINDOW,
  INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME,
  INSTALL_BACKFILL_DEFAULTS,
} from "./lib/skillInstallBackfill";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

const CANONICALIZE_CATALOG_TOPICS_CONFIRM = "canonicalize-catalog-topics";
const APPLY_SKILL_INSTALL_BACKFILL_CONFIRM = "apply-skill-install-backfill";
const SKILL_STAT_EVENTS_CURSOR_KEY = "skill_stat_events";
const MAX_PENDING_SKILL_STAT_EVENTS_PER_SKILL = 1_000;

export const migrations = new Migrations(components.migrations, {
  schema,
  defaultBatchSize: 25,
});

type CanonicalTopicFields = Pick<
  Doc<"skills">,
  | "topics"
  | "inferredTopics"
  | "inferredTopicConfidence"
  | "inferredTopicClassifierVersion"
  | "inferredTopicInputHash"
>;

export function buildCanonicalTopicPatch(
  input: CanonicalTopicFields & {
    currentSourceId?: string | null;
    inferredSourceId?: string | null;
    hasPublisherTopicIntent?: boolean;
  },
): Partial<CanonicalTopicFields> | null {
  const hasInferredTopicState =
    input.inferredTopics !== undefined ||
    input.inferredTopicConfidence !== undefined ||
    input.inferredTopicClassifierVersion !== undefined ||
    input.inferredTopicInputHash !== undefined;
  if (!hasInferredTopicState) return null;

  // Stale inference described an older artifact and must not become publisher-owned metadata.
  const inferenceCurrent =
    Boolean(input.currentSourceId) && input.currentSourceId === input.inferredSourceId;
  const inferredTopics =
    input.topics === undefined && !input.hasPublisherTopicIntent && inferenceCurrent
      ? normalizeInferredCatalogTopics(input.inferredTopics)
      : [];

  return {
    ...(inferredTopics.length > 0 ? { topics: inferredTopics } : {}),
    inferredTopics: undefined,
    inferredTopicConfidence: undefined,
    inferredTopicClassifierVersion: undefined,
    inferredTopicInputHash: undefined,
  };
}

async function hasPublisherTopicIntent(
  ctx: Pick<MutationCtx, "db">,
  targetType: "skill" | "package",
  targetId: string,
  action: "skill.catalog_metadata.set" | "package.catalog_metadata.set",
): Promise<boolean> {
  // Historical explicit clears were stored as an absent topics field, so any settings save wins.
  const auditLog = await ctx.db
    .query("auditLogs")
    .withIndex("by_target_action", (q) =>
      q.eq("targetType", targetType).eq("targetId", targetId).eq("action", action),
    )
    .first();
  return auditLog !== null;
}

export const canonicalizeSkillTopics = migrations.define({
  table: "skills",
  batchSize: 10,
  migrateOne: async (ctx, skill) => {
    const publisherTopicIntent =
      skill.topics === undefined &&
      Boolean(skill.inferredTopics?.length) &&
      skill.latestVersionId === skill.inferredFromVersionId
        ? await hasPublisherTopicIntent(ctx, "skill", skill._id, "skill.catalog_metadata.set")
        : false;
    const patch = buildCanonicalTopicPatch({
      topics: skill.topics,
      inferredTopics: skill.inferredTopics,
      currentSourceId: skill.latestVersionId,
      inferredSourceId: skill.inferredFromVersionId,
      inferredTopicConfidence: skill.inferredTopicConfidence,
      inferredTopicClassifierVersion: skill.inferredTopicClassifierVersion,
      inferredTopicInputHash: skill.inferredTopicInputHash,
      hasPublisherTopicIntent: publisherTopicIntent,
    });
    if (!patch) return;

    const nextSkill: Doc<"skills"> = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
  },
});

export const canonicalizePackageTopics = migrations.define({
  table: "packages",
  batchSize: 10,
  migrateOne: async (ctx, pkg) => {
    const publisherTopicIntent =
      pkg.topics === undefined &&
      Boolean(pkg.inferredTopics?.length) &&
      pkg.latestReleaseId === pkg.inferredFromReleaseId
        ? await hasPublisherTopicIntent(ctx, "package", pkg._id, "package.catalog_metadata.set")
        : false;
    const patch = buildCanonicalTopicPatch({
      topics: pkg.topics,
      inferredTopics: pkg.inferredTopics,
      currentSourceId: pkg.latestReleaseId,
      inferredSourceId: pkg.inferredFromReleaseId,
      inferredTopicConfidence: pkg.inferredTopicConfidence,
      inferredTopicClassifierVersion: pkg.inferredTopicClassifierVersion,
      inferredTopicInputHash: pkg.inferredTopicInputHash,
      hasPublisherTopicIntent: publisherTopicIntent,
    });
    if (!patch) return;

    await ctx.db.patch(pkg._id, patch);
    await syncPackageSearchDigestForPackageId(ctx, pkg._id);
  },
});

async function readSkillInstallCleanWindowStats(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
) {
  let downloads = 0;
  let installs = 0;
  for (
    let day = INSTALL_BACKFILL_CLEAN_WINDOW.startDay;
    day <= INSTALL_BACKFILL_CLEAN_WINDOW.endDay;
    day += 1
  ) {
    const stat = await ctx.db
      .query("skillDailyStats")
      .withIndex("by_skill_day", (q) => q.eq("skillId", skillId).eq("day", day))
      .unique();
    downloads += stat?.downloads ?? 0;
    installs += stat?.installs ?? 0;
  }
  return { downloads, installs };
}

async function readDailyStatsAppliedPendingSkillDocDeltas(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
  now: number,
) {
  const cursor = await ctx.db
    .query("skillStatUpdateCursors")
    .withIndex("by_key", (q) => q.eq("key", SKILL_STAT_EVENTS_CURSOR_KEY))
    .unique();
  const cursorCreationTime = cursor?.cursorCreationTime;
  if (cursorCreationTime === undefined) {
    throw new ConvexError(
      "Skill install backfill requires skill stat daily aggregation through the clean window before applying.",
    );
  }
  if (cursorCreationTime < INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME) {
    if (now < INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME) {
      throw new ConvexError(
        "Skill install backfill requires skill stat daily aggregation through the clean window before applying.",
      );
    }
    const nextEvent = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", cursorCreationTime))
      .take(1);
    if (nextEvent.length > 0) {
      throw new ConvexError(
        "Skill install backfill requires skill stat daily aggregation through the clean window before applying.",
      );
    }
  }

  const pendingEvents = await ctx.db
    .query("skillStatEvents")
    .withIndex("by_skill_processed", (q) => q.eq("skillId", skillId).eq("processedAt", undefined))
    .take(MAX_PENDING_SKILL_STAT_EVENTS_PER_SKILL + 1);
  if (pendingEvents.length > MAX_PENDING_SKILL_STAT_EVENTS_PER_SKILL) {
    throw new ConvexError(
      "Skill install backfill requires draining skill stat doc sync before applying.",
    );
  }

  let downloads = 0;
  let installsAllTime = 0;
  for (const event of pendingEvents) {
    if (event._creationTime > cursorCreationTime) continue;
    if (event.kind === "download") {
      downloads += 1;
    } else if (event.kind === "install_new") {
      installsAllTime += 1;
    } else if (event.kind === "install_clear") {
      installsAllTime += event.delta?.allTime ?? 0;
    }
  }
  return { downloads, installsAllTime };
}

export async function backfillOneSkillInstallEstimate(
  ctx: Pick<MutationCtx, "db">,
  skill: Doc<"skills">,
  now: number = Date.now(),
) {
  const cleanStats = await readSkillInstallCleanWindowStats(ctx, skill._id);
  const pendingSkillDocDeltas = await readDailyStatsAppliedPendingSkillDocDeltas(
    ctx,
    skill._id,
    now,
  );
  const patch = buildSkillInstallBackfillPatch({
    skill,
    cleanStats,
    now,
    pendingSkillDocDownloads: pendingSkillDocDeltas.downloads,
    pendingSkillDocInstallsAllTime: pendingSkillDocDeltas.installsAllTime,
  });
  if (!patch) return false;

  const nextSkill: Doc<"skills"> = { ...skill, ...patch };
  await ctx.db.patch(skill._id, patch);
  // If pending stat events were already counted in daily stats, this writes the
  // temporary target-minus-pending value. The later doc-sync mutation uses the
  // trigger-wrapped internalMutation from ./functions, so its skill patch
  // resyncs publisher stats and search digests when those pending events land.
  await adjustPublisherStatsForSkillChange(ctx, skill, nextSkill);
  await syncSkillSearchDigestForSkill(ctx, nextSkill);
  return true;
}

export const backfillSkillInstallEstimates = migrations.define({
  table: "skills",
  batchSize: 10,
  migrateOne: async (ctx, skill) => {
    await backfillOneSkillInstallEstimate(ctx, skill);
  },
});

export const run = migrations.runner();

export const runCatalogTopicCanonicalization = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    confirmRequired: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== CANONICALIZE_CATALOG_TOPICS_CONFIRM) {
      throw new ConvexError(`Pass confirm="${CANONICALIZE_CATALOG_TOPICS_CONFIRM}" to apply.`);
    }
    if (dryRun) {
      for (const fn of [
        "migrations:canonicalizeSkillTopics",
        "migrations:canonicalizePackageTopics",
      ]) {
        await ctx.runMutation(internal.migrations.run, {
          fn,
          dryRun: true,
          reset: true,
        });
      }
    } else {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.canonicalizeSkillTopics,
      );
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.canonicalizePackageTopics,
      );
    }
    return {
      ok: true as const,
      dryRun,
      confirmRequired: dryRun ? CANONICALIZE_CATALOG_TOPICS_CONFIRM : undefined,
    };
  },
});

export const runSkillInstallBackfill = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    confirmRequired: v.optional(v.string()),
    model: v.object({
      cleanWindowStartDay: v.number(),
      cleanWindowEndDay: v.number(),
      globalCleanDownloads: v.number(),
      globalCleanInstalls: v.number(),
      priorDownloads: v.number(),
      minimumCleanDownloads: v.number(),
      maxSmoothedRate: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== APPLY_SKILL_INSTALL_BACKFILL_CONFIRM) {
      throw new ConvexError(`Pass confirm="${APPLY_SKILL_INSTALL_BACKFILL_CONFIRM}" to apply.`);
    }
    if (dryRun) {
      await ctx.runMutation(internal.migrations.run, {
        fn: "migrations:backfillSkillInstallEstimates",
        dryRun: true,
        reset: true,
      });
    } else {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.backfillSkillInstallEstimates,
      );
    }
    return {
      ok: true as const,
      dryRun,
      confirmRequired: dryRun ? APPLY_SKILL_INSTALL_BACKFILL_CONFIRM : undefined,
      model: {
        cleanWindowStartDay: INSTALL_BACKFILL_CLEAN_WINDOW.startDay,
        cleanWindowEndDay: INSTALL_BACKFILL_CLEAN_WINDOW.endDay,
        ...INSTALL_BACKFILL_DEFAULTS,
      },
    };
  },
});
