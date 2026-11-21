import { getCatalogTopicSlugs, resolveCatalogTopics } from "clawhub-schema/catalogMetadata";
import { resolveStoredPluginCategories } from "clawhub-schema/pluginCategories";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { adjustGlobalPublicPluginsCount, getPublicPluginVisibilityDelta } from "./globalStats";
import { hasDigestChanged, reconcileSearchDigestRows } from "./searchDigestRows";

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

const FACET_SHARED_KEYS = [
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
] as const satisfies readonly Extract<
  keyof Doc<"packagePluginCategorySearchDigest">,
  keyof Doc<"packageTopicSearchDigest">
>[];

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
  (typeof FACET_SHARED_KEYS)[number]
> & {
  pluginCategory: string;
};

type PackageTopicSearchDigestFields = Pick<
  PackageSearchDigestFields,
  (typeof FACET_SHARED_KEYS)[number]
> & {
  topic: string;
};

export function extractPackageDigestFields(pkg: Doc<"packages">): PackageSearchDigestFields {
  const pluginCategoryTags =
    pkg.family === "code-plugin" || pkg.family === "bundle-plugin"
      ? resolveStoredPluginCategories(pkg)
      : [];
  // Template assignments use their own taxonomy; plugin normalization discards them.
  const categories = pkg.family === "claw" ? (pkg.categories ?? ["other"]) : pluginCategoryTags;
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
    pluginCategoryTags,
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
      ...pick(fields, [...FACET_SHARED_KEYS]),
      pluginCategory,
    });
  }
  await reconcileSearchDigestRows(
    ctx.db,
    "packagePluginCategorySearchDigest",
    existing,
    nextByCategory,
    (row) => row.pluginCategory,
  );
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
      ...pick(fields, [...FACET_SHARED_KEYS]),
      topic,
    });
  }
  await reconcileSearchDigestRows(
    ctx.db,
    "packageTopicSearchDigest",
    existing,
    nextByTopic,
    (row) => row.topic,
  );
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
