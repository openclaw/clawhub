import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import type { PublicPluginBrowseMetadata } from "./lib/pluginBrowseRead";

// Family pages use the already-public packages.listPublicPage query. They must
// be separate calls: Convex permits one paginated read per query transaction.
export const getMetadata = query({
  args: {},
  handler: async (ctx): Promise<PublicPluginBrowseMetadata> => {
    const totalCount: number | null = await ctx.runQuery(
      internal.packages.countPublicPluginsInternal,
      {},
    );
    const missingScores: boolean = await ctx.runQuery(
      internal.packages.hasMissingRecommendationScoresInternal,
      { families: ["code-plugin", "bundle-plugin"] },
    );
    return { totalCount, recommendedFallback: missingScores ? "downloads" : null };
  },
});
