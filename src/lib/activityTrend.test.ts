import { describe, expect, it } from "vitest";
import {
  buildDownloadsTrendForPeriod,
  getDownloadTrendPeriod,
  sliceMetricTrend,
  type DownloadTrendPeriod,
  type MetricTrend,
} from "./activityTrend";

const sampleTrend: MetricTrend = {
  range: "daily",
  days: 30,
  total: 60,
  points: Array.from({ length: 30 }, (_, index) => ({
    day: 20_000 + index,
    value: index < 7 ? 1 : 2,
  })),
};

describe("sliceMetricTrend", () => {
  it("returns the last N days and recomputes the total", () => {
    const sliced = sliceMetricTrend(sampleTrend, 7);
    expect(sliced.days).toBe(7);
    expect(sliced.points).toHaveLength(7);
    expect(sliced.total).toBe(14);
    expect(sliced.points[0]?.day).toBe(20_023);
  });
});

describe("buildDownloadsTrendForPeriod", () => {
  it("uses all-time downloads for the all-time tab total", () => {
    const trend = buildDownloadsTrendForPeriod("all-time", sampleTrend, 9_999);
    expect(trend.total).toBe(9_999);
    expect(trend.points).toBe(sampleTrend.points);
  });

  it("keeps the 30-day trend unchanged for the 30d tab", () => {
    const trend = buildDownloadsTrendForPeriod("30d", sampleTrend, 9_999);
    expect(trend).toBe(sampleTrend);
  });

  it("slices to seven days for the 7d tab", () => {
    const trend = buildDownloadsTrendForPeriod("7d", sampleTrend, 9_999);
    expect(trend.days).toBe(7);
    expect(trend.total).toBe(14);
  });

  it.each(["", "unknown", "constructor", "__proto__"])(
    "keeps the 30-day presentation and original trend for unknown period %j",
    (value) => {
      const period = value as DownloadTrendPeriod;
      expect(getDownloadTrendPeriod(period)).toMatchObject({
        periodLabel: "30 days",
        ariaLabel: "Daily downloads over the last 30 days",
      });
      expect(buildDownloadsTrendForPeriod(period, sampleTrend, 9_999)).toBe(sampleTrend);
    },
  );
});
