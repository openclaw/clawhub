import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { PublicSkill } from "../lib/publicUser";
import { Badge } from "./ui/badge";

type SkillCardProps = {
  skill: PublicSkill;
  badge?: string | string[];
  chip?: string;
  platformLabels?: string[];
  summaryFallback: string;
  meta: ReactNode;
  href?: string;
  verified?: boolean;
};

export function SkillCard({
  skill,
  badge,
  chip,
  platformLabels,
  summaryFallback,
  meta,
  href,
  verified,
}: SkillCardProps) {
  const owner = encodeURIComponent(String(skill.ownerUserId));
  const link = href ?? `/${owner}/${skill.slug}`;
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : [];
  const hasTags = badges.length || chip || platformLabels?.length;

  return (
    <Link
      to={link}
      className="group flex w-full flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-[22px] no-underline transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(29,26,23,0.12)] hover:border-[color:var(--border-ui-hover)]"
    >
      {hasTags ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {badges.map((label) => (
            <Badge key={label} variant="default">
              {label}
            </Badge>
          ))}
          {chip ? (
            <Badge variant="accent" className="text-[0.72rem] px-2.5 py-0.5">
              {chip}
            </Badge>
          ) : null}
          {platformLabels?.map((label) => (
            <Badge key={label} variant="compact">
              {label}
            </Badge>
          ))}
          {verified && (
            <span className="inline-flex items-center gap-1 text-[0.72rem] font-semibold text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      ) : null}
      <h3 className="font-display text-base font-bold leading-tight text-[color:var(--ink)] group-hover:text-[color:var(--accent)]">
        {skill.displayName}
      </h3>
      <p className="line-clamp-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">
        {skill.summary ?? summaryFallback}
      </p>
      <div className="mt-auto flex flex-col gap-2 pt-1 text-[0.82rem] text-[color:var(--ink-soft)]">
        {meta}
      </div>
    </Link>
  );
}
