import { TEMPLATE_CATEGORY_DEFINITIONS } from "clawhub-schema/catalogMetadata";
import { getPluginDiscoveryExclusion } from "clawhub-schema/pluginCategories";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import {
  digestMatchesFilters,
  isTemplateCatalogPublisherAvailable,
  toPublicPackageListItem,
  type PackageDigestLike,
  type PublicPackageListItem,
} from "./lib/packageCatalogRead";
import { isEnglishPluginListing } from "./lib/pluginDiscovery";

// The overview replaces fourteen independently paginated category reads with
// one consistent public snapshot. Larger catalogs explicitly retain the paginated
// path rather than silently returning a partial popularity ranking.
export const get = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 8));
    const maximumRows = 1000;
    const [digests, badges] = await Promise.all([
      ctx.db
        .query("packageSearchDigest")
        .withIndex("by_active_family_channel_updated", (q) =>
          q.eq("softDeletedAt", undefined).eq("family", "claw"),
        )
        .order("desc")
        .take(maximumRows + 1),
      ctx.db
        .query("packageBadges")
        .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
        .order("desc")
        .take(maximumRows + 1),
    ]);
    if (digests.length > maximumRows || badges.length > maximumRows) {
      return { complete: false, featured: [], sections: [] };
    }
    const cache = {
      publishers: new Map<Id<"publishers">, Promise<Doc<"publishers"> | null>>(),
      officialPublishers: new Map<Id<"publishers">, Promise<boolean>>(),
    };
    const candidates = digests.filter((digest) => digestMatchesFilters(digest, {}));
    // Each projection may open several independent reads. Bound both phases well
    // below Convex's concurrent-I/O ceiling even at the full 1,000-row cap.
    const visible: PackageDigestLike[] = [];
    const items: PublicPackageListItem[] = [];
    const batchSize = 16;
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      const available = await Promise.all(
        batch.map((digest) => isTemplateCatalogPublisherAvailable(ctx, digest, cache.publishers)),
      );
      const selected = batch.filter((_, index) => available[index]);
      visible.push(...selected);
      items.push(
        ...(await Promise.all(
          selected.map((digest) => toPublicPackageListItem(ctx, digest, undefined, cache)),
        )),
      );
    }
    const byId = new Map(
      visible.map((digest, index) => [String(digest.packageId), { digest, item: items[index] }]),
    );
    const featured: PublicPackageListItem[] = [];
    for (const badge of badges) {
      const entry = byId.get(String(badge.packageId));
      if (
        !entry ||
        getPluginDiscoveryExclusion(entry.digest.categories) ||
        !isEnglishPluginListing(entry.digest)
      )
        continue;
      featured.push({ ...entry.item, featuredAt: badge.at });
      if (featured.length >= limit) break;
    }
    const ranked = [...items].sort(
      (left, right) =>
        right.stats.installs - left.stats.installs || left.name.localeCompare(right.name),
    );
    const sections = [...TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug }) => slug), "other"]
      .map((category) => ({
        category,
        items: ranked.filter((item) => item.categories?.includes(category)).slice(0, limit),
      }))
      .filter((section) => section.items.length > 0);
    return { complete: true, featured, sections };
  },
});
