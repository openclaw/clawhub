import { Link } from "@tanstack/react-router";
import type { HomeSkillListingEntry } from "../lib/homeListingData";
import { formatCompactStat } from "../lib/numberFormat";
import { presentationTitle } from "../lib/presentationTitle";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function SkillListingHead() {
  return (
    <div className="skill-listing-head" aria-hidden="true">
      <span>Skill</span>
      <span>Downloads</span>
    </div>
  );
}

export function SkillListingSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading results">
      <SkillListingHead />
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
        <div key={index} className="home-v2-listing-row skill-listing-row">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SkillListingRow({ entry }: { entry: HomeSkillListingEntry }) {
  const item = "external" in entry ? entry.external : "trending" in entry ? entry.trending : null;
  const isSkillsSh = item?.source === "skills-sh";
  const native = "skill" in entry ? entry : null;
  const owner = native
    ? native.ownerHandle?.trim() || native.owner?.handle?.trim()
    : isSkillsSh
      ? (item?.sourceIdentity?.owner ?? item?.sourceIdentity?.host)
      : item?.publisher?.handle;
  const name = native
    ? presentationTitle(native.skill.displayName, native.skill.slug)
    : item!.displayName;
  const href = native
    ? `/${encodeURIComponent(owner || String(native.skill.ownerPublisherId ?? native.skill.ownerUserId))}/${encodeURIComponent(native.skill.slug)}`
    : item!.canonicalUrl;
  const downloads = native
    ? (native.skill.stats?.downloads ?? 0)
    : isSkillsSh
      ? (item?.sourceIdentity?.lifetimeInstalls ??
        (item && "lifetimeInstalls" in item.metrics ? item.metrics.lifetimeInstalls : null))
      : item && "trending24hDownloads" in item.metrics
        ? item.metrics.trending24hDownloads
        : null;
  const metricLabel = isSkillsSh
    ? "skills.sh lifetime installs"
    : "trending" in entry
      ? "24-hour downloads"
      : "Downloads";

  return (
    <Link to={href} className="home-v2-listing-row skill-listing-row">
      <div className="home-v2-listing-row-body">
        <div className="home-v2-listing-row-title">
          <span className="home-v2-listing-row-name" title={name}>
            {truncateText(name, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
          </span>
          {owner ? <span className="home-v2-listing-row-by">@{owner}</span> : null}
        </div>
      </div>
      <div className="home-v2-listing-row-stats">
        {isSkillsSh ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="compact" size="sm">
                skills.sh
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Synced from skills.sh</TooltipContent>
          </Tooltip>
        ) : null}
        <span aria-label={metricLabel} title={metricLabel}>
          {typeof downloads === "number" ? formatCompactStat(downloads) : "—"}
        </span>
      </div>
    </Link>
  );
}
