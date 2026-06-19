import {
  getCatalogTopicSlugs,
  resolveCatalogTopics,
  resolveStoredPluginCategories,
} from "clawhub-schema";
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
  "icon",
  "stats",
  "recommendedScore",
  "recommendedScoreVersion",
  "runtimeId",
  "categories",
  "topics",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly SharedPackageKey[];

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
  "icon",
  "latestVersion",
  "runtimeId",
  "categories",
  "topics",
  "pluginCategoryTags",
  "verificationTier",
  "stats",
  "recommendedScore",
  "recommendedScoreVersion",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packagePluginCategorySearchDigest">)[];

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
  "icon",
  "latestVersion",
  "runtimeId",
  "categories",
  "topics",
  "pluginCategoryTags",
  "verificationTier",
  "stats",
  "recommendedScore",
  "recommendedScoreVersion",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"packageTopicSearchDigest">)[];

export type PackageSearchDigestFields = Pick<Doc<"packages">, (typeof SHARED_KEYS)[number]> & {
  packageId: Id<"packages">;
  latestVersion?: string;
  ownerHandle?: string;
  ownerKind?: "user" | "org";
  verificationTier?: Doc<"packageSearchDigest">["verificationTier"];
  pluginCategoryTags?: string[];
};

type PackagePluginCategorySearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof PLUGIN_CATEGORY_SHARED_KEYS)[number]
> & {
  pluginCategory: string;
};

type PackageTopicSearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof TOPIC_SHARED_KEYS)[number]
> & {
  topic: string;
};

export function extractPackageDigestFields(pkg: Doc<"packages">): PackageSearchDigestFields {
  const categories = resolveStoredPluginCategories(pkg);
  const inferenceCurrent =
    Boolean(pkg.latestReleaseId) && pkg.latestReleaseId === pkg.inferredFromReleaseId;
  return {
    ...pick(pkg, [...SHARED_KEYS]),
    categories,
    topics: resolveCatalogTopics({
      declared: pkg.topics,
      inferred: pkg.inferredTopics,
      inferenceCurrent,
    }),
    packageId: pkg._id,
    latestVersion: pkg.latestVersionSummary?.version,
    verificationTier: pkg.verification?.tier,
    pluginCategoryTags: categories,
  };
}

export async function upsertPackageSearchDigest(
  ctx: Pick<MutationCtx, "db">,
  fields: PackageSearchDigestFields,
) {
  const nextFields = fields;
  const existing = await ctx.db
    .query("packageSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", nextFields.packageId))
    .unique();
  if (existing) {
    const visibilityDelta = getPublicPluginVisibilityDelta(existing, nextFields);
    if (hasDigestChanged(existing, nextFields)) {
      await ctx.db.patch(existing._id, nextFields);
    }
    await syncPackagePluginCategorySearchDigests(ctx, nextFields);
    await syncPackageTopicSearchDigests(ctx, nextFields);
    await adjustGlobalPublicPluginsCount(ctx, visibilityDelta);
    return;
  }
  await ctx.db.insert("packageSearchDigest", nextFields);
  await syncPackagePluginCategorySearchDigests(ctx, nextFields);
  await syncPackageTopicSearchDigests(ctx, nextFields);
  await adjustGlobalPublicPluginsCount(ctx, getPublicPluginVisibilityDelta(null, nextFields));
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
  const topics = getCatalogTopicSlugs(fields.topics);
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
    .query("packagePluginCategorySearchDigest")
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
