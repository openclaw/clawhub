import { isTemplateCategoryFilterSlug } from "clawhub-schema/catalogMetadata";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { matchCatalogText } from "./lib/catalogTextMatch";
import {
  isTemplateCatalogPublisherAvailable,
  toPublicPackageListItemFromPackage,
} from "./lib/packageCatalogRead";
import { extractPackageDigestFields } from "./lib/packageSearchDigest";
import { isPackageBlockedFromPublic } from "./lib/packageSecurity";
import { compareRankedSearchKeys, rankedSearchKey, verificationRank } from "./lib/searchRanking";
import {
  badPage,
  tooBroad,
  encodeRankedCursor,
  decodeRankedCursor,
  type RankedFilters,
  type RankedRef,
} from "./lib/templateRankedCursor";
import { isRankedReleasePublic } from "./lib/templateRankProjection";

const BATCH = 16;
const INDEX_BATCH = 256;
const MAX_PAGE_LOOKUPS = 512; // per-request stale/forged reference work, not result cardinality
type PublisherCache = Map<Id<"publishers">, Promise<Doc<"publishers"> | null>>;
type Fields = Pick<
  Doc<"packageSearchDigest">,
  | "name"
  | "normalizedName"
  | "family"
  | "displayName"
  | "runtimeId"
  | "summary"
  | "categories"
  | "topics"
  | "pluginCategoryTags"
  | "ownerPublisherId"
  | "stats"
  | "channel"
  | "scanStatus"
  | "softDeletedAt"
  | "verificationTier"
  | "isOfficial"
  | "updatedAt"
>;
async function rank(
  ctx: QueryCtx,
  row: Fields,
  filters: RankedFilters,
  publishers: PublisherCache,
  featured: boolean,
) {
  if (
    row.family !== "claw" ||
    !row.stats ||
    !row.ownerPublisherId ||
    row.softDeletedAt !== undefined ||
    row.channel === "private" ||
    isPackageBlockedFromPublic(row.scanStatus) ||
    (filters.category && !row.categories?.includes(filters.category))
  )
    return null;
  // Publisher ownership/liveness can change ahead of its asynchronous digest refresh.
  if (!(await isTemplateCatalogPublisherAvailable(ctx, row, publishers))) return null;
  const owner = await publishers.get(row.ownerPublisherId);
  const match = filters.q
    ? matchCatalogText(
        {
          name: row.normalizedName,
          displayName: row.displayName,
          summary: row.summary,
          runtimeId: row.runtimeId,
          ownerHandle: owner?.handle,
          categories: row.pluginCategoryTags,
          topics: row.topics,
        },
        filters.q,
      )
    : { score: 0, rankTier: 0 };
  if (!match) return null;
  return {
    name: row.name,
    official: row.isOfficial,
    tier: verificationRank(row.verificationTier),
    stars: row.stats.stars,
    installs: row.stats.installs,
    downloads: row.stats.downloads,
    updatedAt: row.updatedAt,
    key: rankedSearchKey(match, {
      isOfficial: row.isOfficial,
      featured,
      verificationTier: row.verificationTier,
      downloads: row.stats.downloads,
      installs: row.stats.installs,
    }),
  };
}
type Rank = NonNullable<Awaited<ReturnType<typeof rank>>>;
function compare(a: Rank, b: Rank, category: string) {
  if (category) return b.installs - a.installs || a.name.localeCompare(b.name);
  return (
    compareRankedSearchKeys(a.key, b.key) ||
    Number(b.official) - Number(a.official) ||
    b.tier - a.tier ||
    b.stars - a.stars ||
    b.installs - a.installs ||
    b.downloads - a.downloads ||
    b.updatedAt - a.updatedAt ||
    a.name.localeCompare(b.name)
  );
}
async function live(
  ctx: QueryCtx,
  pkg: Doc<"packages"> | null,
  filters: RankedFilters,
  publishers: PublisherCache,
) {
  if (!pkg || pkg.family !== "claw" || !pkg.latestReleaseId) return null;
  const fields = extractPackageDigestFields(pkg);
  const order = await rank(ctx, fields, filters, publishers, false);
  if (!order) return null;
  const [release, badge] = await Promise.all([
    ctx.db.get(pkg.latestReleaseId),
    ctx.db
      .query("packageBadges")
      .withIndex("by_package_kind", (q) => q.eq("packageId", pkg._id).eq("kind", "highlighted"))
      .unique(),
  ]);
  if (!release || !isRankedReleasePublic(release, pkg)) return null;
  const boosted = badge ? await rank(ctx, fields, filters, publishers, true) : order;
  if (!boosted) return null;
  return {
    order: boosted,
    pkg,
    latestVersion: release.version,
    featuredAt: badge?.at,
    categories: fields.categories,
    topics: fields.topics,
  };
}
type Live = NonNullable<Awaited<ReturnType<typeof live>>>;
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
    const owners: PublisherCache = new Map();
    const known = new Map<RankedRef, Id<"packages">>();
    const authorized = new Map<RankedRef, Live>();
    let refs: RankedRef[];
    if (args.cursor !== undefined) {
      refs = decodeRankedCursor(args.cursor, filters);
      // A deployed v1 cursor, or a mixed-rollout page, can still contain names.
      // Never echo an unverified name in a new cursor, even if the client supplied it.
      const legacy = refs.filter((ref): ref is string => typeof ref === "string");
      for (let i = 0; i < legacy.length; i += BATCH) {
        await Promise.all(
          legacy.slice(i, i + BATCH).map(async (name) => {
            const pkg = await ctx.db
              .query("packages")
              .withIndex("by_name", (q) => q.eq("normalizedName", name))
              .unique();
            const item = await live(ctx, pkg, filters, owners);
            if (item) authorized.set(name, item);
          }),
        );
      }
      refs = refs.filter((ref) => typeof ref === "number" || authorized.has(ref));
    } else {
      const ranked: { order: Rank; ref: RankedRef }[] = [];
      // Only currently certified public rank rows have positive tickets. Chunk a native
      // index by its unique monotone key, not by a ceiling on the entire Template family.
      let after = 0;
      while (true) {
        const rows = await ctx.db
          .query("packageSearchDigest")
          .withIndex("by_template_rank_ticket", (q) => q.gt("templateRankTicket", after))
          .take(INDEX_BATCH);
        for (let i = 0; i < rows.length; i += BATCH) {
          await Promise.all(
            rows.slice(i, i + BATCH).map(async (row) => {
              const ticket = row.templateRankTicket!;
              const order = await rank(
                ctx,
                row,
                filters,
                owners,
                row.templateFeaturedAt !== undefined,
              );
              if (order) {
                ranked.push({ order, ref: ticket });
                known.set(ticket, row.packageId);
              }
            }),
          );
        }
        if (rows.length < INDEX_BATCH) break;
        after = rows[rows.length - 1].templateRankTicket!;
      }
      // Mixed-version rollouts and imports without a digest remain complete. This range
      // becomes empty after the optional bounded backfill; never infer publication from a version summary.
      const gaps = ctx.db
        .query("packages")
        .withIndex("by_family_rank_coverage", (q) =>
          q
            .eq("family", "claw")
            .eq("templateRankIndexed", undefined)
            .eq("softDeletedAt", undefined),
        );
      for await (const pkg of gaps) {
        const item = await live(ctx, pkg, filters, owners);
        if (item) {
          const ref = pkg.normalizedName;
          ranked.push({ order: item.order, ref });
          authorized.set(ref, item);
        }
      }
      ranked.sort((a, b) => compare(a.order, b.order, filters.category));
      refs = ranked.map((entry) => entry.ref);
    }
    const selected: Live[] = [];
    let pos = 0;
    while (pos < refs.length && selected.length < args.limit) {
      if (pos >= MAX_PAGE_LOOKUPS) return tooBroad();
      const batch = refs.slice(
        pos,
        pos + Math.min(BATCH, args.limit - selected.length, MAX_PAGE_LOOKUPS - pos),
      );
      pos += batch.length;
      const results = await Promise.all(
        batch.map(async (ref) => {
          const cached = authorized.get(ref);
          if (cached) return cached;
          let pkg: Doc<"packages"> | null;
          if (typeof ref === "string")
            pkg = await ctx.db
              .query("packages")
              .withIndex("by_name", (q) => q.eq("normalizedName", ref))
              .unique();
          else {
            const id =
              known.get(ref) ??
              (
                await ctx.db
                  .query("packageSearchDigest")
                  .withIndex("by_template_rank_ticket", (q) => q.eq("templateRankTicket", ref))
                  .unique()
              )?.packageId;
            pkg = id ? await ctx.db.get(id) : null;
          }
          return live(ctx, pkg, filters, owners);
        }),
      );
      for (const item of results) if (item) selected.push(item);
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
    return { items, nextCursor: encodeRankedCursor(refs.slice(pos), filters) };
  },
});
