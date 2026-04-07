import type { ClawdisSkillMetadata } from "clawhub-schema";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_SUMMARY,
} from "clawhub-schema/licenseConstants";
import { Package, Star } from "lucide-react";
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

  return (
    <aside className="detail-sidebar">
      {/* Download / Install */}
      {!nixPlugin && !isMalwareBlocked && !isRemoved ? (
        <div className="sidebar-card">
          <h3 className="sidebar-card-title">Download</h3>
          <Button asChild variant="primary" className="w-full justify-center">
            <a href={`${convexSiteUrl}/api/v1/download?slug=${skill.slug}`}>
              Download zip
            </a>
          </Button>
        </div>
      ) : null}

      {/* Stats */}
      <div className="sidebar-card">
        <h3 className="sidebar-card-title">Stats</h3>
        <div className="sidebar-stat-grid">
          <div className="sidebar-stat">
            <span className="sidebar-stat-value">
              <Package size={14} aria-hidden="true" />
              {formatCompactStat(skill.stats.downloads)}
            </span>
            <span className="sidebar-stat-label">Downloads</span>
          </div>
          <div className="sidebar-stat">
            <span className="sidebar-stat-value">
              <Star size={14} aria-hidden="true" />
              {formatCompactStat(skill.stats.stars)}
            </span>
            <span className="sidebar-stat-label">Stars</span>
          </div>
          <div className="sidebar-stat">
            <span className="sidebar-stat-value">
              {formatCompactStat(skill.stats.versions ?? 0)}
            </span>
            <span className="sidebar-stat-label">Versions</span>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="sidebar-card">
        <h3 className="sidebar-card-title">Details</h3>
        <dl className="sidebar-metadata">
          <div className="sidebar-metadata-row">
            <dt>Updated</dt>
            <dd>{timeAgo(skill.updatedAt)}</dd>
          </div>
          <div className="sidebar-metadata-row">
            <dt>Created</dt>
            <dd>{timeAgo(skill.createdAt)}</dd>
          </div>
          {latestVersion?.version ? (
            <div className="sidebar-metadata-row">
              <dt>Version</dt>
              <dd>v{latestVersion.version}</dd>
            </div>
          ) : null}
          <div className="sidebar-metadata-row">
            <dt>License</dt>
            <dd>{PLATFORM_SKILL_LICENSE} ({PLATFORM_SKILL_LICENSE_SUMMARY})</dd>
          </div>
          {osLabels.length ? (
            <div className="sidebar-metadata-row">
              <dt>Platforms</dt>
              <dd>{osLabels.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* Tags */}
      {tagEntries.length > 0 ? (
        <div className="sidebar-card">
          <h3 className="sidebar-card-title">Tags</h3>
          <div className="sidebar-tags">
            {tagEntries.map(([tag]) => (
              <Badge key={tag} variant="compact">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Owner */}
      <div className="sidebar-card">
        <h3 className="sidebar-card-title">Publisher</h3>
        <UserBadge
          user={owner}
          fallbackHandle={ownerHandle}
          prefix=""
          size="md"
          showName
        />
      </div>
    </aside>
  );
}
