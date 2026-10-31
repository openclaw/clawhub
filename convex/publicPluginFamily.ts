import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { query } from "./_generated/server";
import {
  canReadInitialPluginFamilyPage,
  readInitialPluginFamilyPage,
} from "./lib/initialPluginFamilyRead";
import type { PublicPackageListPage } from "./lib/packageCatalogRead";

export const listPage = query({
  args: {
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
    sort: v.union(v.literal("recommended"), v.literal("downloads")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<PublicPackageListPage> => {
    if (canReadInitialPluginFamilyPage(args)) {
      const page = await readInitialPluginFamilyPage(ctx, args);
      if (page) return page;
    }
    return await ctx.runQuery(api.packages.listPublicPage, args);
  },
});
