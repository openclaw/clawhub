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
