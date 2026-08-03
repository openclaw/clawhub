import { Link } from "@tanstack/react-router";
import { CloudOff, Loader2, Moon, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  fetchHomePluginListing as fetchPluginListing,
  fetchHomeSkillListing as fetchSkillListing,
  HOME_LISTING_PAGE_SIZE,
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
import type { PackageListItem } from "../lib/packageApi";
import { buildPluginDetailHref } from "../lib/pluginRoutes";
import { presentationTitle } from "../lib/presentationTitle";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
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
const EMPTY_CATEGORY_SLUGS: string[] = [];

function HomeListingEmptyPanel({
  variant,
}: {
  variant: "error" | "empty" | "trendingEmpty" | "trendingUnavailable";
}) {
  const Icon = variant === "error" || variant === "trendingUnavailable" ? CloudOff : Moon;
  const title =
    variant === "trendingUnavailable"
      ? "24-hour Trending unavailable"
      : variant === "trendingEmpty"
        ? "No 24-hour activity yet"
        : variant === "error"
          ? "Listings took a coffee break"
          : "Quiet shelf";
  const body =
    variant === "trendingUnavailable"
      ? "The canonical 24-hour feed isn't available right now. Try another tab."
      : variant === "trendingEmpty"
        ? "No skills have eligible activity in the current 24-hour window."
        : variant === "error"
          ? "We couldn't load this slice of the catalog. Give it another try in a moment."
          : "Nothing on this tab right now. Peek at another tab.";

  return (
    <div className="home-v2-listing-empty" role="status">
      <div className="home-v2-listing-empty-icon" aria-hidden="true">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <p className="home-v2-listing-empty-title">{title}</p>
      <p className="home-v2-listing-empty-body">{body}</p>
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
    const upstreamInstalls = item.sourceIdentity?.lifetimeInstalls ?? item.metrics.lifetimeInstalls;
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
          <div className="home-v2-listing-row-stats is-skills-sh" aria-label="Downloads">
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
            {typeof upstreamInstalls === "number" ? (
              <span title={`${upstreamInstalls.toLocaleString()} skills.sh installs`}>
                {formatCompactStat(upstreamInstalls)}
              </span>
            ) : null}
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
    <Link to={pluginHref} className="home-v2-listing-row">
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
  const listingCacheRef = useRef<Map<string, HomeListingCacheEntry> | null>(null);
  listingCacheRef.current ??= createInitialListingCache(initialListing);
  const listingCache = listingCacheRef.current;

  const [kind, setKind] = useState<ListingKind>(initialListing?.kind ?? "skills");
  const initialTab =
    initialListing?.kind === "skills" && initialListing.trendingState === "unavailable"
      ? "featured"
      : (initialListing?.tab ?? "trending");
  const [tab, setTab] = useState<ListingTab>(initialTab);
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
  const [listingHasMore, setListingHasMore] = useState(initialListing?.hasMore ?? false);
  const [trendingState, setTrendingState] = useState<TrendingFeedState | undefined>(
    initialListing?.kind === "skills" ? initialListing.trendingState : undefined,
  );
  const [canonicalTrendingUnavailable, setCanonicalTrendingUnavailable] = useState(
    initialListing?.kind === "skills" && initialListing.trendingState === "unavailable",
  );

  const visibleTabs =
    kind === "skills"
      ? SKILL_LISTING_TABS.filter(
          (candidate) => candidate.id !== "trending" || !canonicalTrendingUnavailable,
        )
      : PLUGIN_LISTING_TABS;

  const activeItems = kind === "skills" ? skills : plugins;
  const activeStatus = status;
  const isEmpty = activeStatus === "idle" && activeItems.length === 0;
  const showListingMore =
    activeStatus === "idle" && (activeItems.length > visibleCount || listingHasMore);

  useEffect(() => {
    const cacheKey = listingCacheKey({
      kind,
      tab,
      categorySlugs: EMPTY_CATEGORY_SLUGS,
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
        ? fetchSkillListing(tab, EMPTY_CATEGORY_SLUGS, fetchLimit, controller.signal).then(
            (result) => {
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
            },
          )
        : fetchPluginListing(
            tab === "trending" ? "new" : tab,
            EMPTY_CATEGORY_SLUGS,
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
  }, [fetchLimit, kind, listingCache, tab]);

  useEffect(() => {
    setVisibleCount(LISTING_PAGE_SIZE);
    setFetchLimit(LISTING_PAGE_SIZE);
  }, [kind, tab]);

  const visibleSkills = skills.slice(0, visibleCount);
  const visiblePlugins = plugins.slice(0, visibleCount);

  const handleSeeMore = () => {
    setVisibleCount((count) => count + LISTING_PAGE_SIZE);
    setFetchLimit((limit) => limit + LISTING_PAGE_SIZE);
  };

  const handleKindChange = (nextKind: ListingKind) => {
    if (nextKind === kind) return;
    setKind(nextKind);
    setTab(
      nextKind === "skills" ? (canonicalTrendingUnavailable ? "featured" : "trending") : "new",
    );
  };

  return (
    <section
      id="home-v2-listing"
      className="home-v2-listing oc-section"
      aria-label="Browse catalog"
    >
      <div className="home-v2-listing-controls">
        <div className="home-v2-listing-toolbar">
          <div className="home-v2-listing-sort">
            <div className="home-v2-listing-sort-tabs" role="tablist" aria-label="Sort">
              {visibleTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={`home-v2-listing-tab${tab === item.id ? " is-active" : ""}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

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
        </div>
      </div>

      {activeStatus === "idle" && activeItems.length > 0 ? (
        <div className="home-v2-listing-head" aria-hidden="true">
          <span className="home-v2-listing-head-label">
            {kind === "skills" ? "Skill" : "Plugin"}
          </span>
          <span className="home-v2-listing-head-stat">Downloads</span>
        </div>
      ) : null}

      {activeStatus === "loading" ? (
        <BrowseResultsSkeleton label={kind === "skills" ? "Skill" : "Plugin"} variant="list" />
      ) : null}

      {activeStatus === "error" ? <HomeListingEmptyPanel variant="error" /> : null}

      {isEmpty ? (
        <HomeListingEmptyPanel
          variant={
            kind === "skills" && tab === "trending"
              ? trendingState === "unavailable"
                ? "trendingUnavailable"
                : "trendingEmpty"
              : "empty"
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
