import { Link } from "@tanstack/react-router";
import { Binoculars, CloudOff, Loader2, Moon, Plus, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { PLUGIN_CATEGORIES, SKILL_CATEGORIES } from "../lib/categories";
import {
  fetchHomePluginListing as fetchPluginListing,
  fetchHomeSkillListing as fetchSkillListing,
  searchHomeTrendingSkillListing,
  HOME_LISTING_PAGE_SIZE,
  HOME_NEW_WINDOW_MS,
  homeListingCacheKey as listingCacheKey,
  isHomeTrendingSkillEntry,
  type HomeListingCacheEntry,
  type HomeListingInitialData,
  type HomeListingKind as ListingKind,
  type HomeNativeSkillListingEntry,
  type HomeListingTab as ListingTab,
  type HomeSkillListingEntry as SkillPageEntry,
  type TrendingFeedState,
} from "../lib/homeListingData";
import { formatCompactStat } from "../lib/numberFormat";
import { fetchPluginCatalog, type PackageListItem } from "../lib/packageApi";
import { buildPluginDetailHref } from "../lib/pluginRoutes";
import { presentationTitle } from "../lib/presentationTitle";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
import { MarketplaceIcon } from "./MarketplaceIcon";
import {
  BrowseControlsDivider,
  BrowseCategorySelect,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  useBrowseSearchDisclosure,
} from "./BrowseControls";
import { OfficialBadge } from "./OfficialBadge";
import { BrowseResultsSkeleton } from "./skeletons/BrowseResultsSkeleton";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const SKILL_LISTING_TABS: Array<{ id: ListingTab; label: string }> = [
  { id: "trending", label: "Trending" },
  { id: "featured", label: "Featured" },
  { id: "official", label: "Official" },
  { id: "new", label: "New" },
];

const PLUGIN_LISTING_TABS: Array<{
  id: Exclude<ListingTab, "trending">;
  label: string;
}> = [
  { id: "featured", label: "Featured" },
  { id: "official", label: "Official" },
  { id: "new", label: "New" },
];

const LISTING_PAGE_SIZE = HOME_LISTING_PAGE_SIZE;
const LISTING_SEARCH_DEBOUNCE_MS = 220;
const EMPTY_CATEGORY_SLUGS: string[] = [];

function HomeListingEmptyPanel({
  variant,
  query,
  onClear,
}: {
  variant: "error" | "empty" | "filter" | "search" | "trendingEmpty" | "trendingUnavailable";
  query?: string;
  onClear?: () => void;
}) {
  const Icon =
    variant === "error" || variant === "trendingUnavailable"
      ? CloudOff
      : variant === "search"
        ? Binoculars
        : Moon;
  const title =
    variant === "trendingUnavailable"
      ? "24-hour Trending unavailable"
      : variant === "trendingEmpty"
        ? "No 24-hour activity yet"
        : variant === "error"
          ? "Listings took a coffee break"
          : variant === "search"
            ? `No results for “${query}”`
            : "Quiet shelf";
  const body =
    variant === "trendingUnavailable"
      ? "The canonical 24-hour feed isn't available right now. Try another tab."
      : variant === "trendingEmpty"
        ? "No skills have eligible activity in the current 24-hour window."
        : variant === "error"
          ? "We couldn't load this slice of the catalog. Give it another try in a moment."
          : variant === "search"
            ? "Try another query or clear the search."
            : variant === "filter"
              ? "Nothing matches this category on the selected tab."
              : "Nothing on this tab right now. Peek at another tab.";

  return (
    <div className="home-v2-listing-empty" role="status">
      <div className="home-v2-listing-empty-icon" aria-hidden="true">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <p className="home-v2-listing-empty-title">{title}</p>
      <p className="home-v2-listing-empty-body">{body}</p>
      {onClear ? (
        <button type="button" className="home-v2-listing-empty-action" onClick={onClear}>
          <X size={15} aria-hidden="true" />
          {variant === "search" ? "Clear search" : "Clear category"}
        </button>
      ) : null}
    </div>
  );
}

function HomeListingResults({
  showMore,
  loadingMore,
  onSeeMore,
  children,
}: {
  showMore: boolean;
  loadingMore: boolean;
  onSeeMore: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`home-v2-listing-results${showMore ? " is-collapsed" : ""} is-list`}>
      {children}
      {showMore ? (
        <div className="home-v2-listing-more">
          <div className="home-v2-listing-more-fade" aria-hidden="true" />
          <button
            type="button"
            className="home-v2-listing-more-btn"
            onClick={onSeeMore}
            disabled={loadingMore}
            data-loading={loadingMore}
          >
            {loadingMore ? (
              <Loader2 size={14} aria-hidden="true" className="home-v2-listing-more-spinner" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function skillLink(entry: HomeNativeSkillListingEntry) {
  const owner =
    entry.ownerHandle?.trim() ||
    entry.owner?.handle?.trim() ||
    String(entry.skill.ownerPublisherId ?? entry.skill.ownerUserId);
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(entry.skill.slug)}`;
}

function HomeListingSkillRow({ entry }: { entry: SkillPageEntry }) {
  if (isHomeTrendingSkillEntry(entry)) {
    const item = entry.trending;
    const isSkillsSh = item.source === "skills-sh";
    const owner = isSkillsSh
      ? (item.sourceIdentity?.owner ?? item.sourceIdentity?.host)
      : item.publisher?.handle;
    return (
      <Link to={item.canonicalUrl} className="home-v2-listing-row">
        <div className="home-v2-listing-row-body">
          <div className="home-v2-listing-row-title">
            <span className="home-v2-listing-row-name" title={item.displayName}>
              {truncateText(item.displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </span>
            {owner ? <span className="home-v2-listing-row-by">@{owner}</span> : null}
          </div>
          <p className="home-v2-listing-row-summary">
            {truncateText(item.summary || "Agent-ready skill pack.", 80)}
          </p>
        </div>
        {isSkillsSh ? (
          <div className="home-v2-listing-row-stats is-skills-sh" aria-label="Source">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="compact" size="sm">
                  skills.sh
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" align="center">
                Synced from skills.sh
              </TooltipContent>
            </Tooltip>
          </div>
        ) : typeof item.metrics.trending24hDownloads === "number" ? (
          <div className="home-v2-listing-row-stats" aria-label="Downloads">
            <span>{formatCompactStat(item.metrics.trending24hDownloads)}</span>
          </div>
        ) : null}
      </Link>
    );
  }
  const handle = entry.ownerHandle || entry.owner?.handle;
  const name = presentationTitle(entry.skill.displayName, entry.skill.slug);

  return (
    <Link to={skillLink(entry)} className="home-v2-listing-row">
      <div className="home-v2-listing-row-body">
        <div className="home-v2-listing-row-title">
          <span className="home-v2-listing-row-name" title={name}>
            {truncateText(name, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
          </span>
          {handle ? <span className="home-v2-listing-row-by">@{handle}</span> : null}
        </div>
        <p className="home-v2-listing-row-summary">
          {truncateText(entry.skill.summary || "Agent-ready skill pack.", 80)}
        </p>
      </div>
      <div className="home-v2-listing-row-stats" aria-label="Downloads">
        <span>{formatCompactStat(entry.skill.stats?.downloads ?? 0)}</span>
      </div>
    </Link>
  );
}

function HomeListingPluginRow({ plugin }: { plugin: PackageListItem }) {
  const name = presentationTitle(plugin.displayName, plugin.name);
  const pluginHref = buildPluginDetailHref(plugin.name, { ownerHandle: plugin.ownerHandle });

  return (
    <Link to={pluginHref} className="home-v2-listing-row home-v2-listing-row-with-icon">
      <span className="home-v2-listing-row-icon" aria-hidden="true">
        <MarketplaceIcon
          kind="plugin"
          label={name}
          imageUrl={plugin.icon}
          categorySlug={plugin.categories?.[0]}
          size="sm"
        />
      </span>
      <div className="home-v2-listing-row-body">
        <div className="home-v2-listing-row-title">
          <span className="home-v2-listing-row-name" title={name}>
            {truncateText(name, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
          </span>
          {plugin.ownerHandle ? (
            <span className="home-v2-listing-row-by">@{plugin.ownerHandle}</span>
          ) : null}
          {plugin.isOfficial ? <OfficialBadge /> : null}
        </div>
        <p className="home-v2-listing-row-summary">
          {truncateText(plugin.summary || "Gateway plugin for OpenClaw workflows.", 80)}
        </p>
      </div>
      <div className="home-v2-listing-row-stats" aria-label="Downloads">
        <span>{formatCompactStat(plugin.stats?.downloads ?? 0)}</span>
      </div>
    </Link>
  );
}

type HomeListingSectionProps = {
  initialListing?: HomeListingInitialData | null;
};

function createInitialListingCache(initialListing: HomeListingInitialData | null) {
  const cache = new Map<string, HomeListingCacheEntry>();
  if (!initialListing) return cache;
  cache.set(
    listingCacheKey({
      kind: initialListing.kind,
      tab: initialListing.tab,
      categorySlugs: initialListing.categorySlugs,
      fetchLimit: initialListing.fetchLimit,
    }),
    initialListing.kind === "skills"
      ? {
          kind: "skills",
          items: initialListing.items,
          hasMore: initialListing.hasMore,
          trendingState: initialListing.trendingState,
        }
      : {
          kind: "plugins",
          items: initialListing.items,
          hasMore: initialListing.hasMore,
        },
  );
  return cache;
}

export function HomeListingSection({ initialListing = null }: HomeListingSectionProps = {}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const listingCacheRef = useRef<Map<string, HomeListingCacheEntry> | null>(null);
  listingCacheRef.current ??= createInitialListingCache(initialListing);
  const listingCache = listingCacheRef.current;

  const [kind, setKind] = useState<ListingKind>(initialListing?.kind ?? "skills");
  const initialTab =
    initialListing?.kind === "skills" && initialListing.trendingState === "unavailable"
      ? "featured"
      : (initialListing?.tab ?? "trending");
  const [tab, setTab] = useState<ListingTab>(initialTab);
  const [categorySlug, setCategorySlug] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(LISTING_PAGE_SIZE);
  const [fetchLimit, setFetchLimit] = useState(LISTING_PAGE_SIZE);
  const [skills, setSkills] = useState<SkillPageEntry[]>(
    initialListing?.kind === "skills" ? initialListing.items : [],
  );
  const [plugins, setPlugins] = useState<PackageListItem[]>(
    initialListing?.kind === "plugins" ? initialListing.items : [],
  );
  const [status, setStatus] = useState<"loading" | "idle" | "error">(
    initialListing ? "idle" : "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchSkills, setSearchSkills] = useState<SkillPageEntry[]>([]);
  const [searchPlugins, setSearchPlugins] = useState<PackageListItem[]>([]);
  const [searchStatus, setSearchStatus] = useState<"loading" | "idle" | "error">("idle");
  const [listingHasMore, setListingHasMore] = useState(initialListing?.hasMore ?? false);
  const [trendingState, setTrendingState] = useState<TrendingFeedState | undefined>(
    initialListing?.kind === "skills" ? initialListing.trendingState : undefined,
  );
  const [canonicalTrendingUnavailable, setCanonicalTrendingUnavailable] = useState(
    initialListing?.kind === "skills" && initialListing.trendingState === "unavailable",
  );
  const clearSearch = useCallback(() => setSearchQuery(""), []);
  const searchDisclosure = useBrowseSearchDisclosure({
    value: searchQuery,
    onClear: clearSearch,
    inputRef: searchInputRef,
  });

  const trimmedSearch = searchQuery.trim();
  const isSearchMode = trimmedSearch.length > 0;
  const categorySlugs = useMemo(
    () => (categorySlug ? [categorySlug] : EMPTY_CATEGORY_SLUGS),
    [categorySlug],
  );
  const listingCategories = kind === "skills" ? SKILL_CATEGORIES : PLUGIN_CATEGORIES;

  const visibleTabs =
    kind === "skills"
      ? SKILL_LISTING_TABS.filter(
          (candidate) => candidate.id !== "trending" || !canonicalTrendingUnavailable,
        )
      : PLUGIN_LISTING_TABS;

  const activeItems = isSearchMode
    ? kind === "skills"
      ? searchSkills
      : searchPlugins
    : kind === "skills"
      ? skills
      : plugins;
  const activeStatus = isSearchMode ? searchStatus : status;
  const isEmpty = activeStatus === "idle" && activeItems.length === 0;
  const showListingMore =
    activeStatus === "idle" && (activeItems.length > visibleCount || listingHasMore);

  useEffect(() => {
    if (isSearchMode) return undefined;
    const cacheKey = listingCacheKey({
      kind,
      tab,
      categorySlugs,
      fetchLimit,
    });
    const cached = listingCache.get(cacheKey);
    if (cached) {
      if (cached.kind === "skills") {
        setSkills(cached.items);
        setTrendingState(cached.trendingState);
        if (tab === "trending") {
          const unavailable = cached.trendingState === "unavailable";
          setCanonicalTrendingUnavailable(unavailable);
          if (unavailable) setTab("featured");
        }
      } else {
        setPlugins(cached.items);
        setTrendingState(undefined);
      }
      setListingHasMore(cached.hasMore);
      setStatus("idle");
      setLoadingMore(false);
      return undefined;
    }

    const controller = new AbortController();
    // "Load more" only grows fetchLimit: keep the existing rows mounted and
    // append, instead of swapping in the skeleton (which collapses height and
    // throws away the scroll position).
    const isLoadMore = fetchLimit > LISTING_PAGE_SIZE;
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setStatus("loading");
      setListingHasMore(false);
    }

    const load =
      kind === "skills"
        ? fetchSkillListing(tab, categorySlugs, fetchLimit, controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            listingCache.set(cacheKey, {
              kind: "skills",
              items: result.page,
              hasMore: result.hasMore,
              trendingState: result.trendingState,
            });
            setSkills(result.page);
            setTrendingState(result.trendingState);
            if (tab === "trending") {
              const unavailable = result.trendingState === "unavailable";
              setCanonicalTrendingUnavailable(unavailable);
              if (unavailable) setTab("featured");
            }
            setListingHasMore(result.hasMore);
            setStatus("idle");
          })
        : fetchPluginListing(
            tab === "trending" ? "new" : tab,
            categorySlugs,
            fetchLimit,
            controller.signal,
          ).then((result) => {
            if (controller.signal.aborted) return;
            listingCache.set(cacheKey, {
              kind: "plugins",
              items: result.items,
              hasMore: result.hasMore,
            });
            setPlugins(result.items);
            setTrendingState(undefined);
            setListingHasMore(result.hasMore);
            setStatus("idle");
          });

    load
      .catch(() => {
        if (controller.signal.aborted) return;
        // On a load-more failure keep what's already shown instead of wiping it.
        if (isLoadMore) return;
        if (kind === "skills") {
          setSkills([]);
          setStatus("error");
          return;
        }
        setPlugins([]);
        setStatus("error");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoadingMore(false);
      });

    return () => controller.abort();
  }, [categorySlug, fetchLimit, isSearchMode, kind, listingCache, tab]);

  useEffect(() => {
    if (!isSearchMode) {
      setSearchSkills([]);
      setSearchPlugins([]);
      setSearchStatus("idle");
      setLoadingMore(false);
      return undefined;
    }

    searchRequestRef.current += 1;
    const requestId = searchRequestRef.current;
    const controller = new AbortController();
    const isLoadMore = fetchLimit > LISTING_PAGE_SIZE;
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setSearchStatus("loading");
      setListingHasMore(false);
    }

    const handle = window.setTimeout(() => {
      const load =
        kind === "skills" && tab === "trending"
          ? searchHomeTrendingSkillListing(trimmedSearch, fetchLimit, controller.signal).then(
              (result) => {
                if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
                const unavailable = result.trendingState === "unavailable";
                setCanonicalTrendingUnavailable(unavailable);
                if (unavailable) {
                  setTab("featured");
                  return;
                }
                setSearchSkills(result.page);
                setTrendingState(result.trendingState);
                setListingHasMore(result.hasMore);
                setSearchStatus("idle");
              },
            )
          : kind === "skills"
            ? convexHttp
                .action(api.search.searchNativeSkills, {
                  query: trimmedSearch,
                  limit: fetchLimit,
                  ...(tab === "featured" ? { highlightedOnly: true } : {}),
                  ...(tab === "official" ? { officialOnly: true } : {}),
                  ...(tab === "new" ? { createdAfter: Date.now() - HOME_NEW_WINDOW_MS } : {}),
                  ...(categorySlug ? { categorySlug } : {}),
                })
                .then((hits) => {
                  if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
                  const searchHits = hits as HomeNativeSkillListingEntry[];
                  setSearchSkills(searchHits);
                  setListingHasMore(searchHits.length >= fetchLimit);
                  setSearchStatus("idle");
                })
            : fetchPluginCatalog({
                q: trimmedSearch,
                category: categorySlug,
                featured: tab === "featured" ? true : undefined,
                isOfficial: tab === "official" ? true : undefined,
                createdAfter: tab === "new" ? Date.now() - HOME_NEW_WINDOW_MS : undefined,
                limit: fetchLimit,
                signal: controller.signal,
              }).then((result) => {
                if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
                setSearchPlugins(result.items);
                setListingHasMore(result.nextCursor !== null || result.items.length >= fetchLimit);
                setSearchStatus("idle");
              });

      load
        .catch(() => {
          if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
          if (isLoadMore) return;
          if (kind === "skills") setSearchSkills([]);
          else setSearchPlugins([]);
          setSearchStatus("error");
        })
        .finally(() => {
          if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
          setLoadingMore(false);
        });
    }, LISTING_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [categorySlug, fetchLimit, isSearchMode, kind, tab, trimmedSearch]);

  useEffect(() => {
    setVisibleCount(LISTING_PAGE_SIZE);
    setFetchLimit(LISTING_PAGE_SIZE);
  }, [categorySlug, isSearchMode, kind, tab, trimmedSearch]);

  const visibleSkills = (isSearchMode ? searchSkills : skills).slice(0, visibleCount);
  const visiblePlugins = (isSearchMode ? searchPlugins : plugins).slice(0, visibleCount);

  const handleSeeMore = () => {
    setVisibleCount((count) => count + LISTING_PAGE_SIZE);
    setFetchLimit((limit) => limit + LISTING_PAGE_SIZE);
  };

  const handleKindChange = (nextKind: ListingKind) => {
    if (nextKind === kind) return;
    setKind(nextKind);
    setCategorySlug(undefined);
    setTab(
      nextKind === "skills" ? (canonicalTrendingUnavailable ? "featured" : "trending") : "new",
    );
  };

  const handleTabChange = (nextTab: ListingTab) => {
    if (nextTab === "trending") setCategorySlug(undefined);
    setTab(nextTab);
  };

  return (
    <section
      id="home-v2-listing"
      className="home-v2-listing oc-section"
      aria-label="Browse catalog"
    >
      <div className="home-v2-listing-controls">
        <div className="home-v2-listing-toolbar">
          <div className="home-v2-listing-primary">
            <div
              className="home-v2-listing-kind clawhub-segmented oc-segmented"
              role="group"
              aria-label="Content type"
            >
              <button
                type="button"
                className={`home-v2-listing-kind-btn clawhub-segmented-btn oc-segmented-item${
                  kind === "skills" ? " is-active" : ""
                }`}
                aria-pressed={kind === "skills"}
                onClick={() => handleKindChange("skills")}
              >
                Skills
              </button>
              <button
                type="button"
                className={`home-v2-listing-kind-btn clawhub-segmented-btn oc-segmented-item${
                  kind === "plugins" ? " is-active" : ""
                }`}
                aria-pressed={kind === "plugins"}
                onClick={() => handleKindChange("plugins")}
              >
                Plugins
              </button>
            </div>

            <BrowseControlsDivider />

            <div className="home-v2-listing-sort">
              <div className="home-v2-listing-sort-tabs" role="tablist" aria-label="Catalog view">
                {visibleTabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className={`home-v2-listing-tab${tab === item.id ? " is-active" : ""}`}
                    onClick={() => handleTabChange(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="home-v2-listing-actions">
            <BrowseSearchTrigger
              open={searchDisclosure.open}
              onOpen={searchDisclosure.openSearch}
              label="Search catalog"
            />
            {kind === "skills" && tab === "trending" ? null : (
              <BrowseCategorySelect
                categories={listingCategories}
                value={categorySlug}
                onChange={setCategorySlug}
              />
            )}
          </div>
        </div>
        <BrowseSearchPanel open={searchDisclosure.open}>
          <BrowseSearchInput
            inputRef={searchInputRef}
            label={kind === "skills" ? "Search skills" : "Search plugins"}
            placeholder={kind === "skills" ? "Search skills..." : "Search plugins..."}
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={searchDisclosure.closeSearch}
            closeLabel="Close search"
          />
        </BrowseSearchPanel>
      </div>

      {activeStatus === "idle" && activeItems.length > 0 ? (
        <div
          className={`home-v2-listing-head${
            kind === "plugins" ? " home-v2-listing-head-with-icon" : ""
          }`}
          aria-hidden="true"
        >
          {kind === "plugins" ? <span className="home-v2-listing-head-icon-spacer" /> : null}
          <span className="home-v2-listing-head-label">
            {kind === "skills" ? "Skill" : "Plugin"}
          </span>
          <span className="home-v2-listing-head-stat">Downloads</span>
        </div>
      ) : null}

      {activeStatus === "loading" ? (
        <BrowseResultsSkeleton
          label={kind === "skills" ? "Skill" : "Plugin"}
          showIcon={kind === "plugins"}
          variant="list"
        />
      ) : null}

      {activeStatus === "error" ? <HomeListingEmptyPanel variant="error" /> : null}

      {isEmpty ? (
        <HomeListingEmptyPanel
          variant={
            isSearchMode
              ? "search"
              : categorySlug
                ? "filter"
                : kind === "skills" && tab === "trending"
                  ? trendingState === "unavailable"
                    ? "trendingUnavailable"
                    : "trendingEmpty"
                  : "empty"
          }
          query={isSearchMode ? trimmedSearch : undefined}
          onClear={
            isSearchMode
              ? searchDisclosure.closeSearch
              : categorySlug
                ? () => setCategorySlug(undefined)
                : undefined
          }
        />
      ) : null}

      {activeStatus === "idle" && kind === "skills" && visibleSkills.length > 0 ? (
        <HomeListingResults
          showMore={showListingMore}
          loadingMore={loadingMore}
          onSeeMore={handleSeeMore}
        >
          <div className="home-v2-listing-list">
            {visibleSkills.map((entry) => (
              <HomeListingSkillRow
                key={isHomeTrendingSkillEntry(entry) ? entry.trending.id : String(entry.skill._id)}
                entry={entry}
              />
            ))}
          </div>
        </HomeListingResults>
      ) : null}

      {activeStatus === "idle" && kind === "plugins" && visiblePlugins.length > 0 ? (
        <HomeListingResults
          showMore={showListingMore}
          loadingMore={loadingMore}
          onSeeMore={handleSeeMore}
        >
          <div className="home-v2-listing-list">
            {visiblePlugins.map((plugin) => (
              <HomeListingPluginRow key={plugin.name} plugin={plugin} />
            ))}
          </div>
        </HomeListingResults>
      ) : null}
    </section>
  );
}
