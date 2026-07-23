import { getCatalogTopicSlugs, normalizeCatalogTopic } from "clawhub-schema";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api } from "../../../convex/_generated/api";
import { convexHttp } from "../../convex/client";
import {
  ALL_CATEGORY_KEYWORDS,
  getSkillCategoryBySlug,
  getSkillCategoriesForSkill,
} from "../../lib/categories";
import { isSkillsShSearchResult, type SkillsShSearchResult } from "../../lib/skillsShCatalog";
import { parseDir, parseSort, toListSort, type SortDir, type SortKey } from "./-params";
import { isExternalSkillListEntry, type SkillListEntry, type SkillSearchEntry } from "./-types";

const pageSize = 25;
const maxConsecutiveEmptyPagesPerFetch = 3;

function isNavigationAbortError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "AbortError" || err.message === "Failed to fetch" || err.message === "Load failed"
  );
}

export type SkillsView = "grid" | "list";
type LegacySkillsView = SkillsView | "cards";

export function normalizeSkillsView(value: unknown): SkillsView | undefined {
  if (value === "list") return "list";
  if (value === "grid" || value === "cards") return "grid";
  return undefined;
}

export type SkillsSearchState = {
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  highlighted?: boolean;
  featured?: boolean;
  category?: string;
  topic?: string;
  view?: LegacySkillsView;
  focus?: "search";
};

export type InitialSkillsSearchData = {
  key: string;
  limit: number;
  results: SkillSearchEntry[];
} | null;

type SkillsNavigate = (options: {
  search: (prev: SkillsSearchState) => SkillsSearchState;
  replace?: boolean;
}) => void | Promise<void>;

type ListStatus = "loading" | "idle" | "loadingMore" | "done";

type BrowseStream = {
  cursor: string | null | undefined;
  buffer: SkillListEntry[];
};

type BrowsePageResult = {
  page: SkillListEntry[];
  hasMore: boolean;
  nextCursor: string | null;
};

function mixedBrowsePopularity(entry: SkillListEntry) {
  return isExternalSkillListEntry(entry)
    ? entry.result.upstreamInstalls
    : (entry.nativeDownloads ?? entry.skill.stats.downloads);
}

function compareMixedBrowseEntries(left: SkillListEntry, right: SkillListEntry) {
  const popularity = mixedBrowsePopularity(right) - mixedBrowsePopularity(left);
  if (popularity !== 0) return popularity;
  if (isExternalSkillListEntry(left) !== isExternalSkillListEntry(right)) {
    return isExternalSkillListEntry(left) ? 1 : -1;
  }
  return 0;
}

export function buildSkillsSearchKey({
  categorySlug,
  featuredOnly,
  query,
  topic,
}: {
  categorySlug?: string;
  featuredOnly: boolean;
  query: string;
  topic?: string;
}) {
  const trimmed = query.trim();
  return trimmed
    ? `${trimmed}::${featuredOnly ? "1" : "0"}::${categorySlug ?? ""}::${topic ?? ""}`
    : "";
}

export function useSkillsBrowseModel({
  initialSearch,
  search,
  navigate,
  searchInputRef,
}: {
  initialSearch?: InitialSkillsSearchData;
  search: SkillsSearchState;
  navigate: SkillsNavigate;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState(search.q ?? "");
  const searchRequest = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const navigateTimer = useRef<number>(0);

  const view: SkillsView = normalizeSkillsView(search.view) ?? "list";
  const featuredOnly = search.featured ?? search.highlighted ?? false;
  const searchSkills = useAction(api.search.searchSkills);
  const listSkillsShMirrorBrowse = useAction(api.search.listSkillsShMirrorBrowse);

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const urlCategory = useMemo(() => getSkillCategoryBySlug(search.category), [search.category]);
  const activeCategory = urlCategory;
  const activeTopic = search.topic ? normalizeCatalogTopic(search.topic) : undefined;
  const categoryKeywords =
    activeCategory && activeCategory.slug !== "other" ? activeCategory.keywords : undefined;
  const excludeCategoryKeywords =
    activeCategory?.slug === "other" ? ALL_CATEGORY_KEYWORDS : undefined;
  const hasQuery = trimmedQuery.length > 0;
  const requestedSort = search.sort === "default" ? "recommended" : search.sort;
  const sort: SortKey =
    requestedSort === "relevance" && !hasQuery
      ? "recommended"
      : requestedSort === "recommended" && hasQuery
        ? "relevance"
        : (requestedSort ?? (hasQuery ? "relevance" : "recommended"));
  const listSort = sort === "trending" ? undefined : toListSort(sort);
  const dir =
    sort === "relevance" || sort === "recommended" || sort === "downloads"
      ? "desc"
      : parseDir(search.dir, sort);
  const mixedPopularityBrowse =
    !featuredOnly &&
    dir === "desc" &&
    (sort === "downloads" ||
      (sort === "recommended" && (Boolean(activeCategory) || Boolean(activeTopic))));
  const effectiveListSort = mixedPopularityBrowse ? "downloads" : listSort;
  const searchKey = buildSkillsSearchKey({
    query: trimmedQuery,
    featuredOnly,
    categorySlug: activeCategory?.slug,
    topic: activeTopic,
  });
  const matchedInitialSearch = initialSearch?.key === searchKey ? initialSearch : null;
  const initialSearchMatches = matchedInitialSearch !== null;
  const [searchResults, setSearchResults] = useState<Array<SkillSearchEntry>>(() =>
    matchedInitialSearch ? matchedInitialSearch.results : [],
  );
  const [searchLimit, setSearchLimit] = useState(() =>
    matchedInitialSearch ? matchedInitialSearch.limit : pageSize,
  );
  const [isSearching, setIsSearching] = useState(() => hasQuery && !initialSearchMatches);
  const appliedInitialSearchKey = useRef(matchedInitialSearch ? matchedInitialSearch.key : null);

  // One-shot paginated fetches (no reactive subscription)
  const [listResults, setListResults] = useState<SkillListEntry[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [listAutoLoadPaused, setListAutoLoadPaused] = useState(false);
  const nativeListStream = useRef<BrowseStream>({ cursor: undefined, buffer: [] });
  const externalListStream = useRef<BrowseStream>({ cursor: undefined, buffer: [] });
  const fetchGeneration = useRef(0);

  const fetchPage = useCallback(
    async (generation: number, replace: boolean) => {
      const nativeStream = nativeListStream.current;
      const externalStream = externalListStream.current;
      let consecutiveEmptyPages = 0;
      let nativeFailed = false;
      let externalFailed = false;

      if (sort === "trending") {
        try {
          const result = await convexHttp.query(api.skills.listPublicTrendingPage, {
            limit: pageSize,
            nonSuspiciousOnly: true,
            categorySlug: activeCategory?.slug,
            topic: activeTopic,
          });
          if (generation !== fetchGeneration.current) return;
          setListResults(result.items);
          setListAutoLoadPaused(false);
          setListStatus("done");
        } catch (err) {
          if (generation !== fetchGeneration.current) return;
          if (!isNavigationAbortError(err)) {
            console.error("Failed to fetch skills page:", err);
          }
          setListAutoLoadPaused(true);
          setListStatus("idle");
        }
        return;
      }

      if (!mixedPopularityBrowse) {
        let result: BrowsePageResult | null = null;
        try {
          while (nativeStream.cursor !== null) {
            const requestCursor: string | null | undefined = nativeStream.cursor;
            result = (await convexHttp.query(api.skills.listPublicPageV4, {
              cursor: requestCursor ?? undefined,
              numItems: pageSize,
              ...(effectiveListSort ? { sort: effectiveListSort } : {}),
              dir,
              highlightedOnly: featuredOnly,
              categorySlug: activeCategory?.slug,
              topic: activeTopic,
              ...(activeCategory ? { officialFirst: true } : {}),
              categoryKeywords,
              excludeCategoryKeywords,
            })) as BrowsePageResult;
            if (generation !== fetchGeneration.current) return;
            const nextCursor: string | null =
              result.hasMore && result.nextCursor != null && result.nextCursor !== requestCursor
                ? result.nextCursor
                : null;
            nativeStream.cursor = nextCursor;
            if (result.page.length > 0 || !nextCursor) break;
            consecutiveEmptyPages += 1;
            if (consecutiveEmptyPages >= maxConsecutiveEmptyPagesPerFetch) break;
          }
        } catch (err) {
          if (generation !== fetchGeneration.current) return;
          if (!isNavigationAbortError(err)) {
            console.error("Failed to fetch native skills page:", err);
          }
          setListAutoLoadPaused(nativeStream.cursor !== null);
          setListStatus(nativeStream.cursor === null ? "done" : "idle");
          return;
        }
        if (generation !== fetchGeneration.current) return;
        const page = result?.page ?? [];
        setListResults((current) => (replace ? page : [...current, ...page]));
        const hasMore = nativeStream.cursor !== null;
        setListAutoLoadPaused(page.length === 0 && hasMore);
        setListStatus(hasMore ? "idle" : "done");
        return;
      }

      const fillNativeBuffer = async () => {
        if (nativeStream.buffer.length > 0 || nativeStream.cursor === null || nativeFailed) return;
        while (nativeStream.buffer.length === 0 && nativeStream.cursor !== null) {
          const requestCursor: string | null | undefined = nativeStream.cursor;
          let result: BrowsePageResult;
          try {
            result = (await convexHttp.query(api.skills.listPublicPageV4, {
              cursor: requestCursor ?? undefined,
              numItems: pageSize,
              ...(effectiveListSort ? { sort: effectiveListSort } : {}),
              dir,
              highlightedOnly: featuredOnly,
              categorySlug: activeCategory?.slug,
              topic: activeTopic,
              ...(activeCategory && !mixedPopularityBrowse ? { officialFirst: true } : {}),
              categoryKeywords,
              excludeCategoryKeywords,
            })) as BrowsePageResult;
          } catch (err) {
            nativeFailed = true;
            if (!isNavigationAbortError(err)) {
              console.error("Failed to fetch native skills page:", err);
            }
            return;
          }
          if (generation !== fetchGeneration.current) return;
          const nextCursor: string | null =
            result.hasMore && result.nextCursor != null && result.nextCursor !== requestCursor
              ? result.nextCursor
              : null;
          nativeStream.cursor = nextCursor;
          nativeStream.buffer.push(...result.page);
          if (nativeStream.buffer.length === 0 && nextCursor) {
            consecutiveEmptyPages += 1;
            if (consecutiveEmptyPages >= maxConsecutiveEmptyPagesPerFetch) {
              nativeFailed = true;
              return;
            }
          }
        }
      };

      const fillExternalBuffer = async () => {
        if (
          !mixedPopularityBrowse ||
          externalStream.buffer.length > 0 ||
          externalStream.cursor === null ||
          externalFailed
        ) {
          return;
        }
        let externalResults: {
          page: SkillsShSearchResult[];
          nextCursor: string | null;
          hasMore: boolean;
        };
        try {
          const response = await listSkillsShMirrorBrowse({
            limit: pageSize,
            cursor: externalStream.cursor ?? undefined,
            categorySlug: activeCategory?.slug,
            topic: activeTopic,
          });
          externalResults = Array.isArray(response)
            ? {
                page: response as SkillsShSearchResult[],
                nextCursor: null,
                hasMore: false,
              }
            : (response as typeof externalResults);
          if (
            !externalResults ||
            !Array.isArray(externalResults.page) ||
            typeof externalResults.hasMore !== "boolean" ||
            (externalResults.hasMore &&
              (!externalResults.nextCursor || externalResults.nextCursor === externalStream.cursor))
          ) {
            throw new Error("Mirrored skills browse returned an invalid page");
          }
        } catch (err) {
          externalFailed = true;
          if (!isNavigationAbortError(err)) {
            console.error("Failed to fetch mirrored skills page:", err);
          }
          return;
        }
        if (generation !== fetchGeneration.current) return;
        externalStream.cursor = externalResults.hasMore ? externalResults.nextCursor : null;
        externalStream.buffer.push(
          ...externalResults.page.map(
            (external): SkillListEntry => ({
              source: "skills.sh",
              result: external,
            }),
          ),
        );
        if (externalStream.buffer.length === 0 && externalStream.cursor !== null) {
          externalFailed = true;
        }
      };

      const page: SkillListEntry[] = [];
      while (page.length < pageSize) {
        await Promise.all([fillNativeBuffer(), fillExternalBuffer()]);
        if (generation !== fetchGeneration.current) return;
        const native = nativeStream.buffer[0];
        const external = externalStream.buffer[0];
        if (!native && !external) break;
        if (!external || (native && compareMixedBrowseEntries(native, external) <= 0)) {
          page.push(nativeStream.buffer.shift()!);
        } else {
          page.push(externalStream.buffer.shift()!);
        }
      }

      if (generation !== fetchGeneration.current) return;
      setListResults((current) => (replace ? page : [...current, ...page]));
      const hasMore =
        nativeStream.buffer.length > 0 ||
        nativeStream.cursor !== null ||
        externalStream.buffer.length > 0 ||
        externalStream.cursor !== null;
      setListAutoLoadPaused((nativeFailed || externalFailed || page.length === 0) && hasMore);
      setListStatus(hasMore ? "idle" : "done");
    },
    [
      activeCategory?.slug,
      activeTopic,
      categoryKeywords,
      dir,
      effectiveListSort,
      excludeCategoryKeywords,
      featuredOnly,
      listSkillsShMirrorBrowse,
      mixedPopularityBrowse,
      sort,
    ],
  );

  // Reset and fetch first page when sort/dir/filters change
  useEffect(() => {
    if (hasQuery) {
      return () => {};
    }
    fetchGeneration.current += 1;
    const generation = fetchGeneration.current;
    nativeListStream.current = { cursor: undefined, buffer: [] };
    externalListStream.current = {
      cursor: mixedPopularityBrowse ? undefined : null,
      buffer: [],
    };
    setListResults([]);
    setListAutoLoadPaused(false);
    setListStatus("loading");
    void fetchPage(generation, true);
    return () => {
      fetchGeneration.current += 1;
    };
  }, [hasQuery, fetchPage, mixedPopularityBrowse]);

  const isLoadingList = listStatus === "loading";
  const canLoadMoreList = listStatus === "idle";
  const isLoadingMoreList = listStatus === "loadingMore";

  useEffect(() => {
    window.clearTimeout(navigateTimer.current);
    setQuery(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    if (search.focus === "search" && searchInputRef.current) {
      searchInputRef.current.focus();
      void navigate({ search: (prev) => ({ ...prev, focus: undefined }), replace: true });
    }
  }, [navigate, search.focus, searchInputRef]);

  useEffect(() => {
    if (!searchKey) {
      setSearchResults([]);
      setIsSearching(false);
      appliedInitialSearchKey.current = null;
      return;
    }
    if (matchedInitialSearch && appliedInitialSearchKey.current !== matchedInitialSearch.key) {
      setSearchResults(matchedInitialSearch.results);
      setSearchLimit(matchedInitialSearch.limit);
      setIsSearching(false);
      appliedInitialSearchKey.current = matchedInitialSearch.key;
    }
    if (matchedInitialSearch) return;
    setSearchResults([]);
    setSearchLimit(pageSize);
    setIsSearching(true);
    appliedInitialSearchKey.current = null;
  }, [matchedInitialSearch, searchKey]);

  useEffect(() => {
    if (!hasQuery) return () => {};
    if (matchedInitialSearch && searchLimit === matchedInitialSearch.limit) {
      searchRequest.current += 1;
      setIsSearching(false);
      return () => {};
    }

    searchRequest.current += 1;
    const requestId = searchRequest.current;
    setIsSearching(true);
    void (async () => {
      try {
        const data = (await searchSkills({
          query: trimmedQuery,
          highlightedOnly: featuredOnly,
          categorySlug: activeCategory?.slug,
          topic: activeTopic,
          limit: searchLimit,
        })) as Array<SkillSearchEntry>;
        if (requestId === searchRequest.current) {
          setSearchResults(data);
        }
      } finally {
        if (requestId === searchRequest.current) {
          setIsSearching(false);
        }
      }
    })();
    return () => {};
  }, [
    activeCategory?.slug,
    activeTopic,
    hasQuery,
    featuredOnly,
    matchedInitialSearch,
    searchLimit,
    searchSkills,
    trimmedQuery,
  ]);

  const baseItems = useMemo(() => {
    if (hasQuery) {
      return searchResults.map(
        (entry): SkillListEntry =>
          isSkillsShSearchResult(entry)
            ? {
                source: "skills.sh",
                result: entry,
                searchScore: entry.score,
              }
            : {
                skill: entry.skill,
                latestVersion: entry.version,
                ownerHandle: entry.ownerHandle ?? null,
                owner: entry.owner ?? null,
                searchScore: entry.score,
              },
      );
    }
    return listResults;
  }, [hasQuery, listResults, searchResults]);

  const sorted = useMemo(() => {
    const topicItems = activeTopic
      ? baseItems.filter((entry) =>
          isExternalSkillListEntry(entry)
            ? entry.result.topics?.includes(activeTopic)
            : getCatalogTopicSlugs(entry.skill.topics).includes(activeTopic),
        )
      : baseItems;
    const categoryItems = activeCategory
      ? topicItems.filter((entry) =>
          isExternalSkillListEntry(entry)
            ? entry.result.categories?.includes(activeCategory.slug)
            : getSkillCategoriesForSkill(entry.skill).some(
                (category) => category.slug === activeCategory.slug,
              ),
        )
      : topicItems;
    if (!hasQuery && mixedPopularityBrowse) {
      return [...categoryItems].sort(compareMixedBrowseEntries);
    }
    if (
      !hasQuery &&
      (sort !== "downloads" || !categoryItems.some((entry) => isExternalSkillListEntry(entry)))
    ) {
      return categoryItems;
    }
    const multiplier = dir === "asc" ? 1 : -1;
    const results = [...categoryItems];
    results.sort((a, b) => {
      const tieBreak = () => {
        const updated =
          ((isExternalSkillListEntry(a) ? a.result.lastObservedAt : a.skill.updatedAt) -
            (isExternalSkillListEntry(b) ? b.result.lastObservedAt : b.skill.updatedAt)) *
          multiplier;
        if (updated !== 0) return updated;
        const aSlug = isExternalSkillListEntry(a) ? a.result.slug : a.skill.slug;
        const bSlug = isExternalSkillListEntry(b) ? b.result.slug : b.skill.slug;
        return aSlug.localeCompare(bSlug);
      };
      switch (sort) {
        case "relevance":
          return ((a.searchScore ?? 0) - (b.searchScore ?? 0)) * multiplier;
        case "downloads":
          return (
            ((isExternalSkillListEntry(a)
              ? a.result.upstreamInstalls
              : (a.nativeDownloads ?? a.skill.stats.downloads)) -
              (isExternalSkillListEntry(b)
                ? b.result.upstreamInstalls
                : (b.nativeDownloads ?? b.skill.stats.downloads))) *
              multiplier || tieBreak()
          );
        case "stars":
          return (
            ((isExternalSkillListEntry(a) ? 0 : a.skill.stats.stars) -
              (isExternalSkillListEntry(b) ? 0 : b.skill.stats.stars)) *
              multiplier || tieBreak()
          );
        case "updated":
          return tieBreak();
        case "name": {
          const aName = isExternalSkillListEntry(a) ? a.result.displayName : a.skill.displayName;
          const bName = isExternalSkillListEntry(b) ? b.result.displayName : b.skill.displayName;
          return aName.localeCompare(bName) * multiplier || tieBreak();
        }
        default: {
          const aCreated = isExternalSkillListEntry(a)
            ? a.result.lastObservedAt
            : a.skill.createdAt;
          const bCreated = isExternalSkillListEntry(b)
            ? b.result.lastObservedAt
            : b.skill.createdAt;
          return (aCreated - bCreated) * multiplier || tieBreak();
        }
      }
    });
    return results;
  }, [activeCategory, activeTopic, baseItems, dir, hasQuery, mixedPopularityBrowse, sort]);

  const isLoadingSkills = hasQuery ? isSearching && searchResults.length === 0 : isLoadingList;
  const canLoadMore = hasQuery
    ? !isSearching && searchResults.length === searchLimit && searchResults.length > 0
    : canLoadMoreList;
  const isLoadingMore = hasQuery ? isSearching && searchResults.length > 0 : isLoadingMoreList;
  const canAutoLoad =
    typeof IntersectionObserver !== "undefined" && (hasQuery || !listAutoLoadPaused);

  const loadMore = useCallback(() => {
    if (loadMoreInFlightRef.current || isLoadingMore || !canLoadMore) return;
    loadMoreInFlightRef.current = true;
    setListAutoLoadPaused(false);
    if (hasQuery) {
      setSearchLimit((value) => value + pageSize);
    } else {
      setListStatus("loadingMore");
      void fetchPage(fetchGeneration.current, false);
    }
  }, [canLoadMore, fetchPage, hasQuery, isLoadingMore]);

  useEffect(() => {
    if (!isLoadingMore) {
      loadMoreInFlightRef.current = false;
    }
  }, [isLoadingMore]);

  useEffect(() => {
    if (!canLoadMore || !canAutoLoad) return () => {};
    const target = loadMoreRef.current;
    if (!target) return () => {};
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [canAutoLoad, canLoadMore, loadMore]);

  useEffect(() => {
    return () => window.clearTimeout(navigateTimer.current);
  }, []);

  const onQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      window.clearTimeout(navigateTimer.current);
      const trimmed = next.trim();
      navigateTimer.current = window.setTimeout(() => {
        void navigate({
          search: (prev) => {
            const hadQuery = typeof prev.q === "string" && prev.q.trim().length > 0;
            const enteringSearch = Boolean(trimmed) && !hadQuery;
            return {
              ...prev,
              q: trimmed ? next : undefined,
              ...(enteringSearch && parseSort(prev.sort) === "recommended"
                ? { sort: undefined, dir: undefined }
                : null),
            };
          },
          replace: true,
        });
      }, 250);
    },
    [navigate],
  );

  const onToggleFeatured = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        featured: prev.featured || prev.highlighted ? undefined : true,
        highlighted: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const onClearFilters = useCallback(() => {
    window.clearTimeout(navigateTimer.current);
    setQuery("");
    void navigate({
      search: (prev) => ({
        ...prev,
        q: undefined,
        category: undefined,
        topic: undefined,
        featured: undefined,
        highlighted: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const onClearQuery = useCallback(() => {
    window.clearTimeout(navigateTimer.current);
    setQuery("");
    searchInputRef.current?.focus();
    void navigate({
      search: (prev) => {
        const clearsSearchOnlySort = parseSort(prev.sort) === "relevance";
        return {
          ...prev,
          q: undefined,
          sort: clearsSearchOnlySort ? undefined : prev.sort,
          dir: clearsSearchOnlySort ? undefined : prev.dir,
        };
      },
      replace: true,
    });
  }, [navigate, searchInputRef]);

  const onSortChange = useCallback(
    (value: string) => {
      const nextSort = parseSort(value);
      void navigate({
        search: (prev) => {
          const clearsDefaultSearchSort = hasQuery && nextSort === "recommended";
          const reusePreviousDir =
            prev.sort !== undefined &&
            prev.sort !== "recommended" &&
            prev.sort !== "default" &&
            prev.sort !== "relevance";
          return {
            ...prev,
            sort: clearsDefaultSearchSort ? undefined : nextSort,
            dir:
              clearsDefaultSearchSort || nextSort === "recommended" || nextSort === "default"
                ? undefined
                : parseDir(reusePreviousDir ? prev.dir : undefined, nextSort),
          };
        },
        replace: true,
      });
    },
    [hasQuery, navigate],
  );

  const onToggleDir = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        dir: parseDir(prev.dir, sort) === "asc" ? "desc" : "asc",
      }),
      replace: true,
    });
  }, [navigate, sort]);

  const onToggleView = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        view: normalizeSkillsView(prev.view) === "grid" ? undefined : "grid",
      }),
      replace: true,
    });
  }, [navigate]);

  const activeFilters: string[] = [];
  if (featuredOnly) activeFilters.push("featured");

  return {
    activeFilters,
    activeCategory: activeCategory?.slug,
    activeTopic,
    canAutoLoad,
    canLoadMore,
    dir,
    hasQuery,
    featuredOnly,
    isLoadingMore,
    isLoadingSkills,
    loadMore,
    loadMoreRef,
    onClearFilters,
    onClearQuery,
    onQueryChange,
    onSortChange,
    onToggleDir,
    onToggleFeatured,
    onToggleView,
    query,
    sort,
    sorted,
    view,
  };
}
