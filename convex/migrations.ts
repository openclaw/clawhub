import { Migrations, runToCompletion } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { syncPackageSearchDigestForPackageId } from "./functions";
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

export const run = migrations.runner();

export const runCatalogTaxonomyPrerequisites = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await runToCompletion(
      ctx,
      components.migrations,
      internal.migrations.rebuildCatalogTaxonomyPackageDigests,
      { dryRun: args.dryRun },
    );
    return null;
  },
});
