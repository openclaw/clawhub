import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { query } from "./_generated/server";
import {
  canReadInitialPluginFamilyPage,
  readInitialPluginFamilyPage,
} from "./lib/initialPluginFamilyRead";
import type { PublicPackageListPage } from "./lib/packageCatalogRead";
import { withPublicPluginArtwork, type PublicPluginArtwork } from "./lib/publicPluginArtwork";

type PublicPluginArtworkPage = Omit<PublicPackageListPage, "page"> & {
  page: Array<PublicPackageListPage["page"][number] & PublicPluginArtwork>;
};

export const listPage = query({
  args: {
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
    sort: v.union(v.literal("recommended"), v.literal("downloads")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<PublicPluginArtworkPage> => {
    if (canReadInitialPluginFamilyPage(args)) {
      const page = await readInitialPluginFamilyPage(ctx, args);
      if (page) return { ...page, page: await withPublicPluginArtwork(ctx, page.page) };
    }
    return await ctx.runQuery(api.packages.listPublicPage, args);
  },
});
