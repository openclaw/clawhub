import type { PackageChannel, PluginCategorySlug } from "clawhub-schema";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  MAX_PUBLIC_LIST_PAGE_SIZE,
  MAX_PUBLIC_LIST_FILTER_SCAN_DOCUMENTS,
  canViewerReadPackage,
  digestMatchesSearchFilters,
  getPackageByNormalizedName,
  toPublicPackageListItem,
  type PackageDigestLike,
  type PublicPackageListPage,
  type PackageListScanStatus,
} from "./packageCatalogRead";
import { getPluginDiscoveryPins, isEnglishPluginListing } from "./pluginDiscovery";
import type { StoredPackageFamily } from "./templateStorage";

type DbReaderCtx = Pick<QueryCtx | MutationCtx, "db">;
type PackageFamily = StoredPackageFamily;

type CuratedCategoryArgs = {
  category: PluginCategorySlug;
  englishOnly?: boolean;
  family?: PackageFamily;
  channel?: PackageChannel;
  isOfficial?: boolean;
  topic?: string;
  excludedScanStatuses?: PackageListScanStatus[];
  paginationOpts: { cursor: string | null; numItems: number };
};

type CuratedCategoryCursor = {
  scope: string;
  pinOffset: number;
  downloads?: number | null;
  name?: string;
};

export async function listCuratedPluginCategoryPage(
  ctx: DbReaderCtx,
  args: CuratedCategoryArgs,
): Promise<PublicPackageListPage> {
  const scope = JSON.stringify([
    args.category,
    args.family,
    args.channel,
    args.isOfficial,
    args.topic,
    args.excludedScanStatuses,
    args.englishOnly ?? false,
  ]);
  let state: CuratedCategoryCursor = { scope, pinOffset: 0 };
  if (args.paginationOpts.cursor) {
    try {
      const value = JSON.parse(decodeURIComponent(atob(args.paginationOpts.cursor)));
      if (
        value.scope !== scope ||
        !Number.isSafeInteger(value.pinOffset) ||
        value.pinOffset < 0 ||
        (value.downloads !== undefined &&
          value.downloads !== null &&
          (typeof value.downloads !== "number" ||
            !Number.isFinite(value.downloads) ||
            value.downloads < 0)) ||
        (value.name !== undefined && typeof value.name !== "string")
      )
        throw new Error();
      state = value;
    } catch {
      throw new ConvexError("Invalid curated category cursor");
    }
  }
  const targetCount = Math.max(
    1,
    Math.min(args.paginationOpts.numItems, MAX_PUBLIC_LIST_PAGE_SIZE),
  );
  const pins = getPluginDiscoveryPins(args.category);
  const pinNames = new Set(pins);
  const page: PackageDigestLike[] = [];
  const membershipCache = new Map<string, Promise<boolean>>();
  const eligible = async (digest: PackageDigestLike) =>
    (digest.family === "code-plugin" || digest.family === "bundle-plugin") &&
    digestMatchesSearchFilters(digest, args) &&
    (!args.englishOnly || isEnglishPluginListing(digest)) &&
    (await canViewerReadPackage(ctx, digest, undefined, membershipCache));
  // Finish ordered selection before loading independent publisher and stat data.
  // Promise.all preserves that order while overlapping the bounded card reads.
  const result = async (isDone: boolean): Promise<PublicPackageListPage> => ({
    page: await Promise.all(page.map((digest) => toPublicPackageListItem(ctx, digest))),
    isDone,
    continueCursor: isDone ? "" : btoa(encodeURIComponent(JSON.stringify(state))),
  });

  // Resolve pins by canonical identity before taking the top N. A downloaded tail
  // cannot crowd them out, and missing/private/blocked pins consume no visible slot.
  while (state.pinOffset < pins.length && page.length < targetCount) {
    const name = pins[state.pinOffset++];
    const pkg = await getPackageByNormalizedName(ctx, name);
    if (!pkg) continue;
    const digest = await ctx.db
      .query("packageSearchDigest")
      .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
      .unique();
    if (digest && (await eligible(digest))) page.push(digest);
  }
  if (page.length >= targetCount) return result(false);

  // Walk one download-count group at a time: downloads descend, canonical names
  // ascend even across page boundaries. The bounded scan also advances over
  // ineligible rows, so a sparse category can backfill without repeating a page.
  let remaining = MAX_PUBLIC_LIST_FILTER_SCAN_DOCUMENTS;
  while (page.length < targetCount && remaining > 0) {
    if (!state.name) {
      const next = await ctx.db
        .query("packagePluginCategorySearchDigest")
        .withIndex("by_active_category_downloads_name", (q) => {
          const range = q.eq("softDeletedAt", undefined).eq("pluginCategory", args.category);
          return state.downloads === undefined
            ? range
            : range.lt("stats.downloads", state.downloads ?? undefined);
        })
        .order("desc")
        .first();
      if (!next) return result(true);
      state.downloads = next.stats?.downloads ?? null;
      state.name = "";
    }
    const rows = await ctx.db
      .query("packagePluginCategorySearchDigest")
      .withIndex("by_active_category_downloads_name", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("pluginCategory", args.category)
          .eq("stats.downloads", state.downloads ?? undefined)
          .gt("name", state.name!),
      )
      .order("asc")
      .take(Math.min(remaining, Math.max(targetCount - page.length, 20)));
    if (rows.length === 0) {
      delete state.name;
      continue;
    }
    for (const digest of rows) {
      remaining -= 1;
      state.name = digest.name;
      if (!pinNames.has(digest.name) && (await eligible(digest))) page.push(digest);
      if (page.length >= targetCount) return result(false);
    }
  }
  return result(false);
}

export async function listPluginOverviewCategory(
  ctx: DbReaderCtx,
  args: { category: PluginCategorySlug; numItems: number },
) {
  if (args.category === "other") return [];
  return (
    await listCuratedPluginCategoryPage(ctx, {
      category: args.category,
      englishOnly: true,
      paginationOpts: { cursor: null, numItems: args.numItems },
    })
  ).page;
}
