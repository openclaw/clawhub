import type { FunctionReturnType } from "convex/server";
import { ArrowRight, Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";

type PublicPromotion = FunctionReturnType<typeof api.promotions.listActive>[number];

function formatEndsAt(endsAt: number) {
  const days = Math.max(0, Math.ceil((endsAt - Date.now()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  return `${days} days left`;
}

function promotionCtaUrl(promotion: PublicPromotion) {
  return promotion.launchPageUrl ?? promotion.signupUrl ?? promotion.docsUrl ?? null;
}

function PromotionCard({ promotion }: { promotion: PublicPromotion }) {
  const ctaUrl = promotionCtaUrl(promotion);
  return (
    <article className="home-v2-promotion-card">
      <div className="home-v2-promotion-head">
        <span className="home-v2-promotion-flag">
          <Gift size={13} aria-hidden="true" />
          {promotion.sponsor ? `${promotion.sponsor} promotion` : "Promotion"}
        </span>
        <span className="home-v2-promotion-ends">{formatEndsAt(promotion.endsAt)}</span>
      </div>
      <h3 className="home-v2-promotion-title">{promotion.title}</h3>
      <p className="home-v2-promotion-blurb">{promotion.blurb}</p>
      {/* No CLI claim snippet yet: the openclaw `promos claim` command ships
          separately; advertise it here once that CLI flow exists. */}
      {ctaUrl ? (
        <div className="home-v2-promotion-foot">
          <a
            className="home-v2-promotion-link"
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </article>
  );
}

export function HomePromotionsSection() {
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadPromotions = async () => {
      try {
        const active = await convexHttp.query(api.promotions.listActive, {});
        if (!cancelled && active.length > 0) setPromotions(active);
      } catch {
        // Promotions are decorative on the homepage; render nothing on failure.
      }
    };

    void loadPromotions();
    return () => {
      cancelled = true;
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
