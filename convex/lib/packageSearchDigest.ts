import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, obj[key]])) as Pick<T, K>;
}

type SharedPackageKey = Extract<keyof Doc<"packages">, keyof Doc<"packageSearchDigest">>;

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
] as const satisfies readonly SharedPackageKey[];

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
  clawpackAvailable?: boolean;
  hostTargetKeys?: string[];
  environmentFlags?: string[];
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

export function extractPackageClawPackDigestFields(
  release: Doc<"packageReleases"> | null | undefined,
): Pick<PackageSearchDigestFields, "clawpackAvailable" | "hostTargetKeys" | "environmentFlags"> {
  if (!release || release.softDeletedAt || release.clawpackRevokedAt) {
    return {
      clawpackAvailable: false,
      hostTargetKeys: [],
      environmentFlags: [],
    };
  }
  return {
    clawpackAvailable: Boolean(release.clawpackStorageId),
    hostTargetKeys: getPackageClawPackHostTargetKeys(release),
    environmentFlags: getPackageClawPackEnvironmentFlags(release),
  };
}

export function getPackageClawPackHostTargetKeys(release: Doc<"packageReleases">) {
  return [
    ...new Set(
      (release.hostTargetsSummary ?? []).map((target) =>
        [target.os, target.arch, target.libc].filter(Boolean).join("-"),
      ),
    ),
  ];
}

export function getPackageClawPackEnvironmentFlags(release: Doc<"packageReleases">) {
  const environment = release.environmentSummary;
  const flags = [
    environment?.requiresLocalDesktop ? "desktop" : null,
    environment?.requiresBrowser ? "browser" : null,
    environment?.requiresAudioDevice ? "audio" : null,
    environment?.requiresNetwork ? "network" : null,
    environment?.supportsRemoteHost ? "remote-host" : null,
    ...(environment?.requiresExternalServices ?? []).map((service) => `service:${service}`),
    ...(environment?.requiresOsPermissions ?? []).map((permission) => `permission:${permission}`),
    ...(environment?.knownUnsupported ?? []).map((target) => `unsupported:${target}`),
  ].filter((flag): flag is string => Boolean(flag));
  return [...new Set(flags)];
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

function hasDigestChanged(
  existing: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(fields)) {
    const oldValue = existing[key];
    const newValue = fields[key];
    if (oldValue === newValue) continue;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) return true;
  }
  return false;
}
