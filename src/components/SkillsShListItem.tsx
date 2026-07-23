import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { getSkillCategoryBySlug } from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import {
  SKILLS_SH_TRUST_LABEL,
  skillsShRepositoryLabel,
  type SkillsShSearchResult,
} from "../lib/skillsShCatalog";
import { timeAgo } from "../lib/timeAgo";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Badge } from "./ui/badge";

export function SkillsShListItem({ result }: { result: SkillsShSearchResult }) {
  const category = getSkillCategoryBySlug(result.categories?.[0]);
  return (
    <Link
      to={result.route}
      className="skill-list-item skill-list-item-skill skill-list-item-with-taxonomy"
    >
      <MarketplaceIcon kind="skill" label={result.displayName} categorySlug={category?.slug} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-identity">
            <span className="skill-list-item-name" title={result.displayName}>
              {truncateText(result.displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </span>
            <span className="skill-list-item-owner">{skillsShRepositoryLabel(result)}</span>
          </span>
          <Badge variant="warning" size="sm">
            {SKILLS_SH_TRUST_LABEL}
          </Badge>
        </div>
        {result.summary ? (
          <p className="skill-list-item-summary">{truncateText(result.summary, 80)}</p>
        ) : null}
      </div>
      <div className="skill-list-item-taxonomy" aria-label="Source">
        <span className="skill-list-item-category">{category?.label ?? "Other"}</span>
      </div>
      <div className="skill-list-item-meta">
        <span className="skill-list-item-meta-item is-updated">
          Observed {timeAgo(result.lastObservedAt)}
        </span>
        <span className="skill-list-item-meta-item" aria-label="skills.sh installs">
          <Download size={14} aria-hidden="true" /> {formatCompactStat(result.upstreamInstalls)}
        </span>
      </div>
    </Link>
  );
}
