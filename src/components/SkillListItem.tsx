import { Link } from "@tanstack/react-router";
import { Bookmark, Download } from "lucide-react";
import { getSkillBadges } from "../lib/badges";
import { getSkillCategoriesForSkill } from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import { presentationTitle } from "../lib/presentationTitle";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { timeAgo } from "../lib/timeAgo";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
import { CatalogTopicList } from "./CatalogTopicList";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import { Badge } from "./ui/badge";

type SkillListItemProps = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicPublisher | null;
  href?: string;
  showOfficialBadge?: boolean;
  showIcon?: boolean;
};

export function SkillListItem({
  skill,
  ownerHandle,
  owner,
  href: hrefOverride,
  showOfficialBadge = true,
  showIcon = true,
}: SkillListItemProps) {
  const handle = ownerHandle ?? owner?.handle ?? null;
  const ownerSegment = handle?.trim() || String(skill.ownerPublisherId ?? skill.ownerUserId);
  const href =
    hrefOverride ?? `/${encodeURIComponent(ownerSegment)}/${encodeURIComponent(skill.slug)}`;
  const badges = getSkillBadges(skill);
  const isOfficial = badges.includes("Official") || owner?.official === true;
  const categories = getSkillCategoriesForSkill(skill);
  const displayName = presentationTitle(skill.displayName, skill.slug);
  const categoryLabel = categories
    .slice(0, 3)
    .map((category) => category.label)
    .join(", ");

  return (
    <Link
      to={href}
      className={`skill-list-item skill-list-item-skill skill-list-item-with-taxonomy${
        showIcon ? "" : " skill-list-item-no-icon"
      }`}
    >
      {showIcon ? (
        <MarketplaceIcon kind="skill" label={displayName} imageUrl={skill.icon} skill={skill} />
      ) : null}
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-identity">
            <span className="skill-list-item-name" title={displayName}>
              {truncateText(displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </span>
            {handle ? <span className="skill-list-item-owner">@{handle}</span> : null}
          </span>
          {showOfficialBadge && isOfficial ? <OfficialBadge /> : null}
          {badges
            .filter((badge) => badge !== "Official")
            .map((badge) => (
              <Badge key={badge} variant="compact">
                {badge}
              </Badge>
            ))}
          <CatalogTopicList topics={skill.topics} limit={2} />
        </div>
        {skill.summary ? (
          <p className="skill-list-item-summary">{truncateText(skill.summary, 80)}</p>
        ) : null}
      </div>
      <div className="skill-list-item-taxonomy" aria-label="Categories">
        {categoryLabel ? <span className="skill-list-item-category">{categoryLabel}</span> : null}
      </div>
      <div className="skill-list-item-meta">
        <span className="skill-list-item-meta-item is-updated">
          Updated {timeAgo(skill.updatedAt)}
        </span>
        <span className="skill-list-item-meta-item">
          <Bookmark size={14} aria-hidden="true" /> {formatCompactStat(skill.stats.stars)}
        </span>
        <span className="skill-list-item-meta-item">
          <Download size={14} aria-hidden="true" /> {formatCompactStat(skill.stats.downloads)}
        </span>
      </div>
    </Link>
  );
}
