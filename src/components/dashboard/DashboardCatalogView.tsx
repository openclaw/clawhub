import type { ReactNode } from "react";
import { Download, EyeOff } from "lucide-react";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPluginDetailHref } from "../../lib/pluginRoutes";
import { timeAgo } from "../../lib/timeAgo";
import { truncateText } from "../../lib/truncateText";
import { ArtifactScanStatusValue } from "../artifacts/ArtifactScanStrip";
import {
  artifactStatusToScanStatus,
  packageArtifactStatus,
  skillArtifactStatus,
  type ArtifactDisplayStatus,
} from "../artifacts/artifactStatus";
import { auditVerdictMeterLevel } from "../DetailSecuritySummary";
import { MarketplaceIcon } from "../MarketplaceIcon";
import { getScanStatusInfo } from "../SkillSecurityScanResults";
import { buildSkillHref } from "../skillDetailUtils";
import { skillVisibilityStatus } from "./artifactStatusLabels";
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
  const visibility = skillVisibilityStatus(skill);
  return (
    <CatalogRow
      href={detailHref}
      title={skill.displayName}
      titleAccessory={visibilityIcon(visibility.label)}
      secondary={packageRowSecondary(skill.latestVersion?.version, skill.updatedAt)}
      status={skillArtifactStatus(skill)}
      downloads={skill.stats?.downloads ?? 0}
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
  return (
    <CatalogRow
      href={buildPluginDetailHref(pkg.name, { ownerHandle })}
      title={pkg.displayName}
      secondary={packageRowSecondary(pkg.latestVersion ?? pkg.latestRelease?.version, pkg.updatedAt)}
      status={packageArtifactStatus(pkg)}
      downloads={pkg.stats.downloads ?? 0}
      menu={<CatalogRowMenu item={item} ownerHandle={ownerHandle} canManage={canManage} />}
    />
  );
}

function CatalogRow({
  href,
  title,
  titleAccessory,
  secondary,
  status,
  downloads,
  menu,
}: {
  href: string;
  title: string;
  titleAccessory?: ReactNode;
  secondary: string;
  status: ArtifactDisplayStatus;
  downloads: number;
  menu: ReactNode;
}) {
  return (
    <div className="skill-list-item skill-list-item-with-taxonomy dashboard-catalog-row">
      <a href={href} className="dashboard-catalog-row-link" aria-label={`Open ${title}`} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-name">{title}</span>
          {titleAccessory}
        </div>
        <p className="skill-list-item-summary dashboard-catalog-row-secondary">{secondary}</p>
      </div>
      <div className="dashboard-catalog-review" aria-label="Review trend">
        <SecurityAuditMiniStatus status={status} />
      </div>
      <div className="skill-list-item-meta">
        <span className="dashboard-catalog-downloads" title={metricLabel(downloads, "download")}>
          <Download size={14} aria-hidden="true" />
          <span aria-hidden="true">{formatCompactStat(downloads)}</span>
          <span className="sr-only">{metricLabel(downloads, "download")}</span>
        </span>
      </div>
      {menu}
    </div>
  );
}

function packageRowSecondary(version: string | null | undefined, updatedAt: number) {
  return [version ? `v${version}` : null, `Updated ${timeAgo(updatedAt)}`].filter(Boolean).join(" · ");
}

function SecurityAuditMiniStatus({ status }: { status: ArtifactDisplayStatus }) {
  const scanStatus = artifactStatusToScanStatus(status);
  const statusInfo = getScanStatusInfo(scanStatus);
  return (
    <div className="dashboard-mini-audit security-audit-sidebar-value-row" aria-hidden="true">
      <span className="security-audit-sidebar-verdict" data-status={scanStatus}>
        {statusInfo.label}
      </span>
      <span className="security-audit-meter" data-level={auditVerdictMeterLevel(scanStatus)}>
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function metricLabel(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function visibilityIcon(label: string) {
  if (label !== "Hidden" && label !== "Removed") return undefined;
  return (
    <span className="dashboard-catalog-title-icon" title={`${label} from public catalog`}>
      <EyeOff size={13} aria-hidden="true" />
      <span className="sr-only">{label} from public catalog</span>
    </span>
  );
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
