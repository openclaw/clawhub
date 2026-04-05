import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import { v } from "convex/values";
import semver from "semver";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import {
  mutation as rawMutation,
  internalMutation as rawInternalMutation,
  query,
  internalQuery,
  action,
  internalAction,
  httpAction,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  deletePackageSearchDigests,
  extractPackageDigestFields,
  upsertPackageSearchDigest,
} from "./lib/packageSearchDigest";
import { getOwnerPublisher } from "./lib/publishers";
import { extractDigestFields, upsertSkillSearchDigest } from "./lib/skillSearchDigest";

const triggers = new Triggers<DataModel>();

function isMissingTableError(error: unknown, table: string) {
  return (
    error instanceof Error &&
    new RegExp(`unexpected (query )?table:? ${table}`, "i").test(error.message)
  );
}

type PackageDigestSyncCtx = Pick<MutationCtx, "db">;
type OwnerPublisherDigestScheduleCtx = Pick<Partial<MutationCtx>, "scheduler">;
type LatestPackageRelease = Pick<
  Doc<"packageReleases">,
  | "_id"
  | "createdAt"
  | "version"
  | "changelog"
  | "summary"
  | "compatibility"
  | "capabilities"
  | "verification"
  | "distTags"
> & {
  scanStatus?: Doc<"packages">["scanStatus"];
};

function toPackageLatestVersionSummary(
  release: LatestPackageRelease | null,
): Doc<"packages">["latestVersionSummary"] {
  if (!release) return undefined;
  return {
    version: release.version,
    createdAt: release.createdAt,
    changelog: release.changelog,
    compatibility: release.compatibility,
    capabilities: release.capabilities,
    verification: release.verification,
  };
}

function compareFallbackReleases(
  family: Doc<"packages">["family"],
  a: LatestPackageRelease,
  b: LatestPackageRelease,
) {
  if (family === "bundle-plugin") {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a._id.localeCompare(b._id);
  }
  const aSemver = semver.valid(a.version);
  const bSemver = semver.valid(b.version);
  if (aSemver && bSemver) return semver.compare(aSemver, bSemver);
  if (aSemver) return 1;
  if (bSemver) return -1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a._id.localeCompare(b._id);
}

async function getPreferredFallbackPackageRelease(
  ctx: PackageDigestSyncCtx,
  packageId: Id<"packages">,
  family: Doc<"packages">["family"],
): Promise<LatestPackageRelease | null> {
  let cursor: string | null = null;
  let best: LatestPackageRelease | null = null;
  while (true) {
    const page = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_active_created", (q) =>
        q.eq("packageId", packageId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: 100 });
    for (const release of page.page) {
      const candidate: LatestPackageRelease = {
        _id: release._id,
        createdAt: release.createdAt,
        version: release.version,
        changelog: release.changelog,
        summary: release.summary,
        compatibility: release.compatibility,
        capabilities: release.capabilities,
        verification: release.verification,
        scanStatus: release.verification?.scanStatus,
        distTags: release.distTags,
      };
      if (!best || compareFallbackReleases(family, candidate, best) > 0) best = candidate;
    }
    if (page.isDone) return best;
    cursor = page.continueCursor;
  }
}

async function syncPackageSearchDigest(
  ctx: PackageDigestSyncCtx,
  pkg: Doc<"packages"> | null | undefined,
) {
  if (!pkg) return;
  const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
  const fields = extractPackageDigestFields(pkg);
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: pkg.ownerPublisherId,
    ownerUserId: pkg.ownerUserId,
  });
  await upsertPackageSearchDigest(ctx, {
    ...fields,
    latestVersion:
      latestRelease && !latestRelease.softDeletedAt ? latestRelease.version : undefined,
    ownerHandle: owner?.handle ?? "",
    ownerKind: owner?.kind,
  });
}

export async function syncPackageSearchDigestForPackageId(
  ctx: PackageDigestSyncCtx,
  packageId: Id<"packages"> | null | undefined,
) {
  if (!packageId) return;
  const pkg = await ctx.db.get(packageId);
  if (!pkg) return;
  await syncPackageSearchDigest(ctx, pkg);
}

export async function syncPackageSearchDigestsForOwnerUserId(
  ctx: PackageDigestSyncCtx,
  ownerUserId: Id<"users"> | null | undefined,
) {
  if (!ownerUserId) return;
  let cursor: string | null = null;
  try {
    while (true) {
      const page = await ctx.db
        .query("packages")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
        .paginate({ cursor, numItems: 100 });
      for (const pkg of page.page) {
        await syncPackageSearchDigest(ctx, pkg);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  } catch (error) {
    if (isMissingTableError(error, "packages")) return;
    throw error;
  }
}

export async function syncPackageSearchDigestsForOwnerPublisherId(
  ctx: PackageDigestSyncCtx,
  ownerPublisherId: Id<"publishers"> | null | undefined,
) {
  if (!ownerPublisherId) return;
  let cursor: string | null = null;
  try {
    while (true) {
      const page = await ctx.db
        .query("packages")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", ownerPublisherId))
        .paginate({ cursor, numItems: 100 });
      for (const pkg of page.page) {
        await syncPackageSearchDigest(ctx, pkg);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  } catch (error) {
    if (isMissingTableError(error, "packages")) return;
    throw error;
  }
}

async function syncSkillSearchDigestForSkill(
  ctx: PackageDigestSyncCtx,
  skill: Doc<"skills"> | null | undefined,
) {
  if (!skill) return;
  const fields = extractDigestFields(skill);
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: skill.ownerPublisherId,
    ownerUserId: skill.ownerUserId,
  });
  await upsertSkillSearchDigest(ctx, {
    ...fields,
    ownerHandle: owner?.handle ?? "",
    ownerKind: owner?.kind,
    ownerName: owner?.linkedUserId ? owner.handle : undefined,
    ownerDisplayName: owner?.displayName,
    ownerImage: owner?.image,
  });
}

export async function syncSkillSearchDigestsForOwnerPublisherId(
  ctx: PackageDigestSyncCtx,
  ownerPublisherId: Id<"publishers"> | null | undefined,
) {
  if (!ownerPublisherId) return;
  let cursor: string | null = null;
  try {
    while (true) {
      const page = await ctx.db
        .query("skills")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", ownerPublisherId))
        .paginate({ cursor, numItems: 100 });
      for (const skill of page.page) {
        await syncSkillSearchDigestForSkill(ctx, skill);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  } catch (error) {
    if (isMissingTableError(error, "skills")) return;
    throw error;
  }
}

export async function scheduleOwnerPublisherDigestSync(
  ctx: OwnerPublisherDigestScheduleCtx,
  ownerPublisherId: Id<"publishers"> | null | undefined,
) {
  if (!ownerPublisherId || !ctx.scheduler) return;
  await ctx.scheduler.runAfter(
    0,
    internal.functions.syncPackageSearchDigestsForOwnerPublisherIdInternal,
    { ownerPublisherId },
  );
  await ctx.scheduler.runAfter(
    0,
    internal.functions.syncSkillSearchDigestsForOwnerPublisherIdInternal,
    { ownerPublisherId },
  );
}

export const syncPackageSearchDigestsForOwnerPublisherIdInternal = rawInternalMutation({
  args: {
    ownerPublisherId: v.id("publishers"),
  },
  handler: async (ctx, args) => {
    await syncPackageSearchDigestsForOwnerPublisherId(ctx, args.ownerPublisherId);
  },
});

export const syncSkillSearchDigestsForOwnerPublisherIdInternal = rawInternalMutation({
  args: {
    ownerPublisherId: v.id("publishers"),
  },
  handler: async (ctx, args) => {
    await syncSkillSearchDigestsForOwnerPublisherId(ctx, args.ownerPublisherId);
  },
});

export async function repointPackageLatestRelease(
  ctx: PackageDigestSyncCtx,
  packageId: Id<"packages"> | null | undefined,
  affectedReleaseId: Id<"packageReleases"> | null | undefined,
) {
  if (!packageId || !affectedReleaseId) return;
  const pkg = await ctx.db.get(packageId);
  if (!pkg) return;

  const nextTags = Object.fromEntries(
    Object.entries(pkg.tags).filter(([, releaseId]) => releaseId !== affectedReleaseId),
  ) as Doc<"packages">["tags"];
  const latestPointerAffected =
    pkg.latestReleaseId === affectedReleaseId || pkg.tags.latest === affectedReleaseId;

  if (!latestPointerAffected && Object.keys(nextTags).length === Object.keys(pkg.tags).length) {
    return;
  }

  const nextLatest = latestPointerAffected
    ? await getPreferredFallbackPackageRelease(ctx, packageId, pkg.family)
    : null;
  if (latestPointerAffected && nextLatest && !(nextLatest.distTags ?? []).includes("latest")) {
    await ctx.db.patch(nextLatest._id, {
      distTags: [...(nextLatest.distTags ?? []), "latest"],
    });
  }

  const patch: Partial<Doc<"packages">> = {
    tags: latestPointerAffected && nextLatest ? { ...nextTags, latest: nextLatest._id } : nextTags,
    updatedAt: Date.now(),
  };
  if (latestPointerAffected) {
    patch.latestReleaseId = nextLatest?._id;
    patch.latestVersionSummary = toPackageLatestVersionSummary(nextLatest);
    patch.summary = nextLatest?.summary;
    patch.capabilityTags = nextLatest?.capabilities?.capabilityTags;
    patch.executesCode =
      typeof nextLatest?.capabilities?.executesCode === "boolean"
        ? nextLatest.capabilities.executesCode
        : undefined;
    patch.compatibility = nextLatest?.compatibility;
    patch.capabilities = nextLatest?.capabilities;
    patch.verification = nextLatest?.verification;
    patch.scanStatus = nextLatest?.scanStatus;
  }
  await ctx.db.patch(pkg._id, patch);
  await syncPackageSearchDigest(ctx, { ...pkg, ...patch });
}

triggers.register("skills", async (ctx, change) => {
  if (change.operation === "delete") {
    const existing = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_skill", (q) => q.eq("skillId", change.id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  } else {
    await syncSkillSearchDigestForSkill(ctx, change.newDoc);
  }
});

triggers.register("packages", async (ctx, change) => {
  if (change.operation === "delete") {
    await deletePackageSearchDigests(ctx, change.id);
    return;
  }

  await syncPackageSearchDigest(ctx, change.newDoc);
});

triggers.register("packageReleases", async (ctx, change) => {
  if (change.operation === "insert") return;
  if (
    change.operation === "update" &&
    change.oldDoc.softDeletedAt === change.newDoc.softDeletedAt
  ) {
    return;
  }
  const packageId =
    change.operation === "delete" ? change.oldDoc.packageId : change.newDoc.packageId;
  const affectedReleaseId = change.operation === "delete" ? change.oldDoc._id : change.newDoc._id;
  if (change.operation === "delete" || change.newDoc.softDeletedAt) {
    await repointPackageLatestRelease(ctx, packageId, affectedReleaseId);
    return;
  }
  await syncPackageSearchDigestForPackageId(ctx, packageId);
});

triggers.register("users", async (ctx, change) => {
  if (
    change.operation === "update" &&
    change.oldDoc.handle === change.newDoc.handle &&
    change.oldDoc.deletedAt === change.newDoc.deletedAt &&
    change.oldDoc.deactivatedAt === change.newDoc.deactivatedAt
  ) {
    return;
  }
  const ownerUserId = change.operation === "delete" ? change.id : change.newDoc._id;
  await syncPackageSearchDigestsForOwnerUserId(ctx, ownerUserId);
});

triggers.register("publishers", async (ctx, change) => {
  const ownerPublisherId = change.operation === "delete" ? change.id : change.newDoc._id;
  await scheduleOwnerPublisherDigestSync(ctx, ownerPublisherId);
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
export { query, internalQuery, action, internalAction, httpAction };
