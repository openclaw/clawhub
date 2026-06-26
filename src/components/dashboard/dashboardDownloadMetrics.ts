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

/** Visual proxy: weight each artifact's downloads toward its last activity bucket. */
export function buildDownloadSeries(
  skills: DashboardSkill[],
  packages: DashboardPackage[],
  range: DownloadRange,
): number[] {
  const bucketCount = RANGE_BUCKETS[range];
  const buckets = Array.from({ length: bucketCount }, () => 0);
  const now = Date.now();
  const rangeMs =
    range === "1d"
      ? 24 * 60 * 60 * 1000
      : range === "1w"
        ? 7 * 24 * 60 * 60 * 1000
        : range === "1m"
          ? 30 * 24 * 60 * 60 * 1000
          : 90 * 24 * 60 * 60 * 1000;

  const add = (downloads: number, updatedAt: number) => {
    if (downloads <= 0) return;
    const age = Math.max(0, now - updatedAt);
    const ratio = Math.min(1, age / rangeMs);
    const primary = Math.floor((1 - ratio) * (bucketCount - 1));
    buckets[primary] += downloads * 0.62;
    const spill = downloads * 0.38;
    const spread = Math.max(1, Math.floor(bucketCount / 4));
    for (let i = 0; i < spread; i++) {
      buckets[(primary + i) % bucketCount] += spill / spread;
    }
  };

  for (const skill of skills) add(skillDownloads(skill), skill.updatedAt);
  for (const pkg of packages) add(pluginDownloads(pkg), pkg.updatedAt);

  return buckets;
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
