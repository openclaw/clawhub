import { ApiRoutes } from "clawhub-schema/routes";
import { ArrowUpRight, Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { publicApiUrl } from "../lib/publicApiUrl";

type PublicPromotion = {
  slug: string;
  title: string;
  blurb: string;
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
    timeZone: "UTC",
  }).format(new Date(endsAt));
}

function isTencentHyPromotion(title: string) {
  return /tencent hy3/i.test(title);
}

function promotionCtaUrl(promotion: PublicPromotion) {
  return promotion.launchPageUrl ?? promotion.signupUrl ?? promotion.docsUrl ?? null;
}

function promotionMetaCopy(promotion: PublicPromotion) {
  if (isTencentHyPromotion(promotion.title)) {
    return `Tencent's latest model, free until ${formatPromotionDate(promotion.endsAt)}`;
  }

  return promotion.blurb;
}

function PromotionBarItem({ promotion }: { promotion: PublicPromotion }) {
  const ctaUrl = promotionCtaUrl(promotion);
  const isTencentPromotion = isTencentHyPromotion(promotion.title);

  return (
    <article className="promotion-bar-item">
      <div className="promotion-bar-copy">
        <h3 className="promotion-bar-title">
          {isTencentPromotion ? (
            <img
              src="/tencent-hy-favicon.png"
              alt=""
              aria-hidden="true"
              className="promotion-bar-icon"
            />
          ) : (
            <Gift
              size={14}
              aria-hidden="true"
              className="promotion-bar-icon promotion-bar-icon-fallback"
            />
          )}
          <span className="promotion-bar-title-copy">{promotion.title}</span>
        </h3>
        <span className="promotion-bar-separator" aria-hidden="true" />
        <span className="promotion-bar-meta">{promotionMetaCopy(promotion)}</span>
      </div>
      {ctaUrl ? (
        <a className="promotion-bar-link" href={ctaUrl} target="_blank" rel="noopener noreferrer">
          Try it free <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      ) : null}
    </article>
  );
}

export function PromotionsBar() {
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
        // Promotions are optional header content; render nothing on failure.
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
    <section className="promotion-bar" aria-labelledby="active-promotions-title">
      <h2 id="active-promotions-title" className="sr-only">
        Active promotions
      </h2>
      <div className="promotion-bar-track">
        {promotions.map((promotion) => (
          <PromotionBarItem key={promotion.slug} promotion={promotion} />
        ))}
      </div>
    </section>
  );
}
