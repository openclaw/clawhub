import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Code2,
  Download,
  Flame,
  Ghost,
  Image,
  Package,
  Palette,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { SkillCard } from "../components/SkillCard";
import { SkillListItem } from "../components/SkillListItem";
import { SkillStatsTripletLine } from "../components/SkillStats";
import { SoulCard } from "../components/SoulCard";
import { SoulStatsTripletLine } from "../components/SoulStats";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { UserBadge } from "../components/UserBadge";
import { convexHttp } from "../convex/client";
import { getSkillBadges } from "../lib/badges";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill, PublicSoul } from "../lib/publicUser";
import { getSiteMode } from "../lib/site";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const mode = getSiteMode();
  return mode === "souls" ? <OnlyCrabsHome /> : <SkillsHome />;
}

const popularSearches = ["AI Writing", "Screenshot", "Productivity", "Analytics", "Automation"];

const categories = [
  { name: "Productivity", icon: Zap, count: 324, className: "productivity" },
  { name: "AI & ML", icon: Brain, count: 218, className: "ai" },
  { name: "Developer Tools", icon: Code2, count: 456, className: "developer" },
  { name: "Design", icon: Palette, count: 189, className: "design" },
  { name: "Analytics", icon: BarChart3, count: 142, className: "analytics" },
  { name: "Security", icon: Shield, count: 98, className: "security" },
  { name: "Automation", icon: Settings, count: 276, className: "automation" },
  { name: "Media", icon: Image, count: 167, className: "media" },
];

function SkillsHome() {
  type SkillPageEntry = {
    skill: PublicSkill;
    ownerHandle?: string | null;
    owner?: PublicPublisher | null;
    latestVersion?: unknown;
  };

  const [highlighted, setHighlighted] = useState<SkillPageEntry[]>([]);
  const [trending, setTrending] = useState<SkillPageEntry[]>([]);
  const [recent, setRecent] = useState<SkillPageEntry[]>([]);
  const [skillCount, setSkillCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = Route.useNavigate();

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      convexHttp.query(api.skills.listHighlightedPublic, { limit: 6 }),
      convexHttp.query(api.skills.listPublicPageV4, {
        numItems: 6,
        sort: "downloads",
        dir: "desc",
        nonSuspiciousOnly: true,
      }),
      convexHttp.query(api.skills.listPublicPageV4, {
        numItems: 6,
        sort: "updated",
        dir: "desc",
        nonSuspiciousOnly: true,
      }),
      convexHttp.query(api.skills.countPublicSkills, {}),
    ])
      .then(([h, t, r, c]) => {
        if (cancelled) return;
        setHighlighted(h as SkillPageEntry[]);
        setTrending((t as { page: SkillPageEntry[] }).page);
        setRecent((r as { page: SkillPageEntry[] }).page);
        setSkillCount(c as number);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    void navigate({
      to: "/search",
      search: { q, type: undefined },
    });
  };

  return (
    <main>
      {/* Hero Section */}
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-grid">
            <div className="home-hero-copy">
              {/* Badge */}
              <div className="home-hero-kicker">
                <Sparkles size={14} className="home-hero-kicker-icon" />
                <span>
                  {skillCount != null
                    ? `${formatCompactStat(skillCount)} curated tools`
                    : "Thousands of curated tools"}
                </span>
              </div>

              {/* Headline */}
              <h1 className="home-hero-title">
                Discover tools that{" "}
                <span className="home-hero-title-accent">power your work</span>
              </h1>

              {/* Subheadline */}
              <p className="home-hero-subtitle">
                The modern marketplace for internet tools. Find, compare, and install the best
                software to supercharge your productivity.
              </p>

              {/* Search */}
              <form className="home-hero-search" onSubmit={handleSearch}>
                <div className="home-hero-search-wrapper">
                  <Search size={20} className="home-hero-search-icon" />
                  <input
                    type="text"
                    className="home-hero-search-input"
                    placeholder="Search for tools, categories, or features..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <button type="submit" className="home-hero-search-btn">
                    <span>Search</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>

              {/* Popular searches */}
              <div className="home-hero-popular">
                <span className="home-hero-popular-label">Popular:</span>
                {popularSearches.map((search) => (
                  <button
                    key={search}
                    type="button"
                    className="home-hero-popular-tag"
                    onClick={() => setSearchQuery(search)}
                  >
                    {search}
                  </button>
                ))}
              </div>
            </div>

            {/* Discovery Panels */}
            <div className="home-hero-panels" id="home-discovery">
              <Link
                to="/skills"
                search={{
                  q: undefined,
                  sort: "downloads" as const,
                  dir: "desc" as const,
                  highlighted: undefined,
                  nonSuspicious: true,
                  view: undefined,
                  focus: undefined,
                }}
                className="home-hero-panel"
              >
                <div className="home-hero-panel-icon">
                  <Zap size={20} />
                </div>
                <strong>Skills</strong>
                <span>Browse ranked skill bundles</span>
              </Link>
              <Link to="/plugins" className="home-hero-panel">
                <div className="home-hero-panel-icon">
                  <Code2 size={20} />
                </div>
                <strong>Plugins</strong>
                <span>Agent-ready packages</span>
              </Link>
              <Link to="/users" search={{ q: undefined }} className="home-hero-panel">
                <div className="home-hero-panel-icon">
                  <Users size={20} />
                </div>
                <strong>Builders</strong>
                <span>Meet the creators</span>
              </Link>
              <Link
                to="/souls"
                search={{
                  q: undefined,
                  sort: undefined,
                  dir: undefined,
                  view: undefined,
                  focus: undefined,
                }}
                className="home-hero-panel"
              >
                <div className="home-hero-panel-icon">
                  <Ghost size={20} />
                </div>
                <strong>Souls</strong>
                <span>SOUL.md discovery</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      {skillCount != null ? (
        <section className="home-section">
          <div className="home-stats">
            <div className="home-stat">
              <div className="home-stat-value">{formatCompactStat(skillCount)}+</div>
              <div className="home-stat-label">Curated Tools</div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Trending */}
      {trending.length > 0 ? (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">
              <span className="home-section-title-icon trending">
                <TrendingUp size={16} />
              </span>
              Trending Now
            </h2>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: "downloads" as const,
                dir: "desc" as const,
                highlighted: undefined,
                nonSuspicious: true,
                view: undefined,
                focus: undefined,
              }}
              className="home-section-link"
            >
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="results-list">
            {trending.map((entry) => (
              <SkillListItem
                key={entry.skill._id}
                skill={entry.skill}
                ownerHandle={entry.ownerHandle}
                owner={entry.owner}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Recently updated */}
      {recent.length > 0 ? (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">
              <span className="home-section-title-icon recent">
                <Sparkles size={16} />
              </span>
              Recently Updated
            </h2>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: "updated" as const,
                dir: "desc" as const,
                highlighted: undefined,
                nonSuspicious: true,
                view: undefined,
                focus: undefined,
              }}
              className="home-section-link"
            >
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="results-list">
            {recent.map((entry) => (
              <SkillListItem
                key={entry.skill._id}
                skill={entry.skill}
                ownerHandle={entry.ownerHandle}
                owner={entry.owner}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Staff picks */}
      {highlighted.length > 0 ? (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">
              <span className="home-section-title-icon featured">
                <Star size={16} />
              </span>
              Staff Picks
            </h2>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                highlighted: true,
                nonSuspicious: undefined,
                view: undefined,
                focus: undefined,
              }}
              className="home-section-link"
            >
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid">
            {highlighted.map((entry) => (
              <SkillCard
                key={entry.skill._id}
                skill={entry.skill}
                badge={getSkillBadges(entry.skill)}
                summaryFallback="A fresh skill bundle."
                meta={
                  <div className="skill-card-footer-rows">
                    <UserBadge
                      user={entry.owner}
                      fallbackHandle={entry.ownerHandle ?? null}
                      prefix="by"
                      link={false}
                    />
                    <div className="stat">
                      <SkillStatsTripletLine stats={entry.skill.stats} />
                    </div>
                  </div>
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Categories */}
      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Browse by Category</h2>
        </div>
        <div className="home-categories">
          {categories.map((category) => (
            <Link
              key={category.name}
              to="/skills"
              search={{
                q: category.name,
                sort: undefined,
                dir: undefined,
                highlighted: undefined,
                nonSuspicious: true,
                view: undefined,
                focus: undefined,
              }}
              className="home-category-card"
            >
              <div className={`home-category-icon ${category.className}`}>
                <category.icon size={20} aria-hidden="true" />
              </div>
              <div className="home-category-content">
                <div className="home-category-name">{category.name}</div>
                <div className="home-category-count">{category.count} tools</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Quick links */}
      <section className="home-section">
        <div className="home-quick-links">
          <Link
            to="/skills"
            search={{
              q: undefined,
              sort: "stars" as const,
              dir: "desc" as const,
              highlighted: undefined,
              nonSuspicious: true,
              view: undefined,
              focus: undefined,
            }}
            className="home-quick-link"
          >
            <Star size={14} className="home-quick-link-icon" />
            Most starred
          </Link>
          <Link
            to="/skills"
            search={{
              q: undefined,
              sort: "newest" as const,
              dir: undefined,
              highlighted: undefined,
              nonSuspicious: true,
              view: undefined,
              focus: undefined,
            }}
            className="home-quick-link"
          >
            <Sparkles size={14} className="home-quick-link-icon" />
            New this week
          </Link>
          <Link to="/plugins" className="home-quick-link">
            <Code2 size={14} className="home-quick-link-icon" />
            Browse plugins
          </Link>
          <Link to="/users" search={{ q: undefined }} className="home-quick-link">
            <Users size={14} className="home-quick-link-icon" />
            Browse users
          </Link>
          <Link
            to="/skills"
            search={{
              q: undefined,
              sort: undefined,
              dir: undefined,
              highlighted: true,
              nonSuspicious: undefined,
              view: undefined,
              focus: undefined,
            }}
            className="home-quick-link"
          >
            <Star size={14} className="home-quick-link-icon" />
            Staff picks
          </Link>
        </div>
      </section>
    </main>
  );
}

function OnlyCrabsHome() {
  const navigate = Route.useNavigate();
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds);
  const latest = (useQuery(api.souls.list, { limit: 12 }) as PublicSoul[]) ?? [];
  const [query, setQuery] = useState("");
  const seedEnsuredRef = useRef(false);
  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (seedEnsuredRef.current) return;
    seedEnsuredRef.current = true;
    void ensureSoulSeeds({});
  }, [ensureSoulSeeds]);

  return (
    <main>
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-grid">
            <div className="home-hero-copy">
              <div className="home-hero-kicker">
                <Ghost size={14} className="home-hero-kicker-icon" />
                <span>OnlyCrabs</span>
              </div>
              <h1 className="home-hero-title">
                <span className="home-hero-title-accent">SoulHub</span>, where system lore lives.
              </h1>
              <p className="home-hero-subtitle">
                Share SOUL.md bundles, version them like docs, and keep personal system lore in one
                public place.
              </p>
              <form
                className="home-hero-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void navigate({
                    to: "/souls",
                    search: {
                      q: trimmedQuery || undefined,
                      sort: undefined,
                      dir: undefined,
                      view: undefined,
                      focus: undefined,
                    },
                  });
                }}
              >
                <div className="home-hero-search-wrapper">
                  <Search size={20} className="home-hero-search-icon" />
                  <input
                    className="home-hero-search-input"
                    type="text"
                    placeholder="Search souls, prompts, or lore"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button type="submit" className="home-hero-search-btn">
                    <span>Search</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">
            <span className="home-section-title-icon recent">
              <Sparkles size={16} />
            </span>
            Latest Souls
          </h2>
          <Link
            to="/souls"
            search={{
              q: undefined,
              sort: undefined,
              dir: undefined,
              view: undefined,
              focus: undefined,
            }}
            className="home-section-link"
          >
            View all
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid">
          {latest.length === 0 ? (
            <Card>No souls yet. Be the first.</Card>
          ) : (
            latest.map((soul) => (
              <SoulCard
                key={soul._id}
                soul={soul}
                summaryFallback="A SOUL.md bundle."
                meta={
                  <div className="stat">
                    <SoulStatsTripletLine stats={soul.stats} />
                  </div>
                }
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
