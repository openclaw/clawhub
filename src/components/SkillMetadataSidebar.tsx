import type { ClawdisSkillMetadata } from "clawhub-schema";
import { PLATFORM_SKILL_LICENSE } from "clawhub-schema/licenseConstants";
import { Calendar, Download, Package, Scale, Star, Tag } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { timeAgo } from "../lib/timeAgo";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { UserBadge } from "./UserBadge";

type SkillMetadataSidebarProps = {
  skill: PublicSkill;
  latestVersion: { version?: string; _id: Id<"skillVersions"> } | null;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  clawdis?: ClawdisSkillMetadata;
  osLabels: string[];
  tagEntries: Array<[string, Id<"skillVersions">]>;
  isMalwareBlocked?: boolean;
  isRemoved?: boolean;
  nixPlugin?: string;
};

export function SkillMetadataSidebar({
  skill,
  latestVersion,
  owner,
  ownerHandle,
  clawdis: _clawdis,
  osLabels,
  tagEntries,
  isMalwareBlocked,
  isRemoved,
  nixPlugin,
}: SkillMetadataSidebarProps) {
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const showDownload = !nixPlugin && !isMalwareBlocked && !isRemoved;

  return (
    <div className="detail-meta-bar">
      {/* Stats row */}
      <div className="meta-bar-stats">
        <div className="meta-stat">
          <Download size={14} aria-hidden="true" />
          <span className="meta-stat-value">{formatCompactStat(skill.stats.downloads)}</span>
          <span className="meta-stat-label">downloads</span>
        </div>
        <div className="meta-stat">
          <Star size={14} aria-hidden="true" />
          <span className="meta-stat-value">{formatCompactStat(skill.stats.stars)}</span>
          <span className="meta-stat-label">stars</span>
        </div>
        <div className="meta-stat">
          <Package size={14} aria-hidden="true" />
          <span className="meta-stat-value">{formatCompactStat(skill.stats.versions ?? 0)}</span>
          <span className="meta-stat-label">versions</span>
        </div>
      </div>

      {/* Details row */}
      <div className="meta-bar-details">
        <div className="meta-detail">
          <Calendar size={12} aria-hidden="true" />
          <span>Updated {timeAgo(skill.updatedAt)}</span>
        </div>
        {latestVersion?.version ? (
          <div className="meta-detail">
            <Tag size={12} aria-hidden="true" />
            <span>v{latestVersion.version}</span>
          </div>
        ) : null}
        <div className="meta-detail">
          <Scale size={12} aria-hidden="true" />
          <span>{PLATFORM_SKILL_LICENSE}</span>
        </div>
        {osLabels.length > 0 ? (
          <div className="meta-detail">
            <span>{osLabels.join(", ")}</span>
          </div>
        ) : null}
      </div>

      {/* Tags and Publisher row */}
      <div className="meta-bar-footer">
        <div className="meta-bar-publisher">
          <UserBadge
            user={owner}
            fallbackHandle={ownerHandle}
            prefix=""
            size="sm"
            showName
          />
        </div>
        
        {tagEntries.length > 0 ? (
          <div className="meta-bar-tags">
            {tagEntries.map(([tag]) => (
              <Badge key={tag} variant="compact">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        {showDownload ? (
          <Button asChild variant="primary" size="sm">
            <a href={`${convexSiteUrl}/api/v1/download?slug=${skill.slug}`}>
              <Download size={14} aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
