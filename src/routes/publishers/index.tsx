import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  BrowseActions,
  BrowseControls,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  BrowseTabs,
  BrowseViewToggle,
  useBrowseSearchDisclosure,
} from "../../components/BrowseControls";
import { PublisherListItem } from "../../components/PublisherListItem";
import { Button } from "../../components/ui/button";
import { convexHttp } from "../../convex/client";
import type { PublicPublisherListItem } from "../../lib/publicUser";
import { getClawHubSiteUrl, SITE_NAME } from "../../lib/site";

type PublisherKindSearch = "orgs" | "people";
type PublisherViewSearch = "list" | "grid";

type PublishersSearchState = {
  kind?: PublisherKindSearch;
  official?: boolean;
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
const PUBLISHER_KIND_OPTIONS = [
  { value: undefined, label: "All" },
  { value: "orgs", label: "Orgs" },
  { value: "people", label: "Creators" },
  {
    value: "official",
    label: "Officials",
    icon: <BadgeCheck size={14} strokeWidth={2.25} aria-hidden="true" />,
  },
];

function normalizePublisherKind(value: unknown): PublisherKindSearch | undefined {
  if (value === "orgs") return "orgs";
  if (value === "people" || value === "builders" || value === "individuals") return "people";
  return undefined;
}

async function loadPublishersPage({
  cursor,
  kind,
  official,
  query,
}: {
  cursor: string | null;
  kind?: PublisherKindSearch;
  official?: boolean;
  query?: string;
}): Promise<PublishersLoaderResult> {
  const baseArgs = {
    kind: kind === "orgs" ? ("org" as const) : kind === "people" ? ("user" as const) : undefined,
    query,
    paginationOpts: { cursor, numItems: PUBLISHER_PAGE_SIZE },
  };

  return (await convexHttp.query(api.publishers.listPublicPage, {
    ...baseArgs,
    ...(official ? { official: true } : {}),
  })) as PublishersLoaderResult;
}

export const Route = createFileRoute("/publishers/")({
  validateSearch: (search): PublishersSearchState => ({
    kind: normalizePublisherKind(search.kind),
    official:
      search.official === true || search.official === "true" || search.official === "1"
        ? true
        : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    view: search.view === "grid" ? "grid" : undefined,
  }),
  loaderDeps: ({ search }) => ({
    kind: search.kind,
    official: search.official,
    q: search.q,
  }),
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
    await loadPublishersPage({
      cursor: null,
      kind: deps.kind,
      official: deps.official,
      query: deps.q,
    }),
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchNavigateTimer = useRef<number>(0);
  const activeKind = search.kind;
  const officialOnly = search.official === true;
  const activeView = search.view ?? "list";
  const canLoadMore = Boolean(nextCursor);
  const hasQuery = Boolean(search.q?.trim());
  const showHighlights = !hasQuery && !activeKind && !officialOnly;
  const highlightedPublishers = showHighlights ? publishers.slice(0, 3) : [];
  const directoryPublishers = showHighlights ? publishers.slice(3) : publishers;

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
        search: (prev: PublishersSearchState) => ({
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
      search: (prev: PublishersSearchState) => ({
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

  const handleKindChange = useCallback(
    (kind: string | undefined) => {
      void navigate({
        search: (prev: PublishersSearchState) => ({
          ...prev,
          kind: normalizePublisherKind(kind),
          official: undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleOfficialChange = useCallback(() => {
    void navigate({
      search: (prev: PublishersSearchState) => ({
        ...prev,
        kind: undefined,
        official: true,
      }),
      replace: true,
    });
  }, [navigate]);

  const handlePublisherTabChange = useCallback(
    (value: string | undefined) => {
      if (value === "official") {
        handleOfficialChange();
        return;
      }

      handleKindChange(value);
    },
    [handleKindChange, handleOfficialChange],
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
      const page = await loadPublishersPage({
        cursor: nextCursor,
        kind: activeKind,
        official: officialOnly || undefined,
        query: search.q,
      });
      setPublishers((previous) => [...previous, ...page.page]);
      setNextCursor(page.isDone ? null : page.continueCursor);
    } finally {
      setIsLoadingMore(false);
      loadMoreInFlightRef.current = false;
    }
  }, [activeKind, nextCursor, officialOnly, search.q]);

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
        <h1 className="browse-title">Publishers</h1>
      </div>
      <BrowseControls>
        <BrowseControlsRow>
          <BrowseTabs
            ariaLabel="Publisher type"
            options={PUBLISHER_KIND_OPTIONS}
            value={officialOnly ? "official" : activeKind}
            onChange={handlePublisherTabChange}
          />
          <BrowseActions>
            <BrowseSearchTrigger
              open={browseSearch.open}
              onOpen={browseSearch.openSearch}
              label="Search publishers"
            />
            <BrowseViewToggle view={activeView} onToggle={handleToggleView} />
          </BrowseActions>
        </BrowseControlsRow>
        <BrowseSearchPanel open={browseSearch.open}>
          <BrowseSearchInput
            inputRef={searchInputRef}
            label="publisher search"
            placeholder="Search publishers..."
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
          ) : activeView === "grid" ? (
            <div className={`publisher-directory-list publisher-directory-${activeView}`}>
              {directoryPublishers.map((publisher) => (
                <PublisherListItem key={publisher._id} publisher={publisher} variant="grid" />
              ))}
            </div>
          ) : (
            <div className="browse-list-stack">
              <div className="browse-list-head browse-list-head-publishers" aria-hidden="true">
                <span className="browse-list-head-label">Creator</span>
                <span className="browse-list-head-label browse-list-head-stat">Activity</span>
              </div>
              <div className="publisher-directory-list">
                {directoryPublishers.map((publisher) => (
                  <PublisherListItem key={publisher._id} publisher={publisher} variant="list" />
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
