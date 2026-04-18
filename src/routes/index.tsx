import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Code2,
  Download,
  Layers,
  Search,
  Shield,
  Star,
  Users,
  Zap,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import { SoulCard } from "../components/SoulCard";
import { SoulStatsTripletLine } from "../components/SoulStats";
import { convexHttp } from "../convex/client";
import type { PublicSkill, PublicSoul, PublicUser } from "../lib/publicUser";
import { getSiteMode } from "../lib/site";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const mode = getSiteMode();
  return mode === "souls" ? <OnlyCrabsHome /> : <SkillsHome />;
}

function SkillsHome() {
  type SkillPageEntry = {
    skill: PublicSkill;
    ownerHandle?: string | null;
    owner?: PublicUser | null;
    latestVersion?: unknown;
  };

  const [highlighted, setHighlighted] = useState<SkillPageEntry[]>([]);
  const [popular, setPopular] = useState<SkillPageEntry[]>([]);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    convexHttp
      .query(api.skills.listHighlightedPublic, { limit: 6 })
      .then((r) => {
        if (!cancelled) setHighlighted(r as SkillPageEntry[]);
      })
      .catch(() => {});
    convexHttp
      .query(api.skills.listPublicPageV4, {
        numItems: 12,
        sort: "downloads",
        dir: "desc",
        nonSuspiciousOnly: true,
      })
      .then((r) => {
        if (!cancelled) setPopular((r as { page: SkillPageEntry[] }).page);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: "/search",
      search: { q: trimmedQuery || undefined },
    });
  };

  const handleSuggestion = (term: string) => {
    void navigate({
      to: "/search",
      search: { q: term },
    });
  };

  // Format stat numbers
  const formatStat = (n: number | undefined): string => {
    if (!n) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  // Build skill detail link
  const skillLink = (entry: SkillPageEntry) =>
    `/${encodeURIComponent(String(entry.skill.ownerUserId))}/${entry.skill.slug}`;

  // Build carousel cards from highlighted data
  const carouselCards = highlighted.length > 0 ? highlighted.slice(0, 6) : [];

  return (
    <main className="home-v2-main">
      {/* ═══ HERO ═══ */}
      <section className="home-v2-hero">
        <div className="home-v2-hero-bg">
          <div className="home-v2-glow" />
          <div className="home-v2-dots" />
          <div className="home-v2-ring home-v2-ring-1" />
          <div className="home-v2-ring home-v2-ring-2" />
          <div className="home-v2-ring home-v2-ring-3" />
        </div>

        <div className="home-v2-hero-label">BUILT BY THE COMMUNITY.</div>

        <h1 className="home-v2-headline">
          <span className="home-v2-headline-inner">
            <span className="home-v2-action-word">Equip</span>
            <span className="home-v2-sep" />
            <span className="home-v2-action-word">Install</span>
            <span className="home-v2-sep" />
            <span className="home-v2-cycle-wrap">
              <span className="home-v2-cycle-track">
                <span className="home-v2-cycle-word">Unleash.</span>
                <span className="home-v2-cycle-word">Ship.</span>
                <span className="home-v2-cycle-word">Build.</span>
                <span className="home-v2-cycle-word">Create.</span>
                <span className="home-v2-cycle-word">Unleash.</span>
              </span>
            </span>
          </span>
        </h1>

        <p className="home-v2-sub">Tools built by thousands, ready in one search.</p>

        <div className="home-v2-search-container">
          <form className="home-v2-search-bar" onSubmit={handleSearch}>
            <Search className="home-v2-search-icon" size={20} />
            <input
              type="text"
              placeholder="What are you looking for?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
            <button type="submit" className="home-v2-search-go">
              Search <ArrowRight size={16} />
            </button>
          </form>
        </div>

        <div className="home-v2-suggestions">
          <span className="home-v2-suggestions-label">Try</span>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("self-improving agent")}
          >
            <Zap size={13} /> self-improving agent
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("GitHub integration")}
          >
            <Code2 size={13} /> GitHub integration
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("security soul")}
          >
            <Shield size={13} /> security soul
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("dashboard builder")}
          >
            <Layers size={13} /> dashboard builder
          </button>
        </div>
      </section>

      {/* ═══ FEATURED CAROUSEL ═══ */}
      {carouselCards.length > 0 && (
        <section className="home-v2-carousel-section">
          <div className="home-v2-carousel-header">
            <h2>Featured</h2>
            <div className="home-v2-carousel-controls">
              <button type="button" className="home-v2-carousel-btn" aria-label="Previous">
                <ArrowLeft size={16} />
              </button>
              <button type="button" className="home-v2-carousel-btn" aria-label="Next">
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="home-v2-carousel-wrap">
            <div className="home-v2-carousel-track">
              {/* First pass */}
              {carouselCards.map((entry) => (
                <Link
                  key={`c1-${entry.skill._id}`}
                  to={skillLink(entry)}
                  className="home-v2-c-card"
                >
                  <div className="home-v2-c-head">
                    <div className="home-v2-c-icon">
                      <Zap size={18} />
                    </div>
                    <div className="home-v2-c-meta">
                      <div className="home-v2-c-name">
                        {entry.skill.displayName || entry.skill.slug}
                      </div>
                      <div className="home-v2-c-by">
                        by {entry.ownerHandle || entry.owner?.handle || "unknown"}
                      </div>
                    </div>
                  </div>
                  <span className="home-v2-c-tag">
                    <Zap size={11} /> Skill
                  </span>
                  <div className="home-v2-c-desc">
                    {entry.skill.summary || "A fresh skill bundle."}
                  </div>
                  <div className="home-v2-c-footer">
                    <div className="home-v2-c-stats">
                      <span>
                        <Star size={12} />{" "}
                        {formatStat(entry.skill.stats?.stars)}
                      </span>
                      <span>
                        <Download size={12} />{" "}
                        {formatStat(entry.skill.stats?.downloads)}
                      </span>
                    </div>
                    <span className="home-v2-c-install">
                      <Download size={13} /> Install
                    </span>
                  </div>
                </Link>
              ))}
              {/* Duplicate for seamless loop */}
              {carouselCards.map((entry) => (
                <Link
                  key={`c2-${entry.skill._id}`}
                  to={skillLink(entry)}
                  className="home-v2-c-card"
                >
                  <div className="home-v2-c-head">
                    <div className="home-v2-c-icon">
                      <Zap size={18} />
                    </div>
                    <div className="home-v2-c-meta">
                      <div className="home-v2-c-name">
                        {entry.skill.displayName || entry.skill.slug}
                      </div>
                      <div className="home-v2-c-by">
                        by {entry.ownerHandle || entry.owner?.handle || "unknown"}
                      </div>
                    </div>
                  </div>
                  <span className="home-v2-c-tag">
                    <Zap size={11} /> Skill
                  </span>
                  <div className="home-v2-c-desc">
                    {entry.skill.summary || "A fresh skill bundle."}
                  </div>
                  <div className="home-v2-c-footer">
                    <div className="home-v2-c-stats">
                      <span>
                        <Star size={12} />{" "}
                        {formatStat(entry.skill.stats?.stars)}
                      </span>
                      <span>
                        <Download size={12} />{" "}
                        {formatStat(entry.skill.stats?.downloads)}
                      </span>
                    </div>
                    <span className="home-v2-c-install">
                      <Download size={13} /> Install
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══ CATEGORIES ═══ */}
      <section className="home-v2-categories">
        <div className="home-v2-categories-grid">
          <Link
            to="/skills"
            search={{
              q: undefined,
              sort: undefined,
              dir: undefined,
              highlighted: undefined,
              nonSuspicious: true,
              view: undefined,
              focus: undefined,
            }}
            className="home-v2-cat-item"
          >
            <div className="home-v2-cat-icon">
              <Zap size={20} />
            </div>
            <div className="home-v2-cat-text">
              <div className="home-v2-cat-name">Skills</div>
              <div className="home-v2-cat-desc">Agent skill bundles</div>
            </div>
            <span className="home-v2-cat-arrow">
              <ChevronRight size={16} />
            </span>
          </Link>
          <Link to="/plugins" className="home-v2-cat-item">
            <div className="home-v2-cat-icon">
              <Code2 size={20} />
            </div>
            <div className="home-v2-cat-text">
              <div className="home-v2-cat-name">Plugins</div>
              <div className="home-v2-cat-desc">Gateway plugins</div>
            </div>
            <span className="home-v2-cat-arrow">
              <ChevronRight size={16} />
            </span>
          </Link>
          <Link to="/users" className="home-v2-cat-item">
            <div className="home-v2-cat-icon">
              <Users size={20} />
            </div>
            <div className="home-v2-cat-text">
              <div className="home-v2-cat-name">Builders</div>
              <div className="home-v2-cat-desc">Community creators</div>
            </div>
            <span className="home-v2-cat-arrow">
              <ChevronRight size={16} />
            </span>
          </Link>
        </div>
      </section>

      {/* ═══ PROOF BAR ═══ */}
      <div className="home-v2-proof-bar">
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">52.7k</span>
          <span className="home-v2-proof-label">tools</span>
        </div>
        <span className="home-v2-proof-sep" />
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">180k</span>
          <span className="home-v2-proof-label">users</span>
        </div>
        <span className="home-v2-proof-sep" />
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">12M</span>
          <span className="home-v2-proof-label">downloads</span>
        </div>
        <span className="home-v2-proof-sep" />
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">4.8</span>
          <span className="home-v2-proof-label">avg rating</span>
        </div>
      </div>

      {/* ═══ TRENDING ═══ */}
      {popular.length > 0 && (
        <section className="home-v2-trending-section">
          <div className="home-v2-section-header">
            <h2>Trending Now</h2>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: "downloads",
                dir: "desc",
                highlighted: undefined,
                nonSuspicious: true,
                view: undefined,
                focus: undefined,
              }}
              className="home-v2-section-link"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="home-v2-trending-grid">
            {popular.slice(0, 6).map((entry) => (
              <Link
                key={entry.skill._id}
                to={skillLink(entry)}
                className="home-v2-trend-card"
              >
                <div className="home-v2-trend-head">
                  <div className="home-v2-trend-title">
                    {entry.skill.displayName || entry.skill.slug}
                  </div>
                  <div className="home-v2-trend-creator">
                    by {entry.ownerHandle || entry.owner?.handle || "unknown"}
                  </div>
                </div>
                <div className="home-v2-trend-desc">
                  {entry.skill.summary || "Agent-ready skill pack."}
                </div>
                <div className="home-v2-trend-bottom">
                  <div className="home-v2-trend-signals">
                    <span>
                      <Star size={12} />{" "}
                      {formatStat(entry.skill.stats?.stars)}
                    </span>
                    <span>
                      <Download size={12} />{" "}
                      {formatStat(entry.skill.stats?.downloads)}
                    </span>
                  </div>
                  <span className="home-v2-trend-install">
                    <Download size={13} /> Install
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
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
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy fade-up" data-delay="1">
            <span className="hero-badge">SOUL.md, shared.</span>
            <h1 className="hero-title">SoulHub, where system lore lives.</h1>
            <p className="hero-subtitle">
              Share SOUL.md bundles, version them like docs, and keep personal system lore in one
              public place.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <Link to="/upload" search={{ updateSlug: undefined }} className="btn btn-primary">
                Publish a soul
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
                className="btn"
              >
                Browse souls
              </Link>
            </div>
          </div>
          <div className="hero-card hero-search-card fade-up" data-delay="2">
            <form
              className="search-bar"
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
              <span className="mono">/</span>
              <input
                className="search-input"
                placeholder="Search souls, prompts, or lore"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
            <div className="hero-install" style={{ marginTop: 18 }}>
              <div className="stat">Search souls. Versioned, readable, easy to remix.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Latest souls</h2>
        <p className="section-subtitle">Newest SOUL.md bundles across the hub.</p>
        <div className="grid">
          {latest.length === 0 ? (
            <div className="card">No souls yet. Be the first.</div>
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
        <div className="section-cta">
          <Link
            to="/souls"
            search={{
              q: undefined,
              sort: undefined,
              dir: undefined,
              view: undefined,
              focus: undefined,
            }}
            className="btn"
          >
            See all souls
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-6 w-full max-w-screen-xl px-4 md:px-6">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-white shadow-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-red-200">
            Plugins
          </div>
          <div className="text-lg font-semibold">Looking for plugins?</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
            Plugins currently live inside the broader package model. Use the dedicated Plugins
            surface to review that work more clearly.
          </p>
          <div className="mt-4">
            <Link
              to="/plugins"
              className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
            >
              Open Plugins
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
