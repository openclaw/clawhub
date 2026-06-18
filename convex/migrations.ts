import { Migrations, runToCompletion } from "@convex-dev/migrations";
import {
  normalizeInferredCatalogTopics,
  normalizePluginCategories,
  normalizeSkillCategories,
} from "clawhub-schema";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { syncPackageSearchDigestForPackageId } from "./functions";
import {
  selectCatalogInference,
  type CatalogClassificationConfidence,
} from "./lib/catalogClassification";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

const APPLY_HIGH_CONFIDENCE_CONFIRM = "apply-high-confidence-catalog-classifications";
const APPLY_MEDIUM_CONFIDENCE_CONFIRM = "apply-medium-confidence-catalog-classifications";

export const migrations = new Migrations(components.migrations, {
  schema,
  defaultBatchSize: 25,
});

export const rebuildCatalogTaxonomyPackageDigests = migrations.define({
  table: "packages",
  migrateOne: async (ctx, pkg) => {
    await syncPackageSearchDigestForPackageId(ctx, pkg._id);
  },
});

export const rebuildCatalogTaxonomySkillDigests = migrations.define({
  table: "skills",
  migrateOne: async (ctx, skill) => {
    await syncSkillSearchDigestForSkill(ctx, skill);
  },
});

async function applyCatalogClassification(
  ctx: Pick<MutationCtx, "db">,
  result: Doc<"catalogClassificationResults">,
  minimumConfidence: CatalogClassificationConfidence,
) {
  const now = Date.now();
  if (result.targetKind === "skill" && result.skillId) {
    const skill = await ctx.db.get(result.skillId);
    if (!skill) {
      await ctx.db.patch(result._id, {
        applyStatus: "stale",
        error: "Skill no longer exists",
        appliedAt: undefined,
      });
      return;
    }
    const selection = selectCatalogInference({
      currentSourceId: skill.latestVersionId,
      resultSourceId: result.skillVersionId,
      authorCategories: skill.categories,
      authorTopics: skill.topics,
      result: {
        categories: result.categories,
        topics: result.topics,
        confidence: result.categoryConfidence,
        topicConfidence: result.topicConfidence,
      },
      minimumConfidence,
    });
    if (selection.status !== "applied") {
      await ctx.db.patch(result._id, {
        applyStatus: selection.status,
        error: undefined,
        appliedAt: undefined,
      });
      return;
    }
    const patch = {
      inferredCategories: selection.categories
        ? normalizeSkillCategories(selection.categories)
        : undefined,
      inferredTopics: selection.topics
        ? normalizeInferredCatalogTopics(selection.topics)
        : undefined,
      inferredFromVersionId: result.skillVersionId,
      inferredCategoryConfidence: selection.categories ? result.categoryConfidence : undefined,
      inferredTopicConfidence: selection.topics ? result.topicConfidence : undefined,
      inferredClassifierVersion: result.classifierVersion,
      inferredTopicClassifierVersion: result.topicClassifierVersion,
      inferredInputHash: result.inputHash,
      inferredTopicInputHash: result.topicInputHash,
      inferredAt: now,
    };
    await ctx.db.patch(skill._id, patch);
    await syncSkillSearchDigestForSkill(ctx, { ...skill, ...patch });
    await ctx.db.patch(result._id, {
      applyStatus: "applied",
      error: undefined,
      appliedAt: now,
    });
    return;
  }

  if (result.targetKind === "plugin" && result.packageId) {
    const pkg = await ctx.db.get(result.packageId);
    if (!pkg) {
      await ctx.db.patch(result._id, {
        applyStatus: "stale",
        error: "Package no longer exists",
        appliedAt: undefined,
      });
      return;
    }
    const selection = selectCatalogInference({
      currentSourceId: pkg.latestReleaseId,
      resultSourceId: result.packageReleaseId,
      authorCategories: pkg.categories,
      authorTopics: pkg.topics,
      result: {
        categories: result.categories,
        topics: result.topics,
        confidence: result.categoryConfidence,
        topicConfidence: result.topicConfidence,
      },
      minimumConfidence,
    });
    if (selection.status !== "applied") {
      await ctx.db.patch(result._id, {
        applyStatus: selection.status,
        error: undefined,
        appliedAt: undefined,
      });
      return;
    }
    await ctx.db.patch(pkg._id, {
      inferredCategories: selection.categories
        ? normalizePluginCategories(selection.categories)
        : undefined,
      inferredTopics: selection.topics
        ? normalizeInferredCatalogTopics(selection.topics)
        : undefined,
      inferredFromReleaseId: result.packageReleaseId,
      inferredCategoryConfidence: selection.categories ? result.categoryConfidence : undefined,
      inferredTopicConfidence: selection.topics ? result.topicConfidence : undefined,
      inferredClassifierVersion: result.classifierVersion,
      inferredTopicClassifierVersion: result.topicClassifierVersion,
      inferredInputHash: result.inputHash,
      inferredTopicInputHash: result.topicInputHash,
      inferredAt: now,
    });
    await syncPackageSearchDigestForPackageId(ctx, pkg._id);
    await ctx.db.patch(result._id, {
      applyStatus: "applied",
      error: undefined,
      appliedAt: now,
    });
    return;
  }

  await ctx.db.patch(result._id, {
    applyStatus: "error",
    error: "Classification target is inconsistent",
    appliedAt: undefined,
  });
}

export const applyHighConfidenceCatalogClassifications = migrations.define({
  table: "catalogClassificationResults",
  batchSize: 10,
  migrateOne: (ctx, result) => applyCatalogClassification(ctx, result, "high"),
});

export const applyMediumConfidenceCatalogClassifications = migrations.define({
  table: "catalogClassificationResults",
  batchSize: 10,
  migrateOne: (ctx, result) => applyCatalogClassification(ctx, result, "medium"),
});

export const run = migrations.runner();

export const runCatalogClassificationApply = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    minimumConfidence: v.union(v.literal("high"), v.literal("medium")),
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    minimumConfidence: v.union(v.literal("high"), v.literal("medium")),
    confirmRequired: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const confirmRequired =
      args.minimumConfidence === "high"
        ? APPLY_HIGH_CONFIDENCE_CONFIRM
        : APPLY_MEDIUM_CONFIDENCE_CONFIRM;
    if (!dryRun && args.confirm !== confirmRequired) {
      throw new ConvexError(`Pass confirm="${confirmRequired}" to apply.`);
    }
    const migration =
      args.minimumConfidence === "high"
        ? internal.migrations.applyHighConfidenceCatalogClassifications
        : internal.migrations.applyMediumConfidenceCatalogClassifications;
    if (dryRun) {
      await ctx.runMutation(internal.migrations.run, {
        fn:
          args.minimumConfidence === "high"
            ? "migrations:applyHighConfidenceCatalogClassifications"
            : "migrations:applyMediumConfidenceCatalogClassifications",
        dryRun: true,
        reset: true,
      });
    } else {
      await runToCompletion(ctx, components.migrations, migration);
    }
    return {
      ok: true as const,
      dryRun,
      minimumConfidence: args.minimumConfidence,
      confirmRequired: dryRun ? confirmRequired : undefined,
    };
  },
});

export const runCatalogTaxonomyPrerequisites = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.dryRun) {
      for (const fn of [
        "migrations:rebuildCatalogTaxonomyPackageDigests",
        "migrations:rebuildCatalogTaxonomySkillDigests",
      ]) {
        await ctx.runMutation(internal.migrations.run, {
          fn,
          dryRun: true,
          reset: true,
        });
      }
      return null;
    }
    await runToCompletion(
      ctx,
      components.migrations,
      internal.migrations.rebuildCatalogTaxonomyPackageDigests,
    );
    await runToCompletion(
      ctx,
      components.migrations,
      internal.migrations.rebuildCatalogTaxonomySkillDigests,
    );
    return null;
  },
});
