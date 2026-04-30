import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, Star } from "lucide-react";
import { getSkillBadges } from "../lib/badges";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { timeAgo } from "../lib/timeAgo";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Badge } from "./ui/badge";

type SkillListItemProps = {
  skill: PublicSkill;
  ownerHandle?: string | null;
  owner?: PublicPublisher | null;
};

export function SkillListItem({ skill, ownerHandle, owner }: SkillListItemProps) {
  const handle = ownerHandle ?? owner?.handle ?? null;
  const ownerSegment = handle?.trim() || String(skill.ownerPublisherId ?? skill.ownerUserId);
  const href = `/${encodeURIComponent(ownerSegment)}/${encodeURIComponent(skill.slug)}`;
  const badges = getSkillBadges(skill);

  return (
    <Link to={href} className="skill-list-item">
      <MarketplaceIcon kind="skill" label={skill.displayName} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          {handle ? (
            <>
              <span className="skill-list-item-owner">@{handle}</span>
              <span className="skill-list-item-sep">/</span>
            </>
          ) : null}
          <span className="skill-list-item-name">{skill.displayName}</span>
          {badges.map((b) => (
            <Badge key={b} variant="compact">
              {b}
            </Badge>
          ))}
        </div>
        {skill.summary ? <p className="skill-list-item-summary">{skill.summary}</p> : null}
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item">Updated {timeAgo(skill.updatedAt)}</span>
          <span className="skill-list-item-meta-item">
            <Star size={14} aria-hidden="true" /> {formatCompactStat(skill.stats.stars)}
          </span>
          <span className="skill-list-item-meta-item">
            <ArrowDownToLine size={14} aria-hidden="true" />{" "}
            {formatCompactStat(skill.stats.downloads)}
          </span>
        </div>
      </div>
    </Link>
  );
}
