import { AlertTriangle, Download, Star } from "lucide-react";
import type { ReactNode } from "react";
import { formatCompactStat } from "../../lib/numberFormat";
import { familyLabel } from "../../lib/packageLabels";
import { buildPluginDetailHref, buildPluginValidationHref } from "../../lib/pluginRoutes";
import { timeAgo } from "../../lib/timeAgo";
import { truncateText } from "../../lib/truncateText";
import { ArtifactScanStatusValue } from "../artifacts/ArtifactScanStrip";
import {
  packageArtifactStatus,
  skillArtifactStatus,
  type ArtifactDisplayStatus,
} from "../artifacts/artifactStatus";
import { MarketplaceIcon } from "../MarketplaceIcon";
import { buildSkillHref } from "../skillDetailUtils";
import { CatalogRowKindLine, CatalogRowStatusColumn } from "./ArtifactStatusChips";
import {
  packageSecurityStatus,
  packageVisibilityStatus,
  skillSecurityStatus,
  skillVisibilityStatus,
} from "./artifactStatusLabels";
import { CatalogRowMenu } from "./CatalogRowMenu";
import type {
  DashboardCatalogItem,
  DashboardPackage,
  DashboardSkill,
  DashboardView,
} from "./types";

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
            <PluginGridCard key={`plugin:${item.id}`} pkg={item.data} ownerHandle={ownerHandle} />
          ),
        )}
      </div>
    );
  }

  return (
    <div className="browse-list-stack">
      <div className="browse-list-head dashboard-catalog-list-head" aria-hidden="true">
        <span className="browse-list-head-icon-spacer" />
        <span className="browse-list-head-label">Name</span>
        <span className="browse-list-head-label">Status</span>
        <span className="browse-list-head-label browse-list-head-stat">Activity</span>
        <span className="browse-list-head-actions-spacer" />
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
      kindLine={<CatalogRowKindLine kindLabel="Skill" />}
      statusColumn={
        <CatalogRowStatusColumn
          security={skillSecurityStatus(skill)}
          visibility={skillVisibilityStatus(skill)}
        />
      }
      icon={<MarketplaceIcon kind="skill" label={skill.displayName} skill={skill} size="sm" />}
      downloads={skill.stats?.downloads ?? 0}
      stars={skill.stats?.stars ?? 0}
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
  const validationLabel = `${validationCount} validation finding${validationCount === 1 ? "" : "s"}`;

  return (
    <CatalogRow
      href={buildPluginDetailHref(pkg.name, { ownerHandle })}
      title={pkg.displayName}
      summary={pkg.summary}
      kindLine={
        <CatalogRowKindLine
          kindLabel="Plugin"
          familyLabel={
            pkg.family === "code-plugin" || pkg.family === "bundle-plugin"
              ? familyLabel(pkg.family)
              : null
          }
        />
      }
      statusColumn={
        <CatalogRowStatusColumn
          security={packageSecurityStatus(pkg)}
          visibility={packageVisibilityStatus(pkg)}
        />
      }
      icon={<MarketplaceIcon kind="plugin" label={pkg.displayName} size="sm" />}
      downloads={pkg.stats.downloads ?? 0}
      trailing={
        validationCount > 0 ? (
          <a
            href={buildPluginValidationHref(pkg.name)}
            className="skill-list-item-meta-item dashboard-catalog-flag"
            aria-label={`View ${validationCount} validation finding${validationCount === 1 ? "" : "s"} for ${pkg.displayName}`}
            title={validationLabel}
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
  kindLine,
  statusColumn,
  icon,
  downloads,
  stars,
  trailing,
  menu,
}: {
  href: string;
  title: string;
  summary?: string | null;
  kindLine: ReactNode;
  statusColumn: ReactNode;
  icon: ReactNode;
  downloads: number;
  stars?: number;
  trailing?: ReactNode;
  menu: ReactNode;
}) {
  const trimmedSummary = summary?.trim();

  return (
    <div className="skill-list-item skill-list-item-with-taxonomy dashboard-catalog-row">
      <a href={href} className="dashboard-catalog-row-link" aria-label={`Open ${title}`} />
      <span className="dashboard-catalog-row-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-name">{title}</span>
        </div>
        {kindLine}
        {trimmedSummary ? (
          <p className="skill-list-item-summary">{truncateText(trimmedSummary, 80)}</p>
        ) : null}
      </div>
      {statusColumn}
      <div className="skill-list-item-meta">
        {stars !== undefined ? (
          <span className="skill-list-item-meta-item" title={metricLabel(stars, "star")}>
            <Star size={14} aria-hidden="true" />
            <span aria-hidden="true">{formatCompactStat(stars)}</span>
            <span className="sr-only">{metricLabel(stars, "star")}</span>
          </span>
        ) : null}
        <span className="skill-list-item-meta-item" title={metricLabel(downloads, "download")}>
          <Download size={14} aria-hidden="true" />
          <span aria-hidden="true">{formatCompactStat(downloads)}</span>
          <span className="sr-only">{metricLabel(downloads, "download")}</span>
        </span>
        {trailing}
      </div>
      {menu}
    </div>
  );
}

function metricLabel(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function SkillGridCard({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string }) {
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

function PluginGridCard({ pkg, ownerHandle }: { pkg: DashboardPackage; ownerHandle: string }) {
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
        <span title={metricLabel(downloads, "download")}>
          <Download size={13} aria-hidden="true" />
          <span aria-hidden="true">{formatCompactStat(downloads)}</span>
          <span className="sr-only">{metricLabel(downloads, "download")}</span>
        </span>
        <span>{timeAgo(updatedAt)}</span>
      </div>
    </a>
  );
}
