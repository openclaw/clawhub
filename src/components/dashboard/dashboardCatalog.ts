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

export type DashboardAggregateStats = {
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
  }));
  const packageItems: DashboardCatalogItem[] = packages.map((pkg) => ({
    kind: "plugin",
    id: pkg._id,
    name: pkg.displayName,
    searchText: `${pkg.displayName} ${pkg.name}`.toLowerCase(),
    data: pkg,
    updatedAt: pkg.updatedAt,
    installs: pkg.stats.installs ?? 0,
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
  if (parts.length < 3) return item.id;
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
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
  key: DashboardSortKey,
  dir: DashboardSortDir,
): DashboardCatalogItem[] {
  const factor = dir === "asc" ? 1 : -1;
  const sorted = [...items];
  sorted.sort((left, right) => {
    let delta: number;
    if (key === "name") {
      delta = left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    } else if (key === "installs") {
      delta = left.installs - right.installs;
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
