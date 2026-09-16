import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export const FEATURED_CATALOG_SIZE = 8;

export async function assertFeaturedCapacity(
  ctx: Pick<MutationCtx, "db">,
  artifactKind: "plugin" | "skill",
) {
  const badges =
    artifactKind === "plugin"
      ? await ctx.db
          .query("packageBadges")
          .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
          .take(FEATURED_CATALOG_SIZE)
      : await ctx.db
          .query("skillBadges")
          .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
          .take(FEATURED_CATALOG_SIZE);
  // This index read and the badge insertion share a transaction, so concurrent
  // additions cannot each claim the last slot. Existing members bypass this check.
  if (badges.length >= FEATURED_CATALOG_SIZE) {
    throw new ConvexError(
      `Featured is limited to ${FEATURED_CATALOG_SIZE} ${artifactKind}s. Remove a selection before adding another.`,
    );
  }
}
