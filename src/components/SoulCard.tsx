import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { PublicSoul } from "../lib/publicUser";
import { MarketplaceIcon } from "./MarketplaceIcon";

type SoulCardProps = {
  soul: PublicSoul;
  summaryFallback: string;
  meta: ReactNode;
};

export function SoulCard({ soul, summaryFallback, meta }: SoulCardProps) {
  return (
    <Link to="/souls/$slug" params={{ slug: soul.slug }} className="card skill-card">
      <div className="skill-card-header">
        <MarketplaceIcon kind="soul" label={soul.displayName} size="md" />
        <h3 className="skill-card-title">{soul.displayName}</h3>
      </div>
      <p className="skill-card-summary">{soul.summary ?? summaryFallback}</p>
      <div className="skill-card-footer">{meta}</div>
    </Link>
  );
}
