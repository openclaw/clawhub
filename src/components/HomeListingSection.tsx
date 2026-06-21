import { Link } from "@tanstack/react-router";
import { isPluginCategorySlug, isSkillCategorySlug } from "clawhub-schema";
import {
  BadgeCheck,
  Binoculars,
  CloudOff,
  Download,
  LayoutGrid,
  Loader2,
  Moon,
  Plus,
  Rows3,
  Search,
  Star,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { isSkillOfficial } from "../lib/badges";
import {
  getSkillCategoriesForSkill,
  PLUGIN_CATEGORIES,
  SKILL_CATEGORIES,
  type BrowseCategory,
} from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import { fetchPluginCatalog, type PackageListItem } from "../lib/packageApi";
import type { PublicSkill, PublicUser } from "../lib/publicUser";
import { truncateText } from "../lib/truncateText";
import { HomeListingCategorySelect } from "./HomeListingCategorySelect";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import { BrowseResultsSkeleton } from "./skeletons/BrowseResultsSkeleton";

type ListingKind = "skills" | "plugins";
type ListingTab = "popular" | "trending" | "officials" | "new";
type ListingView = "list" | "grid";

type SkillPageEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

const SKILL_LISTING_TABS: Array<{ id: ListingTab; label: string }> = [
  { id: "popular", label: "Top" },
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
];

const PLUGIN_LISTING_TABS: Array<{ id: ListingTab; label: string }> = [
  { id: "officials", label: "Official" },
  { id: "popular", label: "Top" },
  { id: "new", label: "New" },
];

const LISTING_PAGE_SIZE = 20;
const LISTING_SEARCH_DEBOUNCE_MS = 220;
const PLUGIN_CATALOG_PAGE_LIMIT = 100;

const HOME_SKILL_LISTING_CATEGORIES: BrowseCategory[] = SKILL_CATEGORIES.map(
  ({ slug, label, icon }) => ({ slug, label, icon }),
);

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

type SkillSearchHit = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

function filterSkillsByTab(entries: SkillPageEntry[], tab: ListingTab) {
  if (tab === "officials") {
    return entries.filter((entry) => isSkillOfficial(entry.skill));
  }
  return entries;
}

function filterPluginsByTab(items: PackageListItem[], tab: ListingTab) {
  if (tab === "officials") {
    return items.filter((item) => item.isOfficial);
  }
  return items;
}

function isNewSkillEligible(skill: PublicSkill) {
  return (
    !skill.isSuspicious &&
    skill.githubScanStatus !== "pending" &&
    skill.githubScanStatus !== "suspicious"
  );
}

function itemMatchesAnyCategory(
  item: { categories?: readonly string[] | null },
  categorySlugs: readonly string[],
) {
  if (categorySlugs.length === 0) return true;
  const categories = item.categories ?? [];
  return categorySlugs.some((slug) => categories.includes(slug));
}

function skillMatchesAnyCategory(skill: PublicSkill, categorySlugs: readonly string[]) {
  if (categorySlugs.length === 0) return true;
  const categories = getSkillCategoriesForSkill(skill);
  return categorySlugs.some((slug) => categories.some((category) => category.slug === slug));
}

function uniqueSkillEntries(entries: SkillPageEntry[]) {
  const byId = new Map<string, SkillPageEntry>();
  for (const entry of entries) {
    byId.set(String(entry.skill._id), entry);
  }
  return [...byId.values()];
}

function uniquePlugins(items: PackageListItem[]) {
  const byName = new Map<string, PackageListItem>();
  for (const item of items) {
    byName.set(item.name, item);
  }
  return [...byName.values()];
}

function sortSkillEntries(entries: SkillPageEntry[], tab: ListingTab) {
  return [...entries].sort((left, right) => {
    if (tab === "new") {
      return (
        (right.skill.updatedAt ?? right.skill.createdAt ?? right.skill._creationTime ?? 0) -
        (left.skill.updatedAt ?? left.skill.createdAt ?? left.skill._creationTime ?? 0)
      );
    }
    return (right.skill.stats?.downloads ?? 0) - (left.skill.stats?.downloads ?? 0);
  });
}

function HomeListingEmptyPanel({
  variant,
  query,
  onClearSearch,
}: {
  variant: "error" | "search" | "filter";
  query?: string;
  onClearSearch?: () => void;
}) {
  const Icon = variant === "error" ? CloudOff : variant === "search" ? Binoculars : Moon;
  const title =
    variant === "error"
      ? "Listings took a coffee break"
      : variant === "search"
        ? query
          ? `No claws for “${query}”`
          : "No claws in this view"
        : "Quiet shelf";
  const body =
    variant === "error"
      ? "We couldn't load this slice of the catalog. Give it another try in a moment."
      : variant === "search"
        ? "Try another query or clear the search."
        : "Nothing on this tab right now. Peek at another tab or widen the category.";

  return (
    <div className="home-v2-listing-empty" role="status">
      <div className="home-v2-listing-empty-icon" aria-hidden="true">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <p className="home-v2-listing-empty-title">{title}</p>
      <p className="home-v2-listing-empty-body">{body}</p>
      {variant === "search" && onClearSearch ? (
        <button type="button" className="home-v2-listing-empty-action" onClick={onClearSearch}>
          <X size={15} aria-hidden="true" />
          Clear search
        </button>
      ) : null}
    </div>
  );
}

function HomeListingResults({
  view,
  showMore,
  loadingMore,
  onSeeMore,
  children,
}: {
  view: ListingView;
  showMore: boolean;
  loadingMore: boolean;
  onSeeMore: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`home-v2-listing-results${showMore ? " is-collapsed" : ""}${view === "grid" ? " is-grid" : " is-list"}`}
    >
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

function skillLink(entry: SkillPageEntry) {
  const owner =
    entry.ownerHandle?.trim() ||
    entry.owner?.handle?.trim() ||
    String(entry.skill.ownerPublisherId ?? entry.skill.ownerUserId);
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(entry.skill.slug)}`;
}

async function fetchSkillListing(
  tab: ListingTab,
  categorySlugs: readonly string[],
  numItems: number,
) {
  if (tab === "trending") {
    const requestLimit = categorySlugs.length > 0 ? 200 : numItems;
    const result = await convexHttp.query(api.skills.listPublicTrendingPage, {
      limit: requestLimit,
    });
    const items = ((result as { items?: SkillPageEntry[] }).items ?? []).filter((entry) =>
      skillMatchesAnyCategory(entry.skill, categorySlugs),
    );
    return {
      page: uniqueSkillEntries(items).slice(0, numItems),
      hasMore: items.length > numItems || (items.length >= numItems && numItems < 200),
    };
  }

  const categoriesToFetch = categorySlugs.length > 0 ? categorySlugs : [null];
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const page: SkillPageEntry[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (page.length < numItems) {
        const result = await convexHttp.query(api.skills.listPublicPageV4, {
          cursor: cursor ?? undefined,
          numItems: numItems - page.length,
          sort: tab === "new" ? "newest" : "downloads",
          dir: "desc",
          officialFirst: tab === "officials" ? true : undefined,
          categorySlug: categorySlug ?? undefined,
        });
        if (Array.isArray(result)) break;

        const resultPage = ((result as { page?: SkillPageEntry[] }).page ?? []).filter(
          (entry) =>
            skillMatchesAnyCategory(entry.skill, categorySlugs) &&
            (tab !== "new" || isNewSkillEligible(entry.skill)),
        );
        page.push(...resultPage);

        const nextCursor = (result as { nextCursor?: string | null }).nextCursor ?? null;
        hasMore = Boolean((result as { hasMore?: boolean }).hasMore ?? nextCursor);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      return { page, hasMore };
    }),
  );
  const pages = results.flatMap((result) => result.page);
  const sorted = sortSkillEntries(filterSkillsByTab(uniqueSkillEntries(pages), tab), tab);
  const hasMore = sorted.length > numItems || results.some((result) => result.hasMore);
  const page = sorted.slice(0, numItems);
  return { page, hasMore };
}

async function fetchPluginListing(
  tab: ListingTab,
  categorySlugs: readonly string[],
  limit: number,
  signal: AbortSignal,
) {
  const openClawOfficials = tab === "officials";
  const categoriesToFetch = categorySlugs.length > 0 ? categorySlugs : [null];
  const results = await Promise.all(
    categoriesToFetch.map(async (categorySlug) => {
      const items: PackageListItem[] = [];
      let cursor: string | null | undefined;
      let hasMore = false;

      while (items.length < limit) {
        const result = await fetchPluginCatalog({
          category: categorySlug ?? undefined,
          cursor: cursor ?? undefined,
          isOfficial: openClawOfficials ? true : undefined,
          excludedScanStatuses: tab === "new" ? ["pending", "suspicious"] : undefined,
          sort: tab === "new" ? "updated" : "downloads",
          limit: Math.min(limit - items.length, PLUGIN_CATALOG_PAGE_LIMIT),
          signal,
        });
        items.push(...result.items.filter((item) => itemMatchesAnyCategory(item, categorySlugs)));

        hasMore = result.nextCursor != null;
        if (!result.nextCursor || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }

      return { items, hasMore };
    }),
  );
  let items = uniquePlugins(results.flatMap((result) => result.items));
  items = filterPluginsByTab(items, tab);
  if (tab === "new") {
    items.sort((a, b) => b.updatedAt - a.updatedAt);
  } else if (tab === "popular" || openClawOfficials) {
    items.sort((a, b) => (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0));
  }
  const page = items.slice(0, limit);
  return {
    items: page,
    hasMore: items.length > limit || results.some((result) => result.hasMore),
  };
}

function HomeListingSkillRow({ entry, showStats }: { entry: SkillPageEntry; showStats: boolean }) {
  const handle = entry.ownerHandle || entry.owner?.handle;
  const name = entry.skill.displayName || entry.skill.slug;

  return (
    <Link
      to={skillLink(entry)}
      className={`home-v2-listing-row${showStats ? "" : " has-no-stats"}`}
    >
      <span className="home-v2-listing-row-icon" aria-hidden="true">
        <MarketplaceIcon kind="skill" label={name} skill={entry.skill} size="sm" />
      </span>
      <div className="home-v2-listing-row-body">
        <div className="home-v2-listing-row-title">
          <span className="home-v2-listing-row-name">{name}</span>
          {handle ? <span className="home-v2-listing-row-by">@{handle}</span> : null}
        </div>
        <p className="home-v2-listing-row-summary">
          {truncateText(entry.skill.summary || "Agent-ready skill pack.", 80)}
        </p>
      </div>
      {showStats ? (
        <div className="home-v2-listing-row-stats" aria-label="Popularity">
          <span>
            <Star size={13} aria-hidden="true" />
            {formatCompactStat(entry.skill.stats?.stars ?? 0)}
          </span>
          <span>
            <Download size={13} aria-hidden="true" />
            {formatCompactStat(entry.skill.stats?.downloads ?? 0)}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

function HomeListingPluginRow({ plugin }: { plugin: PackageListItem }) {
  const name = plugin.displayName || plugin.name;

  return (
    <Link to="/plugins/$name" params={{ name: plugin.name }} className="home-v2-listing-row">
      <span className="home-v2-listing-row-icon" aria-hidden="true">
        <MarketplaceIcon kind="plugin" label={name} size="sm" />
      </span>
      <div className="home-v2-listing-row-body">
        <div className="home-v2-listing-row-title">
          <span className="home-v2-listing-row-name">{name}</span>
          {plugin.ownerHandle ? (
            <span className="home-v2-listing-row-by">@{plugin.ownerHandle}</span>
          ) : null}
          {plugin.isOfficial ? <OfficialBadge /> : null}
        </div>
        <p className="home-v2-listing-row-summary">
          {truncateText(plugin.summary || "Gateway plugin for OpenClaw workflows.", 80)}
        </p>
      </div>
      <div className="home-v2-listing-row-stats" aria-label="Popularity">
        <span>
          <Star size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.stars ?? 0)}
        </span>
        <span>
          <Download size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.downloads ?? 0)}
        </span>
      </div>
    </Link>
  );
}

function HomeListingSkillCard({ entry, showStats }: { entry: SkillPageEntry; showStats: boolean }) {
  const handle = entry.ownerHandle || entry.owner?.handle;
  const name = entry.skill.displayName || entry.skill.slug;

  return (
    <Link
      to={skillLink(entry)}
      className={`home-v2-listing-card${showStats ? "" : " has-no-stats"}`}
    >
      <div className="home-v2-listing-card-head">
        <span className="home-v2-listing-card-icon" aria-hidden="true">
          <MarketplaceIcon kind="skill" label={name} skill={entry.skill} size="sm" />
        </span>
        <div className="home-v2-listing-card-id">
          <span className="home-v2-listing-card-name">{name}</span>
          {handle ? <span className="home-v2-listing-card-by">@{handle}</span> : null}
        </div>
      </div>
      <p className="home-v2-listing-card-summary">
        {truncateText(entry.skill.summary || "Agent-ready skill pack.", 80)}
      </p>
      {showStats ? (
        <div className="home-v2-listing-card-stats" aria-label="Popularity">
          <span>
            <Star size={13} aria-hidden="true" />
            {formatCompactStat(entry.skill.stats?.stars ?? 0)}
          </span>
          <span>
            <Download size={13} aria-hidden="true" />
            {formatCompactStat(entry.skill.stats?.downloads ?? 0)}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

function HomeListingPluginCard({ plugin }: { plugin: PackageListItem }) {
  const name = plugin.displayName || plugin.name;

  return (
    <Link to="/plugins/$name" params={{ name: plugin.name }} className="home-v2-listing-card">
      <div className="home-v2-listing-card-head">
        <span className="home-v2-listing-card-icon" aria-hidden="true">
          <MarketplaceIcon kind="plugin" label={name} size="sm" />
        </span>
        <div className="home-v2-listing-card-id">
          <span className="home-v2-listing-card-name">{name}</span>
          <span className="home-v2-listing-card-by-row">
            {plugin.ownerHandle ? (
              <span className="home-v2-listing-card-by">@{plugin.ownerHandle}</span>
            ) : null}
            {plugin.isOfficial ? <OfficialBadge /> : null}
          </span>
        </div>
      </div>
      <p className="home-v2-listing-card-summary">
        {truncateText(plugin.summary || "Gateway plugin for OpenClaw workflows.", 80)}
      </p>
      <div className="home-v2-listing-card-stats" aria-label="Popularity">
        <span>
          <Star size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.stars ?? 0)}
        </span>
        <span>
          <Download size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.downloads ?? 0)}
        </span>
      </div>
    </Link>
  );
}

export function HomeListingSection() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const [kind, setKind] = useState<ListingKind>("skills");
  const [tab, setTab] = useState<ListingTab>("popular");
  const [view, setView] = useState<ListingView>("list");
  const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(LISTING_PAGE_SIZE);
  const [fetchLimit, setFetchLimit] = useState(LISTING_PAGE_SIZE);
  const [skills, setSkills] = useState<SkillPageEntry[]>([]);
  const [plugins, setPlugins] = useState<PackageListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSkills, setSearchSkills] = useState<SkillPageEntry[]>([]);
  const [searchPlugins, setSearchPlugins] = useState<PackageListItem[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [listingHasMore, setListingHasMore] = useState(false);

  const trimmedSearch = searchQuery.trim();
  const isSearchMode = trimmedSearch.length > 0;
  const listingCategories = kind === "skills" ? HOME_SKILL_LISTING_CATEGORIES : PLUGIN_CATEGORIES;
  const selectedCategories = useMemo(
    () =>
      categorySlugs.flatMap((slug) => {
        const category = listingCategories.find((candidate) => candidate.slug === slug);
        return category ? [category] : [];
      }),
    [categorySlugs, listingCategories],
  );

  const filteredSearchSkills = useMemo(
    () => filterSkillsByTab(searchSkills, tab),
    [searchSkills, tab],
  );
  const filteredSearchPlugins = useMemo(
    () => filterPluginsByTab(searchPlugins, tab),
    [searchPlugins, tab],
  );
  const visibleTabs = kind === "skills" ? SKILL_LISTING_TABS : PLUGIN_LISTING_TABS;

  const activeItems = isSearchMode
    ? kind === "skills"
      ? filteredSearchSkills
      : filteredSearchPlugins
    : kind === "skills"
      ? skills
      : plugins;
  const activeStatus = isSearchMode ? searchStatus : status;
  const isEmpty = activeStatus === "idle" && activeItems.length === 0;
  const showSkillStats = !(kind === "skills" && tab === "trending" && !isSearchMode);
  const showListingMore =
    activeStatus === "idle" && (activeItems.length > visibleCount || listingHasMore);

  const openListingSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      openListingSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openListingSearch]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (trimmedSearch) {
        setSearchQuery("");
        return;
      }
      setSearchOpen(false);
      searchInputRef.current?.blur();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, trimmedSearch]);

  useEffect(() => {
    if (isSearchMode) return undefined;
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
        ? fetchSkillListing(tab, categorySlugs, fetchLimit).then((result) => {
            if (controller.signal.aborted) return;
            setSkills(result.page);
            setListingHasMore(result.hasMore);
            setStatus("idle");
          })
        : fetchPluginListing(tab, categorySlugs, fetchLimit, controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            setPlugins(result.items);
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
  }, [categorySlugs, fetchLimit, isSearchMode, kind, tab]);

  useEffect(() => {
    if (!isSearchMode) {
      setSearchSkills([]);
      setSearchPlugins([]);
      setSearchStatus("idle");
      setListingHasMore(false);
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
        kind === "skills"
          ? Promise.all(
              (categorySlugs.length > 0 ? categorySlugs : [null]).map((categorySlug) =>
                convexHttp.action(api.search.searchSkills, {
                  query: trimmedSearch,
                  limit: fetchLimit,
                  ...(tab === "new" ? { nonSuspiciousOnly: true, excludePendingScan: true } : {}),
                  ...(categorySlug ? { categorySlug } : {}),
                }),
              ),
            ).then((results) => {
              if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
              const rows = uniqueSkillEntries(
                results.flatMap((hits) =>
                  (hits as SkillSearchHit[])
                    .map((hit) => ({
                      skill: hit.skill,
                      ownerHandle: hit.ownerHandle,
                      owner: hit.owner,
                    }))
                    .filter(
                      (entry) =>
                        skillMatchesAnyCategory(entry.skill, categorySlugs) &&
                        (tab !== "new" || isNewSkillEligible(entry.skill)),
                    ),
                ),
              );
              const sortedRows = tab === "new" ? sortSkillEntries(rows, tab) : rows;
              setSearchSkills(sortedRows.slice(0, fetchLimit));
              setListingHasMore(
                sortedRows.length > fetchLimit ||
                  results.some((hits) => (hits as SkillSearchHit[]).length >= fetchLimit),
              );
              setSearchStatus("idle");
            })
          : Promise.all(
              (categorySlugs.length > 0 ? categorySlugs : [null]).map((categorySlug) =>
                fetchPluginCatalog({
                  q: trimmedSearch,
                  category: categorySlug ?? undefined,
                  isOfficial: tab === "officials" ? true : undefined,
                  excludedScanStatuses: tab === "new" ? ["pending", "suspicious"] : undefined,
                  sort: tab === "new" ? "updated" : "downloads",
                  limit: fetchLimit,
                  signal: controller.signal,
                }),
              ),
            ).then((results) => {
              if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
              const items = uniquePlugins(
                results.flatMap((result) =>
                  result.items.filter((item) => itemMatchesAnyCategory(item, categorySlugs)),
                ),
              );
              setSearchPlugins(
                tab === "new" ? [...items].sort((a, b) => b.updatedAt - a.updatedAt) : items,
              );
              setListingHasMore(
                results.some(
                  (result) => result.nextCursor != null || result.items.length >= fetchLimit,
                ),
              );
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
  }, [categorySlugs, fetchLimit, isSearchMode, kind, tab, trimmedSearch]);

  useEffect(() => {
    if (categorySlugs.length === 0) return;
    const isValid = kind === "skills" ? isSkillCategorySlug : isPluginCategorySlug;
    const validCategorySlugs = categorySlugs.filter((slug) => isValid(slug));
    if (validCategorySlugs.length !== categorySlugs.length) {
      setCategorySlugs(validCategorySlugs);
    }
  }, [categorySlugs, kind]);

  useEffect(() => {
    setVisibleCount(LISTING_PAGE_SIZE);
    setFetchLimit(LISTING_PAGE_SIZE);
  }, [categorySlugs, isSearchMode, kind, tab, trimmedSearch, view]);

  const visibleSkills = (isSearchMode ? filteredSearchSkills : skills).slice(0, visibleCount);
  const visiblePlugins = (isSearchMode ? filteredSearchPlugins : plugins).slice(0, visibleCount);

  const handleSeeMore = () => {
    setVisibleCount((count) => count + LISTING_PAGE_SIZE);
    setFetchLimit((limit) => limit + LISTING_PAGE_SIZE);
  };

  const closeListingSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    searchInputRef.current?.blur();
  };

  const handleListingSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  const handleKindChange = (nextKind: ListingKind) => {
    if (nextKind === kind) return;
    setKind(nextKind);
    setCategorySlugs([]);
    if (nextKind === "plugins") setTab("officials");
    else if (tab === "officials") setTab("popular");
  };

  const removeCategory = (slug: string) => {
    setCategorySlugs((current) => current.filter((categorySlug) => categorySlug !== slug));
  };

  return (
    <section id="home-v2-listing" className="home-v2-listing" aria-label="Browse catalog">
      <div className="home-v2-listing-controls">
        <div className="home-v2-listing-toolbar">
          <div className="home-v2-listing-kind" role="group" aria-label="Content type">
            <button
              type="button"
              className={`home-v2-listing-kind-btn${kind === "skills" ? " is-active" : ""}`}
              aria-pressed={kind === "skills"}
              onClick={() => handleKindChange("skills")}
            >
              Skills
            </button>
            <button
              type="button"
              className={`home-v2-listing-kind-btn${kind === "plugins" ? " is-active" : ""}`}
              aria-pressed={kind === "plugins"}
              onClick={() => handleKindChange("plugins")}
            >
              Plugins
            </button>
          </div>

          <span className="home-v2-listing-divider" aria-hidden="true" />

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
                  {item.id === "officials" ? (
                    <BadgeCheck
                      size={14}
                      strokeWidth={2.25}
                      className="home-v2-listing-tab-icon"
                      aria-hidden="true"
                    />
                  ) : null}
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="home-v2-listing-actions">
            <div className="home-v2-listing-actions-rail has-category">
              <button
                type="button"
                className={`home-v2-listing-search-trigger${searchOpen ? " is-active" : ""}`}
                aria-label="Search catalog"
                aria-expanded={searchOpen}
                aria-controls="home-v2-listing-search-panel"
                title="Search catalog (/)"
                onClick={openListingSearch}
              >
                <Search size={16} aria-hidden="true" />
              </button>

              <HomeListingCategorySelect
                categories={listingCategories}
                value={categorySlugs}
                onChange={setCategorySlugs}
              />

              <div className="home-v2-listing-view" role="group" aria-label="Layout">
                <button
                  type="button"
                  className={`home-v2-listing-view-btn${view === "list" ? " is-active" : ""}`}
                  aria-pressed={view === "list"}
                  aria-label="List view"
                  onClick={() => setView("list")}
                >
                  <Rows3 size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`home-v2-listing-view-btn${view === "grid" ? " is-active" : ""}`}
                  aria-pressed={view === "grid"}
                  aria-label="Grid view"
                  onClick={() => setView("grid")}
                >
                  <LayoutGrid size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          id="home-v2-listing-search-panel"
          className={`home-v2-listing-search${searchOpen ? " is-open" : ""}`}
          hidden={!searchOpen}
        >
          <form className="home-v2-listing-search-bar" onSubmit={handleListingSearchSubmit}>
            <Search size={16} className="home-v2-listing-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              className="home-v2-listing-search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={
                kind === "skills" ? "Search skills on ClawHub" : "Search plugins on ClawHub"
              }
              aria-label={kind === "skills" ? "Search skills" : "Search plugins"}
              autoComplete="off"
            />
            <button
              type="button"
              className="home-v2-listing-search-close"
              aria-label="Close search"
              onClick={closeListingSearch}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </form>
        </div>

        {selectedCategories.length > 0 ? (
          <div className="home-v2-listing-active-filters" aria-label="Active category filters">
            {selectedCategories.length <= 3 ? (
              selectedCategories.map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  className="home-v2-listing-filter-chip"
                  onClick={() => removeCategory(category.slug)}
                  aria-label={`Remove ${category.label} category filter`}
                >
                  {category.label}
                  <X size={13} aria-hidden="true" />
                </button>
              ))
            ) : (
              <>
                <span className="home-v2-listing-filter-chip is-summary">
                  {selectedCategories.length} categories
                </span>
                <button
                  type="button"
                  className="home-v2-listing-filter-clear"
                  onClick={() => setCategorySlugs([])}
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {activeStatus === "idle" && view === "list" && activeItems.length > 0 ? (
        <div
          className={`home-v2-listing-head${showSkillStats ? "" : " has-no-stats"}`}
          aria-hidden="true"
        >
          <span className="home-v2-listing-head-icon-spacer" />
          <span className="home-v2-listing-head-label">
            {kind === "skills" ? "Skill" : "Plugin"}
          </span>
          {showSkillStats ? <span className="home-v2-listing-head-stat">Popularity</span> : null}
        </div>
      ) : null}

      {activeStatus === "loading" ? (
        <BrowseResultsSkeleton label={kind === "skills" ? "Skill" : "Plugin"} variant="list" />
      ) : null}

      {activeStatus === "error" ? <HomeListingEmptyPanel variant="error" /> : null}

      {isEmpty ? (
        <HomeListingEmptyPanel
          variant={isSearchMode ? "search" : "filter"}
          query={isSearchMode ? trimmedSearch : undefined}
          onClearSearch={isSearchMode ? closeListingSearch : undefined}
        />
      ) : null}

      {activeStatus === "idle" && kind === "skills" && visibleSkills.length > 0 ? (
        <HomeListingResults
          view={view}
          showMore={showListingMore}
          loadingMore={loadingMore}
          onSeeMore={handleSeeMore}
        >
          <div className={view === "grid" ? "home-v2-listing-grid" : "home-v2-listing-list"}>
            {visibleSkills.map((entry) =>
              view === "grid" ? (
                <HomeListingSkillCard
                  key={entry.skill._id}
                  entry={entry}
                  showStats={showSkillStats}
                />
              ) : (
                <HomeListingSkillRow
                  key={entry.skill._id}
                  entry={entry}
                  showStats={showSkillStats}
                />
              ),
            )}
          </div>
        </HomeListingResults>
      ) : null}

      {activeStatus === "idle" && kind === "plugins" && visiblePlugins.length > 0 ? (
        <HomeListingResults
          view={view}
          showMore={showListingMore}
          loadingMore={loadingMore}
          onSeeMore={handleSeeMore}
        >
          <div className={view === "grid" ? "home-v2-listing-grid" : "home-v2-listing-list"}>
            {visiblePlugins.map((plugin) =>
              view === "grid" ? (
                <HomeListingPluginCard key={plugin.name} plugin={plugin} />
              ) : (
                <HomeListingPluginRow key={plugin.name} plugin={plugin} />
              ),
            )}
          </div>
        </HomeListingResults>
      ) : null}
    </section>
  );
}
