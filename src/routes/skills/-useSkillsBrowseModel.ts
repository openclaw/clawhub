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
import { parseDir, parseSort, toListSort, type SortDir, type SortKey } from "./-params";
import type { SkillListEntry, SkillSearchEntry } from "./-types";

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
  const dir = sort === "relevance" ? "desc" : parseDir(search.dir, sort);
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
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [listAutoLoadPaused, setListAutoLoadPaused] = useState(false);
  const fetchGeneration = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null, generation: number) => {
      let pageCursor = cursor;
      let consecutiveEmptyPages = 0;
      try {
        if (sort === "trending") {
          const result = await convexHttp.query(api.skills.listPublicTrendingPage, {
            limit: pageSize,
            nonSuspiciousOnly: true,
            categorySlug: activeCategory?.slug,
            topic: activeTopic,
          });
          if (generation !== fetchGeneration.current) return;
          setListResults(result.items);
          setListCursor(null);
          setListAutoLoadPaused(false);
          setListStatus("done");
          return;
        }
        while (true) {
          const result = await convexHttp.query(api.skills.listPublicPageV4, {
            cursor: pageCursor ?? undefined,
            numItems: pageSize,
            ...(listSort ? { sort: listSort } : {}),
            dir,
            highlightedOnly: featuredOnly,
            categorySlug: activeCategory?.slug,
            topic: activeTopic,
            ...(activeCategory ? { officialFirst: true } : {}),
            categoryKeywords,
            excludeCategoryKeywords,
          });
          if (generation !== fetchGeneration.current) return;
          const nextCursor =
            result.hasMore && result.nextCursor != null && result.nextCursor !== pageCursor
              ? result.nextCursor
              : null;

          // Filtered scans can yield empty transport pages before reaching visible results.
          if (result.page.length === 0 && nextCursor) {
            consecutiveEmptyPages += 1;
            if (consecutiveEmptyPages < maxConsecutiveEmptyPagesPerFetch) {
              pageCursor = nextCursor;
              continue;
            }
          }

          setListResults((prev) => (cursor ? [...prev, ...result.page] : result.page));
          setListCursor(nextCursor);
          setListAutoLoadPaused(result.page.length === 0 && Boolean(nextCursor));
          setListStatus(nextCursor ? "idle" : "done");
          return;
        }
      } catch (err) {
        if (generation !== fetchGeneration.current) return;
        if (!isNavigationAbortError(err)) {
          console.error("Failed to fetch skills page:", err);
        }
        // Reset to idle so the user can retry via "Load more"
        setListCursor(pageCursor);
        setListAutoLoadPaused(Boolean(pageCursor));
        setListStatus(pageCursor ? "idle" : "done");
      }
    },
    [
      activeCategory?.slug,
      activeTopic,
      categoryKeywords,
      dir,
      excludeCategoryKeywords,
      featuredOnly,
      listSort,
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
    setListResults([]);
    setListCursor(null);
    setListAutoLoadPaused(false);
    setListStatus("loading");
    void fetchPage(null, generation);
    return () => {
      fetchGeneration.current += 1;
    };
  }, [hasQuery, fetchPage]);

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
      return searchResults.map((entry) => ({
        skill: entry.skill,
        latestVersion: entry.version,
        ownerHandle: entry.ownerHandle ?? null,
        owner: entry.owner ?? null,
        searchScore: entry.score,
      }));
    }
    return listResults;
  }, [hasQuery, listResults, searchResults]);

  const sorted = useMemo(() => {
    const topicItems = activeTopic
      ? baseItems.filter((entry) => getCatalogTopicSlugs(entry.skill.topics).includes(activeTopic))
      : baseItems;
    const categoryItems = activeCategory
      ? topicItems.filter((entry) =>
          getSkillCategoriesForSkill(entry.skill).some(
            (category) => category.slug === activeCategory.slug,
          ),
        )
      : topicItems;
    if (!hasQuery) {
      return categoryItems;
    }
    const multiplier = dir === "asc" ? 1 : -1;
    const results = [...categoryItems];
    results.sort((a, b) => {
      const tieBreak = () => {
        const updated = (a.skill.updatedAt - b.skill.updatedAt) * multiplier;
        if (updated !== 0) return updated;
        return a.skill.slug.localeCompare(b.skill.slug);
      };
      switch (sort) {
        case "relevance":
          return ((a.searchScore ?? 0) - (b.searchScore ?? 0)) * multiplier;
        case "downloads":
          return (a.skill.stats.downloads - b.skill.stats.downloads) * multiplier || tieBreak();
        case "stars":
          return (a.skill.stats.stars - b.skill.stats.stars) * multiplier || tieBreak();
        case "updated":
          return (
            (a.skill.updatedAt - b.skill.updatedAt) * multiplier ||
            a.skill.slug.localeCompare(b.skill.slug)
          );
        case "name":
          return (
            (a.skill.displayName.localeCompare(b.skill.displayName) ||
              a.skill.slug.localeCompare(b.skill.slug)) * multiplier
          );
        default:
          return (
            (a.skill.createdAt - b.skill.createdAt) * multiplier ||
            a.skill.slug.localeCompare(b.skill.slug)
          );
      }
    });
    return results;
  }, [activeCategory, activeTopic, baseItems, dir, hasQuery, sort]);

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
      void fetchPage(listCursor, fetchGeneration.current);
    }
  }, [canLoadMore, fetchPage, hasQuery, isLoadingMore, listCursor]);

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
