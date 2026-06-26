import { AlertTriangle, Download } from "lucide-react";
import type { ReactNode } from "react";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPluginDetailHref, buildPluginValidationHref } from "../../lib/pluginRoutes";
import { timeAgo } from "../../lib/timeAgo";
import { truncateText } from "../../lib/truncateText";
import {
  packageArtifactStatus,
  skillArtifactStatus,
  type ArtifactDisplayStatus,
} from "../artifacts/artifactStatus";
import { ArtifactScanStatusValue } from "../artifacts/ArtifactScanStrip";
import { MarketplaceIcon } from "../MarketplaceIcon";
import { buildSkillHref } from "../skillDetailUtils";
import { CatalogRowMenu } from "./CatalogRowMenu";
import { PackageCatalogMeta, SkillCatalogMeta } from "./ArtifactStatusChips";
import type { DashboardCatalogItem, DashboardPackage, DashboardSkill, DashboardView } from "./types";

type DashboardCatalogViewProps = {
  items: DashboardCatalogItem[];
  view: DashboardView;
  ownerHandle: string;
  canManage: boolean;
};

export function DashboardCatalogView({
  items,
  view,
  ownerHandle,
  canManage,
}: DashboardCatalogViewProps) {
  if (view === "grid") {
    return (
      <div className="home-v2-listing-grid dashboard-catalog-grid">
        {items.map((item) =>
          item.kind === "skill" ? (
            <SkillGridCard key={`skill:${item.id}`} skill={item.data} ownerHandle={ownerHandle} />
          ) : (
            <PluginGridCard
              key={`plugin:${item.id}`}
              pkg={item.data}
              ownerHandle={ownerHandle}
            />
          ),
        )}
      </div>
    );
  }

  return (
    <div className="browse-list-stack">
      <div className="browse-list-head browse-list-head-simple" aria-hidden="true">
        <span className="browse-list-head-icon-spacer" />
        <span className="browse-list-head-label">Name</span>
        <span className="browse-list-head-label browse-list-head-stat">Activity</span>
      </div>
      <div className="results-list">
        {items.map((item) =>
          item.kind === "skill" ? (
            <SkillListRow
              key={`skill:${item.id}`}
              item={item}
              skill={item.data}
              ownerHandle={ownerHandle}
              canManage={canManage}
            />
          ) : (
            <PluginListRow
              key={`plugin:${item.id}`}
              item={item}
              pkg={item.data}
              ownerHandle={ownerHandle}
              canManage={canManage}
            />
          ),
        )}
      </div>
    </div>
  );
}

function skillHrefs(
  skill: Extract<DashboardCatalogItem, { kind: "skill" }>["data"],
  ownerHandle: string,
) {
  const detailHref =
    skill.detailHref ??
    buildSkillHref(ownerHandle, skill.ownerPublisherId ?? skill.ownerUserId ?? null, skill.slug);
  return { detailHref };
}

function SkillListRow({
  item,
  skill,
  ownerHandle,
  canManage,
}: {
  item: DashboardCatalogItem;
  skill: Extract<DashboardCatalogItem, { kind: "skill" }>["data"];
  ownerHandle: string;
  canManage: boolean;
}) {
  const { detailHref } = skillHrefs(skill, ownerHandle);
  return (
    <CatalogRow
      href={detailHref}
      title={skill.displayName}
      summary={skill.summary}
      meta={<SkillCatalogMeta skill={skill} />}
      icon={
        <MarketplaceIcon kind="skill" label={skill.displayName} skill={skill} size="sm" />
      }
      downloads={skill.stats?.downloads ?? 0}
      updatedAt={skill.updatedAt}
      menu={<CatalogRowMenu item={item} ownerHandle={ownerHandle} canManage={canManage} />}
    />
  );
}

function PluginListRow({
  item,
  pkg,
  ownerHandle,
  canManage,
}: {
  item: DashboardCatalogItem;
  pkg: Extract<DashboardCatalogItem, { kind: "plugin" }>["data"];
  ownerHandle: string;
  canManage: boolean;
}) {
  const validationCount = pkg.inspectorWarningCount ?? 0;

  return (
    <CatalogRow
      href={buildPluginDetailHref(pkg.name, { ownerHandle })}
      title={pkg.displayName}
      summary={pkg.summary}
      meta={<PackageCatalogMeta pkg={pkg} />}
      icon={<MarketplaceIcon kind="plugin" label={pkg.displayName} size="sm" />}
      downloads={pkg.stats.downloads ?? 0}
      updatedAt={pkg.updatedAt}
      trailing={
        validationCount > 0 ? (
          <a
            href={buildPluginValidationHref(pkg.name)}
            className="skill-list-item-meta-item dashboard-catalog-flag"
            aria-label={`View ${validationCount} validation finding${validationCount === 1 ? "" : "s"} for ${pkg.displayName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <AlertTriangle size={14} aria-hidden="true" />
            {validationCount}
          </a>
        ) : null
      }
      menu={<CatalogRowMenu item={item} ownerHandle={ownerHandle} canManage={canManage} />}
    />
  );
}

function CatalogRow({
  href,
  title,
  summary,
  meta,
  icon,
  downloads,
  updatedAt,
  trailing,
  menu,
}: {
  href: string;
  title: string;
  summary?: string | null;
  meta: ReactNode;
  icon: ReactNode;
  downloads: number;
  updatedAt: number;
  trailing?: ReactNode;
  menu: ReactNode;
}) {
  const trimmedSummary = summary?.trim();

  return (
    <div className="skill-list-item skill-list-item-with-taxonomy dashboard-catalog-row">
      <a href={href} className="dashboard-catalog-row-main">
        <span className="dashboard-catalog-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="skill-list-item-body">
          <div className="skill-list-item-main dashboard-catalog-row-title">
            <span className="skill-list-item-name">{title}</span>
          </div>
          {meta}
          {trimmedSummary ? (
            <p className="skill-list-item-summary">{truncateText(trimmedSummary, 80)}</p>
          ) : null}
        </div>
        <div className="skill-list-item-taxonomy" aria-hidden="true" />
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item is-updated">Updated {timeAgo(updatedAt)}</span>
          <span className="skill-list-item-meta-item">
            <Download size={14} aria-hidden="true" /> {formatCompactStat(downloads)}
          </span>
          {trailing}
        </div>
      </a>
      {menu}
    </div>
  );
}

function SkillGridCard({
  skill,
  ownerHandle,
}: {
  skill: DashboardSkill;
  ownerHandle: string;
}) {
  const { detailHref } = skillHrefs(skill, ownerHandle);
  return (
    <DashboardCatalogGridCard
      href={detailHref}
      title={skill.displayName}
      summary={skill.summary}
      summaryFallback="Agent-ready skill pack."
      icon={<MarketplaceIcon kind="skill" label={skill.displayName} skill={skill} size="sm" />}
      status={skillArtifactStatus(skill)}
      downloads={skill.stats?.downloads ?? 0}
      updatedAt={skill.updatedAt}
    />
  );
}

function PluginGridCard({
  pkg,
  ownerHandle,
}: {
  pkg: DashboardPackage;
  ownerHandle: string;
}) {
  return (
    <DashboardCatalogGridCard
      href={buildPluginDetailHref(pkg.name, { ownerHandle })}
      title={pkg.displayName}
      summary={pkg.summary}
      summaryFallback="Gateway plugin for OpenClaw workflows."
      icon={<MarketplaceIcon kind="plugin" label={pkg.displayName} size="sm" />}
      status={packageArtifactStatus(pkg)}
      downloads={pkg.stats.downloads ?? 0}
      updatedAt={pkg.updatedAt}
    />
  );
}

function DashboardCatalogGridCard({
  href,
  title,
  summary,
  summaryFallback,
  icon,
  status,
  downloads,
  updatedAt,
}: {
  href: string;
  title: string;
  summary?: string | null;
  summaryFallback: string;
  icon: ReactNode;
  status: ArtifactDisplayStatus;
  downloads: number;
  updatedAt: number;
}) {
  return (
    <a href={href} className="home-v2-listing-card dashboard-catalog-grid-card">
      <div className="home-v2-listing-card-head">
        <span className="home-v2-listing-card-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="home-v2-listing-card-id">
          <span className="home-v2-listing-card-name">{truncateText(title, 40)}</span>
        </div>
      </div>
      <p className="home-v2-listing-card-summary">
        {truncateText(summary?.trim() || summaryFallback, 80)}
      </p>
      <div
        className="home-v2-listing-card-stats dashboard-catalog-grid-card-stats"
        aria-label="Catalog activity"
      >
        <span className="dashboard-catalog-grid-card-scan">
          <ArtifactScanStatusValue status={status} />
        </span>
        <span>
          <Download size={13} aria-hidden="true" />
          {formatCompactStat(downloads)}
        </span>
        <span>{timeAgo(updatedAt)}</span>
      </div>
    </a>
  );
}
