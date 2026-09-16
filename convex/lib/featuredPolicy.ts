import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export const FEATURED_CATALOG_SIZE = 16;

export async function assertFeaturedCapacity(
  ctx: Pick<MutationCtx, "db">,
  artifactKind: "plugin" | "skill",
) {
  let count = 0;
  if (artifactKind === "skill") {
    count = (
      await ctx.db
        .query("skillBadges")
        .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
        .take(FEATURED_CATALOG_SIZE)
    ).length;
  } else {
    // Claws share the badge table but have their own catalog.
    for await (const badge of ctx.db
      .query("packageBadges")
      .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))) {
      const pkg = await ctx.db.get(badge.packageId);
      if (pkg?.family !== "code-plugin" && pkg?.family !== "bundle-plugin") continue;
      if (++count >= FEATURED_CATALOG_SIZE) break;
    }
  }
  // This index read and the badge insertion share a transaction, so concurrent
  // additions cannot each claim the last slot. Existing members bypass this check.
  if (count >= FEATURED_CATALOG_SIZE) {
    throw new ConvexError(
      `Featured is limited to ${FEATURED_CATALOG_SIZE} ${artifactKind}s. Remove a selection before adding another.`,
    );
  }
}
