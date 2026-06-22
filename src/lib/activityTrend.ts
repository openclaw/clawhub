import { api } from "../../convex/_generated/api";

export type MetricTrendPoint = {
  day: number;
  value: number;
};

export type MetricTrend = {
  range: "daily";
  days: number;
  total: number;
  points: MetricTrendPoint[];
};

export type ActivityTrend = {
  downloads: MetricTrend;
};

export const getSkillActivityTrendForSlug = api.skills.getActivityTrendForSlug;
export const getPackageActivityTrendForName = api.packages.getActivityTrendForName;

const DAY_MS = 86_400_000;

export function getActivityTrendEndDay(now = Date.now()) {
  return Math.floor(now / DAY_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMetricTrend(value: unknown): value is MetricTrend {
  if (!isRecord(value)) return false;
  if (
    value.range !== "daily" ||
    typeof value.days !== "number" ||
    typeof value.total !== "number"
  ) {
    return false;
  }
  if (!Array.isArray(value.points)) return false;
  return value.points.every(
    (point) => isRecord(point) && typeof point.day === "number" && typeof point.value === "number",
  );
}

export function isActivityTrend(value: unknown): value is ActivityTrend {
  return isRecord(value) && isMetricTrend(value.downloads);
}

export type DownloadTrendPeriod = "all-time" | "30d" | "7d";

export function sliceMetricTrend(trend: MetricTrend, lastDays: number): MetricTrend {
  const safeDays = Math.max(1, Math.min(Math.trunc(lastDays), trend.points.length));
  if (safeDays >= trend.points.length) {
    return trend;
  }
  const points = trend.points.slice(-safeDays);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return { range: "daily", days: points.length, total, points };
}

export function buildDownloadsTrendForPeriod(
  period: DownloadTrendPeriod,
  activityTrend: MetricTrend,
  allTimeDownloads: number,
): MetricTrend {
  switch (period) {
    case "7d":
      return sliceMetricTrend(activityTrend, 7);
    case "30d":
      return activityTrend;
    case "all-time":
      return { ...activityTrend, total: Math.max(0, Math.trunc(allTimeDownloads)) };
    default:
      return activityTrend;
  }
}

export function getDownloadTrendPeriodLabel(period: DownloadTrendPeriod): string {
  switch (period) {
    case "all-time":
      return "All time";
    case "30d":
      return "30 days";
    case "7d":
      return "7 days";
    default:
      return "30 days";
  }
}

export function getDownloadTrendAriaLabel(period: DownloadTrendPeriod): string {
  switch (period) {
    case "all-time":
      return "Recent daily downloads with all-time total";
    case "30d":
      return "Daily downloads over the last 30 days";
    case "7d":
      return "Daily downloads over the last 7 days";
    default:
      return "Daily downloads over the last 30 days";
  }
}
