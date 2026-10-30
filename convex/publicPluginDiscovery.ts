import { isPluginCategorySlug } from "clawhub-schema/pluginCategories";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { packageListScanStatusValidator } from "./lib/packageCatalogRead";
import {
  listCuratedPluginCategoryPage,
  listPluginOverviewCategory,
} from "./lib/pluginDiscoveryQueries";

// Keep public category reads independent of publishing-module initialization.
export const listPluginDiscoveryCategoryInternal = internalQuery({
  args: {
    category: v.string(),
    family: v.optional(v.union(v.literal("code-plugin"), v.literal("bundle-plugin"))),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    topic: v.optional(v.string()),
    excludedScanStatuses: v.optional(v.array(packageListScanStatusValidator)),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!isPluginCategorySlug(args.category) || args.category === "other")
      return { page: [], isDone: true, continueCursor: "" };
    return await listCuratedPluginCategoryPage(ctx, { ...args, category: args.category });
  },
});

export const listPluginOverviewCategoryInternal = internalQuery({
  args: {
    category: v.string(),
    numItems: v.number(),
  },
  handler: async (ctx, args) => {
    if (!isPluginCategorySlug(args.category)) return [];
    return await listPluginOverviewCategory(ctx, {
      category: args.category,
      numItems: args.numItems,
    });
  },
});
