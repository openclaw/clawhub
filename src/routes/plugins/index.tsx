import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { PluginListItem } from "../../components/PluginListItem";
import { Button } from "../../components/ui/button";
import {
  fetchPluginCatalog,
  isRateLimitedPackageApiError,
  type PackageListItem,
} from "../../lib/packageApi";

type PluginSearchState = {
  q?: string;
  cursor?: string;
  family?: "code-plugin" | "bundle-plugin";
  verified?: boolean;
  executesCode?: boolean;
};

type PluginsLoaderData = {
  items: PackageListItem[];
  nextCursor: string | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
};

function formatRetryDelay(retryAfterSeconds: number | null) {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return "in a moment";
  if (retryAfterSeconds < 60) {
    return `in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export const Route = createFileRoute("/plugins/")({
  validateSearch: (search): PluginSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
    family:
      search.family === "code-plugin" || search.family === "bundle-plugin"
        ? search.family
        : undefined,
    verified:
      search.verified === true || search.verified === "true" || search.verified === "1"
        ? true
        : undefined,
    executesCode:
      search.executesCode === true ||
      search.executesCode === "true" ||
      search.executesCode === "1"
        ? true
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    try {
      const data = await fetchPluginCatalog({
        q: deps.q,
        cursor: deps.q ? undefined : deps.cursor,
        family: deps.family,
        isOfficial: deps.verified,
        executesCode: deps.executesCode,
        limit: 50,
      });
      return {
        items: data.items ?? [],
        nextCursor: data.nextCursor ?? null,
        rateLimited: false,
        retryAfterSeconds: null,
      } satisfies PluginsLoaderData;
    } catch (error) {
      if (isRateLimitedPackageApiError(error)) {
        return {
          items: [],
          nextCursor: null,
          rateLimited: true,
          retryAfterSeconds: (error as { retryAfterSeconds?: number }).retryAfterSeconds ?? null,
        } satisfies PluginsLoaderData;
      }
      throw error;
    }
  },
  component: PluginsIndex,
});

export function PluginsIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { items, nextCursor, rateLimited, retryAfterSeconds } =
    Route.useLoaderData() as PluginsLoaderData;
  const [query, setQuery] = useState(search.q ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  const handleFilterToggle = (key: string) => {
    if (key === "verified") {
      void navigate({
        search: (prev) => ({
          ...prev,
          cursor: undefined,
          verified: prev.verified ? undefined : true,
        }),
      });
    } else if (key === "executesCode") {
      void navigate({
        search: (prev) => ({
          ...prev,
          cursor: undefined,
          executesCode: prev.executesCode ? undefined : true,
        }),
      });
    }
  };

  const handleFamilySort = (value: string) => {
    const family =
      value === "code-plugin" || value === "bundle-plugin" ? value : undefined;
    void navigate({
      search: (prev) => ({
        ...prev,
        cursor: undefined,
        family: family as "code-plugin" | "bundle-plugin" | undefined,
      }),
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: (prev) => ({
        ...prev,
        cursor: undefined,
        q: query.trim() || undefined,
      }),
    });
  };

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <h1 className="browse-title">Plugins</h1>
        <div className="flex items-center gap-2">
          <button
            className="browse-sidebar-toggle"
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle filters"
          >
            Filters
          </button>
          <Button asChild variant="primary">
            <Link
              to="/publish-plugin"
              search={{
                ownerHandle: undefined,
                name: undefined,
                displayName: undefined,
                family: undefined,
                nextVersion: undefined,
                sourceRepo: undefined,
              }}
            >
              Publish
            </Link>
          </Button>
        </div>
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
          sortOptions={[
            { value: "all", label: "All types" },
            { value: "code-plugin", label: "Code plugins" },
            { value: "bundle-plugin", label: "Bundle plugins" },
          ]}
          activeSort={search.family ?? "all"}
          onSortChange={handleFamilySort}
          filters={[
            { key: "verified", label: "Verified only", active: search.verified ?? false },
            { key: "executesCode", label: "Executes code", active: search.executesCode ?? false },
          ]}
          onFilterToggle={handleFilterToggle}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {items.length} plugin{items.length !== 1 ? "s" : ""}
            </span>
          </div>

          {rateLimited ? (
            <div className="empty-state">
              <AlertTriangle size={20} aria-hidden="true" />
              <p className="empty-state-title">Plugin catalog is temporarily unavailable</p>
              <p className="empty-state-body">
                Try again {formatRetryDelay(retryAfterSeconds)}.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No plugins found</p>
              <p className="empty-state-body">Try a different search term or remove filters.</p>
            </div>
          ) : (
            <div className="results-list">
              {items.map((item) => (
                <PluginListItem key={item.name} item={item} />
              ))}
            </div>
          )}

          {!search.q && (search.cursor || nextCursor) ? (
            <div className="mt-5 flex justify-center gap-3">
              {search.cursor ? (
                <Button
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev) => ({ ...prev, cursor: undefined }),
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
                      search: (prev) => ({ ...prev, cursor: nextCursor }),
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
