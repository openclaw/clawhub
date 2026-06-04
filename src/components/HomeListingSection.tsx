import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  BadgeCheck,
  Binoculars,
  CloudOff,
  LayoutGrid,
  Moon,
  Plus,
  Rows3,
  Search,
  Star,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { isSkillHighlighted, isSkillOfficial } from "../lib/badges";
import { formatCompactStat } from "../lib/numberFormat";
import { fetchPluginCatalog, type PackageListItem } from "../lib/packageApi";
import type { PublicSkill, PublicUser } from "../lib/publicUser";
import { HomeListingCategorySelect } from "./HomeListingCategorySelect";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";

type ListingKind = "skills" | "plugins";
type ListingTab = "popular" | "officials" | "featured";
type ListingView = "list" | "grid";

type SkillPageEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

const LISTING_TABS: Array<{ id: ListingTab; label: string }> = [
  { id: "popular", label: "Most popular" },
  { id: "officials", label: "Officials" },
  { id: "featured", label: "Featured" },
];

const LISTING_PAGE_SIZE = 20;
const LISTING_SEARCH_DEBOUNCE_MS = 220;

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
  if (tab === "featured") {
    return entries.filter((entry) => isSkillHighlighted(entry.skill));
  }
  return entries;
}

function filterPluginsByTab(items: PackageListItem[], tab: ListingTab) {
  if (tab === "officials") {
    return items.filter((item) => item.isOfficial);
  }
  return items;
}

function HomeListingEmptyPanel({
  variant,
  query,
  onFullSearch,
}: {
  variant: "error" | "search" | "filter";
  query?: string;
  onFullSearch?: () => void;
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
        ? "This tab's filters might be too picky. Try another tab, or search the full hub."
        : "Nothing on this tab right now. Peek at another tab or widen the category.";

  return (
    <div className="home-v2-listing-empty" role="status">
      <div className="home-v2-listing-empty-icon" aria-hidden="true">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <p className="home-v2-listing-empty-title">{title}</p>
      <p className="home-v2-listing-empty-body">{body}</p>
      {variant === "search" && onFullSearch ? (
        <button type="button" className="home-v2-listing-empty-action" onClick={onFullSearch}>
          Search the full hub
        </button>
      ) : null}
    </div>
  );
}

function HomeListingResults({
  view,
  showMore,
  onSeeMore,
  children,
}: {
  view: ListingView;
  showMore: boolean;
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
          <button type="button" className="home-v2-listing-more-btn" onClick={onSeeMore}>
            <Plus size={14} aria-hidden="true" />
            See more
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
  categorySlug: string | null,
  numItems: number,
) {
  const result = await convexHttp.query(api.skills.listPublicPageV4, {
    numItems,
    sort: "downloads",
    dir: "desc",
    highlightedOnly: tab === "featured" ? true : undefined,
    officialOnly: tab === "officials" ? true : undefined,
    categorySlug: categorySlug ?? undefined,
  });
  const page = Array.isArray(result)
    ? []
    : ((result as { page?: SkillPageEntry[] }).page ?? []);
  return page;
}

async function fetchPluginListing(tab: ListingTab, limit: number, signal: AbortSignal) {
  const result = await fetchPluginCatalog({
    featured: tab === "featured" ? true : undefined,
    isOfficial: tab === "officials" ? true : undefined,
    limit,
    signal,
  });
  const items = [...result.items];
  if (tab === "popular" || tab === "officials") {
    items.sort((a, b) => (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0));
  }
  return items.slice(0, limit);
}

function HomeListingSkillRow({ entry }: { entry: SkillPageEntry }) {
  const handle = entry.ownerHandle || entry.owner?.handle;
  const name = entry.skill.displayName || entry.skill.slug;

  return (
    <Link to={skillLink(entry)} className="home-v2-listing-row">
      <span className="home-v2-listing-row-icon" aria-hidden="true">
        <MarketplaceIcon kind="skill" label={name} icon={entry.skill.icon} size="sm" />
      </span>
      <div className="home-v2-listing-row-body">
        <div className="home-v2-listing-row-title">
          <span className="home-v2-listing-row-name">{name}</span>
          {handle ? <span className="home-v2-listing-row-by">@{handle}</span> : null}
        </div>
        <p className="home-v2-listing-row-summary">
          {entry.skill.summary || "Agent-ready skill pack."}
        </p>
      </div>
      <div className="home-v2-listing-row-stats" aria-label="Popularity">
        <span>
          <Star size={13} aria-hidden="true" />
          {formatCompactStat(entry.skill.stats?.stars ?? 0)}
        </span>
        <span>
          <ArrowDownToLine size={13} aria-hidden="true" />
          {formatCompactStat(entry.skill.stats?.downloads ?? 0)}
        </span>
      </div>
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
          {plugin.summary || "Gateway plugin for OpenClaw workflows."}
        </p>
      </div>
      <div className="home-v2-listing-row-stats" aria-label="Popularity">
        <span>
          <Star size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.stars ?? 0)}
        </span>
        <span>
          <ArrowDownToLine size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.downloads ?? 0)}
        </span>
      </div>
    </Link>
  );
}

function HomeListingSkillCard({ entry }: { entry: SkillPageEntry }) {
  const handle = entry.ownerHandle || entry.owner?.handle;
  const name = entry.skill.displayName || entry.skill.slug;

  return (
    <Link to={skillLink(entry)} className="home-v2-listing-card">
      <div className="home-v2-listing-card-head">
        <span className="home-v2-listing-card-icon" aria-hidden="true">
          <MarketplaceIcon kind="skill" label={name} icon={entry.skill.icon} size="sm" />
        </span>
        <div className="home-v2-listing-card-id">
          <span className="home-v2-listing-card-name">{name}</span>
          {handle ? <span className="home-v2-listing-card-by">@{handle}</span> : null}
        </div>
      </div>
      <p className="home-v2-listing-card-summary">
        {entry.skill.summary || "Agent-ready skill pack."}
      </p>
      <div className="home-v2-listing-card-stats" aria-label="Popularity">
        <span>
          <Star size={13} aria-hidden="true" />
          {formatCompactStat(entry.skill.stats?.stars ?? 0)}
        </span>
        <span>
          <ArrowDownToLine size={13} aria-hidden="true" />
          {formatCompactStat(entry.skill.stats?.downloads ?? 0)}
        </span>
      </div>
    </Link>
  );
}

function HomeListingPluginCard({ plugin }: { plugin: PackageListItem }) {
  const name = plugin.displayName || plugin.name;

  return (
    <Link
      to="/plugins/$name"
      params={{ name: plugin.name }}
      className="home-v2-listing-card"
    >
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
        {plugin.summary || "Gateway plugin for OpenClaw workflows."}
      </p>
      <div className="home-v2-listing-card-stats" aria-label="Popularity">
        <span>
          <Star size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.stars ?? 0)}
        </span>
        <span>
          <ArrowDownToLine size={13} aria-hidden="true" />
          {formatCompactStat(plugin.stats?.downloads ?? 0)}
        </span>
      </div>
    </Link>
  );
}

export function HomeListingSection() {
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const [kind, setKind] = useState<ListingKind>("skills");
  const [tab, setTab] = useState<ListingTab>("popular");
  const [view, setView] = useState<ListingView>("list");
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(LISTING_PAGE_SIZE);
  const [fetchLimit, setFetchLimit] = useState(LISTING_PAGE_SIZE);
  const [skills, setSkills] = useState<SkillPageEntry[]>([]);
  const [plugins, setPlugins] = useState<PackageListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSkills, setSearchSkills] = useState<SkillPageEntry[]>([]);
  const [searchPlugins, setSearchPlugins] = useState<PackageListItem[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");

  const trimmedSearch = searchQuery.trim();
  const isSearchMode = trimmedSearch.length > 0;

  const filteredSearchSkills = useMemo(
    () => filterSkillsByTab(searchSkills, tab),
    [searchSkills, tab],
  );
  const filteredSearchPlugins = useMemo(
    () => filterPluginsByTab(searchPlugins, tab),
    [searchPlugins, tab],
  );

  const activeItems = isSearchMode
    ? kind === "skills"
      ? filteredSearchSkills
      : filteredSearchPlugins
    : kind === "skills"
      ? skills
      : plugins;
  const activeStatus = isSearchMode ? searchStatus : status;
  const isEmpty = activeStatus === "idle" && activeItems.length === 0;
  const showListingMore = activeStatus === "idle" && activeItems.length > visibleCount;

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
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
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
    if (isSearchMode) return;
    const controller = new AbortController();
    setStatus("loading");

    const load =
      kind === "skills"
        ? fetchSkillListing(tab, categorySlug, fetchLimit)
            .then((page) => {
              if (controller.signal.aborted) return;
              setSkills(page);
              setStatus("idle");
            })
        : fetchPluginListing(tab, fetchLimit, controller.signal)
            .then((items) => {
              if (controller.signal.aborted) return;
              setPlugins(items);
              setStatus("idle");
            });

    load.catch(() => {
      if (controller.signal.aborted) return;
      if (kind === "skills") setSkills([]);
      else setPlugins([]);
      setStatus("error");
    });

    return () => controller.abort();
  }, [categorySlug, fetchLimit, isSearchMode, kind, tab]);

  useEffect(() => {
    if (!isSearchMode) {
      setSearchSkills([]);
      setSearchPlugins([]);
      setSearchStatus("idle");
      return;
    }

    searchRequestRef.current += 1;
    const requestId = searchRequestRef.current;
    const controller = new AbortController();
    setSearchStatus("loading");

    const handle = window.setTimeout(() => {
      const load =
        kind === "skills"
          ? convexHttp
              .action(api.search.searchSkills, {
                query: trimmedSearch,
                limit: fetchLimit,
                highlightedOnly: tab === "featured" ? true : undefined,
              })
              .then((hits) => {
                if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
                const rows = (hits as SkillSearchHit[]).map((hit) => ({
                  skill: hit.skill,
                  ownerHandle: hit.ownerHandle,
                  owner: hit.owner,
                }));
                setSearchSkills(rows);
                setSearchStatus("idle");
              })
          : fetchPluginCatalog({
              q: trimmedSearch,
              featured: tab === "featured" ? true : undefined,
              isOfficial: tab === "officials" ? true : undefined,
              limit: fetchLimit,
              signal: controller.signal,
            }).then((result) => {
              if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
              setSearchPlugins(result.items);
              setSearchStatus("idle");
            });

      load.catch(() => {
        if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
        if (kind === "skills") setSearchSkills([]);
        else setSearchPlugins([]);
        setSearchStatus("error");
      });
    }, LISTING_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [fetchLimit, isSearchMode, kind, tab, trimmedSearch]);

  useEffect(() => {
    setVisibleCount(LISTING_PAGE_SIZE);
    setFetchLimit(LISTING_PAGE_SIZE);
  }, [categorySlug, isSearchMode, kind, tab, trimmedSearch, view]);

  const visibleSkills = (isSearchMode ? filteredSearchSkills : skills).slice(0, visibleCount);
  const visiblePlugins = (isSearchMode ? filteredSearchPlugins : plugins).slice(0, visibleCount);

  const handleSeeMore = () => {
    setVisibleCount((count) => count + LISTING_PAGE_SIZE);
    setFetchLimit((limit) => limit + LISTING_PAGE_SIZE);
  };

  const openListingSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const closeListingSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    searchInputRef.current?.blur();
  };

  const goToFullSearch = () => {
    const q = trimmedSearch;
    if (!q) return;
    void navigate({
      to: "/search",
      search: { q, type: kind === "skills" ? "skills" : "plugins" },
    });
  };

  const handleListingSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    goToFullSearch();
  };

  return (
    <section className="home-v2-listing" aria-label="Browse catalog">
      <div className="home-v2-listing-controls">
        <div className="home-v2-listing-toolbar">
          <div className="home-v2-listing-kind" role="group" aria-label="Content type">
            <button
              type="button"
              className={`home-v2-listing-kind-btn${kind === "skills" ? " is-active" : ""}`}
              aria-pressed={kind === "skills"}
              onClick={() => setKind("skills")}
            >
              Skills
            </button>
            <button
              type="button"
              className={`home-v2-listing-kind-btn${kind === "plugins" ? " is-active" : ""}`}
              aria-pressed={kind === "plugins"}
              onClick={() => setKind("plugins")}
            >
              Plugins
            </button>
          </div>

          <span className="home-v2-listing-divider" aria-hidden="true" />

          <div className="home-v2-listing-sort" role="tablist" aria-label="Sort">
            {LISTING_TABS.map((item) => (
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

          <div className="home-v2-listing-actions">
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

            {kind === "skills" ? (
              <HomeListingCategorySelect
                value={categorySlug}
                onChange={setCategorySlug}
              />
            ) : null}

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
                kind === "skills" ? "Search skills in this catalog…" : "Search plugins in this catalog…"
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
      </div>

      {activeStatus === "idle" && view === "list" && activeItems.length > 0 ? (
        <div className="home-v2-listing-head" aria-hidden="true">
          <span className="home-v2-listing-head-label">
            {kind === "skills" ? "Skill" : "Plugin"}
          </span>
          <span className="home-v2-listing-head-stat">Popularity</span>
        </div>
      ) : null}

      {activeStatus === "loading" ? (
        <div className="home-v2-listing-list home-v2-listing-list-loading" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="home-v2-listing-skeleton" />
          ))}
        </div>
      ) : null}

      {activeStatus === "error" ? <HomeListingEmptyPanel variant="error" /> : null}

      {isEmpty ? (
        <HomeListingEmptyPanel
          variant={isSearchMode ? "search" : "filter"}
          query={isSearchMode ? trimmedSearch : undefined}
          onFullSearch={isSearchMode ? goToFullSearch : undefined}
        />
      ) : null}

      {activeStatus === "idle" && kind === "skills" && visibleSkills.length > 0 ? (
        <HomeListingResults
          view={view}
          showMore={showListingMore}
          onSeeMore={handleSeeMore}
        >
          <div
            className={view === "grid" ? "home-v2-listing-grid" : "home-v2-listing-list"}
          >
            {visibleSkills.map((entry) =>
              view === "grid" ? (
                <HomeListingSkillCard key={entry.skill._id} entry={entry} />
              ) : (
                <HomeListingSkillRow key={entry.skill._id} entry={entry} />
              ),
            )}
          </div>
        </HomeListingResults>
      ) : null}

      {activeStatus === "idle" && kind === "plugins" && visiblePlugins.length > 0 ? (
        <HomeListingResults
          view={view}
          showMore={showListingMore}
          onSeeMore={handleSeeMore}
        >
          <div
            className={view === "grid" ? "home-v2-listing-grid" : "home-v2-listing-list"}
          >
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
