import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import { getSkillCategoryForSkill } from "../lib/categories";
import type { PublicSkill } from "../lib/publicUser";
import { truncateText } from "../lib/truncateText";
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
  ownerHandle?: string | null;
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
  ownerHandle,
}: SkillCardProps) {
  const owner = encodeURIComponent(String(skill.ownerUserId));
  const link = href ?? `/${owner}/${skill.slug}`;
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : [];
  const isOfficial = badges.includes("Verified");
  const visibleBadges = ownerHandle ? badges.filter((label) => label !== "Verified") : badges;
  const primaryCategory = getSkillCategoryForSkill(skill);
  const hasSecondaryTags =
    visibleBadges.length || chip || platformLabels?.length || skill.topics?.length;
  const hasTags = primaryCategory || hasSecondaryTags;

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
        <div className="skill-card-identity">
          <h3 className="skill-card-title">{truncateText(skill.displayName, 40)}</h3>
          {ownerHandle ? (
            <span className="skill-card-owner-row">
              <span className="skill-card-owner">@{ownerHandle}</span>
              {isOfficial ? <OfficialBadge /> : null}
            </span>
          ) : null}
        </div>
      </div>
      <p className="skill-card-summary">{truncateText(skill.summary ?? summaryFallback, 100)}</p>
      {hasTags ? (
        <div className="skill-card-tags">
          {primaryCategory ? (
            <span className="skill-card-tag-category">
              <BrowseCategoryIcon
                slug={primaryCategory.slug}
                icon={primaryCategory.icon}
                size={13}
              />
              {primaryCategory.label}
            </span>
          ) : null}
          {primaryCategory && hasSecondaryTags ? (
            <span className="skill-card-tag-separator" aria-hidden="true" />
          ) : null}
          {visibleBadges.map((label) =>
            label === "Verified" ? (
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
      <div className="skill-card-footer">
        <div className="skill-card-bottom-row">
          <div className="skill-card-bottom-meta">{meta}</div>
        </div>
      </div>
    </Link>
  );
}
