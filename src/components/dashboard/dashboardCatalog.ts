import {
  packageSecurityStatus,
  packageVisibilityStatus,
  skillSecurityStatus,
  skillVisibilityStatus,
} from "./artifactStatusLabels";
import { collectAttentionItems } from "./dashboardAttention";
import type {
  DashboardAttentionItem,
  DashboardCatalogItem,
  DashboardKindFilter,
  DashboardPackage,
  DashboardSkill,
  DashboardSortDir,
  DashboardSortKey,
} from "./types";

type DashboardAggregateStats = {
  skillsCount: number;
  pluginsCount: number;
  totalInstalls: number;
  totalDownloads: number;
  needsAttentionCount: number;
};

function readSkillInstalls(skill: DashboardSkill) {
  return skill.stats?.installsAllTime ?? skill.stats?.installsCurrent ?? 0;
}

function readSkillDownloads(skill: DashboardSkill) {
  return skill.stats?.downloads ?? 0;
}

export function computeDashboardStats(
  skills: DashboardSkill[],
  packages: DashboardPackage[],
  ownerHandle = "",
): DashboardAggregateStats {
  const skillInstalls = skills.reduce((sum, skill) => sum + readSkillInstalls(skill), 0);
  const pluginInstalls = packages.reduce((sum, pkg) => sum + (pkg.stats.installs ?? 0), 0);
  const skillDownloads = skills.reduce((sum, skill) => sum + readSkillDownloads(skill), 0);
  const pluginDownloads = packages.reduce((sum, pkg) => sum + (pkg.stats.downloads ?? 0), 0);
  const attentionItems = collectAttentionItems(skills, packages, ownerHandle);

  return {
    skillsCount: skills.length,
    pluginsCount: packages.length,
    totalInstalls: skillInstalls + pluginInstalls,
    totalDownloads: skillDownloads + pluginDownloads,
    needsAttentionCount: attentionItems.length,
  };
}

export function mergeDashboardItems(
  skills: DashboardSkill[],
  packages: DashboardPackage[],
): DashboardCatalogItem[] {
  const skillItems: DashboardCatalogItem[] = skills.map((skill) => ({
    kind: "skill",
    id: skill._id,
    name: skill.displayName,
    searchText: `${skill.displayName} ${skill.slug}`.toLowerCase(),
    data: skill,
    updatedAt: skill.updatedAt,
    installs: readSkillInstalls(skill),
    downloads: readSkillDownloads(skill),
  }));
  const packageItems: DashboardCatalogItem[] = packages.map((pkg) => ({
    kind: "plugin",
    id: pkg._id,
    name: pkg.displayName,
    searchText: `${pkg.displayName} ${pkg.name}`.toLowerCase(),
    data: pkg,
    updatedAt: pkg.updatedAt,
    installs: pkg.stats.installs ?? 0,
    downloads: pkg.stats.downloads ?? 0,
  }));

  return [...skillItems, ...packageItems];
}

export function filterByKind(
  items: DashboardCatalogItem[],
  kind: DashboardKindFilter,
): DashboardCatalogItem[] {
  if (kind === "all") return items;
  if (kind === "attention") return items;
  return items.filter((item) => item.kind === kind);
}

export function filterByAttention(
  items: DashboardCatalogItem[],
  attentionItems: DashboardAttentionItem[],
): DashboardCatalogItem[] {
  const keys = new Set(attentionItems.map(attentionEntityKey));
  return items.filter((item) => keys.has(`${item.kind}:${item.id}`));
}

export function excludeAttentionItems(
  items: DashboardCatalogItem[],
  attentionItems: DashboardAttentionItem[],
): DashboardCatalogItem[] {
  const keys = new Set(attentionItems.map(attentionEntityKey));
  return items.filter((item) => !keys.has(`${item.kind}:${item.id}`));
}

function attentionEntityKey(item: DashboardAttentionItem) {
  const parts = item.id.split(":");
  if (parts.length < 2) return item.id;
  return `${parts[0]}:${parts[1]}`;
}

export function searchDashboardItems(
  items: DashboardCatalogItem[],
  query: string,
): DashboardCatalogItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items;
  return items.filter((item) => item.searchText.includes(trimmed));
}

export function sortDashboardItems(
  items: DashboardCatalogItem[],
  key?: DashboardSortKey,
  dir?: DashboardSortDir,
): DashboardCatalogItem[] {
  const resolvedDir = dir ?? (key === "name" ? "asc" : "desc");
  const factor = resolvedDir === "asc" ? 1 : -1;
  const sorted = [...items];
  sorted.sort((left, right) => {
    let delta: number;
    if (!key) {
      delta = defaultDashboardPriority(left) - defaultDashboardPriority(right);
      if (delta === 0) delta = left.downloads - right.downloads;
      if (delta === 0) delta = left.updatedAt - right.updatedAt;
      if (delta === 0) {
        return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
      }
      return -delta;
    }
    if (key === "name") {
      delta = left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    } else if (key === "downloads") {
      delta = left.downloads - right.downloads;
    } else {
      delta = left.updatedAt - right.updatedAt;
    }
    if (delta === 0) {
      delta = left.name.localeCompare(right.name, "en", { sensitivity: "base" });
      return delta;
    }
    return delta * factor;
  });
  return sorted;
}

function defaultDashboardPriority(item: DashboardCatalogItem) {
  if (item.kind === "plugin") {
    const security = packageSecurityStatus(item.data);
    if (security.tone === "destructive") return 60;
    if (security.tone === "pending") return 50;
    if (security.tone === "warning") return 40;
    if ((item.data.inspectorWarningCount ?? 0) > 0) return 30;
    if (packageVisibilityStatus(item.data).tone !== "success") return 20;
    return 0;
  }

  const security = skillSecurityStatus(item.data);
  const visibility = skillVisibilityStatus(item.data);
  if (security.tone === "destructive") return 60;
  if (security.tone === "pending") return 50;
  if (security.tone === "warning") return 40;
  if (visibility.label === "Quality hold") return 30;
  if (visibility.label === "Hidden" || visibility.label === "Removed") return 20;
  return 0;
}
