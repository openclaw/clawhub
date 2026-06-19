import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { PublicSkill } from "../lib/publicUser";
import { CatalogTopicList } from "./CatalogTopicList";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import { Badge } from "./ui/badge";

type SkillCardProps = {
  skill: PublicSkill;
  badge?: string | string[];
  chip?: string;
  platformLabels?: string[];
  summaryFallback: string;
  meta: ReactNode;
  href?: string;
  className?: string;
};

export function SkillCard({
  skill,
  badge,
  chip,
  platformLabels,
  summaryFallback,
  meta,
  href,
  className,
}: SkillCardProps) {
  const owner = encodeURIComponent(String(skill.ownerUserId));
  const link = href ?? `/${owner}/${skill.slug}`;
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : [];
  const hasTags = badges.length || chip || platformLabels?.length || skill.topics?.length;

  return (
    <Link to={link} className={["card skill-card", className].filter(Boolean).join(" ")}>
      <div className="skill-card-header">
        <MarketplaceIcon
          kind="skill"
          label={skill.displayName}
          icon={skill.icon}
          skill={skill}
          size="md"
        />
        <h3 className="skill-card-title">{skill.displayName}</h3>
      </div>
      <p className="skill-card-summary">{skill.summary ?? summaryFallback}</p>
      {hasTags ? (
        <div className="skill-card-tags">
          {badges.map((label) =>
            label === "Official" ? (
              <OfficialBadge key={label} />
            ) : (
              <Badge key={label}>{label}</Badge>
            ),
          )}
          {chip ? <Badge variant="accent">{chip}</Badge> : null}
          {platformLabels?.map((label) => (
            <Badge key={label} variant="compact">
              {label}
            </Badge>
          ))}
          <CatalogTopicList topics={skill.topics} limit={3} />
        </div>
      ) : null}
      <div className="skill-card-footer">{meta}</div>
    </Link>
  );
}
