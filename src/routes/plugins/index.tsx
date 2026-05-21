import { createFileRoute, redirect } from "@tanstack/react-router";
import { isPluginCategorySlug } from "clawhub-schema";
import { PackageSearch, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { PLUGIN_CATEGORIES } from "../../lib/categories";
import {
  fetchPluginCatalog,
  isRateLimitedPackageApiError,
  type PackageListItem,
} from "../../lib/packageApi";

type PluginSort = "relevance" | "updated" | "newest" | "name";

const PLUGINS_PAGE_SIZE = 100;

type PluginSearchState = {
  q?: string;
  category?: string;
  cursor?: string;
  family?: undefined;
  featured?: boolean;
  verified?: boolean;
  executesCode?: boolean;
  sort?: PluginSort;
  view?: LegacyPluginView;
};

type PluginView = "list" | "grid";
type LegacyPluginView = PluginView | "cards";

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
  apiError?: boolean;
};

function formatRetryDelay(retryAfterSeconds: number | null) {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return "in a moment";
  if (retryAfterSeconds < 60) {
    return `in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function parsePluginSort(value: unknown): PluginSort | undefined {
  if (value === "relevance" || value === "updated" || value === "newest" || value === "name") {
    return value;
  }
  return undefined;
}

function sortPluginSearchItems(items: PackageListItem[], sort: PluginSort) {
  if (sort === "relevance") return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    const tieBreak = () =>
      b.updatedAt - a.updatedAt ||
      b.createdAt - a.createdAt ||
      a.family.localeCompare(b.family) ||
      a.name.localeCompare(b.name);

    if (sort === "name") {
      return (
        a.displayName.localeCompare(b.displayName) ||
        a.name.localeCompare(b.name) ||
        a.family.localeCompare(b.family)
      );
    }

    if (sort === "newest") {
      return (
        b.createdAt - a.createdAt ||
        b.updatedAt - a.updatedAt ||
        a.family.localeCompare(b.family) ||
        a.name.localeCompare(b.name)
      );
    }

    return tieBreak();
  });
  return sorted;
}

export const Route = createFileRoute("/plugins/")({
  pendingComponent: PluginsIndexPending,
  validateSearch: (search): PluginSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    category:
      typeof search.category === "string" && isPluginCategorySlug(search.category)
        ? search.category
        : undefined,
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
    featured:
      search.featured === true || search.featured === "true" || search.featured === "1"
        ? true
        : undefined,
    verified:
      search.verified === true || search.verified === "true" || search.verified === "1"
        ? true
        : undefined,
    executesCode:
      search.executesCode === true || search.executesCode === "true" || search.executesCode === "1"
        ? true
        : undefined,
    sort: parsePluginSort(search.sort),
    view: normalizePluginView(search.view),
  }),
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    const incompatibleSort = !hasQuery && search.sort && search.sort !== "updated";
    const browseOnlyFeatured = hasQuery && search.featured;
    const invalidCategory = Boolean(search.category && !isPluginCategorySlug(search.category));
    if (incompatibleSort || browseOnlyFeatured || invalidCategory) {
      throw redirect({
        to: "/plugins",
        search: {
          ...search,
          category: invalidCategory ? undefined : search.category,
          featured: browseOnlyFeatured ? undefined : search.featured,
          sort: incompatibleSort ? undefined : search.sort,
        },
        replace: true,
      });
    }
  },
  loaderDeps: ({ search }) => ({
    q: search.q,
    category: search.category,
    cursor: search.cursor,
    featured: search.featured,
    verified: search.verified,
    executesCode: search.executesCode,
  }),
  loader: async ({ deps }): Promise<PluginsLoaderData> => {
    try {
      const data = await fetchPluginCatalog({
        q: deps.q,
        category: deps.category,
        cursor: deps.q ? undefined : deps.cursor,
        featured: deps.featured,
        isOfficial: deps.verified,
        executesCode: deps.executesCode,
        limit: PLUGINS_PAGE_SIZE,
      });

      return {
        items: data?.items ?? [],
        nextCursor: data?.nextCursor ?? null,
        rateLimited: false,
        retryAfterSeconds: null,
        apiError: false,
      };
    } catch (error) {
      if (isRateLimitedPackageApiError(error)) {
        return {
          items: [],
          nextCursor: null,
          rateLimited: true,
          retryAfterSeconds: error.retryAfterSeconds,
          apiError: false,
        };
      }

      return {
        items: [],
        nextCursor: null,
        rateLimited: false,
        retryAfterSeconds: null,
        apiError: true,
      };
    }
  },
  component: PluginsIndex,
});

function PluginsIndexPending() {
  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button className="browse-sidebar-toggle" type="button" disabled>
          Filters
        </button>
        <h1 className="browse-title">Plugins</h1>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input className="browse-search-input" placeholder="Search plugins..." disabled />
      </div>
      <div className="browse-layout">
        <BrowseSidebar
          categories={PLUGIN_CATEGORIES}
          activeCategory={undefined}
          onCategoryChange={() => {}}
          sortOptions={[
            { value: "featured", label: "Featured" },
            { value: "updated", label: "Recently updated" },
          ]}
          activeSort="updated"
          onSortChange={() => {}}
          filters={[
            { key: "verified", label: "Verified only", active: false },
            { key: "executesCode", label: "Executes code", active: false },
          ]}
          onFilterToggle={() => {}}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">Loading results</span>
            <div className="browse-view-toggle">
              <button className="browse-view-btn is-active" type="button" disabled>
                List
              </button>
              <button className="browse-view-btn" type="button" disabled>
                Grid
              </button>
            </div>
          </div>
          <BrowseResultsSkeleton />
        </div>
      </div>
    </main>
  );
}

function PluginsIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const loaderData = Route.useLoaderData() as PluginsLoaderData | undefined;

  // Defensive handling for when loader data is unavailable (SSR errors, etc.)
  const items = loaderData?.items ?? [];
  const nextCursor = loaderData?.nextCursor ?? null;
  const rateLimited = loaderData?.rateLimited ?? false;
  const retryAfterSeconds = loaderData?.retryAfterSeconds ?? null;
  const apiError = loaderData?.apiError ?? !loaderData;
  const view = normalizePluginView(search.view) ?? "list";

  const [query, setQuery] = useState(search.q ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  const hasQuery = Boolean(search.q?.trim());

  const activeCategory = search.category;

  const activeSort = hasQuery
    ? (search.sort ?? "relevance")
    : search.featured
      ? "featured"
      : "updated";
  const visibleItems = useMemo(
    () => (hasQuery ? sortPluginSearchItems(items, activeSort as PluginSort) : items),
    [activeSort, hasQuery, items],
  );

  const sortOptions = useMemo(() => {
    if (hasQuery) {
      return [
        { value: "relevance", label: "Relevance" },
        { value: "updated", label: "Recently updated" },
        { value: "newest", label: "Newest" },
        { value: "name", label: "Name" },
      ];
    }
    return [
      { value: "featured", label: "Featured" },
      { value: "updated", label: "Recently updated" },
    ];
  }, [hasQuery]);

  const handleFilterToggle = (key: string) => {
    if (key === "verified") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          verified: prev.verified ? undefined : true,
        }),
      });
    } else if (key === "executesCode") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          executesCode: prev.executesCode ? undefined : true,
        }),
      });
    }
  };

  const handleSortChange = (value: string) => {
    if (value === "featured") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          featured: true,
          family: undefined,
          q: undefined,
          sort: undefined,
        }),
      });
      return;
    }

    if (hasQuery) {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          family: undefined,
          featured: undefined,
          sort: parsePluginSort(value) === "relevance" ? undefined : parsePluginSort(value),
        }),
        replace: true,
      });
      return;
    }

    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        featured: undefined,
        sort: parsePluginSort(value) === "updated" ? undefined : parsePluginSort(value),
      }),
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
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        q: query.trim() || undefined,
        featured: undefined,
        sort: undefined,
      }),
    });
  };

  const handleToggleView = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        view: normalizePluginView(prev.view) === "grid" ? undefined : "grid",
      }),
      replace: true,
    });
  };

  const handleClear = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        q: undefined,
        category: undefined,
        verified: undefined,
        executesCode: undefined,
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
    setQuery("");
  };

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button
          className="browse-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle filters"
        >
          Filters
        </button>
        <h1 className="browse-title">
          Plugins <span className="browse-count">{visibleItems.length}</span>
        </h1>
      </div>
      <form className="browse-page-search" onSubmit={handleSearch}>
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          className="browse-search-input"
          placeholder="Search plugins..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={PLUGIN_CATEGORIES}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={sortOptions}
          activeSort={activeSort}
          onSortChange={handleSortChange}
          filters={[
            { key: "verified", label: "Verified only", active: search.verified ?? false },
            { key: "executesCode", label: "Executes code", active: search.executesCode ?? false },
          ]}
          onFilterToggle={handleFilterToggle}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {visibleItems.length} result{visibleItems.length !== 1 ? "s" : ""}
              {hasQuery ||
              search.category ||
              search.verified ||
              search.executesCode ||
              search.featured ? (
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  Clear
                </button>
              ) : null}
            </span>
            <div className="browse-view-toggle">
              <button
                className={`browse-view-btn${view === "list" ? " is-active" : ""}`}
                type="button"
                onClick={view === "grid" ? handleToggleView : undefined}
              >
                List
              </button>
              <button
                className={`browse-view-btn${view === "grid" ? " is-active" : ""}`}
                type="button"
                onClick={view === "list" ? handleToggleView : undefined}
              >
                Grid
              </button>
            </div>
          </div>

          {apiError ? (
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
            </div>
          ) : (
            <div className={view === "grid" ? "grid" : "results-list"}>
              {visibleItems.map((item) => (
                <PluginListItem
                  key={item.name}
                  item={item}
                  variant={view === "grid" ? "card" : "list"}
                />
              ))}
            </div>
          )}

          {!hasQuery && (search.cursor || nextCursor) ? (
            <div className="mt-5 flex justify-center gap-3">
              {search.cursor ? (
                <Button
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev: PluginSearchState) => ({ ...prev, cursor: undefined }),
                    });
                  }}
                >
                  First page
                </Button>
              ) : null}
              {nextCursor ? (
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev: PluginSearchState) => ({ ...prev, cursor: nextCursor }),
                    });
                  }}
                >
                  Next page
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
