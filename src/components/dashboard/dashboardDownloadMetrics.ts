import type { DashboardPackage, DashboardSkill } from "./types";

export type DownloadRange = "1w" | "1m" | "all";

export type DashboardDownloadMetricPoint = { day: number; value: number };

export type DashboardDownloadMetrics = {
  endDay: number;
  allTimeDownloads: number;
  skills: {
    allTimeDownloads: number;
    points: DashboardDownloadMetricPoint[];
  };
  plugins: {
    allTimeDownloads: number;
    points: DashboardDownloadMetricPoint[];
  };
};

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

export function downloadMetricQuerySelection(value: string | undefined) {
  const selection = parseDownloadInsight(value);
  if (selection.scope === "skill") return { kind: "skill" as const, slug: selection.slug };
  if (selection.scope === "plugin") return { kind: "plugin" as const, name: selection.name };
  return undefined;
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

export function metricSeries(points: DashboardDownloadMetricPoint[], range: DownloadRange) {
  const values = points.map((point) => point.value);
  return range === "1w" ? values.slice(-7) : values;
}

export function combineMetricSeries(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, index) => (left[index] ?? 0) + (right[index] ?? 0));
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

const DAY_MS = 86_400_000;

export function rangeLabels(range: DownloadRange, endDay: number): string[] {
  const endDate = new Date(endDay * DAY_MS);
  const formatDate = (date: Date) =>
    date.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  if (range === "1w") {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(endDate);
      date.setDate(endDate.getDate() - (6 - index));
      return formatDate(date);
    });
  }
  if (range === "1m") {
    return Array.from({ length: 30 }, (_, index) => {
      if (index % 7 !== 0 && index !== 29) return "";
      const date = new Date(endDate);
      date.setDate(endDate.getDate() - (29 - index));
      return formatDate(date);
    });
  }
  return Array.from({ length: 30 }, (_, index) => {
    if (index % 7 !== 0 && index !== 29) return "";
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - (29 - index));
    return formatDate(date);
  });
}
