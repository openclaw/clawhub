import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { OwnedResourceActor } from "../../lib/publishers";

export async function getLatestPackageRescanTarget(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  packageId: Id<"packages">,
) {
  const pkg = await ctx.db.get(packageId);
  if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
    throw new ConvexError("Plugin not found");
  }
  if (!pkg.latestReleaseId) throw new ConvexError("Plugin has no published release");
  const release = await ctx.db.get(pkg.latestReleaseId);
  if (!release || release.softDeletedAt) throw new ConvexError("Latest plugin release not found");
  return { pkg, release };
}

export async function insertPackageRescanRequest(
  ctx: Pick<MutationCtx, "db">,
  actor: OwnedResourceActor,
  target: {
    pkg: Doc<"packages">;
    release: Doc<"packageReleases">;
  },
) {
  const now = Date.now();
  return await ctx.db.insert("rescanRequests", {
    targetKind: "plugin",
    packageId: target.pkg._id,
    packageReleaseId: target.release._id,
    targetVersion: target.release.version,
    requestedByUserId: actor._id,
    ownerUserId: target.pkg.ownerUserId,
    ownerPublisherId: target.pkg.ownerPublisherId,
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
  });
}
