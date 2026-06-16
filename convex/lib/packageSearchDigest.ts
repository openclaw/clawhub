import { resolvePluginPrimaryCategory } from "clawhub-schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { adjustGlobalPublicPluginsCount, getPublicPluginVisibilityDelta } from "./globalStats";

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
  "primaryCategory",
  "topics",
  "executesCode",
  "stats",
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
  "primaryCategory",
  "topics",
  "executesCode",
  "verificationTier",
  "stats",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packageCapabilitySearchDigest">)[];

const TOPIC_SHARED_KEYS = [
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
  "primaryCategory",
  "topics",
  "pluginCategoryTags",
  "executesCode",
  "verificationTier",
  "stats",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packageTopicSearchDigest">)[];

const PLUGIN_CATEGORY_SHARED_KEYS = [
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
  "primaryCategory",
  "topics",
  "pluginCategoryTags",
  "executesCode",
  "verificationTier",
  "stats",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packagePluginCategorySearchDigest">)[];

export type PackageSearchDigestFields = Pick<Doc<"packages">, (typeof SHARED_KEYS)[number]> & {
  packageId: Id<"packages">;
  latestVersion?: string;
  ownerHandle?: string;
  ownerKind?: "user" | "org";
  verificationTier?: Doc<"packageSearchDigest">["verificationTier"];
  pluginCategoryTags?: string[];
};

type PackageCapabilitySearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof CAPABILITY_SHARED_KEYS)[number]
> & {
  capabilityTag: string;
};

type PackageTopicSearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof TOPIC_SHARED_KEYS)[number]
> & {
  topic: string;
};

type PackagePluginCategorySearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof PLUGIN_CATEGORY_SHARED_KEYS)[number]
> & {
  pluginCategory: string;
};

export function extractPackageDigestFields(pkg: Doc<"packages">): PackageSearchDigestFields {
  const primaryCategory = resolvePluginPrimaryCategory(pkg);
  return {
    ...pick(pkg, [...SHARED_KEYS]),
    packageId: pkg._id,
    latestVersion: pkg.latestVersionSummary?.version,
    verificationTier: pkg.verification?.tier,
    pluginCategoryTags: primaryCategory ? [primaryCategory] : [],
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
    const visibilityDelta = getPublicPluginVisibilityDelta(existing, fields);
    if (hasDigestChanged(existing, fields)) {
      await ctx.db.patch(existing._id, fields);
    }
    await syncPackageCapabilitySearchDigests(ctx, fields);
    await syncPackageTopicSearchDigests(ctx, fields);
    await syncPackagePluginCategorySearchDigests(ctx, fields);
    await adjustGlobalPublicPluginsCount(ctx, visibilityDelta);
    return;
  }
  await ctx.db.insert("packageSearchDigest", fields);
  await syncPackageCapabilitySearchDigests(ctx, fields);
  await syncPackageTopicSearchDigests(ctx, fields);
  await syncPackagePluginCategorySearchDigests(ctx, fields);
  await adjustGlobalPublicPluginsCount(ctx, getPublicPluginVisibilityDelta(null, fields));
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

async function syncPackagePluginCategorySearchDigests(
  ctx: Pick<MutationCtx, "db">,
  fields: PackageSearchDigestFields,
) {
  const existing = await ctx.db
    .query("packagePluginCategorySearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", fields.packageId))
    .collect();
  const categories = [...new Set((fields.pluginCategoryTags ?? []).filter(Boolean))];
  const nextByCategory = new Map<string, PackagePluginCategorySearchDigestFields>();
  for (const pluginCategory of categories) {
    nextByCategory.set(pluginCategory, {
      ...pick(fields, [...PLUGIN_CATEGORY_SHARED_KEYS]),
      pluginCategory,
    });
  }
  for (const row of existing) {
    const next = nextByCategory.get(row.pluginCategory);
    if (!next) {
      await ctx.db.delete(row._id);
      continue;
    }
    if (!hasDigestChanged(row, next)) {
      nextByCategory.delete(row.pluginCategory);
      continue;
    }
    await ctx.db.patch(row._id, next);
    nextByCategory.delete(row.pluginCategory);
  }
  for (const next of nextByCategory.values()) {
    await ctx.db.insert("packagePluginCategorySearchDigest", next);
  }
}

async function syncPackageTopicSearchDigests(
  ctx: Pick<MutationCtx, "db">,
  fields: PackageSearchDigestFields,
) {
  const existing = await ctx.db
    .query("packageTopicSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", fields.packageId))
    .collect();
  const topics = [...new Set((fields.topics ?? []).filter(Boolean))];
  const nextByTopic = new Map<string, PackageTopicSearchDigestFields>();
  for (const topic of topics) {
    nextByTopic.set(topic, {
      ...pick(fields, [...TOPIC_SHARED_KEYS]),
      topic,
    });
  }
  for (const row of existing) {
    const next = nextByTopic.get(row.topic);
    if (!next) {
      await ctx.db.delete(row._id);
      continue;
    }
    if (!hasDigestChanged(row, next)) {
      nextByTopic.delete(row.topic);
      continue;
    }
    await ctx.db.patch(row._id, next);
    nextByTopic.delete(row.topic);
  }
  for (const next of nextByTopic.values()) {
    await ctx.db.insert("packageTopicSearchDigest", next);
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
  if (existing) {
    await adjustGlobalPublicPluginsCount(ctx, getPublicPluginVisibilityDelta(existing, null));
    await ctx.db.delete(existing._id);
  }
  for (const row of await ctx.db
    .query("packageCapabilitySearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", packageId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("packageTopicSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", packageId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("packagePluginCategorySearchDigest")
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
