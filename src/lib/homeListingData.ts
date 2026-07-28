import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { fetchCatalogDiscoveryCapabilities } from "./catalogDiscoveryCapabilities";
import { getSkillCategoriesForSkill } from "./categories";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";
import type { PublicSkill, PublicUser } from "./publicUser";
import { fetchCanonicalTrendingPage, type CanonicalTrendingItem } from "./trendingApi";

export type HomeListingKind = "skills" | "plugins";
export type HomeListingTab = "trending" | "new" | "featured" | "official";

export type HomeNativeSkillListingEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

type HomeTrendingSkillListingEntry = {
  trending: CanonicalTrendingItem;
};

export type HomeSkillListingEntry = HomeNativeSkillListingEntry | HomeTrendingSkillListingEntry;

export function isHomeTrendingSkillEntry(
  entry: HomeSkillListingEntry,
): entry is HomeTrendingSkillListingEntry {
  return "trending" in entry;
}

export type HomeListingCacheEntry =
  | { kind: "skills"; items: HomeSkillListingEntry[]; hasMore: boolean }
  | { kind: "plugins"; items: PackageListItem[]; hasMore: boolean };

type HomeListingInitialDataBase = {
  tab: HomeListingTab;
  categorySlugs: [];
  fetchLimit: typeof HOME_LISTING_PAGE_SIZE;
  hasMore: boolean;
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
export const HOME_NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;

const PLUGIN_CATALOG_PAGE_LIMIT = 100;
const LEGACY_NEW_PLUGIN_MAX_REQUESTS = 10;
// Featured is intentionally a finite editorial feed: the latest 40 badge-history rows.
const FEATURED_SKILL_LIMIT = 40;

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

export function uniqueHomeSkillEntries(entries: HomeNativeSkillListingEntry[]) {
  const byId = new Map<string, HomeNativeSkillListingEntry>();
  for (const entry of entries) byId.set(String(entry.skill._id), entry);
  return [...byId.values()];
}

export function uniqueHomePlugins(items: PackageListItem[]) {
  const byName = new Map<string, PackageListItem>();
  for (const item of items) byName.set(item.name, item);
  return [...byName.values()];
}

export async function fetchHomeSkillListing(
  tab: HomeListingTab,
  categorySlugs: readonly string[],
  numItems: number,
  signal?: AbortSignal,
) {
  if (tab === "trending") {
    const capabilities = await fetchCatalogDiscoveryCapabilities();
    if (!capabilities.canonicalTrendingEnabled) {
      const result = await convexHttp.query(api.skills.listPublicTrendingPage, {
        limit: numItems,
        categorySlug: categorySlugs.length === 1 ? categorySlugs[0] : undefined,
      });
      const page = ((result as { items?: HomeNativeSkillListingEntry[] }).items ?? []).filter(
        (entry) => skillMatchesAnyHomeCategory(entry.skill, categorySlugs),
      );
      return { page, hasMore: false };
    }

    const items: HomeTrendingSkillListingEntry[] = [];
    let cursor: string | null = null;
    let hasMore = false;
    const maxRequests =
      numItems < HOME_LISTING_PAGE_SIZE ? numItems : Math.ceil(numItems / HOME_LISTING_PAGE_SIZE);
    for (let pageIndex = 0; pageIndex < maxRequests; pageIndex += 1) {
      const result = await fetchCanonicalTrendingPage({
        cursor,
        limit: Math.min(HOME_LISTING_PAGE_SIZE, numItems - items.length),
        signal,
      });
      items.push(...result.items.map((trending) => ({ trending })));
      cursor = result.nextCursor;
      hasMore = cursor !== null;
      if (!cursor || items.length >= numItems) break;
    }
    return { page: items, hasMore };
  }

  // highlightedOnly is a dedicated backend path ordered by skillBadges.by_kind_at;
  // the nominal sort below is ignored for Featured and never chooses its candidate set.
  const capabilities =
    tab === "new" ? await fetchCatalogDiscoveryCapabilities() : { apiVersion: 1 as const };
  const newestCutoff = Date.now() - HOME_NEW_WINDOW_MS;
  const requestLimit = tab === "featured" ? FEATURED_SKILL_LIMIT : numItems;
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
          sort: tab === "new" || tab === "official" ? "newest" : "updated",
          dir: "desc",
          highlightedOnly: tab === "featured" ? true : undefined,
          officialOnly: tab === "official" ? true : undefined,
          ...(tab === "new" && capabilities.apiVersion >= 1 ? { createdAfter: newestCutoff } : {}),
          categorySlug: categorySlug ?? undefined,
        });
        const transportPage = (result as { page?: HomeNativeSkillListingEntry[] }).page ?? [];
        const resultPage = transportPage.filter(
          (entry) =>
            skillMatchesAnyHomeCategory(entry.skill, categorySlugs) &&
            (tab !== "new" ||
              capabilities.apiVersion >= 1 ||
              entry.skill.createdAt >= newestCutoff),
        );
        page.push(...resultPage);

        const nextCursor = (result as { nextCursor?: string | null }).nextCursor ?? null;
        hasMore = Boolean((result as { hasMore?: boolean }).hasMore ?? nextCursor);
        if (
          tab === "new" &&
          capabilities.apiVersion === 0 &&
          transportPage.some((entry) => entry.skill.createdAt < newestCutoff)
        ) {
          hasMore = false;
          break;
        }
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      return { page, hasMore };
    }),
  );
  const items = uniqueHomeSkillEntries(results.flatMap((result) => result.page)).sort(
    (left, right) => {
      if (tab === "featured") {
        return (
          (right.skill.badges?.highlighted?.at ?? 0) - (left.skill.badges?.highlighted?.at ?? 0)
        );
      }
      if (tab === "new" || tab === "official") {
        return right.skill.createdAt - left.skill.createdAt;
      }
      return 0;
    },
  );
  return {
    page: items.slice(0, numItems),
    hasMore:
      tab === "featured"
        ? numItems < FEATURED_SKILL_LIMIT &&
          (items.length > numItems || results.some((result) => result.hasMore))
        : items.length > numItems || results.some((result) => result.hasMore),
  };
}

export async function fetchHomePluginListing(
  tab: Exclude<HomeListingTab, "trending">,
  categorySlugs: readonly string[],
  limit: number,
  signal?: AbortSignal,
) {
  const categoriesToFetch = categorySlugs.length > 0 ? categorySlugs : [null];
  const newestCutoff = Date.now() - HOME_NEW_WINDOW_MS;
  if (tab === "new") {
    const capabilities = await fetchCatalogDiscoveryCapabilities();
    if (capabilities.apiVersion === 0) {
      const results = await Promise.all(
        categoriesToFetch.map(async (categorySlug) => {
          const items: PackageListItem[] = [];
          let cursor: string | null | undefined;
          let hasMore = false;
          for (
            let requestIndex = 0;
            requestIndex < LEGACY_NEW_PLUGIN_MAX_REQUESTS && items.length < limit;
            requestIndex += 1
          ) {
            const result = await fetchPluginCatalog({
              category: categorySlug ?? undefined,
              cursor: cursor ?? undefined,
              sort: "updated",
              limit: PLUGIN_CATALOG_PAGE_LIMIT,
              signal,
            });
            const reachedCutoff = result.items.some((item) => item.updatedAt < newestCutoff);
            items.push(
              ...result.items.filter(
                (item) =>
                  item.createdAt >= newestCutoff && itemMatchesAnyHomeCategory(item, categorySlugs),
              ),
            );
            hasMore = !reachedCutoff && result.nextCursor !== null;
            if (
              reachedCutoff ||
              !result.nextCursor ||
              result.nextCursor === cursor ||
              items.length >= limit
            ) {
              break;
            }
            cursor = result.nextCursor;
          }
          return { items, hasMore };
        }),
      );
      const items = uniqueHomePlugins(results.flatMap((result) => result.items)).sort(
        (left, right) => right.createdAt - left.createdAt,
      );
      return {
        items: items.slice(0, limit),
        hasMore: items.length > limit || results.some((result) => result.hasMore),
      };
    }

    const results = await Promise.all(
      categoriesToFetch.map(async (categorySlug) => {
        const page: PackageListItem[] = [];
        let cursor: string | null = null;
        let isDone = false;
        while (page.length < limit && !isDone) {
          signal?.throwIfAborted();
          const result = (await convexHttp.query(api.packages.listPublicNewPluginsPage, {
            category: categorySlug ?? undefined,
            createdAfter: newestCutoff,
            paginationOpts: {
              cursor,
              numItems: Math.min(HOME_LISTING_PAGE_SIZE, limit - page.length),
            },
          })) as {
            page: PackageListItem[];
            isDone: boolean;
            continueCursor: string;
          };
          signal?.throwIfAborted();
          page.push(
            ...(result.page.filter(
              (item) => item.family === "code-plugin" || item.family === "bundle-plugin",
            ) as PackageListItem[]),
          );
          isDone = result.isDone;
          if (isDone || !result.continueCursor || result.continueCursor === cursor) break;
          cursor = result.continueCursor;
        }
        return { page, isDone };
      }),
    );
    const items = uniqueHomePlugins(results.flatMap((result) => result.page)).sort(
      (left, right) => right.createdAt - left.createdAt,
    );
    return {
      items: items.slice(0, limit),
      hasMore: items.length > limit || results.some((result) => !result.isDone),
    };
  }
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const items: PackageListItem[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (items.length < limit) {
        const result = await fetchPluginCatalog({
          category: categorySlug ?? undefined,
          cursor: cursor ?? undefined,
          featured: tab === "featured" ? true : undefined,
          isOfficial: tab === "official" ? true : undefined,
          sort: "updated",
          limit: Math.min(limit - items.length, PLUGIN_CATALOG_PAGE_LIMIT),
          signal,
        });
        const page = result.items.filter((item) => itemMatchesAnyHomeCategory(item, categorySlugs));
        items.push(...page);
        hasMore = result.nextCursor !== null;
        if (!result.nextCursor || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }
      return { items, hasMore };
    }),
  );
  const items = uniqueHomePlugins(results.flatMap((result) => result.items)).sort((left, right) => {
    if (tab === "featured") return (right.featuredAt ?? 0) - (left.featuredAt ?? 0);
    return right.updatedAt - left.updatedAt;
  });
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit || results.some((result) => result.hasMore),
  };
}

export async function fetchInitialHomeListing(): Promise<HomeListingInitialData> {
  const result = await fetchHomeSkillListing("trending", [], HOME_LISTING_PAGE_SIZE);
  return {
    kind: "skills",
    tab: "trending",
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
