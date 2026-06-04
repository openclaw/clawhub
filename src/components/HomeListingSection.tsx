import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownToLine, ListFilter, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { formatCompactStat } from "../lib/numberFormat";
import { familyLabel } from "../lib/packageLabels";
import { fetchPluginCatalog, type PackageListItem } from "../lib/packageApi";
import type { PublicSkill, PublicUser } from "../lib/publicUser";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";

type ListingKind = "skills" | "plugins";
type ListingTab = "latest" | "popular" | "rated" | "featured";

type SkillPageEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicUser | null;
};

const LISTING_TABS: Array<{ id: ListingTab; label: string }> = [
  { id: "latest", label: "Latest" },
  { id: "popular", label: "Most popular" },
  { id: "rated", label: "Top rated" },
  { id: "featured", label: "Featured" },
];

const PAGE_SIZE = 12;

function skillLink(entry: SkillPageEntry) {
  const owner =
    entry.ownerHandle?.trim() ||
    entry.owner?.handle?.trim() ||
    String(entry.skill.ownerPublisherId ?? entry.skill.ownerUserId);
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(entry.skill.slug)}`;
}

function skillsSortForTab(tab: ListingTab) {
  if (tab === "latest") return "newest" as const;
  if (tab === "popular") return "downloads" as const;
  if (tab === "rated") return "stars" as const;
  return "downloads" as const;
}

function skillsBrowseSort(tab: ListingTab) {
  if (tab === "latest") return "newest" as const;
  if (tab === "popular") return "downloads" as const;
  if (tab === "rated") return "stars" as const;
  return "recommended" as const;
}

async function fetchSkillListing(tab: ListingTab) {
  const result = await convexHttp.query(api.skills.listPublicPageV4, {
    numItems: PAGE_SIZE,
    sort: skillsSortForTab(tab),
    dir: "desc",
    highlightedOnly: tab === "featured" ? true : undefined,
  });
  const page = Array.isArray(result)
    ? []
    : ((result as { page?: SkillPageEntry[] }).page ?? []);
  return page;
}

async function fetchPluginListing(tab: ListingTab, signal: AbortSignal) {
  const result = await fetchPluginCatalog({
    featured: tab === "featured" ? true : undefined,
    limit: PAGE_SIZE,
    signal,
  });
  const items = [...result.items];
  if (tab === "latest") {
    items.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  } else if (tab === "popular" || tab === "rated") {
    items.sort((a, b) => b.updatedAt - a.updatedAt || a.displayName.localeCompare(b.displayName));
  }
  return items.slice(0, PAGE_SIZE);
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
      <div className="home-v2-listing-row-stats">
        <span>{familyLabel(plugin.family)}</span>
        {plugin.latestVersion ? <span>v{plugin.latestVersion}</span> : null}
      </div>
    </Link>
  );
}

export function HomeListingSection() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<ListingKind>("skills");
  const [tab, setTab] = useState<ListingTab>("latest");
  const [skills, setSkills] = useState<SkillPageEntry[]>([]);
  const [plugins, setPlugins] = useState<PackageListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");

  const activeItems = kind === "skills" ? skills : plugins;
  const isEmpty = status === "idle" && activeItems.length === 0;

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    const load =
      kind === "skills"
        ? fetchSkillListing(tab)
            .then((page) => {
              if (controller.signal.aborted) return;
              setSkills(page);
              setStatus("idle");
            })
        : fetchPluginListing(tab, controller.signal)
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
  }, [kind, tab]);

  const filterHref = useMemo(() => {
    if (kind === "plugins") {
      return {
        to: "/plugins" as const,
        search: {
          q: undefined,
          cursor: undefined,
          family: undefined,
          featured: tab === "featured" ? true : undefined,
          official: undefined,
          executesCode: undefined,
          sort: tab === "latest" ? ("newest" as const) : ("updated" as const),
          view: undefined,
        },
      };
    }
    return {
      to: "/skills" as const,
      search: {
        q: undefined,
        sort: skillsBrowseSort(tab),
        dir: "desc" as const,
        featured: tab === "featured" ? true : undefined,
        highlighted: tab === "featured" ? true : undefined,
        category: undefined,
        view: undefined,
        focus: undefined,
      },
    };
  }, [kind, tab]);

  const openFilter = () => {
    void navigate(filterHref);
  };

  return (
    <section className="home-v2-listing" aria-label="Browse catalog">
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

        <div className="home-v2-listing-tabs" role="tablist" aria-label="Sort">
          {LISTING_TABS.map((item) => (
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

        <button type="button" className="home-v2-listing-filter" onClick={openFilter}>
          <ListFilter size={16} aria-hidden="true" />
          Filter
        </button>
      </div>

      {status === "loading" ? (
        <div className="home-v2-listing-list home-v2-listing-list-loading" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="home-v2-listing-skeleton" />
          ))}
        </div>
      ) : null}

      {status === "error" ? (
        <p className="home-v2-listing-empty">Could not load listings. Try again in a moment.</p>
      ) : null}

      {isEmpty ? (
        <p className="home-v2-listing-empty">Nothing here yet. Check another tab or filter.</p>
      ) : null}

      {status === "idle" && kind === "skills" && skills.length > 0 ? (
        <div className="home-v2-listing-list">
          {skills.map((entry) => (
            <HomeListingSkillRow key={entry.skill._id} entry={entry} />
          ))}
        </div>
      ) : null}

      {status === "idle" && kind === "plugins" && plugins.length > 0 ? (
        <div className="home-v2-listing-list">
          {plugins.map((plugin) => (
            <HomeListingPluginRow key={plugin.name} plugin={plugin} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
