import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TREND_DAYS,
  buildDailyActivityTrends,
  buildDailyMetricTrends,
} from "./downloadTrend";

describe("download trend helpers", () => {
  it("fills missing days and totals the daily activity points", () => {
    const trend = buildDailyActivityTrends(
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
    expect(trend.installs.range).toBe("daily");
    expect(trend.installs.days).toBe(ACTIVITY_TREND_DAYS);
    expect(trend.installs.total).toBe(5);
    expect(trend.installs.points).toHaveLength(ACTIVITY_TREND_DAYS);
    expect(trend.installs.points[0]).toEqual({ day: -4, value: 0 });
    expect(trend.installs.points.at(-1)).toEqual({ day: 25, value: 0 });
    expect(trend.installs.points.find((point) => point.day === 20)).toEqual({
      day: 20,
      value: 1,
    });
    expect(trend.installs.points.find((point) => point.day === 22)).toEqual({
      day: 22,
      value: 4,
    });
  });

  it("shows zero 30-day activity when no daily rows exist", () => {
    const trend = buildDailyActivityTrends([], 25);

    expect(trend.downloads.total).toBe(0);
    expect(trend.downloads.points).toHaveLength(ACTIVITY_TREND_DAYS);
    expect(trend.downloads.points[0]?.day).toBe(-4);
    expect(trend.downloads.points.at(-1)?.day).toBe(25);
    expect(trend.downloads.points.every((point) => point.value === 0)).toBe(true);
    expect(trend.installs.total).toBe(0);
    expect(trend.installs.points).toHaveLength(ACTIVITY_TREND_DAYS);
    expect(trend.installs.points.every((point) => point.value === 0)).toBe(true);
  });

  it("keeps the public metric trend contract downloads-only", () => {
    const trend = buildDailyMetricTrends([{ day: 25, downloads: 2, installs: 1 }], 25);

    expect(trend.downloads.total).toBe(2);
    expect("installs" in trend).toBe(false);
  });
});
