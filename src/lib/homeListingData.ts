import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { isSkillOfficial } from "./badges";
import { getSkillCategoriesForSkill } from "./categories";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";
import type { PublicSkill, PublicUser } from "./publicUser";

export type HomeListingKind = "skills" | "plugins";
export type HomeListingTab = "popular" | "trending" | "officials" | "new";

export type HomeSkillListingEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

export type HomeListingCacheEntry =
  | { kind: "skills"; items: HomeSkillListingEntry[]; hasMore: boolean }
  | { kind: "plugins"; items: PackageListItem[]; hasMore: boolean };

export type HomeListingInitialData = {
  kind: "skills";
  tab: "popular";
  categorySlugs: [];
  fetchLimit: typeof HOME_LISTING_PAGE_SIZE;
  items: HomeSkillListingEntry[];
  hasMore: boolean;
};

export const HOME_LISTING_PAGE_SIZE = 20;

const PLUGIN_CATALOG_PAGE_LIMIT = 100;

export function homeListingCacheKey({
  kind,
  tab,
  categorySlugs,
  fetchLimit,
}: {
  kind: HomeListingKind;
  tab: HomeListingTab;
  categorySlugs: readonly string[];
  fetchLimit: number;
}) {
  return ["listing", kind, tab, categoryCacheKey(categorySlugs), fetchLimit].join(":");
}

export function filterHomeSkillsByTab(entries: HomeSkillListingEntry[], tab: HomeListingTab) {
  if (tab === "officials") {
    return entries.filter((entry) => isSkillOfficial(entry.skill));
  }
  return entries;
}

export function filterHomePluginsByTab(items: PackageListItem[], tab: HomeListingTab) {
  if (tab === "officials") {
    return items.filter((item) => item.isOfficial);
  }
  return items;
}

export function isNewHomeSkillEligible(skill: PublicSkill) {
  return (
    !skill.isSuspicious &&
    skill.githubScanStatus !== "pending" &&
    skill.githubScanStatus !== "suspicious"
  );
}

export function itemMatchesAnyHomeCategory(
  item: { categories?: readonly string[] | null },
  categorySlugs: readonly string[],
) {
  if (categorySlugs.length === 0) return true;
  const categories = item.categories ?? [];
  return categorySlugs.some((slug) => categories.includes(slug));
}

export function skillMatchesAnyHomeCategory(skill: PublicSkill, categorySlugs: readonly string[]) {
  if (categorySlugs.length === 0) return true;
  const categories = getSkillCategoriesForSkill(skill);
  return categorySlugs.some((slug) => categories.some((category) => category.slug === slug));
}

export function uniqueHomeSkillEntries(entries: HomeSkillListingEntry[]) {
  const byId = new Map<string, HomeSkillListingEntry>();
  for (const entry of entries) {
    byId.set(String(entry.skill._id), entry);
  }
  return [...byId.values()];
}

export function uniqueHomePlugins(items: PackageListItem[]) {
  const byName = new Map<string, PackageListItem>();
  for (const item of items) {
    byName.set(item.name, item);
  }
  return [...byName.values()];
}

export function sortHomeSkillEntries(entries: HomeSkillListingEntry[], tab: HomeListingTab) {
  return [...entries].sort((left, right) => {
    if (tab === "new") {
      return (
        (right.skill.updatedAt ?? right.skill.createdAt ?? right.skill._creationTime ?? 0) -
        (left.skill.updatedAt ?? left.skill.createdAt ?? left.skill._creationTime ?? 0)
      );
    }
    return (right.skill.stats?.downloads ?? 0) - (left.skill.stats?.downloads ?? 0);
  });
}

export async function fetchHomeSkillListing(
  tab: HomeListingTab,
  categorySlugs: readonly string[],
  numItems: number,
) {
  if (tab === "trending") {
    const requestLimit = categorySlugs.length > 0 ? 200 : numItems;
    const result = await convexHttp.query(api.skills.listPublicTrendingPage, {
      limit: requestLimit,
    });
    const items = ((result as { items?: HomeSkillListingEntry[] }).items ?? []).filter((entry) =>
      skillMatchesAnyHomeCategory(entry.skill, categorySlugs),
    );
    return {
      page: uniqueHomeSkillEntries(items).slice(0, numItems),
      hasMore: items.length > numItems || (items.length >= numItems && numItems < 200),
    };
  }

  const categoriesToFetch = categorySlugs.length > 0 ? categorySlugs : [null];
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const page: HomeSkillListingEntry[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (page.length < numItems) {
        const result = await convexHttp.query(api.skills.listPublicPageV4, {
          cursor: cursor ?? undefined,
          numItems: numItems - page.length,
          sort: tab === "new" ? "newest" : "downloads",
          dir: "desc",
          officialFirst: tab === "officials" ? true : undefined,
          categorySlug: categorySlug ?? undefined,
        });
        if (Array.isArray(result)) break;

        const resultPage = ((result as { page?: HomeSkillListingEntry[] }).page ?? []).filter(
          (entry) =>
            skillMatchesAnyHomeCategory(entry.skill, categorySlugs) &&
            (tab !== "new" || isNewHomeSkillEligible(entry.skill)),
        );
        page.push(...resultPage);

        const nextCursor = (result as { nextCursor?: string | null }).nextCursor ?? null;
        hasMore = Boolean((result as { hasMore?: boolean }).hasMore ?? nextCursor);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      return { page, hasMore };
    }),
  );
  const pages = results.flatMap((result) => result.page);
  const sorted = sortHomeSkillEntries(
    filterHomeSkillsByTab(uniqueHomeSkillEntries(pages), tab),
    tab,
  );
  const hasMore = sorted.length > numItems || results.some((result) => result.hasMore);
  const page = sorted.slice(0, numItems);
  return { page, hasMore };
}

export async function fetchHomePluginListing(
  tab: HomeListingTab,
  categorySlugs: readonly string[],
  limit: number,
  signal?: AbortSignal,
) {
  const openClawOfficials = tab === "officials";
  const categoriesToFetch = categorySlugs.length > 0 ? categorySlugs : [null];
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const items: PackageListItem[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (items.length < limit) {
        const result = await fetchPluginCatalog({
          category: categorySlug ?? undefined,
          cursor: cursor ?? undefined,
          isOfficial: openClawOfficials ? true : undefined,
          excludedScanStatuses: tab === "new" ? ["pending", "suspicious"] : undefined,
          sort: tab === "new" ? "updated" : "downloads",
          limit: Math.min(limit - items.length, PLUGIN_CATALOG_PAGE_LIMIT),
          signal,
        });
        items.push(
          ...result.items.filter((item) => itemMatchesAnyHomeCategory(item, categorySlugs)),
        );

        hasMore = result.nextCursor != null;
        if (!result.nextCursor || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }

      return { items, hasMore };
    }),
  );
  let items = uniqueHomePlugins(results.flatMap((result) => result.items));
  items = filterHomePluginsByTab(items, tab);
  if (tab === "new") {
    items.sort((a, b) => b.updatedAt - a.updatedAt);
  } else if (tab === "popular" || openClawOfficials) {
    items.sort((a, b) => (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0));
  }
  const page = items.slice(0, limit);
  return {
    items: page,
    hasMore: items.length > limit || results.some((result) => result.hasMore),
  };
}

export async function fetchInitialHomeListing(): Promise<HomeListingInitialData> {
  const result = await fetchHomeSkillListing("popular", [], HOME_LISTING_PAGE_SIZE);
  return {
    kind: "skills",
    tab: "popular",
    categorySlugs: [],
    fetchLimit: HOME_LISTING_PAGE_SIZE,
    items: result.page,
    hasMore: result.hasMore,
  };
}

function categoryCacheKey(categorySlugs: readonly string[]) {
  if (categorySlugs.length === 0) return "all";
  return [...categorySlugs].sort().join(",");
}
