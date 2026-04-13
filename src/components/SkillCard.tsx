import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Badge } from "./ui/badge";
import type { PublicSkill } from "../lib/publicUser";

type SkillCardProps = {
  skill: PublicSkill;
  badge?: string | string[];
  chip?: string;
  platformLabels?: string[];
  summaryFallback: string;
  meta: ReactNode;
  href?: string;
};

export function SkillCard({
  skill,
  badge,
  chip,
  platformLabels,
  summaryFallback,
  meta,
  href,
}: SkillCardProps) {
  const owner = encodeURIComponent(String(skill.ownerUserId));
  const link = href ?? `/${owner}/${skill.slug}`;
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : [];
  const hasTags = badges.length || chip || platformLabels?.length;

  return (
    <Link to={link} className="card skill-card">
      {hasTags ? (
        <div className="skill-card-tags">
          {badges.map((label) => (
            <Badge key={label}>
              {label}
            </Badge>
          ))}
          {chip ? <Badge variant="accent">{chip}</Badge> : null}
          {platformLabels?.map((label) => (
            <Badge key={label} variant="compact">
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="skill-card-header">
        <MarketplaceIcon kind="skill" label={skill.displayName} size="md" />
        <h3 className="skill-card-title">{skill.displayName}</h3>
      </div>
      <p className="skill-card-summary">{skill.summary ?? summaryFallback}</p>
      <div className="skill-card-footer">{meta}</div>
    </Link>
  );
}
