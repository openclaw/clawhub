import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, obj[key]])) as Pick<T, K>;
}

const SHARED_KEYS = [
  "name",
  "normalizedName",
  "displayName",
  "family",
  "channel",
  "isOfficial",
  "ownerUserId",
  "ownerPublisherId",
  "summary",
  "capabilityTags",
  "executesCode",
  "runtimeId",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packages"> & keyof Doc<"packageSearchDigest">)[];

const CAPABILITY_SHARED_KEYS = [
  "packageId",
  "name",
  "normalizedName",
  "displayName",
  "family",
  "channel",
  "isOfficial",
  "ownerUserId",
  "ownerPublisherId",
  "ownerHandle",
  "ownerKind",
  "summary",
  "latestVersion",
  "runtimeId",
  "capabilityTags",
  "executesCode",
  "verificationTier",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packageCapabilitySearchDigest">)[];

export type PackageSearchDigestFields = Pick<Doc<"packages">, (typeof SHARED_KEYS)[number]> & {
  packageId: Id<"packages">;
  latestVersion?: string;
  ownerHandle?: string;
  ownerKind?: "user" | "org";
  verificationTier?: Doc<"packageSearchDigest">["verificationTier"];
};

type PackageCapabilitySearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof CAPABILITY_SHARED_KEYS)[number]
> & {
  capabilityTag: string;
};

export function extractPackageDigestFields(pkg: Doc<"packages">): PackageSearchDigestFields {
  return {
    ...pick(pkg, [...SHARED_KEYS]),
    packageId: pkg._id,
    latestVersion: pkg.latestVersionSummary?.version,
    verificationTier: pkg.verification?.tier,
  };
}

export async function upsertPackageSearchDigest(
  ctx: Pick<MutationCtx, "db">,
  fields: PackageSearchDigestFields,
) {
  const existing = await ctx.db
    .query("packageSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", fields.packageId))
    .unique();
  if (existing) {
    if (hasDigestChanged(existing, fields)) {
      await ctx.db.patch(existing._id, fields);
    }
    await syncPackageCapabilitySearchDigests(ctx, fields);
    return;
  }
  await ctx.db.insert("packageSearchDigest", fields);
  await syncPackageCapabilitySearchDigests(ctx, fields);
}

async function syncPackageCapabilitySearchDigests(
  ctx: Pick<MutationCtx, "db">,
  fields: PackageSearchDigestFields,
) {
  const existing = await ctx.db
    .query("packageCapabilitySearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", fields.packageId))
    .collect();
  const tags = [...new Set((fields.capabilityTags ?? []).filter(Boolean))];
  const nextByTag = new Map<string, PackageCapabilitySearchDigestFields>();
  for (const capabilityTag of tags) {
    nextByTag.set(capabilityTag, {
      ...pick(fields, [...CAPABILITY_SHARED_KEYS]),
      capabilityTag,
    });
  }
  for (const row of existing) {
    const next = nextByTag.get(row.capabilityTag);
    if (!next) {
      await ctx.db.delete(row._id);
      continue;
    }
    if (!hasDigestChanged(row, next)) {
      nextByTag.delete(row.capabilityTag);
      continue;
    }
    await ctx.db.patch(row._id, next);
    nextByTag.delete(row.capabilityTag);
  }
  for (const next of nextByTag.values()) {
    await ctx.db.insert("packageCapabilitySearchDigest", next);
  }
}

export async function deletePackageSearchDigests(
  ctx: Pick<MutationCtx, "db">,
  packageId: Id<"packages">,
) {
  const existing = await ctx.db
    .query("packageSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", packageId))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
  for (const row of await ctx.db
    .query("packageCapabilitySearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", packageId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
}

function hasDigestChanged<
  TExisting extends Record<string, unknown>,
  TFields extends Record<string, unknown>,
>(existing: TExisting, fields: TFields): boolean {
  for (const key of Object.keys(fields)) {
    const oldValue = (existing as Record<string, unknown>)[key];
    const newValue = (fields as Record<string, unknown>)[key];
    if (oldValue === newValue) continue;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) return true;
  }
  return false;
}
