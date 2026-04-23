import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Code2,
  Download,
  Package,
  Search,
  Star,
  Users,
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

// ═══ Slot machine word pool (13 words = 1/13 jackpot odds) ═══
const SLOT_WORDS = [
  "Equip", "Install", "Unleash", "Ship", "Build",
  "Create", "Deploy", "Launch", "Hack", "Scale",
  "Forge", "Craft", "Wield",
];

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

  // ═══ SLOT MACHINE EASTER EGG ═══
  const HACK_INDEX = SLOT_WORDS.indexOf("Hack");
  const clickTimesRef = useRef<number[]>([]);
  const [slotState, setSlotState] = useState<
    | null
    | { phase: "spinning" }
    | { phase: "stopped"; results: [number, number, number]; won: boolean; isHackJackpot: boolean }
  >(null);
  const slotTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [slotReelOffsets, setSlotReelOffsets] = useState<[number, number, number]>([0, 0, 0]);
  const [stoppedReels, setStoppedReels] = useState<Set<number>>(new Set());
  const confettiRef = useRef<HTMLCanvasElement>(null);
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownUntilRef = useRef<number>(0);

  // Clean up timers/intervals if the component unmounts mid-spin
  useEffect(() => {
    return () => {
      for (const t of slotTimersRef.current) clearTimeout(t);
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    };
  }, []);

  const triggerSlots = useCallback(() => {
    // Clean up any previous timers
    for (const t of slotTimersRef.current) clearTimeout(t);
    slotTimersRef.current = [];
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);

    setSlotState({ phase: "spinning" });
    setStoppedReels(new Set());

    // Controlled odds: ~1/25 any jackpot, ~1/100 Hack jackpot
    let r0: number, r1: number, r2: number;
    const isJackpot = Math.random() < 1 / 25;
    if (isJackpot) {
      // 25% of jackpots are Hack (1/25 × 1/4 = 1/100 overall)
      const isHack = Math.random() < 0.25;
      if (isHack) {
        r0 = HACK_INDEX;
      } else {
        // Pick any word except Hack
        let idx = Math.floor(Math.random() * (SLOT_WORDS.length - 1));
        if (idx >= HACK_INDEX) idx++;
        r0 = idx;
      }
      r1 = r0;
      r2 = r0;
    } else {
      // Normal spin — re-roll if accidental triple match
      do {
        r0 = Math.floor(Math.random() * SLOT_WORDS.length);
        r1 = Math.floor(Math.random() * SLOT_WORDS.length);
        r2 = Math.floor(Math.random() * SLOT_WORDS.length);
      } while (r0 === r1 && r1 === r2);
    }
    const results: [number, number, number] = [r0, r1, r2];
    const landed = new Set<number>();

    // Animate fast offset cycling — only cycle reels that haven't landed
    let frame = 0;
    const spinInterval = setInterval(() => {
      frame++;
      setSlotReelOffsets((prev) => [
        landed.has(0) ? prev[0] : (frame * 3) % SLOT_WORDS.length,
        landed.has(1) ? prev[1] : (frame * 5 + 4) % SLOT_WORDS.length,
        landed.has(2) ? prev[2] : (frame * 7 + 9) % SLOT_WORDS.length,
      ]);
    }, 60);
    spinIntervalRef.current = spinInterval;

    // Stop reels sequentially with a satisfying stagger
    const stopReel = (reelIdx: 0 | 1 | 2, delay: number) => {
      const t = setTimeout(() => {
        landed.add(reelIdx);
        setStoppedReels((prev) => new Set(prev).add(reelIdx));
        setSlotReelOffsets((prev) => {
          const next = [...prev] as [number, number, number];
          next[reelIdx] = results[reelIdx];
          return next;
        });
      }, delay);
      slotTimersRef.current.push(t);
    };

    stopReel(0, 1200);
    stopReel(1, 1800);

    const tFinal = setTimeout(() => {
      clearInterval(spinInterval);
      spinIntervalRef.current = null;
      landed.add(2);
      setStoppedReels(new Set([0, 1, 2]));
      setSlotReelOffsets(results);
      const won = r0 === r1 && r1 === r2;
      const isHackJackpot = won && r0 === HACK_INDEX;
      setSlotState({ phase: "stopped", results, won, isHackJackpot });
      if (won) {
        fireConfetti(isHackJackpot);
      }
      // Cooldown: 18s after win, 3s after loss
      const displayTime = won ? 10000 : 2400;
      const cooldownTime = won ? 18000 : 3000;
      cooldownUntilRef.current = Date.now() + cooldownTime;
      const tReset = setTimeout(() => {
        setSlotState(null);
        setStoppedReels(new Set());
      }, displayTime);
      slotTimersRef.current.push(tReset);
    }, 2400);
    slotTimersRef.current.push(tFinal);
  }, []);

  const handleLabelClick = useCallback(() => {
    const now = Date.now();
    // Respect cooldown period
    if (now < cooldownUntilRef.current) return;
    clickTimesRef.current.push(now);
    // Keep only last 3 clicks
    if (clickTimesRef.current.length > 3) {
      clickTimesRef.current = clickTimesRef.current.slice(-3);
    }
    if (clickTimesRef.current.length === 3) {
      const first = clickTimesRef.current[0];
      const last = clickTimesRef.current[2];
      if (last - first < 800 && !slotState) {
        clickTimesRef.current = [];
        triggerSlots();
      }
    }
  }, [slotState, triggerSlots]);

  const fireConfetti = (isHackJackpot: boolean) => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const STANDARD_COLORS = [
      "#d4453a", "#ff6b6b", "#ffd93d", "#6bcb77",
      "#4d96ff", "#ff6f91", "#845ec2", "#ffc75f",
    ];
    const OCEAN_COLORS = [
      "#0ea5e9", "#06b6d4", "#14b8a6", "#22d3ee",
      "#38bdf8", "#67e8f9", "#a5f3fc", "#2dd4bf",
      "#d4453a", "#ff6b6b",
    ];
    const colors = isHackJackpot ? OCEAN_COLORS : STANDARD_COLORS;

    type Particle = {
      x: number; y: number; vx: number; vy: number;
      w: number; h: number; color: string; rot: number; vr: number;
      life: number; shape: "rect" | "bubble" | "claw";
    };
    const particles: Particle[] = [];

    const count = isHackJackpot ? 200 : 150;
    for (let i = 0; i < count; i++) {
      const isBubble = isHackJackpot && Math.random() < 0.35;
      const isClaw = isHackJackpot && !isBubble && Math.random() < 0.2;
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 300,
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 18,
        vy: isHackJackpot
          ? -Math.random() * 14 - 2 + (isBubble ? -4 : 0)
          : -Math.random() * 16 - 4,
        w: isBubble ? Math.random() * 8 + 4 : Math.random() * 10 + 4,
        h: isBubble ? 0 : Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        life: isHackJackpot ? 1.3 : 1,
        shape: isClaw ? "claw" : isBubble ? "bubble" : "rect",
      });
    }

    const drawClaw = (context: CanvasRenderingContext2D, size: number) => {
      // Simple lobster claw shape
      context.beginPath();
      context.moveTo(0, size * 0.5);
      context.quadraticCurveTo(-size * 0.6, size * 0.2, -size * 0.4, -size * 0.3);
      context.quadraticCurveTo(-size * 0.2, -size * 0.6, 0, -size * 0.3);
      context.quadraticCurveTo(size * 0.2, -size * 0.6, size * 0.4, -size * 0.3);
      context.quadraticCurveTo(size * 0.6, size * 0.2, 0, size * 0.5);
      context.closePath();
      context.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.shape === "bubble" ? 0.15 : 0.4;
        p.vx *= 0.99;
        p.rot += p.vr;
        p.life -= isHackJackpot ? 0.005 : 0.008;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color;

        if (p.shape === "bubble") {
          ctx.beginPath();
          ctx.arc(0, 0, p.w, 0, Math.PI * 2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha *= 0.7;
          ctx.stroke();
          ctx.globalAlpha *= 0.15;
          ctx.fill();
        } else if (p.shape === "claw") {
          drawClaw(ctx, p.w);
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (alive) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = "none";
      }
    };
    requestAnimationFrame(draw);
  };

  const renderSlotReel = (reelIdx: 0 | 1 | 2) => {
    const offset = slotReelOffsets[reelIdx];
    const word = SLOT_WORDS[offset];
    const isReelSpinning = slotState !== null && !stoppedReels.has(reelIdx);
    return (
      <span className={`home-v2-slot-reel ${isReelSpinning ? "spinning" : ""}`}>
        <span className="home-v2-slot-word">{word}</span>
      </span>
    );
  };

  return (
    <main className="home-v2-main">
      {/* Confetti canvas for slot machine wins */}
      <canvas
        ref={confettiRef}
        className="home-v2-confetti"
        style={{ display: "none" }}
      />

      {/* ═══ HERO ═══ */}
      <section className="home-v2-hero">
        <div className="home-v2-hero-bg">
          <div className="home-v2-glow" />
          <div className="home-v2-dots" />
          <div className="home-v2-ring home-v2-ring-1" />
          <div className="home-v2-ring home-v2-ring-2" />
          <div className="home-v2-ring home-v2-ring-3" />
        </div>

        <div
          className={`home-v2-hero-label ${slotState ? "home-v2-hero-label-active" : ""}`}
          onClick={handleLabelClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") handleLabelClick(); }}
        >
          BUILT BY THE COMMUNITY.
        </div>

        {slotState ? (
          <h1 className={`home-v2-headline home-v2-headline-slots${
            slotState.phase === "stopped" && slotState.won
              ? slotState.isHackJackpot
                ? " home-v2-headline-jackpot home-v2-headline-hack"
                : " home-v2-headline-jackpot"
              : ""
          }`}>
            {slotState.phase === "stopped" && slotState.isHackJackpot && (
              <img
                src="/clawd-mark.png"
                alt=""
                aria-hidden="true"
                className="home-v2-hack-lobster"
              />
            )}
            <span className="home-v2-headline-inner">
              {renderSlotReel(0)}
              <span className="home-v2-sep" />
              {renderSlotReel(1)}
              <span className="home-v2-sep" />
              {renderSlotReel(2)}
            </span>
          </h1>
        ) : (
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
        )}

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
              <span className="home-v2-search-go-label">Search</span>{" "}
              <ArrowRight size={16} />
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
            self-improving agent
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("GitHub integration")}
          >
            GitHub integration
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("security soul")}
          >
            security soul
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion("dashboard builder")}
          >
            dashboard builder
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
                    <div className="home-v2-c-meta">
                      <div className="home-v2-c-name">
                        {entry.skill.displayName || entry.skill.slug}
                      </div>
                      <div className="home-v2-c-by">
                        by {entry.ownerHandle || entry.owner?.handle || "unknown"}
                      </div>
                    </div>
                  </div>
                  <span className="home-v2-c-tag">Skill</span>
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
                    <div className="home-v2-c-meta">
                      <div className="home-v2-c-name">
                        {entry.skill.displayName || entry.skill.slug}
                      </div>
                      <div className="home-v2-c-by">
                        by {entry.ownerHandle || entry.owner?.handle || "unknown"}
                      </div>
                    </div>
                  </div>
                  <span className="home-v2-c-tag">Skill</span>
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
              <Package size={20} />
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
