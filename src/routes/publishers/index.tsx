import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutGrid, List, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { PublisherListItem } from "../../components/PublisherListItem";
import { Button } from "../../components/ui/button";
import { convexHttp } from "../../convex/client";
import type { PublicPublisherListItem } from "../../lib/publicUser";
import { getSiteMode, getSiteName, getSiteUrlForMode } from "../../lib/site";

type PublisherKindSearch = "orgs" | "builders";
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

function listedCountLabel(value: number, total: number, kind?: PublisherKindSearch) {
  const label =
    kind === "orgs"
      ? total === 1
        ? "org"
        : "orgs"
      : kind === "builders"
        ? total === 1
          ? "builder"
          : "builders"
        : total === 1
          ? "publisher"
          : "publishers";
  return total > value ? `Showing ${value} of ${total} ${label}` : `Showing all ${total} ${label}`;
}

export const Route = createFileRoute("/publishers/")({
  validateSearch: (search): PublishersSearchState => ({
    kind:
      search.kind === "orgs" || search.kind === "builders" || search.kind === "individuals"
        ? search.kind === "individuals"
          ? "builders"
          : search.kind
        : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    view: search.view === "grid" ? "grid" : undefined,
  }),
  loaderDeps: ({ search }) => search,
  head: () => {
    const mode = getSiteMode();
    const siteName = getSiteName(mode);
    const siteUrl = getSiteUrlForMode(mode);
    const title = `Publishers · ${siteName}`;
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
      kind: deps.kind === "orgs" ? "org" : deps.kind === "builders" ? "user" : undefined,
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
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const counts = result.counts ?? {
    all: publishers.length,
    organizations: publishers.filter((publisher) => publisher.kind === "org").length,
    individuals: publishers.filter((publisher) => publisher.kind === "user").length,
  };
  const globalCounts = result.globalCounts ?? counts;
  const activeKind = search.kind;
  const activeView = search.view ?? "list";
  const activeTotal =
    activeKind === "orgs"
      ? counts.organizations
      : activeKind === "builders"
        ? counts.individuals
        : counts.all;
  const canLoadMore = Boolean(nextCursor);
  const hasQuery = Boolean(search.q?.trim());
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

  const handleClear = useCallback(() => {
    setQuery("");
    void navigate({
      search: (prev: PublishersSearchState) => ({
        ...prev,
        q: undefined,
        kind: undefined,
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
        kind: activeKind === "orgs" ? "org" : activeKind === "builders" ? "user" : undefined,
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
        <h1 className="browse-title">
          Publishers
          <span className="browse-count">{globalCounts.all}</span>
        </h1>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          className="browse-search-input"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search publishers..."
        />
      </div>

      <div className="browse-results publishers-results">
        {highlightedPublishers.length > 0 ? (
          <section className="publisher-highlights" aria-labelledby="publisher-highlights-title">
            <div className="publisher-section-heading">
              <h2 id="publisher-highlights-title">Popular publishers</h2>
            </div>
            <div className="publisher-highlight-grid">
              {highlightedPublishers.map((publisher) => (
                <PublisherListItem key={publisher._id} publisher={publisher} variant="highlight" />
              ))}
            </div>
          </section>
        ) : null}

        <div className="browse-results-toolbar publishers-toolbar">
          <span className="browse-results-count publisher-listed-count">
            {listedCountLabel(publishers.length, activeTotal, activeKind)}
            {hasQuery || activeKind ? (
              <button className="browse-clear-btn" type="button" onClick={handleClear}>
                Clear
              </button>
            ) : null}
          </span>
          <div className="publisher-toolbar-controls">
            <nav className="publisher-filter-tabs" aria-label="Publisher type">
              <Link
                to="/publishers"
                search={{ q: search.q, view: search.view }}
                className={`publisher-filter-tab${!activeKind ? " is-active" : ""}`}
              >
                All <span>{counts.all}</span>
              </Link>
              <Link
                to="/publishers"
                search={{ q: search.q, kind: "orgs", view: search.view }}
                className={`publisher-filter-tab${activeKind === "orgs" ? " is-active" : ""}`}
              >
                Orgs <span>{counts.organizations}</span>
              </Link>
              <Link
                to="/publishers"
                search={{ q: search.q, kind: "builders", view: search.view }}
                className={`publisher-filter-tab${activeKind === "builders" ? " is-active" : ""}`}
              >
                Builders <span>{counts.individuals}</span>
              </Link>
            </nav>
            <nav className="publisher-filter-tabs publisher-view-tabs" aria-label="Publisher view">
              <Link
                to="/publishers"
                search={{ q: search.q, kind: search.kind }}
                resetScroll={false}
                aria-label="List view"
                className={`publisher-filter-tab${activeView === "list" ? " is-active" : ""}`}
              >
                <List size={14} aria-hidden="true" />
              </Link>
              <Link
                to="/publishers"
                search={{ q: search.q, kind: search.kind, view: "grid" }}
                resetScroll={false}
                aria-label="Grid view"
                className={`publisher-filter-tab${activeView === "grid" ? " is-active" : ""}`}
              >
                <LayoutGrid size={14} aria-hidden="true" />
              </Link>
            </nav>
          </div>
        </div>

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
    </main>
  );
}
