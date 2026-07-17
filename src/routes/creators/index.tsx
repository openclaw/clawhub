import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { BadgeCheck, UserCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MarketplaceIcon } from "../../components/MarketplaceIcon";
import { PublisherListItem } from "../../components/PublisherListItem";
import { Button } from "../../components/ui/button";
import { convexHttp } from "../../convex/client";
import { buildPublisherProfileHref } from "../../lib/ownerRoute";
import type { PublicPublisherListItem } from "../../lib/publicUser";
import { getClawHubSiteUrl, SITE_NAME } from "../../lib/site";
import { timeAgo } from "../../lib/timeAgo";
import { useAuthStatus } from "../../lib/useAuthStatus";

type PublisherKindSearch = "orgs" | "people";
type PublisherViewSearch = "list" | "grid";

type PublishersSearchState = {
  kind?: PublisherKindSearch;
  official?: boolean;
  following?: boolean;
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
const FOLLOWED_PUBLISHER_PAGE_SIZE = 25;
const PUBLISHER_KIND_OPTIONS = [
  { value: undefined, label: "All" },
  {
    value: "official",
    label: "Verified",
    icon: <BadgeCheck size={14} strokeWidth={2.25} aria-hidden="true" />,
  },
  {
    value: "following",
    label: "Following",
    icon: <UserCheck size={14} strokeWidth={2.25} aria-hidden="true" />,
  },
  { value: "orgs", label: "Organizations", mobileLabel: "Orgs" },
  { value: "people", label: "Users" },
];

type FollowedPublisherItem = {
  publisher: {
    _id: string;
    handle: string;
    displayName: string;
    kind: "org" | "user";
    image?: string | null;
  };
};

type FollowedPublishersResult = {
  items: FollowedPublisherItem[];
  nextCursor: string | null;
};

type FollowedPublisherPage = {
  cursorKey: string;
  items: FollowedPublisherItem[];
};

type PublisherActivityItem = {
  activityId: string;
  eventType: "skill.publish" | "plugin.publish";
  eventAt: number;
  version: string;
  publisher: {
    publisherId: string;
    handle: string;
    displayName: string;
    kind: "org" | "user";
    image: string | null;
  };
  artifact: {
    kind: "skill" | "plugin";
    artifactId: string;
    displayName: string;
    href: string;
  };
};

type PublisherActivityResult = {
  items: PublisherActivityItem[];
  nextCursor: string | null;
};

type PublisherActivityPage = {
  cursorKey: string;
  items: PublisherActivityItem[];
};

function followedPublisherItemsEqual(
  left: FollowedPublisherItem[],
  right: FollowedPublisherItem[],
) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        item.publisher._id === other.publisher._id &&
        item.publisher.handle === other.publisher.handle &&
        item.publisher.displayName === other.publisher.displayName &&
        item.publisher.kind === other.publisher.kind &&
        item.publisher.image === other.publisher.image
      );
    })
  );
}

function publisherActivityItemsEqual(
  left: PublisherActivityItem[],
  right: PublisherActivityItem[],
) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        item.activityId === other.activityId &&
        item.publisher.handle === other.publisher.handle &&
        item.publisher.displayName === other.publisher.displayName &&
        item.artifact.displayName === other.artifact.displayName &&
        item.artifact.href === other.artifact.href
      );
    })
  );
}

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

export const Route = createFileRoute("/creators/")({
  validateSearch: (search): PublishersSearchState => ({
    kind: normalizePublisherKind(search.kind),
    official:
      search.official === true || search.official === "true" || search.official === "1"
        ? true
        : undefined,
    following:
      search.following === true || search.following === "true" || search.following === "1"
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
    const title = `Creators · ${SITE_NAME}`;
    const description =
      "Discover the people and organizations publishing skills, plugins, packages, and ecosystem tooling on ClawHub.";

    return {
      links: [
        {
          rel: "canonical",
          href: `${siteUrl}/creators`,
        },
      ],
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${siteUrl}/creators` },
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
  const { isAuthenticated, isLoading: isAuthLoading } = useAuthStatus();
  const [query, setQuery] = useState(search.q ?? "");
  const [publishers, setPublishers] = useState(result.page);
  const [nextCursor, setNextCursor] = useState<string | null>(
    result.isDone ? null : result.continueCursor,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [followedCursorRequest, setFollowedCursorRequest] = useState<string | null>(null);
  const [followedPages, setFollowedPages] = useState<FollowedPublisherPage[]>([]);
  const [followedNextCursor, setFollowedNextCursor] = useState<string | null>(null);
  const [isLoadingMoreFollowed, setIsLoadingMoreFollowed] = useState(false);
  const [activityCursorRequest, setActivityCursorRequest] = useState<string | null>(null);
  const [activityPages, setActivityPages] = useState<PublisherActivityPage[]>([]);
  const [activityNextCursor, setActivityNextCursor] = useState<string | null>(null);
  const [isLoadingMoreActivity, setIsLoadingMoreActivity] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchNavigateTimer = useRef<number>(0);
  const activeKind = search.kind;
  const officialOnly = search.official === true;
  const followingOnly = search.following === true;
  const activeView = search.view ?? "list";
  const followedPublishersResult = useQuery(
    api.publisherFollows.listFollowedPublishers,
    isAuthenticated && followingOnly
      ? {
          limit: FOLLOWED_PUBLISHER_PAGE_SIZE,
          ...(followedCursorRequest ? { cursor: followedCursorRequest } : {}),
          ...(search.q ? { query: search.q } : {}),
        }
      : "skip",
  ) as FollowedPublishersResult | undefined;
  const publisherActivityResult = useQuery(
    api.publisherActivity.listMine,
    isAuthenticated && followingOnly && !search.q
      ? {
          limit: 25,
          ...(activityCursorRequest ? { cursor: activityCursorRequest } : {}),
        }
      : "skip",
  ) as PublisherActivityResult | undefined;
  const followedPublishers = useMemo(
    () => followedPages.flatMap((page) => page.items),
    [followedPages],
  );
  const publisherActivity = useMemo(
    () => activityPages.flatMap((page) => page.items),
    [activityPages],
  );
  const canLoadMore = followingOnly ? Boolean(followedNextCursor) : Boolean(nextCursor);
  const hasQuery = Boolean(search.q?.trim());
  const showHighlights = !hasQuery && !activeKind && !officialOnly && !followingOnly;
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
    if (followingOnly && isAuthenticated) {
      setFollowedCursorRequest(null);
      setFollowedPages([]);
      setFollowedNextCursor(null);
      setIsLoadingMoreFollowed(false);
      return;
    }

    setFollowedCursorRequest(null);
    setFollowedPages([]);
    setFollowedNextCursor(null);
    setIsLoadingMoreFollowed(false);
  }, [followingOnly, isAuthenticated, search.q]);

  useEffect(() => {
    setActivityCursorRequest(null);
    setActivityPages([]);
    setActivityNextCursor(null);
    setIsLoadingMoreActivity(false);
  }, [followingOnly, isAuthenticated, search.q]);

  useEffect(() => {
    if (!followingOnly || !followedPublishersResult) return;

    const cursorKey = followedCursorRequest ?? "";
    setFollowedPages((previous) => {
      const nextPage = { cursorKey, items: followedPublishersResult.items };
      const existingIndex = previous.findIndex((page) => page.cursorKey === cursorKey);
      if (existingIndex >= 0) {
        const existingPage = previous[existingIndex];
        if (
          existingPage &&
          followedPublisherItemsEqual(existingPage.items, followedPublishersResult.items)
        ) {
          return previous;
        }
        return previous.map((page, index) => (index === existingIndex ? nextPage : page));
      }
      return followedCursorRequest ? [...previous, nextPage] : [nextPage];
    });
    setFollowedNextCursor(followedPublishersResult.nextCursor);
    setIsLoadingMoreFollowed(false);
  }, [followedCursorRequest, followedPublishersResult, followingOnly]);

  useEffect(() => {
    if (!followingOnly || !publisherActivityResult) return;
    const cursorKey = activityCursorRequest ?? "";
    setActivityPages((previous) => {
      const nextPage = { cursorKey, items: publisherActivityResult.items };
      const existingIndex = previous.findIndex((page) => page.cursorKey === cursorKey);
      if (existingIndex >= 0) {
        const existingPage = previous[existingIndex];
        if (
          existingPage &&
          publisherActivityItemsEqual(existingPage.items, publisherActivityResult.items)
        ) {
          return previous;
        }
        return previous.map((page, index) => (index === existingIndex ? nextPage : page));
      }
      return activityCursorRequest ? [...previous, nextPage] : [nextPage];
    });
    setActivityNextCursor(publisherActivityResult.nextCursor);
    setIsLoadingMoreActivity(false);
  }, [activityCursorRequest, followingOnly, publisherActivityResult]);

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
          following: undefined,
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
        following: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const handleFollowingChange = useCallback(() => {
    void navigate({
      search: (prev: PublishersSearchState) => ({
        ...prev,
        kind: undefined,
        official: undefined,
        following: true,
        view: undefined,
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
      if (value === "following") {
        handleFollowingChange();
        return;
      }

      handleKindChange(value);
    },
    [handleKindChange, handleOfficialChange, handleFollowingChange],
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
    if (followingOnly) {
      if (!followedNextCursor || isLoadingMoreFollowed) return;
      setIsLoadingMoreFollowed(true);
      setFollowedCursorRequest(followedNextCursor);
      return;
    }

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
  }, [
    activeKind,
    followedNextCursor,
    followingOnly,
    isLoadingMoreFollowed,
    nextCursor,
    officialOnly,
    search.q,
  ]);

  const loadMoreActivity = useCallback(() => {
    if (!activityNextCursor || isLoadingMoreActivity) return;
    setIsLoadingMoreActivity(true);
    setActivityCursorRequest(activityNextCursor);
  }, [activityNextCursor, isLoadingMoreActivity]);

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
    <main className="browse-page browse-page-borderless-header publishers-browse-page">
      <div className="browse-page-header">
        <h1 className="browse-title">Creators</h1>
      </div>
      <BrowseControls>
        <BrowseControlsRow>
          <BrowseTabs
            ariaLabel="Publisher type"
            options={PUBLISHER_KIND_OPTIONS}
            value={followingOnly ? "following" : officialOnly ? "official" : activeKind}
            onChange={handlePublisherTabChange}
          />
          <BrowseActions>
            <BrowseSearchTrigger
              open={browseSearch.open}
              onOpen={browseSearch.openSearch}
              label="Search publishers"
            />
            {followingOnly ? null : (
              <BrowseViewToggle view={activeView} onToggle={handleToggleView} />
            )}
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
          {followingOnly ? (
            <FollowedPublisherDiscovery
              authenticated={isAuthenticated}
              authLoading={isAuthLoading}
              activity={publisherActivity}
              activityLoading={
                isAuthenticated &&
                !search.q &&
                publisherActivity.length === 0 &&
                publisherActivityResult === undefined
              }
              activityCanLoadMore={Boolean(activityNextCursor)}
              activityLoadingMore={isLoadingMoreActivity}
              onLoadMoreActivity={loadMoreActivity}
              loading={
                isAuthenticated &&
                followedPublishers.length === 0 &&
                followedPublishersResult === undefined
              }
              publishers={followedPublishers}
              query={search.q}
            />
          ) : highlightedPublishers.length > 0 ? (
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

          {followingOnly ? null : publishers.length === 0 ? (
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
              <Button
                type="button"
                onClick={loadMore}
                disabled={followingOnly ? isLoadingMoreFollowed : isLoadingMore}
              >
                {(followingOnly ? isLoadingMoreFollowed : isLoadingMore)
                  ? "Loading..."
                  : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function FollowedPublisherDiscovery({
  authenticated,
  authLoading,
  activity,
  activityLoading,
  activityCanLoadMore,
  activityLoadingMore,
  onLoadMoreActivity,
  loading,
  publishers,
  query,
}: {
  authenticated: boolean;
  authLoading: boolean;
  activity: PublisherActivityItem[];
  activityLoading: boolean;
  activityCanLoadMore: boolean;
  activityLoadingMore: boolean;
  onLoadMoreActivity: () => void;
  loading: boolean;
  publishers: FollowedPublisherItem[];
  query?: string;
}) {
  if (authLoading) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Loading followed publishers...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Sign in to see publishers you follow</p>
      </div>
    );
  }

  if (loading || activityLoading) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Loading followed publishers...</p>
      </div>
    );
  }

  if (publishers.length === 0 && activity.length === 0 && !activityCanLoadMore) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">
          {query?.trim() ? "No followed publishers match" : "No followed publishers yet"}
        </p>
      </div>
    );
  }

  return (
    <div className="followed-discovery-stack">
      {activity.length > 0 || activityCanLoadMore ? (
        <section className="publisher-activity" aria-labelledby="publisher-activity-title">
          <h2 id="publisher-activity-title" className="publisher-section-title">
            Latest from publishers you follow
          </h2>
          <div className="publisher-activity-list">
            {activity.map((item) => (
              <Link
                key={item.activityId}
                to={item.artifact.href}
                className="publisher-activity-row"
              >
                <MarketplaceIcon
                  kind={item.publisher.kind === "org" ? "org" : "user"}
                  label={item.publisher.displayName}
                  imageUrl={item.publisher.image}
                  size="sm"
                />
                <span className="publisher-activity-copy">
                  <span className="publisher-activity-title">
                    <strong>{item.publisher.displayName}</strong> published{" "}
                    {item.artifact.displayName}
                  </span>
                  <span className="publisher-activity-meta">
                    {item.artifact.kind === "skill" ? "Skill" : "Plugin"} {item.version} ·{" "}
                    {timeAgo(item.eventAt)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          {activityCanLoadMore ? (
            <div className="publisher-activity-more">
              <Button
                type="button"
                variant="secondary"
                onClick={onLoadMoreActivity}
                disabled={activityLoadingMore}
              >
                {activityLoadingMore ? "Loading..." : "Load older activity"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {publishers.length > 0 ? (
        <div className="browse-list-stack">
          <div className="browse-list-head browse-list-head-publishers" aria-hidden="true">
            <span className="browse-list-head-label">Creator</span>
            <span className="browse-list-head-label browse-list-head-stat">Why shown</span>
          </div>
          <div className="publisher-directory-list">
            {publishers.map(({ publisher }) => (
              <Link
                key={publisher._id}
                to={buildPublisherProfileHref(publisher.handle)}
                className="publisher-card publisher-card-list followed-publisher-card"
                aria-label={`Followed publisher: ${publisher.displayName}`}
              >
                <div className="publisher-card-main">
                  <MarketplaceIcon
                    kind={publisher.kind === "org" ? "org" : "user"}
                    label={publisher.displayName}
                    imageUrl={publisher.image}
                    size="sm"
                  />
                  <div className="publisher-card-copy">
                    <span className="publisher-card-identity">
                      <span className="publisher-card-title-row">
                        <span className="publisher-card-name">{publisher.displayName}</span>
                        {publisher.kind === "org" ? (
                          <span className="publisher-card-kind">Org</span>
                        ) : null}
                      </span>
                      <span className="publisher-card-handle">@{publisher.handle}</span>
                    </span>
                  </div>
                </div>
                <span className="followed-publisher-reason">Followed publisher</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
