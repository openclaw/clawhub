import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { resolvePackageReleaseScanStatus } from "./lib/packageSecurity";

// Staff records evidence reviewed during curation. This never grants Official
// status; that remains the existing, separately audited publisher policy.
export const setStaffCustodyInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
    sourceRepo: v.string(),
    repositoryOwnerId: v.number(),
    evidenceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (actor?.role !== "admin" || actor.deletedAt || actor.deactivatedAt) {
      throw new ConvexError("Only active staff may establish custody");
    }
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.kind !== "org" || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("An active organization publisher is required");
    }
    if (
      !/^[-\w.]+\/[-\w.]+$/.test(args.sourceRepo) ||
      !Number.isSafeInteger(args.repositoryOwnerId) ||
      args.repositoryOwnerId <= 0
    ) {
      throw new ConvexError("Invalid company repository identity");
    }
    let evidence: URL;
    try {
      evidence = new URL(args.evidenceUrl);
    } catch {
      throw new ConvexError("Invalid ownership evidence URL");
    }
    if (evidence.protocol !== "https:" || evidence.username || evidence.password)
      throw new ConvexError("Ownership evidence must use HTTPS");
    const members = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .take(101);
    if (!members.length || members.length > 100)
      throw new ConvexError("Staff ownership could not be established");
    for (const member of members) {
      const user = await ctx.db.get(member.userId);
      if (user?.role !== "admin" || user.deletedAt || user.deactivatedAt)
        throw new ConvexError("Cannot establish custody for a publisher with company members");
    }
    if (!members.some((m) => m.role === "owner"))
      throw new ConvexError("A staff owner is required");
    if (publisher.githubOrgId)
      throw new ConvexError("A verified company publisher cannot enter staff custody");
    const now = Date.now();
    const staffCustody = {
      repositoryOwner: args.sourceRepo.split("/")[0].toLowerCase(),
      repositoryOwnerId: args.repositoryOwnerId,
      sourceRepo: args.sourceRepo.toLowerCase(),
      evidenceUrl: args.evidenceUrl,
      establishedAt: now,
      establishedBy: actor._id,
    };
    await ctx.db.patch(publisher._id, { staffCustody, updatedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "publisher.staffCustody.establish",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: staffCustody,
      createdAt: now,
    });
    return { ok: true };
  },
});

function syncRelease(release: Doc<"packageReleases"> | null) {
  if (!release) return undefined;
  return {
    version: release.version,
    status: release.publicationStatus ?? "published",
    scanStatus: resolvePackageReleaseScanStatus(release),
    curation: release.curation,
    source: release.source
      ? { repo: release.source.repo, path: release.source.path ?? "" }
      : undefined,
  };
}
export const getSyncStateForUserInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    name: v.string(),
    sourceHash: v.string(),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (actor?.role !== "admin" || actor.deletedAt || actor.deactivatedAt)
      throw new ConvexError("Only active staff may inspect curated synchronization state");
    const pkg = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", args.name.toLowerCase()))
      .unique();
    if (!pkg) return null;
    const publisher = pkg.ownerPublisherId ? await ctx.db.get(pkg.ownerPublisherId) : null;
    const latest = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_active_created", (q) =>
        q.eq("packageId", pkg._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .first();
    const matching = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_curated_hash", (q) =>
        q.eq("packageId", pkg._id).eq("curation.sourceContentHash", args.sourceHash),
      )
      .order("desc")
      .first();
    const requested = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_version", (q) =>
        q.eq("packageId", pkg._id).eq("version", args.version),
      )
      .unique();
    return {
      deleted: Boolean(pkg.softDeletedAt || pkg.canonicalPackageId),
      staffCustody: Boolean(publisher?.staffCustody),
      latest: syncRelease(latest),
      matching: syncRelease(matching),
      requested: syncRelease(requested),
    };
  },
});

// Source replacement is a reviewed staff action after the new exact artifact
// clears ordinary scans. Historical version URLs keep their original bytes.
export const setCanonicalReplacementInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    name: v.string(),
    targetName: v.string(),
    reason: v.string(),
  },
  handler: applyCanonicalReplacement,
});
export async function applyCanonicalReplacement(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; name: string; targetName: string; reason: string },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (actor?.role !== "admin" || actor.deletedAt || actor.deactivatedAt)
    throw new ConvexError("Only active staff may replace a curated source");
  if (!args.reason.trim()) throw new ConvexError("A reviewed replacement reason is required");
  const [source, target] = await Promise.all(
    [args.name, args.targetName].map((name) =>
      ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", name.toLowerCase()))
        .unique(),
    ),
  );
  if (
    !source ||
    !target ||
    source._id === target._id ||
    source.softDeletedAt ||
    target.softDeletedAt ||
    target.canonicalPackageId ||
    source.channel === "private" ||
    target.channel === "private"
  )
    throw new ConvexError("Both canonical packages must be active and public");
  if (source.canonicalPackageId) {
    if (source.canonicalPackageId === target._id) return { ok: true };
    throw new ConvexError("The prior canonical decision requires separate review");
  }
  const [from, to] = await Promise.all(
    [source, target].map(async (pkg) =>
      pkg.latestReleaseId ? ctx.db.get(pkg.latestReleaseId) : null,
    ),
  );
  if (
    !from?.curation ||
    from.curation.authorship !== "registry" ||
    !to?.curation ||
    to.curation.authorship !== "company" ||
    from.curation.integration !== to.curation.integration ||
    from.curation.job !== to.curation.job
  )
    throw new ConvexError(
      "Replacement requires the same integration and job, from registry authorship to company authorship",
    );
  if (
    (to.publicationStatus !== undefined && to.publicationStatus !== "published") ||
    resolvePackageReleaseScanStatus(to) !== "clean"
  )
    throw new ConvexError("Canonical replacement requires a clean published artifact");
  const publisher = target.ownerPublisherId ? await ctx.db.get(target.ownerPublisherId) : null;
  if (
    !publisher?.staffCustody ||
    publisher.staffCustody.repositoryOwnerId !== to.curation.ownerId ||
    to.source?.repo?.toLowerCase() !== publisher.staffCustody.sourceRepo.toLowerCase()
  )
    throw new ConvexError("The target is no longer staff-custodied");
  const now = Date.now();
  await ctx.db.patch(source._id, { canonicalPackageId: target._id, updatedAt: now });
  await upsertPackageSearchDigest(
    ctx,
    extractPackageDigestFields({ ...source, canonicalPackageId: target._id, updatedAt: now }),
  );
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "package.curated.canonical_replace",
    targetType: "package",
    targetId: source._id,
    metadata: {
      targetPackageId: target._id,
      reason: args.reason,
      previousSource: from.source,
      canonicalSource: to.source,
    },
    createdAt: now,
  });
  return { ok: true };
}
