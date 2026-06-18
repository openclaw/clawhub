import { Migrations, runToCompletion } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { syncPackageSearchDigestForPackageId } from "./functions";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

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

export const run = migrations.runner();

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
