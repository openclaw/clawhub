import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { PublicSoul } from "../lib/publicUser";

type SoulCardProps = {
  soul: PublicSoul;
  summaryFallback: string;
  meta: ReactNode;
};

export function SoulCard({ soul, summaryFallback, meta }: SoulCardProps) {
  return (
    <Link
      to="/souls/$slug"
      params={{ slug: soul.slug }}
      className="group flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-[22px] no-underline transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(29,26,23,0.12)]"
    >
      <h3 className="font-display text-base font-bold text-[color:var(--ink)] group-hover:text-[color:var(--accent)]">
        {soul.displayName}
      </h3>
      <p className="line-clamp-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">
        {soul.summary ?? summaryFallback}
      </p>
      <div className="mt-auto flex items-center gap-3 pt-2">{meta}</div>
    </Link>
  );
}
