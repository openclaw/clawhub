import type { DashboardPackage, DashboardSkill } from "./types";

export type DownloadRange = "1d" | "1w" | "1m" | "all";

export type DownloadInsightSelection =
  | { scope: "all" }
  | { scope: "skill"; slug: string }
  | { scope: "plugin"; name: string };

const INSIGHT_PREFIX = /^(skill|plugin):(.+)$/;

export function parseDownloadInsight(value: string | undefined): DownloadInsightSelection {
  if (!value || value === "all") return { scope: "all" };
  const match = INSIGHT_PREFIX.exec(value);
  if (!match) return { scope: "all" };
  const [, kind, id] = match;
  if (kind === "skill" && id) return { scope: "skill", slug: id };
  if (kind === "plugin" && id) return { scope: "plugin", name: id };
  return { scope: "all" };
}

export function formatDownloadInsight(selection: DownloadInsightSelection): string | undefined {
  if (selection.scope === "all") return undefined;
  if (selection.scope === "skill") return `skill:${selection.slug}`;
  return `plugin:${selection.name}`;
}

export function skillDownloads(skill: DashboardSkill) {
  return skill.stats?.downloads ?? 0;
}

export function pluginDownloads(pkg: DashboardPackage) {
  return pkg.stats.downloads ?? 0;
}

export function resolveDownloadInsight(
  selection: DownloadInsightSelection,
  skills: DashboardSkill[],
  packages: DashboardPackage[],
) {
  if (selection.scope === "all") {
    return { skills, packages, label: null as string | null, missing: false };
  }
  if (selection.scope === "skill") {
    const skill = skills.find((entry) => entry.slug === selection.slug);
    return {
      skills: skill ? [skill] : [],
      packages: [] as DashboardPackage[],
      label: skill?.displayName ?? selection.slug,
      missing: !skill,
    };
  }
  const pkg = packages.find((entry) => entry.name === selection.name);
  return {
    skills: [] as DashboardSkill[],
    packages: pkg ? [pkg] : [],
    label: pkg?.displayName ?? selection.name,
    missing: !pkg,
  };
}

export function buildDownloadInsightOptions(
  skills: DashboardSkill[],
  packages: DashboardPackage[],
) {
  const options = [{ value: "all", label: "All items" }];
  const skillOptions = [...skills]
    .sort((left, right) => skillDownloads(right) - skillDownloads(left))
    .map((skill) => ({
      value: `skill:${skill.slug}`,
      label: skill.displayName || skill.slug,
    }));
  const pluginOptions = [...packages]
    .sort((left, right) => pluginDownloads(right) - pluginDownloads(left))
    .map((pkg) => ({
      value: `plugin:${pkg.name}`,
      label: pkg.displayName || pkg.name,
    }));
  return [...options, ...skillOptions, ...pluginOptions];
}

export function artifactDownloads(skills: DashboardSkill[], packages: DashboardPackage[]) {
  const skill = skills[0];
  if (skill) return skillDownloads(skill);
  const pkg = packages[0];
  if (pkg) return pluginDownloads(pkg);
  return 0;
}

const RANGE_BUCKETS: Record<DownloadRange, number> = {
  "1d": 24,
  "1w": 7,
  "1m": 30,
  all: 12,
};

/** Gentle curve shapes — resampled per range so each chart reads differently. */
const KIND_PROFILES = {
  skill: [0.08, 0.1, 0.12, 0.14, 0.17, 0.2, 0.19],
  plugin: [0.11, 0.15, 0.2, 0.21, 0.17, 0.1, 0.06],
} as const;

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function resampleProfile(profile: readonly number[], bucketCount: number) {
  if (bucketCount <= 0) return [];
  if (bucketCount === 1) return [profile.at(-1) ?? 1];
  if (bucketCount === profile.length) return [...profile];

  return Array.from({ length: bucketCount }, (_, index) => {
    const position = (index / (bucketCount - 1)) * (profile.length - 1);
    const left = Math.floor(position);
    const right = Math.min(left + 1, profile.length - 1);
    const blend = position - left;
    return profile[left] * (1 - blend) + profile[right] * blend;
  });
}

function mockSeriesTarget(keys: string[], kind: "skill" | "plugin") {
  if (keys.length === 0) return 0;
  const base = kind === "skill" ? 236 : 284;
  const variation =
    keys.reduce((sum, key) => sum + (hashString(`${kind}:${key}`) % 52), 0) / keys.length;
  return Math.round(base + variation);
}

function scaleProfileToTotal(profile: number[], targetTotal: number) {
  const weightSum = profile.reduce((sum, weight) => sum + weight, 0) || 1;
  return profile.map((weight) => (weight / weightSum) * targetTotal);
}

function buildKindSeries(keys: string[], kind: "skill" | "plugin", bucketCount: number) {
  const profile = resampleProfile(KIND_PROFILES[kind], bucketCount);
  return scaleProfileToTotal(profile, mockSeriesTarget(keys, kind));
}

function addSeries(left: number[], right: number[]) {
  return left.map((value, index) => value + (right[index] ?? 0));
}

/** Visual proxy: smooth mock curves with totals in the ~200–300 range. */
export function buildDownloadSeries(
  skills: DashboardSkill[],
  packages: DashboardPackage[],
  range: DownloadRange,
): number[] {
  const bucketCount = RANGE_BUCKETS[range];
  const skillKeys = skills.map((skill) => skill.slug);
  const pluginKeys = packages.map((pkg) => pkg.name);

  const skillSeries = skillKeys.length > 0 ? buildKindSeries(skillKeys, "skill", bucketCount) : [];
  const pluginSeries =
    pluginKeys.length > 0 ? buildKindSeries(pluginKeys, "plugin", bucketCount) : [];

  if (skillSeries.length > 0 && pluginSeries.length > 0) {
    return addSeries(skillSeries, pluginSeries);
  }
  if (skillSeries.length > 0) return skillSeries;
  if (pluginSeries.length > 0) return pluginSeries;
  return Array.from({ length: bucketCount }, () => 0);
}

export function sumSeries(series: number[]) {
  return series.reduce((sum, value) => sum + value, 0);
}

export function formatRangeTotal(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString();
}

export function rangeDelta(series: number[]) {
  if (series.length < 2) return 0;
  const mid = Math.floor(series.length / 2);
  const recent = sumSeries(series.slice(mid));
  const prior = sumSeries(series.slice(0, mid));
  if (prior <= 0) return recent > 0 ? 100 : 0;
  return Math.round(((recent - prior) / prior) * 100);
}

export function rangeLabels(range: DownloadRange): string[] {
  if (range === "1d") {
    return Array.from({ length: 24 }, (_, hour) => {
      const h = hour % 12 || 12;
      const meridiem = hour < 12 ? "AM" : "PM";
      return hour % 6 === 0 ? `${h} ${meridiem}` : "";
    });
  }
  if (range === "1w") {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
  if (range === "1m") {
    return Array.from({ length: 30 }, (_, index) => (index % 7 === 0 ? `${index + 1}` : ""));
  }
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date();
    month.setMonth(month.getMonth() - (11 - index));
    return month.toLocaleString("en-US", { month: "short" });
  });
}
