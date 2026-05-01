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
  featured?: boolean;
  verified?: boolean;
  executesCode?: boolean;
  hostTarget?: "darwin-arm64" | "linux-x64-glibc" | "win32-x64";
  environment?: "browser" | "desktop" | "network";
};

const HOST_TARGET_FILTERS = {
  mac: "darwin-arm64",
  linux: "linux-x64-glibc",
  windows: "win32-x64",
} as const;

const ENVIRONMENT_FILTERS = {
  browser: "browser",
  desktop: "desktop",
  network: "network",
} as const;

type HostTargetFilterKey = keyof typeof HOST_TARGET_FILTERS;
type EnvironmentFilterKey = keyof typeof ENVIRONMENT_FILTERS;

function isHostTargetFilterKey(key: string): key is HostTargetFilterKey {
  return key in HOST_TARGET_FILTERS;
}

function isEnvironmentFilterKey(key: string): key is EnvironmentFilterKey {
  return key in ENVIRONMENT_FILTERS;
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

export const Route = createFileRoute("/plugins/")({
  validateSearch: (search): PluginSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
    family:
      search.family === "code-plugin" || search.family === "bundle-plugin"
        ? search.family
        : undefined,
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
    hostTarget:
      search.hostTarget === "darwin-arm64" ||
      search.hostTarget === "linux-x64-glibc" ||
      search.hostTarget === "win32-x64"
        ? search.hostTarget
        : undefined,
    environment:
      search.environment === "browser" ||
      search.environment === "desktop" ||
      search.environment === "network"
        ? search.environment
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }): Promise<PluginsLoaderData> => {
    try {
      const data = await fetchPluginCatalog({
        q: deps.q,
        cursor: deps.q ? undefined : deps.cursor,
        family: deps.family,
        featured: deps.featured,
        isOfficial: deps.verified,
        executesCode: deps.executesCode,
        hostTarget: deps.hostTarget,
        environment: deps.environment,
        limit: 50,
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
    } else if (isHostTargetFilterKey(key)) {
      const hostTarget = HOST_TARGET_FILTERS[key];
      void navigate({
        search: (prev) => ({
          ...prev,
          cursor: undefined,
          hostTarget: prev.hostTarget === hostTarget ? undefined : hostTarget,
        }),
      });
    } else if (isEnvironmentFilterKey(key)) {
      const environment = ENVIRONMENT_FILTERS[key];
      void navigate({
        search: (prev) => ({
          ...prev,
          cursor: undefined,
          environment: prev.environment === environment ? undefined : environment,
        }),
      });
    }
  };

  const handleFamilySort = (value: string) => {
    if (value === "featured") {
      void navigate({
        search: (prev) => ({
          ...prev,
          cursor: undefined,
          featured: true,
          family: undefined,
        }),
      });
      return;
    }

    const family = value === "code-plugin" || value === "bundle-plugin" ? value : undefined;
    void navigate({
      search: (prev) => ({
        ...prev,
        cursor: undefined,
        featured: undefined,
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
        <button
          className="browse-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle filters"
        >
          Filters
        </button>
        <h1 className="browse-title">Plugins</h1>
        <div className="browse-page-actions">
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
            { value: "featured", label: "Featured" },
            { value: "all", label: "All types" },
            { value: "code-plugin", label: "Code plugins" },
            { value: "bundle-plugin", label: "Bundle plugins" },
          ]}
          activeSort={search.featured ? "featured" : (search.family ?? "all")}
          onSortChange={handleFamilySort}
          filters={[
            { key: "verified", label: "Verified only", active: search.verified ?? false },
            { key: "executesCode", label: "Executes code", active: search.executesCode ?? false },
            {
              key: "mac",
              label: "macOS ready",
              active: search.hostTarget === HOST_TARGET_FILTERS.mac,
            },
            {
              key: "linux",
              label: "Linux ready",
              active: search.hostTarget === HOST_TARGET_FILTERS.linux,
            },
            {
              key: "windows",
              label: "Windows ready",
              active: search.hostTarget === HOST_TARGET_FILTERS.windows,
            },
            {
              key: "browser",
              label: "Browser needed",
              active: search.environment === ENVIRONMENT_FILTERS.browser,
            },
            {
              key: "desktop",
              label: "Desktop needed",
              active: search.environment === ENVIRONMENT_FILTERS.desktop,
            },
            {
              key: "network",
              label: "Network needed",
              active: search.environment === ENVIRONMENT_FILTERS.network,
            },
          ]}
          onFilterToggle={handleFilterToggle}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {items.length} plugin{items.length !== 1 ? "s" : ""}
            </span>
          </div>

          {apiError ? (
            <div className="empty-state">
              <AlertTriangle size={20} aria-hidden="true" />
              <p className="empty-state-title">Unable to load plugins</p>
              <p className="empty-state-body">
                The plugin catalog is temporarily unavailable. Please try again later.
              </p>
            </div>
          ) : rateLimited ? (
            <div className="empty-state">
              <AlertTriangle size={20} aria-hidden="true" />
              <p className="empty-state-title">Plugin catalog is temporarily unavailable</p>
              <p className="empty-state-body">Try again {formatRetryDelay(retryAfterSeconds)}.</p>
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
