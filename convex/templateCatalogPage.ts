import { isTemplateCategoryFilterSlug } from "clawhub-schema/catalogMetadata";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { matchCatalogText } from "./lib/catalogTextMatch";
import {
  isTemplateCatalogPublisherAvailable,
  toPublicPackageListItemFromPackage,
} from "./lib/packageCatalogRead";
import { isPublishedPackageRelease } from "./lib/packageReleaseVisibility";
import { extractPackageDigestFields } from "./lib/packageSearchDigest";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { compareRankedSearchKeys, rankedSearchKey, verificationRank } from "./lib/searchRanking";
import {
  badPage,
  tooBroad,
  MAX_TEMPLATE_CANDIDATES,
  encodeRankedCursor,
  decodeRankedCursor,
  type RankedFilters,
} from "./lib/templateRankedCursor";

// Keep independent point reads below Convex's in-flight syscall limit.
const BATCH = 16;
type PublisherCache = Map<Id<"publishers">, Promise<Doc<"publishers"> | null>>;
async function eligible(
  ctx: QueryCtx,
  pkg: Doc<"packages"> | null,
  filters: RankedFilters,
  publishers: PublisherCache,
) {
  if (!pkg || pkg.family !== "claw" || !pkg.latestReleaseId || !pkg.ownerPublisherId) return null;
  const digest = extractPackageDigestFields(pkg);
  if (
    pkg.softDeletedAt !== undefined ||
    pkg.channel === "private" ||
    isPackageBlockedFromPublic(pkg.scanStatus) ||
    (filters.category && !digest.categories?.includes(filters.category))
  )
    return null;
  if (!(await isTemplateCatalogPublisherAvailable(ctx, pkg, publishers))) return null;
  const owner = await publishers.get(pkg.ownerPublisherId);
  const match = filters.q
    ? matchCatalogText(
        {
          name: pkg.normalizedName,
          displayName: pkg.displayName,
          summary: pkg.summary,
          runtimeId: pkg.runtimeId,
          ownerHandle: owner?.handle,
          categories: digest.pluginCategoryTags,
          topics: digest.topics,
        },
        filters.q,
      )
    : { score: 0, rankTier: 0 };
  if (!match) return null;
  const [release, badge] = await Promise.all([
    ctx.db.get(pkg.latestReleaseId),
    ctx.db
      .query("packageBadges")
      .withIndex("by_package_kind", (q) => q.eq("packageId", pkg._id).eq("kind", "highlighted"))
      .unique(),
  ]);
  if (
    !isPublishedPackageRelease(release, pkg._id) ||
    isPackageBlockedFromPublic(resolvePackageReleaseScanStatus(release))
  )
    return null;
  const key = rankedSearchKey(match, {
    isOfficial: pkg.isOfficial,
    featured: Boolean(badge),
    verificationTier: pkg.verification?.tier,
    downloads: pkg.stats.downloads,
    installs: pkg.stats.installs,
  });
  return {
    pkg,
    key,
    latestVersion: release.version,
    featuredAt: badge?.at,
    categories: digest.categories,
    topics: digest.topics,
  };
}
type Candidate = NonNullable<Awaited<ReturnType<typeof eligible>>>;
function compareRelevance(a: Candidate, b: Candidate) {
  return (
    compareRankedSearchKeys(a.key, b.key) ||
    Number(b.pkg.isOfficial) - Number(a.pkg.isOfficial) ||
    verificationRank(b.pkg.verification?.tier) - verificationRank(a.pkg.verification?.tier) ||
    b.pkg.stats.stars - a.pkg.stats.stars ||
    b.pkg.stats.installs - a.pkg.stats.installs ||
    b.pkg.stats.downloads - a.pkg.stats.downloads ||
    b.pkg.updatedAt - a.pkg.updatedAt ||
    a.pkg.name.localeCompare(b.pkg.name)
  );
}

export const get = query({
  args: {
    q: v.optional(v.string()),
    category: v.optional(v.string()),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const filters = {
      q: args.q?.trim().toLowerCase() ?? "",
      category: args.category ?? "",
      limit: args.limit,
    };
    if (
      (!filters.q && !filters.category) ||
      filters.q.length > 256 ||
      (args.category !== undefined && !isTemplateCategoryFilterSlug(args.category)) ||
      !Number.isInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > 100
    )
      return badPage();
    const publishers: PublisherCache = new Map();
    const selected: Candidate[] = [];
    let remaining: string[];
    if (args.cursor !== undefined) {
      const names = decodeRankedCursor(args.cursor, filters);
      let index = 0;
      while (index < names.length && selected.length < args.limit) {
        const part = names.slice(index, index + Math.min(BATCH, args.limit - selected.length));
        index += part.length;
        const candidates = await Promise.all(
          part.map(async (name) =>
            eligible(
              ctx,
              await ctx.db
                .query("packages")
                .withIndex("by_name", (q) => q.eq("normalizedName", name))
                .unique(),
              filters,
              publishers,
            ),
          ),
        );
        for (const candidate of candidates) if (candidate) selected.push(candidate);
      }
      remaining = names.slice(index);
    } else {
      // One family-bounded native B-tree read; unlike the general package search,
      // these existing rows need no index bootstrap, backfill, or lexical rerun.
      const rows = await ctx.db
        .query("packages")
        .withIndex("by_active_family_installs", (q) =>
          q.eq("softDeletedAt", undefined).eq("family", "claw"),
        )
        .take(MAX_TEMPLATE_CANDIDATES + 1);
      if (rows.length > MAX_TEMPLATE_CANDIDATES) return tooBroad();
      const candidates: Candidate[] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = await Promise.all(
          rows.slice(i, i + BATCH).map((pkg) => eligible(ctx, pkg, filters, publishers)),
        );
        for (const c of batch) if (c) candidates.push(c);
      }
      candidates.sort(
        filters.category
          ? (a, b) =>
              b.pkg.stats.installs - a.pkg.stats.installs || a.pkg.name.localeCompare(b.pkg.name)
          : compareRelevance,
      );
      selected.push(...candidates.slice(0, args.limit));
      remaining = candidates.slice(args.limit).map((c) => c.pkg.normalizedName);
    }
    const items = [];
    for (let i = 0; i < selected.length; i += BATCH) {
      items.push(
        ...(await Promise.all(
          selected.slice(i, i + BATCH).map(async (c) => ({
            ...(await toPublicPackageListItemFromPackage(ctx, c.pkg)),
            latestVersion: c.latestVersion,
            categories: c.categories,
            topics: c.topics,
            ...(c.featuredAt === undefined ? {} : { featuredAt: c.featuredAt }),
          })),
        )),
      );
    }
    return { items, nextCursor: encodeRankedCursor(remaining, filters) };
  },
});
