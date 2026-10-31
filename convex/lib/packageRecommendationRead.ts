import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { RECOMMENDATION_SCORE_VERSION } from "./recommendationScore";

export async function hasMissingPackageRecommendedScore(
  ctx: Pick<QueryCtx, "db">,
  family: Doc<"packages">["family"] | undefined,
) {
  if (family) {
    const missingScore = await ctx.db
      .query("packages")
      .withIndex("by_active_family_recommended_score", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", family).eq("recommendedScore", undefined),
      )
      .first();
    if (missingScore) return true;

    const missingVersion = await ctx.db
      .query("packages")
      .withIndex("by_active_family_recommended_score_version", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("recommendedScoreVersion", undefined),
      )
      .first();
    if (missingVersion) return true;

    const staleVersion = await ctx.db
      .query("packages")
      .withIndex("by_active_family_recommended_score_version", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .lt("recommendedScoreVersion", RECOMMENDATION_SCORE_VERSION),
      )
      .first();
    return Boolean(staleVersion);
  }

  const missingScore = await ctx.db
    .query("packages")
    .withIndex("by_active_recommended_score", (q) =>
      q.eq("softDeletedAt", undefined).eq("recommendedScore", undefined),
    )
    .first();
  if (missingScore) return true;

  const missingVersion = await ctx.db
    .query("packages")
    .withIndex("by_active_recommended_score_version", (q) =>
      q.eq("softDeletedAt", undefined).eq("recommendedScoreVersion", undefined),
    )
    .first();
  if (missingVersion) return true;

  const staleVersion = await ctx.db
    .query("packages")
    .withIndex("by_active_recommended_score_version", (q) =>
      q.eq("softDeletedAt", undefined).lt("recommendedScoreVersion", RECOMMENDATION_SCORE_VERSION),
    )
    .first();
  return Boolean(staleVersion);
}
