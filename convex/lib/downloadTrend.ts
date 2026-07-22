import { toDayKey } from "./leaderboards";

export const ACTIVITY_TREND_DAYS = 30;
export const ACTIVITY_TREND_DAY_MS = 86_400_000;

type DailyMetricRow = {
  day: number;
  downloads: number;
  installs: number;
};

type MetricTrend = {
  range: "daily";
  days: number;
  total: number;
  points: Array<{ day: number; value: number }>;
};

export type DailyMetricTrends = {
  downloads: MetricTrend;
};

export type DailyActivityTrends = DailyMetricTrends & {
  installs: MetricTrend;
};

export function getActivityTrendRange(now: number) {
  return getActivityTrendRangeForEndDay(toDayKey(now));
}

export function getActivityTrendRangeForEndDay(endDayValue: number) {
  const endDay = Math.trunc(endDayValue);
  const startDay = endDay - (ACTIVITY_TREND_DAYS - 1);
  const startTime = startDay * ACTIVITY_TREND_DAY_MS;
  const endTimeExclusive = (endDay + 1) * ACTIVITY_TREND_DAY_MS;
  return { startDay, endDay, startTime, endTimeExclusive };
}

export function clampActivityTrendEndDay(endDayValue: number, now: number) {
  return Math.min(Math.trunc(endDayValue), toDayKey(now));
}

function buildMetricTrend(
  rows: DailyMetricRow[],
  endDay: number,
  metric: "downloads" | "installs",
): MetricTrend {
  const { startDay } = getActivityTrendRangeForEndDay(endDay);
  const valuesByDay = new Map<number, number>();
  for (const row of rows) {
    valuesByDay.set(row.day, Math.max(0, row[metric]));
  }

  const points = Array.from({ length: ACTIVITY_TREND_DAYS }, (_, index) => {
    const day = startDay + index;
    return {
      day,
      value: valuesByDay.get(day) ?? 0,
    };
  });

  const total = points.reduce((sum, point) => sum + point.value, 0);
  return { range: "daily", days: ACTIVITY_TREND_DAYS, total, points };
}

export function buildDailyMetricTrends(rows: DailyMetricRow[], endDay: number): DailyMetricTrends {
  return {
    downloads: buildMetricTrend(rows, endDay, "downloads"),
  };
}

export function buildDailyActivityTrends(
  rows: DailyMetricRow[],
  endDay: number,
): DailyActivityTrends {
  return {
    ...buildDailyMetricTrends(rows, endDay),
    installs: buildMetricTrend(rows, endDay, "installs"),
  };
}
