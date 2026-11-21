import { getCatalogTopicSlugs } from "clawhub-schema/catalogMetadata";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { adjustGlobalPublicPluginsCount } from "./globalStats";
import {
  extractPackageFacetFields,
  type PackageSearchDigestFields,
} from "./packageSearchDigestProjection";
import { getPublicPluginVisibilityDelta } from "./packageSecurity";
import { hasDigestChanged, reconcileSearchDigestRows } from "./searchDigestRows";

type PackagePluginCategorySearchDigestFields = ReturnType<typeof extractPackageFacetFields> & {
  pluginCategory: string;
};

type PackageTopicSearchDigestFields = ReturnType<typeof extractPackageFacetFields> & {
  topic: string;
};

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
      ...extractPackageFacetFields(fields),
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
      ...extractPackageFacetFields(fields),
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
