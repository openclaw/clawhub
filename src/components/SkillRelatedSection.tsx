import { Download, Star } from "lucide-react";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import { buildSkillCategoryBrowseHref, type SkillCategory } from "../lib/categories";
import { formatSkillStatsTriplet } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { buildSkillHref } from "./skillDetailUtils";
import { Button } from "./ui/button";

export type RelatedSkillEntry = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicPublisher | null;
};

type SkillRelatedSectionProps = {
  category: SkillCategory | null;
  relatedSkills: RelatedSkillEntry[];
  isLoading: boolean;
  variant?: "default" | "compact";
};

function ownerLabel(entry: RelatedSkillEntry) {
  return (
    entry.ownerHandle?.trim() ||
    entry.owner?.handle?.trim() ||
    String(entry.skill.ownerPublisherId ?? entry.skill.ownerUserId)
  );
}

function truncateRelatedSkillSummary(summary: string, maxLength = 80) {
  const trimmed = summary.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function SkillRelatedSection({
  category,
  relatedSkills,
  isLoading,
  variant = "default",
}: SkillRelatedSectionProps) {
  const visibleSkills = relatedSkills.slice(0, 5);
  if (!category || (!isLoading && visibleSkills.length === 0)) return null;
  const isCompact = variant === "compact";

  return (
    <section
      className={`related-skills-section${isCompact ? " related-skills-section-compact detail-mobile-related" : ""}`}
      aria-labelledby="related-skills-heading"
    >
      <div className="related-skills-header">
        <h2 id="related-skills-heading" className="related-skills-title">
          Related skills
        </h2>
      </div>
      <div className="related-skills-list" aria-busy={isLoading}>
        {isLoading
          ? Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`related-skill-skeleton-${index}`}
                className="related-skill-row related-skill-row-skeleton"
              >
                <span className="related-skill-icon-skeleton" aria-hidden="true" />
                <span className="related-skill-copy">
                  <span className="related-skill-title-skeleton" />
                  <span className="related-skill-summary-skeleton" />
                </span>
                <span className="related-skill-owner-skeleton" />
              </div>
            ))
          : visibleSkills.map((entry) => {
              const owner = ownerLabel(entry);
              const ownerId =
                entry.owner?._id ?? entry.skill.ownerPublisherId ?? entry.skill.ownerUserId;
              const formattedStats = formatSkillStatsTriplet(entry.skill.stats);
              const href = buildSkillHref(
                entry.ownerHandle ?? entry.owner?.handle ?? null,
                ownerId,
                entry.skill.slug,
              );

              return (
                <a key={entry.skill._id} href={href} className="related-skill-row">
                  <span className="related-skill-icon" aria-hidden="true">
                    <MarketplaceIcon
                      kind="skill"
                      label={entry.skill.displayName}
                      skill={entry.skill}
                      size="sm"
                    />
                  </span>
                  <span className="related-skill-copy">
                    <span className="related-skill-title-line">
                      <span className="related-skill-name">{entry.skill.displayName}</span>
                      {isCompact ? (
                        <span className="related-skill-owner-inline">@{owner}</span>
                      ) : null}
                    </span>
                    {entry.skill.summary ? (
                      <span className="related-skill-summary">
                        {truncateRelatedSkillSummary(entry.skill.summary)}
                      </span>
                    ) : null}
                  </span>
                  {isCompact ? (
                    <span className="related-skill-stats" aria-label="Related skill stats">
                      <span className="related-skill-stat">
                        <Star size={13} aria-hidden="true" />
                        {formattedStats.stars}
                      </span>
                      <span className="related-skill-stat">
                        <Download size={13} aria-hidden="true" />
                        {formattedStats.installsAllTime}
                      </span>
                    </span>
                  ) : (
                    <span className="related-skill-owner">
                      {owner}/{entry.skill.slug}
                    </span>
                  )}
                </a>
              );
            })}
      </div>
      <div className="related-skills-footer">
        <Button asChild variant="ghost" size="xs" className="related-skills-category-link">
          <a href={buildSkillCategoryBrowseHref(category)}>
            <BrowseCategoryIcon slug={category.slug} icon={category.icon} size={13} />
            More in {category.label}
          </a>
        </Button>
      </div>
    </section>
  );
}
