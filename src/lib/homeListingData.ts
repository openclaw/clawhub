import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { isSkillOfficial } from "./badges";
import { getSkillCategoriesForSkill } from "./categories";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";
import type { PublicSkill, PublicUser } from "./publicUser";

export type HomeListingKind = "skills" | "plugins";
export type HomeListingTab = "featured" | "popular" | "trending" | "officials";

export type HomeSkillListingEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

export type HomeListingCacheEntry =
  | { kind: "skills"; items: HomeSkillListingEntry[]; hasMore: boolean }
  | { kind: "plugins"; items: PackageListItem[]; hasMore: boolean };

type HomeListingInitialDataBase = {
  tab: HomeListingTab;
  categorySlugs: [];
  fetchLimit: typeof HOME_LISTING_PAGE_SIZE;
  hasMore: boolean;
  featuredAvailability: Record<HomeListingKind, boolean>;
};

export type HomeListingInitialData =
  | (HomeListingInitialDataBase & {
      kind: "skills";
      items: HomeSkillListingEntry[];
    })
  | (HomeListingInitialDataBase & {
      kind: "plugins";
      items: PackageListItem[];
    });

export const HOME_LISTING_PAGE_SIZE = 20;

const PLUGIN_CATALOG_PAGE_LIMIT = 100;
// Highlighted skill responses are cursorless, so request the backend's full public maximum.
const FEATURED_SKILL_LIST_LIMIT = 200;

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

function sortHomeSkillEntries(entries: HomeSkillListingEntry[]) {
  return [...entries].sort((left, right) => {
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

  const requestLimit = tab === "featured" ? FEATURED_SKILL_LIST_LIMIT : numItems;
  const categoriesToFetch = categorySlugs.length > 0 ? categorySlugs : [null];
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const page: HomeSkillListingEntry[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (page.length < requestLimit) {
        const result = await convexHttp.query(api.skills.listPublicPageV4, {
          cursor: cursor ?? undefined,
          numItems: requestLimit - page.length,
          sort: "downloads",
          dir: "desc",
          highlightedOnly: tab === "featured" ? true : undefined,
          officialFirst: tab === "officials" ? true : undefined,
          categorySlug: categorySlug ?? undefined,
        });
        if (Array.isArray(result)) break;

        const resultPage = ((result as { page?: HomeSkillListingEntry[] }).page ?? []).filter(
          (entry) => skillMatchesAnyHomeCategory(entry.skill, categorySlugs),
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
  const sorted = sortHomeSkillEntries(filterHomeSkillsByTab(uniqueHomeSkillEntries(pages), tab));
  const hasMore =
    sorted.length > numItems || (tab !== "featured" && results.some((result) => result.hasMore));
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
  const featured = tab === "featured";
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
          featured: featured ? true : undefined,
          sort: "downloads",
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
  if (tab === "popular" || featured || openClawOfficials) {
    items.sort((a, b) => (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0));
  }
  const page = items.slice(0, limit);
  return {
    items: page,
    hasMore: items.length > limit || results.some((result) => result.hasMore),
  };
}

export async function fetchHomeFeaturedAvailability(kind: HomeListingKind, signal?: AbortSignal) {
  if (kind === "skills") {
    const result = await convexHttp.query(api.skills.listPublicPageV4, {
      numItems: 1,
      sort: "downloads",
      dir: "desc",
      highlightedOnly: true,
    });
    return (
      !Array.isArray(result) &&
      ((result as { page?: HomeSkillListingEntry[] }).page?.length ?? 0) > 0
    );
  }

  const result = await fetchPluginCatalog({
    featured: true,
    sort: "downloads",
    limit: 1,
    signal,
  });
  return result.items.length > 0;
}

export async function fetchInitialHomeListing(): Promise<HomeListingInitialData> {
  const [featuredPlugins, hasFeaturedSkills] = await Promise.all([
    fetchHomePluginListing("featured", [], HOME_LISTING_PAGE_SIZE),
    fetchHomeFeaturedAvailability("skills").catch(() => false),
  ]);
  const hasFeaturedPlugins = featuredPlugins.items.length > 0;
  const result = hasFeaturedPlugins
    ? featuredPlugins
    : await fetchHomePluginListing("officials", [], HOME_LISTING_PAGE_SIZE);
  return {
    kind: "plugins",
    tab: hasFeaturedPlugins ? "featured" : "officials",
    categorySlugs: [],
    fetchLimit: HOME_LISTING_PAGE_SIZE,
    items: result.items,
    hasMore: result.hasMore,
    featuredAvailability: {
      plugins: hasFeaturedPlugins,
      skills: hasFeaturedSkills,
    },
  };
}

function categoryCacheKey(categorySlugs: readonly string[]) {
  if (categorySlugs.length === 0) return "all";
  return [...categorySlugs].sort().join(",");
}
