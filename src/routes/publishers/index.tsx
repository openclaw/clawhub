import { createFileRoute } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { PublisherListItem } from "../../components/PublisherListItem";
import { Button } from "../../components/ui/button";
import { convexHttp } from "../../convex/client";
import { formatBrowseCount } from "../../lib/browseCount";
import type { PublicPublisherListItem } from "../../lib/publicUser";
import { getClawHubSiteUrl, SITE_NAME } from "../../lib/site";

type PublisherKindSearch = "orgs" | "people";
type PublisherViewSearch = "list" | "grid";

type PublishersSearchState = {
  kind?: PublisherKindSearch;
  q?: string;
  view?: PublisherViewSearch;
};

type PublishersLoaderResult = {
  page: PublicPublisherListItem[];
  counts: {
    all: number;
    organizations: number;
    individuals: number;
  };
  globalCounts?: {
    all: number;
    organizations: number;
    individuals: number;
  };
  continueCursor: string;
  isDone: boolean;
};

const PUBLISHER_PAGE_SIZE = 25;

function normalizePublisherKind(value: unknown): PublisherKindSearch | undefined {
  if (value === "orgs") return "orgs";
  if (value === "people" || value === "builders" || value === "individuals") return "people";
  return undefined;
}

export const Route = createFileRoute("/publishers/")({
  validateSearch: (search): PublishersSearchState => ({
    kind: normalizePublisherKind(search.kind),
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    view: search.view === "grid" ? "grid" : undefined,
  }),
  loaderDeps: ({ search }) => search,
  head: () => {
    const siteUrl = getClawHubSiteUrl();
    const title = `Publishers · ${SITE_NAME}`;
    const description =
      "Discover the people and organizations publishing skills, plugins, packages, and ecosystem tooling on ClawHub.";

    return {
      links: [
        {
          rel: "canonical",
          href: `${siteUrl}/publishers`,
        },
      ],
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${siteUrl}/publishers` },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  loader: async ({ deps }): Promise<PublishersLoaderResult> =>
    (await convexHttp.query(api.publishers.listPublicPage, {
      kind: deps.kind === "orgs" ? "org" : deps.kind === "people" ? "user" : undefined,
      query: deps.q,
      paginationOpts: { cursor: null, numItems: PUBLISHER_PAGE_SIZE },
    })) as PublishersLoaderResult,
  component: PublishersIndex,
});

function PublishersIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const result = Route.useLoaderData() as PublishersLoaderResult;
  const [query, setQuery] = useState(search.q ?? "");
  const [publishers, setPublishers] = useState(result.page);
  const [nextCursor, setNextCursor] = useState<string | null>(
    result.isDone ? null : result.continueCursor,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeKind = search.kind;
  const activeView = search.view ?? "list";
  const canLoadMore = Boolean(nextCursor);
  const hasQuery = Boolean(search.q?.trim());
  const hasActiveFilters = hasQuery || Boolean(activeKind);
  const formattedCount = !hasActiveFilters
    ? formatBrowseCount(result.globalCounts?.all ?? result.counts.all)
    : null;
  const showHighlights = !hasQuery && !activeKind;
  const highlightedPublishers = showHighlights ? publishers.slice(0, 3) : [];
  const directoryPublishers = showHighlights ? publishers.slice(3) : publishers;

  useEffect(() => {
    setQuery(search.q ?? "");
    setPublishers(result.page);
    setNextCursor(result.isDone ? null : result.continueCursor);
    setIsLoadingMore(false);
    loadMoreInFlightRef.current = false;
  }, [result, search.q]);

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      const trimmed = next.trim();
      void navigate({
        search: (prev: PublishersSearchState) => ({
          ...prev,
          q: trimmed ? next : undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleClearQuery = useCallback(() => {
    setQuery("");
    searchInputRef.current?.focus();
    void navigate({
      search: (prev: PublishersSearchState) => ({
        ...prev,
        q: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const handleKindChange = useCallback(
    (kind: string | undefined) => {
      void navigate({
        search: (prev: PublishersSearchState) => ({
          ...prev,
          kind: normalizePublisherKind(kind),
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleToggleView = useCallback(() => {
    void navigate({
      search: (prev: PublishersSearchState) => ({
        ...prev,
        view: prev.view === "grid" ? undefined : "grid",
      }),
      replace: true,
    });
  }, [navigate]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = (await convexHttp.query(api.publishers.listPublicPage, {
        kind: activeKind === "orgs" ? "org" : activeKind === "people" ? "user" : undefined,
        query: search.q,
        paginationOpts: { cursor: nextCursor, numItems: PUBLISHER_PAGE_SIZE },
      })) as PublishersLoaderResult;
      setPublishers((previous) => [...previous, ...page.page]);
      setNextCursor(page.isDone ? null : page.continueCursor);
    } finally {
      setIsLoadingMore(false);
      loadMoreInFlightRef.current = false;
    }
  }, [activeKind, nextCursor, search.q]);

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
          Publishers
          {formattedCount ? (
            <>
              {" "}
              <span className="browse-count">{formattedCount}</span>
            </>
          ) : null}
        </h1>
        <div className="browse-view-toggle">
          <button
            className={`browse-view-btn${activeView === "list" ? " is-active" : ""}`}
            type="button"
            onClick={activeView === "grid" ? handleToggleView : undefined}
          >
            List
          </button>
          <button
            className={`browse-view-btn${activeView === "grid" ? " is-active" : ""}`}
            type="button"
            onClick={activeView === "list" ? handleToggleView : undefined}
          >
            Grid
          </button>
        </div>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="browse-search-input"
          aria-label="Search publishers"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search publishers..."
        />
        {query ? (
          <button
            type="button"
            className="browse-search-clear"
            aria-label="Clear publisher search"
            onClick={handleClearQuery}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          radioGroups={[
            {
              title: "Type",
              ariaLabel: "Publisher type",
              activeValue: activeKind,
              onChange: handleKindChange,
              options: [
                { value: undefined, label: "All" },
                { value: "orgs", label: "Organizations" },
                { value: "people", label: "People" },
              ],
            },
          ]}
        />
        <div className="browse-results">
          {highlightedPublishers.length > 0 ? (
            <section className="publisher-highlights" aria-labelledby="publisher-highlights-title">
              <div className="publisher-section-heading">
                <h2 id="publisher-highlights-title">Popular publishers</h2>
              </div>
              <div className="publisher-highlight-grid">
                {highlightedPublishers.map((publisher) => (
                  <PublisherListItem
                    key={publisher._id}
                    publisher={publisher}
                    variant="highlight"
                  />
                ))}
              </div>
            </section>
          ) : null}

          {publishers.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No publishers found</p>
            </div>
          ) : (
            <div className={`publisher-directory-list publisher-directory-${activeView}`}>
              {directoryPublishers.map((publisher) => (
                <PublisherListItem
                  key={publisher._id}
                  publisher={publisher}
                  variant={activeView === "grid" ? "grid" : "list"}
                />
              ))}
            </div>
          )}
          {canLoadMore || isLoadingMore ? (
            <div ref={loadMoreRef} className="card mt-4 flex justify-center">
              <Button type="button" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
