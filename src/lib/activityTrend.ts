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

export const DOWNLOAD_TREND_PERIODS = [
  {
    id: "all-time",
    label: "All time",
    periodLabel: "All time",
    ariaLabel: "Recent daily downloads with all-time total",
  },
  {
    id: "30d",
    label: "30d",
    periodLabel: "30 days",
    ariaLabel: "Daily downloads over the last 30 days",
  },
  {
    id: "7d",
    label: "7d",
    periodLabel: "7 days",
    ariaLabel: "Daily downloads over the last 7 days",
  },
] as const;

export type DownloadTrendPeriod = (typeof DOWNLOAD_TREND_PERIODS)[number]["id"];

export function getDownloadTrendPeriod(period: DownloadTrendPeriod) {
  return DOWNLOAD_TREND_PERIODS.find((option) => option.id === period) ?? DOWNLOAD_TREND_PERIODS[1];
}

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
