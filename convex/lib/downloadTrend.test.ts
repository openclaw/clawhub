import { describe, expect, it } from "vitest";
import { ACTIVITY_TREND_DAYS, buildDailyMetricTrends } from "./downloadTrend";

describe("download trend helpers", () => {
  it("fills missing days and totals the daily activity points", () => {
    const trend = buildDailyMetricTrends(
      [
        { day: 20, downloads: 3, installs: 1 },
        { day: 22, downloads: 8, installs: 4 },
        { day: 25, downloads: 2, installs: 0 },
      ],
      25,
    );

    expect(trend.downloads.range).toBe("daily");
    expect(trend.downloads.days).toBe(ACTIVITY_TREND_DAYS);
    expect(trend.downloads.total).toBe(13);
    expect(trend.downloads.points).toHaveLength(ACTIVITY_TREND_DAYS);
    expect(trend.downloads.points[0]).toEqual({ day: -4, value: 0 });
    expect(trend.downloads.points.at(-1)).toEqual({ day: 25, value: 2 });
    expect(trend.downloads.points.find((point) => point.day === 20)).toEqual({
      day: 20,
      value: 3,
    });
    expect(trend.downloads.points.find((point) => point.day === 22)).toEqual({
      day: 22,
      value: 8,
    });
  });

  it("shows zero 30-day activity when no daily rows exist", () => {
    const trend = buildDailyMetricTrends([], 25);

    expect(trend.downloads.total).toBe(0);
    expect(trend.downloads.points).toHaveLength(ACTIVITY_TREND_DAYS);
    expect(trend.downloads.points[0]?.day).toBe(-4);
    expect(trend.downloads.points.at(-1)?.day).toBe(25);
    expect(trend.downloads.points.every((point) => point.value === 0)).toBe(true);
  });
});
