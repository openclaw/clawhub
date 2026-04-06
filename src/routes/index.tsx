import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { SkillCard } from "../components/SkillCard";
import { SkillListItem } from "../components/SkillListItem";
import { SkillStatsTripletLine } from "../components/SkillStats";
import { SoulCard } from "../components/SoulCard";
import { SoulStatsTripletLine } from "../components/SoulStats";
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

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      convexHttp.query(api.skills.listHighlightedPublic, { limit: 6 }),
      convexHttp.query(api.skills.listPublicPageV4, {
        numItems: 8,
        sort: "downloads",
        dir: "desc",
        nonSuspiciousOnly: true,
      }),
      convexHttp.query(api.skills.listPublicPageV4, {
        numItems: 8,
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

  return (
    <main>
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-grid">
            <div className="home-hero-copy">
              <div className="home-hero-kicker">Discovery hub</div>
              <h1 className="home-hero-title">The collaborative hub for agent skills</h1>
              <p className="home-hero-subtitle">
                {skillCount != null
                  ? `${formatCompactStat(skillCount)} public skill bundles, plugin packages, and builder profiles in one shared index. Browse fast, fork the good stuff, ship your own.`
                  : "Public skill bundles, plugin packages, and builder profiles in one shared index. Browse fast, fork the good stuff, ship your own."}
              </p>
              <div className="home-hero-actions">
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
                  className="btn btn-primary"
                >
                  Browse All Skills & Plugins
                </Link>
                <Link
                  to="/publish-skill"
                  search={{ updateSlug: undefined }}
                  className="btn home-hero-publish-btn"
                >
                  + Publish Yours
                </Link>
              </div>
              <p className="home-hero-explainer">
                Sharp filters. Clean listings. Discovery that feels more like a real index and less
                like a sad spreadsheet.
              </p>
            </div>

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
                <span className="home-hero-panel-label">Skills</span>
                <strong>Browse ranked skill bundles</strong>
                <span>Popular installs, fresh updates, staff picks.</span>
              </Link>
              <Link to="/plugins" className="home-hero-panel">
                <span className="home-hero-panel-label">Plugins</span>
                <strong>Find agent-ready packages</strong>
                <span>Code plugins, bundles, and verified publishers.</span>
              </Link>
              <Link to="/users" search={{ q: undefined }} className="home-hero-panel">
                <span className="home-hero-panel-label">Users</span>
                <strong>Meet the builders</strong>
                <span>Profiles, bios, and the people shipping useful stuff.</span>
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
                <span className="home-hero-panel-label">Souls</span>
                <strong>SOUL.md discovery is coming</strong>
                <span>Holding page for the next catalog surface.</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Trending */}
      {trending.length > 0 ? (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Trending</h2>
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
              See all
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
            <h2 className="home-section-title">Recently updated</h2>
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
              See all
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
            <h2 className="home-section-title">Staff picks</h2>
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
              See all
            </Link>
          </div>
          <div className="grid">
            {
            highlighted.map((entry) => (
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

      {/* Quick links */}
      <section className="home-section">
        <div className="home-quick-links">
          <Link
            to="/skills"
            search={{ q: undefined, sort: "stars" as const, dir: "desc" as const, highlighted: undefined, nonSuspicious: true, view: undefined, focus: undefined }}
            className="home-quick-link"
          >
            Most starred
          </Link>
          <Link
            to="/skills"
            search={{ q: undefined, sort: "newest" as const, dir: undefined, highlighted: undefined, nonSuspicious: true, view: undefined, focus: undefined }}
            className="home-quick-link"
          >
            New this week
          </Link>
          <Link to="/plugins" className="home-quick-link">
            Browse plugins
          </Link>
          <Link to="/users" search={{ q: undefined }} className="home-quick-link">
            Browse users
          </Link>
          <Link
            to="/souls"
            search={{ q: undefined, sort: undefined, dir: undefined, view: undefined, focus: undefined }}
            className="home-quick-link"
          >
            Souls coming soon
          </Link>
          <Link
            to="/skills"
            search={{ q: undefined, sort: undefined, dir: undefined, highlighted: true, nonSuspicious: undefined, view: undefined, focus: undefined }}
            className="home-quick-link"
          >
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
              <div className="home-hero-kicker">OnlyCrabs</div>
              <h1 className="home-hero-title">SoulHub, where system lore lives.</h1>
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
                <input
                  className="home-hero-search-input"
                  type="text"
                  placeholder="Search souls, prompts, or lore"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button className="btn btn-primary" type="submit">
                  Search
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Latest souls</h2>
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
            See all
          </Link>
        </div>
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
      </section>
    </main>
  );
}
