import { ApiRoutes } from "clawhub-schema/routes";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { publicApiUrl } from "../lib/publicApiUrl";

type PublicPromotion = {
  slug: string;
  title: string;
  blurb: string;
  sponsor?: string;
  endsAt: number;
  signupUrl?: string;
  docsUrl?: string;
  launchPageUrl?: string;
};

const PROMOTIONS_POLL_INTERVAL_MS = 60_000;

function nextPromotionsRefreshDelay(promotions: PublicPromotion[], now: number) {
  return promotions.reduce(
    (delay, promotion) =>
      promotion.endsAt >= now ? Math.min(delay, promotion.endsAt - now + 1) : delay,
    PROMOTIONS_POLL_INTERVAL_MS,
  );
}

function formatPromotionDate(endsAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(endsAt));
}

function promotionDisplayTitle(title: string) {
  return title.replace(/\s+is free on\s+/i, " on ");
}

function promotionCtaUrl(promotion: PublicPromotion) {
  return promotion.launchPageUrl ?? promotion.signupUrl ?? promotion.docsUrl ?? null;
}

function PromotionCard({ promotion }: { promotion: PublicPromotion }) {
  const ctaUrl = promotionCtaUrl(promotion);
  return (
    <article className="home-v2-promotion-card">
      <div className="home-v2-promotion-content">
        <div className="home-v2-promotion-stack">
          <span className="home-v2-promotion-kicker">Limited access</span>
          <h3 className="home-v2-promotion-title">{promotionDisplayTitle(promotion.title)}</h3>
          <p className="home-v2-promotion-meta">
            Available at no cost until {formatPromotionDate(promotion.endsAt)}.
          </p>
        </div>
      </div>
      {/* No CLI claim snippet yet: the openclaw `promos claim` command ships
          separately; advertise it here once that CLI flow exists. */}
      <div className="home-v2-promotion-actions">
        {ctaUrl ? (
          <a
            className="home-v2-promotion-link"
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more <ArrowRight size={13} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function HomePromotionsSection() {
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleRefresh(active: PublicPromotion[]) {
      if (refreshTimer) clearTimeout(refreshTimer);
      const delay = nextPromotionsRefreshDelay(active, Date.now());
      refreshTimer = setTimeout(() => {
        if (cancelled) return;
        setPromotions((current) => current.filter((promotion) => promotion.endsAt >= Date.now()));
        void loadPromotions();
      }, delay);
    }

    async function loadPromotions() {
      try {
        const response = await fetch(publicApiUrl(ApiRoutes.promotions).toString(), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Promotions request failed: ${response.status}`);
        const payload = (await response.json()) as { promotions?: PublicPromotion[] };
        if (!Array.isArray(payload.promotions)) throw new Error("Invalid promotions response");
        const active = payload.promotions;
        if (cancelled) return;
        setPromotions(active);
        scheduleRefresh(active);
      } catch {
        // Promotions are decorative on the homepage; render nothing on failure.
        if (!cancelled) scheduleRefresh([]);
      }
    }

    void loadPromotions();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, []);

  if (promotions.length === 0) return null;

  return (
    <section className="home-v2-promotions" aria-labelledby="home-promotions-title">
      <h2 id="home-promotions-title" className="sr-only">
        Active promotions
      </h2>
      <div className="home-v2-promotions-track">
        {promotions.map((promotion) => (
          <PromotionCard key={promotion.slug} promotion={promotion} />
        ))}
      </div>
    </section>
  );
}
