import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { HomeAppsSection } from "../components/HomeAppsSection";
import { HomeBringSkillsSection } from "../components/HomeBringSkillsSection";
import { HomeListingSection } from "../components/HomeListingSection";
import { HomePopularPublishersSection } from "../components/HomePopularPublishersSection";
import { HomeV2FoldBottomFade } from "../components/HomeV2FoldBottomFade";
import { fetchInitialHomeListing, type HomeListingInitialData } from "../lib/homeListingData";

export const Route = createFileRoute("/")({
  loader: loadInitialHomeListing,
  component: SkillsHome,
});

async function loadInitialHomeListing(): Promise<HomeListingInitialData | null> {
  try {
    return await fetchInitialHomeListing();
  } catch (error) {
    console.error("Failed to load initial home listing:", error);
    return null;
  }
}

const SLOT_WORDS = [
  "Equip",
  "Install",
  "Unleash",
  "Ship",
  "Build",
  "Create",
  "Deploy",
  "Launch",
  "Hack",
  "Scale",
  "Forge",
  "Craft",
  "Wield",
];
const HACK_INDEX = SLOT_WORDS.indexOf("Hack");

function SkillsHome() {
  const initialListing = Route.useLoaderData();
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

  useEffect(() => {
    return () => {
      for (const timer of slotTimersRef.current) clearTimeout(timer);
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    };
  }, []);

  const fireConfetti = useCallback((isHackJackpot: boolean) => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const standardColors = [
      "#d4453a",
      "#ff6b6b",
      "#ffd93d",
      "#6bcb77",
      "#4d96ff",
      "#ff6f91",
      "#845ec2",
      "#ffc75f",
    ];
    const oceanColors = [
      "#0ea5e9",
      "#06b6d4",
      "#14b8a6",
      "#22d3ee",
      "#38bdf8",
      "#67e8f9",
      "#a5f3fc",
      "#2dd4bf",
      "#d4453a",
      "#ff6b6b",
    ];
    const colors = isHackJackpot ? oceanColors : standardColors;

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      w: number;
      h: number;
      color: string;
      rot: number;
      vr: number;
      life: number;
      shape: "rect" | "bubble" | "claw";
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
        vy: isHackJackpot ? -Math.random() * 14 - 2 + (isBubble ? -4 : 0) : -Math.random() * 16 - 4,
        w: isBubble ? Math.random() * 8 + 4 : Math.random() * 10 + 4,
        h: isBubble ? 0 : Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)] ?? colors[0],
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        life: isHackJackpot ? 1.3 : 1,
        shape: isClaw ? "claw" : isBubble ? "bubble" : "rect",
      });
    }

    const drawClaw = (context: CanvasRenderingContext2D, size: number) => {
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
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        alive = true;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += particle.shape === "bubble" ? 0.15 : 0.4;
        particle.vx *= 0.99;
        particle.rot += particle.vr;
        particle.life -= isHackJackpot ? 0.005 : 0.008;
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, particle.life));
        ctx.fillStyle = particle.color;

        if (particle.shape === "bubble") {
          ctx.beginPath();
          ctx.arc(0, 0, particle.w, 0, Math.PI * 2);
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha *= 0.7;
          ctx.stroke();
          ctx.globalAlpha *= 0.15;
          ctx.fill();
        } else if (particle.shape === "claw") {
          drawClaw(ctx, particle.w);
        } else {
          ctx.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
        }
        ctx.restore();
      }

      if (alive) {
        requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = "none";
    };

    requestAnimationFrame(draw);
  }, []);

  const triggerSlots = useCallback(() => {
    for (const timer of slotTimersRef.current) clearTimeout(timer);
    slotTimersRef.current = [];
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);

    setSlotState({ phase: "spinning" });
    setStoppedReels(new Set());

    let r0: number;
    let r1: number;
    let r2: number;
    const isJackpot = Math.random() < 1 / 25;

    if (isJackpot) {
      const isHackJackpot = Math.random() < 0.25;
      if (isHackJackpot) {
        r0 = HACK_INDEX;
      } else {
        let index = Math.floor(Math.random() * (SLOT_WORDS.length - 1));
        if (index >= HACK_INDEX) index++;
        r0 = index;
      }
      r1 = r0;
      r2 = r0;
    } else {
      let attempts = 0;
      do {
        r0 = Math.floor(Math.random() * SLOT_WORDS.length);
        r1 = Math.floor(Math.random() * SLOT_WORDS.length);
        r2 = Math.floor(Math.random() * SLOT_WORDS.length);
        attempts++;
      } while (r0 === r1 && r1 === r2 && attempts < 8);

      if (r0 === r1 && r1 === r2) {
        r1 = (r0 + 1) % SLOT_WORDS.length;
        r2 = (r0 + 2) % SLOT_WORDS.length;
      }
    }

    const results: [number, number, number] = [r0, r1, r2];
    const landed = new Set<number>();
    let frame = 0;
    const spinInterval = setInterval(() => {
      frame++;
      setSlotReelOffsets((previous) => [
        landed.has(0) ? previous[0] : (frame * 3) % SLOT_WORDS.length,
        landed.has(1) ? previous[1] : (frame * 5 + 4) % SLOT_WORDS.length,
        landed.has(2) ? previous[2] : (frame * 7 + 9) % SLOT_WORDS.length,
      ]);
    }, 60);
    spinIntervalRef.current = spinInterval;

    const stopReel = (reelIndex: 0 | 1 | 2, delay: number) => {
      const timer = setTimeout(() => {
        landed.add(reelIndex);
        setStoppedReels((previous) => new Set(previous).add(reelIndex));
        setSlotReelOffsets((previous) => {
          const next = [...previous] as [number, number, number];
          next[reelIndex] = results[reelIndex];
          return next;
        });
      }, delay);
      slotTimersRef.current.push(timer);
    };

    stopReel(0, 1200);
    stopReel(1, 1800);

    const finalTimer = setTimeout(() => {
      clearInterval(spinInterval);
      spinIntervalRef.current = null;
      landed.add(2);
      setStoppedReels(new Set([0, 1, 2]));
      setSlotReelOffsets(results);
      const won = r0 === r1 && r1 === r2;
      const isHackJackpot = won && r0 === HACK_INDEX;
      setSlotState({ phase: "stopped", results, won, isHackJackpot });
      if (won) fireConfetti(isHackJackpot);

      const displayTime = won ? 10000 : 2400;
      const cooldownTime = won ? 18000 : 3000;
      cooldownUntilRef.current = Date.now() + cooldownTime;
      const resetTimer = setTimeout(() => {
        setSlotState(null);
        setStoppedReels(new Set());
      }, displayTime);
      slotTimersRef.current.push(resetTimer);
    }, 2400);
    slotTimersRef.current.push(finalTimer);
  }, [fireConfetti]);

  const handleLabelClick = useCallback(() => {
    const now = Date.now();
    if (now < cooldownUntilRef.current) return;
    clickTimesRef.current.push(now);
    if (clickTimesRef.current.length > 3) {
      clickTimesRef.current = clickTimesRef.current.slice(-3);
    }
    if (clickTimesRef.current.length !== 3) return;

    const first = clickTimesRef.current[0] ?? 0;
    const last = clickTimesRef.current[2] ?? 0;
    if (last - first < 800 && !slotState) {
      clickTimesRef.current = [];
      triggerSlots();
    }
  }, [slotState, triggerSlots]);

  const renderSlotReel = (reelIndex: 0 | 1 | 2) => {
    const offset = slotReelOffsets[reelIndex];
    const word = SLOT_WORDS[offset] ?? SLOT_WORDS[0];
    const isReelSpinning = slotState !== null && !stoppedReels.has(reelIndex);
    return (
      <span className={`home-v2-slot-reel ${isReelSpinning ? "spinning" : ""}`}>
        <span className="home-v2-slot-word">{word}</span>
      </span>
    );
  };

  return (
    <main className="home-v2-main">
      <HomeV2FoldBottomFade />
      <canvas ref={confettiRef} className="home-v2-confetti" style={{ display: "none" }} />

      {/* ═══ HERO ═══ */}
      <section className="home-v2-hero">
        <div className="home-v2-hero-bg">
          <div className="home-v2-glow" />
          <div className="home-v2-dots" />
          <div className="home-v2-ring home-v2-ring-1" />
          <div className="home-v2-ring home-v2-ring-2" />
          <div className="home-v2-ring home-v2-ring-3" />
        </div>

        <button
          className={`home-v2-hero-label ${slotState ? "home-v2-hero-label-active" : ""}`}
          type="button"
          onClick={handleLabelClick}
        >
          BUILT BY THE COMMUNITY
        </button>

        {slotState ? (
          <h1
            className={`home-v2-headline home-v2-headline-slots${
              slotState.phase === "stopped" && slotState.won
                ? slotState.isHackJackpot
                  ? " home-v2-headline-jackpot home-v2-headline-hack"
                  : " home-v2-headline-jackpot"
                : ""
            }`}
          >
            {slotState.phase === "stopped" && slotState.isHackJackpot ? (
              <img
                src="/og-clawhub-watermark.png"
                alt=""
                aria-hidden="true"
                className="home-v2-hack-lobster"
              />
            ) : null}
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

        <p className="home-v2-sub">Discover skills and plugins from top creators</p>
      </section>

      <HomeListingSection initialListing={initialListing} />
      <HomePopularPublishersSection />
      <HomeAppsSection />
      <HomeBringSkillsSection />
    </main>
  );
}
