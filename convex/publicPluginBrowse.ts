import { query } from "./_generated/server";
import { readGlobalPublicPluginsCount } from "./lib/globalStats";
import { hasMissingPackageRecommendedScore } from "./lib/packageRecommendationRead";
import type { PublicPluginBrowseMetadata } from "./lib/pluginBrowseRead";

// Family pages use the already-public packages.listPublicPage query. They must
// be separate calls: Convex permits one paginated read per query transaction.
export const getMetadata = query({
  args: {},
  handler: async (ctx): Promise<PublicPluginBrowseMetadata> => {
    // Keep these bounded reads in this query to avoid nested-query startup and dispatch.
    const totalCount = await readGlobalPublicPluginsCount(ctx);
    const missingScores =
      (await hasMissingPackageRecommendedScore(ctx, "code-plugin")) ||
      (await hasMissingPackageRecommendedScore(ctx, "bundle-plugin"));
    return { totalCount, recommendedFallback: missingScores ? "downloads" : null };
  },
});
