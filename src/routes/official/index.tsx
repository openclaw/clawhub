import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  BrowseActions,
  BrowseControls,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  useBrowseSearchDisclosure,
} from "../../components/BrowseControls";
import { PublisherListItem } from "../../components/PublisherListItem";
import { Button } from "../../components/ui/button";
import { convexHttp } from "../../convex/client";
import type { PublicPublisherListItem } from "../../lib/publicUser";
import { getClawHubSiteUrl, SITE_NAME } from "../../lib/site";

type OfficialSearchState = {
  q?: string;
};

type OfficialLoaderResult = {
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

async function loadOfficialOrganizationsPage({
  cursor,
  query,
}: {
  cursor: string | null;
  query?: string;
}): Promise<OfficialLoaderResult> {
  return (await convexHttp.query(api.publishers.listPublicPage, {
    kind: "org",
    official: true,
    query,
    paginationOpts: { cursor, numItems: PUBLISHER_PAGE_SIZE },
  })) as OfficialLoaderResult;
}

export const Route = createFileRoute("/official/")({
  validateSearch: (search): OfficialSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
  }),
  head: () => {
    const siteUrl = getClawHubSiteUrl();
    const title = `Official · ${SITE_NAME}`;
    const description = "The organizations behind the top skills and plugins on ClawHub.";

    return {
      links: [
        {
          rel: "canonical",
          href: `${siteUrl}/official`,
        },
      ],
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${siteUrl}/official` },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  loader: async ({ deps }): Promise<OfficialLoaderResult> =>
    await loadOfficialOrganizationsPage({
      cursor: null,
      query: deps.q,
    }),
  component: OfficialIndex,
});

function OfficialIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const result = Route.useLoaderData() as OfficialLoaderResult;
  const [query, setQuery] = useState(search.q ?? "");
  const [publishers, setPublishers] = useState(result.page);
  const [nextCursor, setNextCursor] = useState<string | null>(
    result.isDone ? null : result.continueCursor,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchNavigateTimer = useRef<number>(0);
  const canLoadMore = Boolean(nextCursor);

  useEffect(() => {
    window.clearTimeout(searchNavigateTimer.current);
    setQuery(search.q ?? "");
    setPublishers(result.page);
    setNextCursor(result.isDone ? null : result.continueCursor);
    setIsLoadingMore(false);
    loadMoreInFlightRef.current = false;
  }, [result, search.q]);

  useEffect(() => {
    return () => window.clearTimeout(searchNavigateTimer.current);
  }, []);

  const navigateToPublisherSearch = useCallback(
    (next: string, replace: boolean) => {
      const trimmed = next.trim();
      void navigate({
        search: (prev: OfficialSearchState) => ({
          ...prev,
          q: trimmed ? next : undefined,
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
        navigateToPublisherSearch(next, true);
      }, 250);
    },
    [navigateToPublisherSearch],
  );

  const handleClearQuery = useCallback(() => {
    window.clearTimeout(searchNavigateTimer.current);
    setQuery("");
    searchInputRef.current?.focus();
    void navigate({
      search: (prev: OfficialSearchState) => ({
        ...prev,
        q: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const handleSearchSubmit = useCallback(() => {
    window.clearTimeout(searchNavigateTimer.current);
    navigateToPublisherSearch(query, false);
  }, [navigateToPublisherSearch, query]);
  const browseSearch = useBrowseSearchDisclosure({
    value: query,
    onClear: handleClearQuery,
    inputRef: searchInputRef,
  });

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = await loadOfficialOrganizationsPage({
        cursor: nextCursor,
        query: search.q,
      });
      setPublishers((previous) => [...previous, ...page.page]);
      setNextCursor(page.isDone ? null : page.continueCursor);
    } finally {
      setIsLoadingMore(false);
      loadMoreInFlightRef.current = false;
    }
  }, [nextCursor, search.q]);

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
    <main className="browse-page browse-page-borderless-header official-browse-page">
      <div className="browse-page-header official-page-header">
        <div className="browse-page-header-main">
          <h1 className="browse-title">Official</h1>
          <p className="official-page-description">
            The organizations behind the top skills and plugins on ClawHub
          </p>
        </div>
      </div>

      <BrowseControls>
        <BrowseControlsRow>
          <BrowseActions>
            <BrowseSearchTrigger
              open={browseSearch.open}
              onOpen={browseSearch.openSearch}
              label="Search official organizations"
            />
          </BrowseActions>
        </BrowseControlsRow>
        <BrowseSearchPanel open={browseSearch.open}>
          <BrowseSearchInput
            inputRef={searchInputRef}
            label="official organization search"
            placeholder="Search official organizations..."
            value={query}
            onChange={handleQueryChange}
            onClear={browseSearch.closeSearch}
            onSubmit={handleSearchSubmit}
            closeLabel="Close search"
          />
        </BrowseSearchPanel>
      </BrowseControls>

      <div className="browse-layout">
        <div className="browse-results">
          {publishers.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No official organizations found</p>
            </div>
          ) : (
            <div className="browse-list-stack">
              <div className="browse-list-head browse-list-head-publishers" aria-hidden="true">
                <span className="browse-list-head-label">Organization</span>
                <span className="browse-list-head-label browse-list-head-stat">Activity</span>
              </div>
              <div className="publisher-directory-list">
                {publishers.map((publisher) => (
                  <PublisherListItem
                    key={publisher._id}
                    publisher={publisher}
                    variant="list"
                    showOfficialBadge={false}
                  />
                ))}
              </div>
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
