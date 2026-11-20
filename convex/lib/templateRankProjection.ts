import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isPublishedPackageRelease } from "./packageReleaseVisibility";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./packageSecurity";

export function isRankedReleasePublic(
  release: Doc<"packageReleases"> | null,
  pkg: Doc<"packages">,
) {
  return (
    isPublishedPackageRelease(release, pkg._id) &&
    !isPackageBlockedFromPublic(resolvePackageReleaseScanStatus(release))
  );
}

// Run in the same transaction as the package, latest-release visibility, or badge change.
// Only a transition into public eligibility allocates a ticket. Hidden rows do not have one;
// withdrawal followed by republication cannot revive a ticket from a previous public period.
export async function syncTemplateRankProjection(
  ctx: Pick<MutationCtx, "db">,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases"> | null,
) {
  if (pkg.family !== "claw" && !pkg.templateRankIndexed) return;
  const digest = await ctx.db
    .query("packageSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
    .unique();
  if (!digest) throw new Error("Missing package digest during ranked projection sync");
  const visible =
    pkg.family === "claw" &&
    !!pkg.ownerPublisherId &&
    pkg.softDeletedAt === undefined &&
    pkg.channel !== "private" &&
    !isPackageBlockedFromPublic(pkg.scanStatus) &&
    isRankedReleasePublic(release, pkg);
  let ticket = visible ? digest.templateRankTicket : undefined;
  if (visible && ticket === undefined) {
    const counter = await ctx.db.query("templateRankSequence").unique();
    ticket = (counter?.high ?? 0) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("Rank ticket sequence exhausted");
    if (counter) await ctx.db.patch(counter._id, { high: ticket });
    else await ctx.db.insert("templateRankSequence", { high: ticket });
  }
  const highlighted = visible
    ? await ctx.db
        .query("packageBadges")
        .withIndex("by_package_kind", (q) => q.eq("packageId", pkg._id).eq("kind", "highlighted"))
        .unique()
    : null;
  if (digest.templateRankTicket !== ticket || digest.templateFeaturedAt !== highlighted?.at) {
    await ctx.db.patch(digest._id, {
      templateRankTicket: ticket,
      templateFeaturedAt: highlighted?.at,
    });
  }
  if (pkg.family === "claw" && !pkg.templateRankIndexed)
    await ctx.db.patch(pkg._id, { templateRankIndexed: true });
}
