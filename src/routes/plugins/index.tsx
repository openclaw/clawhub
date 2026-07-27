import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { isPluginCategorySlug } from "clawhub-schema";
import { useQuery } from "convex/react";
import { BadgeCheck, PackageSearch, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  BrowseActions,
  BrowseCategorySelect,
  BrowseCategorySidebar,
  BrowseControls,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  BrowseTabs,
  BrowseTopicChips,
  BrowseViewToggle,
  useBrowseSearchDisclosure,
} from "../../components/BrowseControls";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { formatBrowseCount } from "../../lib/browseCount";
import {
  parseBrowseTopicFromSearchInput,
  sanitizeBrowseTopicSearch,
} from "../../lib/browseTopicSearch";
import { PLUGIN_CATEGORIES, resolvePluginBrowseCategorySlug } from "../../lib/categories";
import {
  fetchPluginCatalog,
  isRateLimitedPackageApiError,
  type PackageListItem,
} from "../../lib/packageApi";
import { useBrowseTopicSearch } from "../../lib/useBrowseTopicSearch";
import { useMediaQuery } from "../../lib/useMediaQuery";

type VisiblePluginSort = "recommended" | "updated" | "downloads" | "trending";
type PluginSort = VisiblePluginSort | "relevance";
type LegacyPluginSort = PluginSort | "newest" | "name" | "installs";
type PluginBrowseTab = VisiblePluginSort | "official";

const PLUGINS_PAGE_SIZE = 25;
const PLUGIN_CATALOG_REQUEST_TIMEOUT_MS = 5_000;

type PluginSearchState = {
  q?: string;
  category?: string;
  topic?: string;
  cursor?: string;
  family?: undefined;
  featured?: boolean;
  official?: boolean;
  sort?: LegacyPluginSort;
  view?: LegacyPluginView;
};

type PluginView = "list" | "grid";
type LegacyPluginView = PluginView | "cards";

const PLUGIN_BROWSE_TABS = [
  { value: "recommended", label: "All" },
  { value: "trending", label: "Trending" },
  {
    value: "official",
    label: "Official",
    icon: <BadgeCheck size={14} strokeWidth={2.25} aria-hidden="true" />,
  },
  { value: "updated", label: "Updated" },
];

function normalizePluginView(value: unknown): PluginView | undefined {
  if (value === "list") return "list";
  if (value === "grid" || value === "cards") return "grid";
  return undefined;
}

type PluginsLoaderData = {
  items: PackageListItem[];
  nextCursor: string | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  totalCount?: number | null;
  isLoading?: boolean;
  apiError?: boolean;
};

type PluginsPageDataRequest = {
  q?: string;
  category?: string;
  topic?: string;
  cursor?: string;
  featured?: boolean;
  official?: boolean;
  sort?: PluginSort;
  signal?: AbortSignal;
};

function createPluginsLoadingData(): PluginsLoaderData {
  return {
    items: [],
    nextCursor: null,
    rateLimited: false,
    retryAfterSeconds: null,
    totalCount: null,
    isLoading: true,
    apiError: false,
  };
}

function formatRetryDelay(retryAfterSeconds: number | null) {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return "in a moment";
  if (retryAfterSeconds < 60) {
    return `in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function parsePluginSort(value: unknown): LegacyPluginSort | undefined {
  if (
    value === "recommended" ||
    value === "relevance" ||
    value === "updated" ||
    value === "downloads" ||
    value === "trending" ||
    value === "installs" ||
    value === "newest" ||
    value === "name"
  ) {
    return value === "installs" ? "downloads" : value;
  }
  return undefined;
}

function sortPluginSearchItems(items: PackageListItem[], sort: PluginSort) {
  if (sort === "recommended" || sort === "relevance") return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    const tieBreak = () =>
      b.updatedAt - a.updatedAt ||
      b.createdAt - a.createdAt ||
      a.family.localeCompare(b.family) ||
      a.name.localeCompare(b.name);

    if (sort === "downloads") {
      return (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0) || tieBreak();
    }

    return tieBreak();
  });
  return sorted;
}

function normalizeActivePluginSort(sort: LegacyPluginSort | undefined): PluginSort | undefined {
  if (sort === "newest" || sort === "name" || sort === "installs") return undefined;
  return sort;
}

function getDefaultPluginBrowseSort(
  _args: Pick<PluginsPageDataRequest, "category" | "featured" | "official">,
): VisiblePluginSort {
  return "recommended";
}

function hasPersistentPluginBrowseFilter(
  args: Pick<PluginsPageDataRequest, "category" | "featured" | "official">,
) {
  return Boolean(args.category || args.featured || args.official);
}

function isNavigationAbortError(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

export async function loadPluginsPageData(
  args: PluginsPageDataRequest,
): Promise<PluginsLoaderData> {
  const requestController = new AbortController();
  const abortFromNavigation = () => requestController.abort(args.signal?.reason);
  if (args.signal?.aborted) {
    abortFromNavigation();
  } else {
    args.signal?.addEventListener("abort", abortFromNavigation, { once: true });
  }
  const timeoutId = setTimeout(() => {
    requestController.abort(new DOMException("Plugin catalog request timed out", "TimeoutError"));
  }, PLUGIN_CATALOG_REQUEST_TIMEOUT_MS);

  try {
    const data = await fetchPluginCatalog({
      q: args.q,
      category: args.category,
      topic: args.topic,
      officialFirst: Boolean(args.category && !args.q),
      cursor: args.q ? undefined : args.cursor,
      featured: args.featured,
      isOfficial: args.official,
      ...(!args.q &&
      (args.sort === "downloads" ||
        args.sort === "updated" ||
        args.sort === "trending" ||
        !args.sort ||
        args.sort === "recommended")
        ? { sort: args.sort ?? getDefaultPluginBrowseSort(args) }
        : {}),
      limit: PLUGINS_PAGE_SIZE,
      signal: requestController.signal,
      // Public browse SSR must not serialize request-scoped private package visibility.
      viewerMode: "anonymous",
    });

    return {
      items: data?.items ?? [],
      nextCursor: data?.nextCursor ?? null,
      totalCount: data?.totalCount ?? null,
      rateLimited: false,
      retryAfterSeconds: null,
      isLoading: false,
      apiError: false,
    };
  } catch (error) {
    if (isNavigationAbortError(args.signal)) throw error;
    if (isRateLimitedPackageApiError(error)) {
      return {
        items: [],
        nextCursor: null,
        rateLimited: true,
        retryAfterSeconds: error.retryAfterSeconds,
        totalCount: null,
        isLoading: false,
        apiError: false,
      };
    }

    return {
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
      totalCount: null,
      isLoading: false,
      apiError: true,
    };
  } finally {
    clearTimeout(timeoutId);
    args.signal?.removeEventListener("abort", abortFromNavigation);
  }
}

export const Route = createFileRoute("/plugins/")({
  pendingComponent: PluginsIndexPending,
  validateSearch: (search): PluginSearchState => {
    const q = typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined;
    const category =
      typeof search.category === "string"
        ? resolvePluginBrowseCategorySlug(search.category)
        : undefined;
    const featured =
      search.featured === true || search.featured === "true" || search.featured === "1"
        ? true
        : undefined;
    const official =
      search.official === true ||
      search.official === "true" ||
      search.official === "1" ||
      search.verified === true ||
      search.verified === "true" ||
      search.verified === "1"
        ? true
        : undefined;
    const legacyInstallSort = search.sort === "installs";
    const noExplicitSort = search.sort === undefined;
    const staleImplicitFilteredCursor =
      noExplicitSort && !q && hasPersistentPluginBrowseFilter({ category, featured, official });
    return {
      q,
      category,
      topic: parseBrowseTopicFromSearchInput(search as Record<string, unknown>),
      cursor:
        !legacyInstallSort &&
        !staleImplicitFilteredCursor &&
        typeof search.cursor === "string" &&
        search.cursor
          ? search.cursor
          : undefined,
      featured,
      official,
      sort: parsePluginSort(search.sort),
      view: normalizePluginView(search.view),
    };
  },
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    const incompatibleSort =
      search.sort &&
      search.sort !== "recommended" &&
      search.sort !== "updated" &&
      search.sort !== "downloads" &&
      search.sort !== "trending" &&
      !(hasQuery && search.sort === "relevance");
    const staleFeatured = Boolean(hasQuery && search.featured);
    if (incompatibleSort || staleFeatured) {
      throw redirect({
        to: "/plugins",
        search: {
          ...search,
          featured: staleFeatured ? undefined : search.featured,
          sort: incompatibleSort ? undefined : search.sort,
        },
        replace: true,
      });
    }
  },
  loaderDeps: ({ search }) => {
    const hasQuery = Boolean(search.q);
    return {
      q: search.q,
      category: search.category,
      topic: search.topic,
      cursor: hasQuery ? undefined : search.cursor,
      featured: search.featured,
      official: search.official,
      sort: hasQuery ? undefined : normalizeActivePluginSort(search.sort),
    };
  },
  loader: async ({ deps, abortController }): Promise<PluginsLoaderData> =>
    await loadPluginsPageData({
      ...deps,
      signal: abortController.signal,
    }),
  component: PluginsIndex,
});

function PluginsIndexPending() {
  return (
    <main className="browse-page browse-page-borderless-header">
      <div className="browse-page-header">
        <h1 className="browse-title">Plugins</h1>
      </div>
      <BrowseControls>
        <BrowseControlsRow>
          <BrowseTabs
            ariaLabel="Sort order"
            options={PLUGIN_BROWSE_TABS}
            value="recommended"
            onChange={() => {}}
          />
          <BrowseActions>
            <BrowseSearchTrigger open={false} onOpen={() => {}} label="Search plugins" disabled />
            <BrowseCategorySelect
              categories={PLUGIN_CATEGORIES}
              value={undefined}
              onChange={() => {}}
              responsive
            />
            <BrowseViewToggle view="list" onToggle={() => {}} />
          </BrowseActions>
        </BrowseControlsRow>
      </BrowseControls>
      <div className="browse-layout browse-layout-with-sidebar">
        <BrowseCategorySidebar
          ariaLabel="Plugin categories"
          categories={PLUGIN_CATEGORIES}
          value={undefined}
          onChange={() => {}}
          disabled
        />
        <div className="browse-results">
          <BrowseResultsSkeleton label="Plugin" />
        </div>
      </div>
    </main>
  );
}

function PluginsIndex() {
  const routeSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const { search, activeTopic } = useBrowseTopicSearch(routeSearch, navigate);
  const initialLoaderData = Route.useLoaderData() as PluginsLoaderData | undefined;
  const [catalogState, setCatalogState] = useState(() => ({
    loaderData: initialLoaderData,
    data: initialLoaderData ?? createPluginsLoadingData(),
  }));
  const catalogData =
    catalogState.loaderData === initialLoaderData
      ? catalogState.data
      : (initialLoaderData ?? catalogState.data);

  // Defensive handling for when loader data is unavailable (SSR errors, etc.)
  const items = catalogData.items;
  const nextCursor = catalogData.nextCursor;
  const rateLimited = catalogData.rateLimited;
  const retryAfterSeconds = catalogData.retryAfterSeconds;
  const isLoading = catalogData.isLoading ?? false;
  const apiError = catalogData.apiError ?? false;
  const view = normalizePluginView(search.view) ?? "list";
  const isMobileBrowse = useMediaQuery("(max-width: 760px)");
  const effectiveView = isMobileBrowse ? "list" : view;

  const [query, setQuery] = useState(search.q ?? "");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreAbortControllerRef = useRef<AbortController | null>(null);
  const searchNavigateTimer = useRef<number>(0);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  const hasQuery = Boolean(search.q?.trim());
  const hasActiveFilters =
    hasQuery ||
    Boolean(search.category) ||
    Boolean(activeTopic) ||
    Boolean(search.official) ||
    Boolean(search.featured);
  const shouldResolveTotalCount =
    !hasActiveFilters && !search.cursor && catalogData.totalCount == null;
  const totalPluginsCount = useQuery(
    api.packages.countPublicPlugins,
    shouldResolveTotalCount ? {} : "skip",
  );
  const totalCount = catalogData.totalCount ?? totalPluginsCount ?? null;
  const formattedCount = !hasActiveFilters && !search.cursor ? formatBrowseCount(totalCount) : null;

  useEffect(() => {
    if (initialLoaderData) {
      loadMoreAbortControllerRef.current?.abort();
      loadMoreAbortControllerRef.current = null;
      setIsLoadingMore(false);
      loadMoreInFlightRef.current = false;
      setCatalogState({ loaderData: initialLoaderData, data: initialLoaderData });
    }
    return () => loadMoreAbortControllerRef.current?.abort();
  }, [initialLoaderData]);

  const activeCategory = search.category;
  const categoryTopics = useQuery(
    api.catalogTopics.listTopByCategory,
    activeCategory
      ? {
          kind: "plugin",
          category: activeCategory,
        }
      : "skip",
  );

  const activeSort: PluginSort =
    search.sort === "installs"
      ? "downloads"
      : search.sort === "relevance" || search.sort === "newest" || search.sort === "name"
        ? "recommended"
        : (search.sort ?? (hasQuery ? "recommended" : getDefaultPluginBrowseSort(search)));
  const activeBrowseTab: PluginBrowseTab = search.official ? "official" : activeSort;
  const visibleItems = useMemo(() => {
    return hasQuery ? sortPluginSearchItems(items, activeSort) : items;
  }, [activeSort, hasQuery, items]);
  const handleBrowseTabChange = (value: string | undefined) => {
    if (value === "official") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          family: undefined,
          official: true,
          sort: undefined,
        }),
        replace: true,
      });
      return;
    }

    handleSortChange(value ?? "recommended");
  };

  const handleSortChange = (value: string) => {
    const nextSort = parsePluginSort(value) ?? "recommended";

    void navigate({
      search: (prev: PluginSearchState) => {
        const isExplicitFilteredRecommendation =
          nextSort === "recommended" && !prev.q && hasPersistentPluginBrowseFilter(prev);
        const sort =
          isExplicitFilteredRecommendation || nextSort === "downloads"
            ? nextSort
            : nextSort === "updated" || nextSort === "trending"
              ? nextSort
              : undefined;
        const nextSearch: PluginSearchState = {
          ...prev,
          cursor: undefined,
          family: undefined,
          featured: prev.q ? undefined : prev.featured,
          sort,
        };
        delete nextSearch.official;
        return nextSearch;
      },
      replace: true,
    });
  };

  const handleCategoryChange = (slug: string | undefined) => {
    const category = slug && isPluginCategorySlug(slug) ? slug : undefined;
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        category,
        topic: undefined,
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
  };

  const handleTopicChange = (topic: string | undefined) => {
    void navigate({
      search: (prev: PluginSearchState) =>
        sanitizeBrowseTopicSearch(
          {
            ...prev,
            cursor: undefined,
            family: undefined,
          },
          topic ?? null,
        ),
      replace: true,
    });
  };

  useEffect(() => {
    return () => window.clearTimeout(searchNavigateTimer.current);
  }, []);

  const navigateToPluginSearch = useCallback(
    (next: string, replace: boolean) => {
      const trimmed = next.trim();
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          family: undefined,
          q: trimmed ? next : undefined,
          featured: undefined,
          sort: undefined,
        }),
        replace,
      });
    },
    [navigate],
  );

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      window.clearTimeout(searchNavigateTimer.current);
      searchNavigateTimer.current = window.setTimeout(() => {
        navigateToPluginSearch(next, true);
      }, 250);
    },
    [navigateToPluginSearch],
  );

  const handleSearchSubmit = () => {
    window.clearTimeout(searchNavigateTimer.current);
    navigateToPluginSearch(query, false);
  };

  const handleClearSearch = () => {
    window.clearTimeout(searchNavigateTimer.current);
    setQuery("");
    searchInputRef.current?.focus();
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        q: undefined,
        cursor: undefined,
        sort: undefined,
        featured: undefined,
      }),
      replace: true,
    });
  };
  const browseSearch = useBrowseSearchDisclosure({
    value: query,
    onClear: handleClearSearch,
    inputRef: searchInputRef,
  });

  const handleToggleView = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        view: normalizePluginView(prev.view) === "grid" ? undefined : "grid",
      }),
      replace: true,
    });
  };

  const canLoadMore =
    !hasQuery && !isLoading && !apiError && !rateLimited && Boolean(nextCursor) && !isLoadingMore;

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadMoreInFlightRef.current) return;
    const controller = new AbortController();
    loadMoreAbortControllerRef.current = controller;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      const data = await loadPluginsPageData({
        q: search.q,
        category: search.category,
        topic: search.topic,
        cursor: nextCursor,
        featured: search.featured,
        official: search.official,
        sort: normalizeActivePluginSort(search.sort),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setCatalogState((previous) => {
        if (previous.loaderData !== initialLoaderData) return previous;
        return {
          ...previous,
          data: {
            ...data,
            items: [...previous.data.items, ...data.items],
          },
        };
      });
    } catch (error) {
      if (!isNavigationAbortError(controller.signal)) throw error;
    } finally {
      if (loadMoreAbortControllerRef.current === controller) {
        loadMoreAbortControllerRef.current = null;
        setIsLoadingMore(false);
        loadMoreInFlightRef.current = false;
      }
    }
  }, [
    initialLoaderData,
    nextCursor,
    search.category,
    search.featured,
    search.official,
    search.q,
    search.sort,
    search.topic,
  ]);

  useEffect(() => {
    if (!canLoadMore || typeof IntersectionObserver === "undefined") return () => {};
    const target = loadMoreRef.current;
    if (!target) return () => {};
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMore, loadMore]);

  return (
    <main className="browse-page browse-page-borderless-header">
      <div className="browse-page-header">
        <div className="browse-page-header-main">
          <h1 className="browse-title">
            Plugins
            {formattedCount ? (
              <>
                {" "}
                <span className="browse-count">{formattedCount}</span>
              </>
            ) : null}
          </h1>
        </div>
      </div>
      <BrowseControls>
        <BrowseControlsRow>
          <BrowseTabs
            ariaLabel="Sort order"
            options={PLUGIN_BROWSE_TABS}
            value={activeBrowseTab}
            onChange={handleBrowseTabChange}
          />
          <BrowseActions>
            <BrowseSearchTrigger
              open={browseSearch.open}
              onOpen={browseSearch.openSearch}
              label="Search plugins"
            />
            <BrowseCategorySelect
              categories={PLUGIN_CATEGORIES}
              value={activeCategory}
              onChange={handleCategoryChange}
              responsive
            />
            <BrowseViewToggle view={view} onToggle={handleToggleView} />
          </BrowseActions>
          <BrowseSearchPanel open={browseSearch.open}>
            <BrowseSearchInput
              inputRef={searchInputRef}
              label="plugin search"
              placeholder="Search plugins..."
              value={query}
              onChange={handleQueryChange}
              onClear={browseSearch.closeSearch}
              onSubmit={handleSearchSubmit}
              closeLabel="Close search"
            />
          </BrowseSearchPanel>
        </BrowseControlsRow>
        <BrowseTopicChips
          topics={categoryTopics ?? []}
          activeTopic={activeTopic}
          onChange={handleTopicChange}
          loading={Boolean(activeCategory && categoryTopics === undefined)}
        />
      </BrowseControls>
      <div className="browse-layout browse-layout-with-sidebar">
        <BrowseCategorySidebar
          ariaLabel="Plugin categories"
          categories={PLUGIN_CATEGORIES}
          value={activeCategory}
          onChange={handleCategoryChange}
        />
        <div className="browse-results">
          {isLoading ? (
            <BrowseResultsSkeleton label="Plugin" variant={effectiveView} />
          ) : apiError ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">Unable to load plugins</p>
              <p className="empty-state-body">
                The plugin catalog is temporarily unavailable. Please try again later.
              </p>
            </div>
          ) : rateLimited ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">Plugin catalog is temporarily unavailable</p>
              <p className="empty-state-body">Try again {formatRetryDelay(retryAfterSeconds)}.</p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No plugins found</p>
              <p className="empty-state-body">Try a different search term or remove filters.</p>
              <Button asChild size="sm" className="mt-4">
                <Link
                  to="/add"
                  search={{ kind: "plugin", ownerHandle: undefined, method: undefined }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add a plugin
                </Link>
              </Button>
            </div>
          ) : effectiveView === "grid" ? (
            <div className="grid browse-results-grid">
              {visibleItems.map((item) => (
                <PluginListItem key={item.name} item={item} variant="card" />
              ))}
            </div>
          ) : (
            <div className="browse-list-stack">
              <div className="browse-list-head" aria-hidden="true">
                <span className="browse-list-head-icon-spacer" />
                <span className="browse-list-head-label">Plugin</span>
                <span className="browse-list-head-label">Category</span>
                <span className="browse-list-head-label browse-list-head-stat">Popularity</span>
              </div>
              <div className="results-list">
                {visibleItems.map((item) => (
                  <PluginListItem key={item.name} item={item} variant="list" />
                ))}
              </div>
            </div>
          )}

          {!isLoading && !hasQuery && (nextCursor || isLoadingMore) ? (
            <div ref={loadMoreRef} className="mt-5 flex justify-center">
              <Button variant="primary" type="button" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
