import { PACKAGE_TRENDING_LEADERBOARD_LIMIT } from "clawhub-schema";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { getSkillCategoriesForSkill } from "./categories";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";
import type { PublicSkill, PublicUser } from "./publicUser";
import type { SkillsShSearchResult } from "./skillsShCatalog";

export type HomeListingKind = "skills" | "plugins";
export type HomeListingTab = "featured" | "popular" | "trending";

export type HomeNativeSkillListingEntry = {
  skill: PublicSkill;
  nativeDownloads?: number;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

type HomeSkillsShListingEntry = {
  source: "skills.sh";
  result: SkillsShSearchResult;
};

export type HomeSkillListingEntry = HomeNativeSkillListingEntry | HomeSkillsShListingEntry;

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

export function skillsShMatchesAnyHomeCategory(
  result: SkillsShSearchResult,
  categorySlugs: readonly string[],
) {
  return (
    categorySlugs.length === 0 || categorySlugs.some((slug) => result.categories?.includes(slug))
  );
}

function isHomeSkillsShListingEntry(
  entry: HomeSkillListingEntry,
): entry is HomeSkillsShListingEntry {
  return "source" in entry && entry.source === "skills.sh";
}

function uniqueHomeSkillEntries(entries: HomeSkillListingEntry[]) {
  const byId = new Map<string, HomeSkillListingEntry>();
  for (const entry of entries) {
    const key = isHomeSkillsShListingEntry(entry)
      ? `skills-sh:${entry.result.externalId}`
      : `native:${entry.skill._id}`;
    byId.set(key, entry);
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
    const leftDownloads = isHomeSkillsShListingEntry(left)
      ? left.result.upstreamInstalls
      : (left.nativeDownloads ?? left.skill.stats.downloads);
    const rightDownloads = isHomeSkillsShListingEntry(right)
      ? right.result.upstreamInstalls
      : (right.nativeDownloads ?? right.skill.stats.downloads);
    return rightDownloads - leftDownloads;
  });
}

function sortFeaturedHomeSkillEntries(entries: HomeSkillListingEntry[]) {
  return [...entries].sort((left, right) => {
    const leftFeaturedAt = isHomeSkillsShListingEntry(left)
      ? 0
      : (left.skill.badges?.highlighted?.at ?? 0);
    const rightFeaturedAt = isHomeSkillsShListingEntry(right)
      ? 0
      : (right.skill.badges?.highlighted?.at ?? 0);
    return rightFeaturedAt - leftFeaturedAt;
  });
}

function sortFeaturedHomePlugins(items: PackageListItem[]) {
  return [...items].sort((left, right) => (right.featuredAt ?? 0) - (left.featuredAt ?? 0));
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
    const items = ((result as { items?: HomeNativeSkillListingEntry[] }).items ?? []).filter(
      (entry) => skillMatchesAnyHomeCategory(entry.skill, categorySlugs),
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
      const page: HomeNativeSkillListingEntry[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (page.length < requestLimit) {
        const result = await convexHttp.query(api.skills.listPublicPageV4, {
          cursor: cursor ?? undefined,
          numItems: requestLimit - page.length,
          sort: "downloads",
          dir: "desc",
          highlightedOnly: tab === "featured" ? true : undefined,
          categorySlug: categorySlug ?? undefined,
        });
        if (Array.isArray(result)) break;

        const resultPage = ((result as { page?: HomeNativeSkillListingEntry[] }).page ?? []).filter(
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
  const externalLimit = Math.min(requestLimit, 50);
  const externalResults =
    tab === "popular"
      ? await Promise.all(
          categoriesToFetch.map(async (categorySlug) => {
            const items: HomeSkillsShListingEntry[] = [];
            let cursor: string | null | undefined;
            let hasMore = false;

            try {
              while (items.length < requestLimit) {
                const result = (await convexHttp.action(api.search.listSkillsShMirrorBrowse, {
                  limit: Math.min(externalLimit, requestLimit - items.length),
                  cursor: cursor ?? undefined,
                  categorySlug: categorySlug ?? undefined,
                })) as {
                  page: SkillsShSearchResult[];
                  nextCursor: string | null;
                  hasMore: boolean;
                };
                items.push(
                  ...result.page
                    .filter((external) => skillsShMatchesAnyHomeCategory(external, categorySlugs))
                    .map(
                      (external): HomeSkillsShListingEntry => ({
                        source: "skills.sh",
                        result: external,
                      }),
                    ),
                );

                const nextCursor = result.hasMore ? result.nextCursor : null;
                hasMore = Boolean(nextCursor);
                if (!nextCursor || nextCursor === cursor) break;
                cursor = nextCursor;
              }
            } catch {
              return { items: [], hasMore: false };
            }

            return { items, hasMore };
          }),
        )
      : [];
  const pages: HomeSkillListingEntry[] = [
    ...results.flatMap((result) => result.page),
    ...externalResults.flatMap((result) => result.items),
  ];
  const unique = uniqueHomeSkillEntries(pages);
  const sorted =
    tab === "featured" ? sortFeaturedHomeSkillEntries(unique) : sortHomeSkillEntries(unique);
  const hasMore =
    sorted.length > numItems ||
    (tab !== "featured" && results.some((result) => result.hasMore)) ||
    externalResults.some((result) => result.hasMore);
  const page = sorted.slice(0, numItems);
  return { page, hasMore };
}

export async function fetchHomePluginListing(
  tab: HomeListingTab,
  categorySlugs: readonly string[],
  limit: number,
  signal?: AbortSignal,
) {
  const featured = tab === "featured";
  const trending = tab === "trending";
  const usesGlobalTrendingFilter = trending && categorySlugs.length > 1;
  const categoriesToFetch = usesGlobalTrendingFilter
    ? [null]
    : categorySlugs.length > 0
      ? categorySlugs
      : [null];
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const items: PackageListItem[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;
      let trendingCandidatesScanned = 0;

      while (items.length < limit) {
        const result = await fetchPluginCatalog({
          category: categorySlug ?? undefined,
          cursor: cursor ?? undefined,
          featured: featured ? true : undefined,
          sort: trending ? "trending" : "downloads",
          limit: usesGlobalTrendingFilter
            ? PLUGIN_CATALOG_PAGE_LIMIT
            : Math.min(limit - items.length, PLUGIN_CATALOG_PAGE_LIMIT),
          signal,
        });
        trendingCandidatesScanned += result.items.length;
        items.push(
          ...result.items.filter((item) => itemMatchesAnyHomeCategory(item, categorySlugs)),
        );

        hasMore = result.nextCursor != null;
        if (
          usesGlobalTrendingFilter &&
          trendingCandidatesScanned >= PACKAGE_TRENDING_LEADERBOARD_LIMIT &&
          result.nextCursor
        ) {
          throw new Error(
            `Trending plugin feed exceeded ${PACKAGE_TRENDING_LEADERBOARD_LIMIT}-item contract`,
          );
        }
        if (!result.nextCursor || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }

      return { items, hasMore };
    }),
  );
  let items = uniqueHomePlugins(results.flatMap((result) => result.items));
  if (featured) {
    items = sortFeaturedHomePlugins(items);
  } else if (tab === "popular") {
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
    : await fetchHomePluginListing("popular", [], HOME_LISTING_PAGE_SIZE);
  return {
    kind: "plugins",
    tab: hasFeaturedPlugins ? "featured" : "popular",
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
