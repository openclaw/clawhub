import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeAgo } from "./timeAgo";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0);

function agoByDays(days: number) {
  return timeAgo(NOW - days * DAY);
}

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports sub-minute gaps as just now", () => {
    expect(timeAgo(NOW)).toBe("just now");
    expect(timeAgo(NOW - 59_999)).toBe("just now");
  });

  it("formats minutes and hours", () => {
    expect(timeAgo(NOW - MINUTE)).toBe("1m ago");
    expect(timeAgo(NOW - 59 * MINUTE)).toBe("59m ago");
    expect(timeAgo(NOW - HOUR)).toBe("1h ago");
    expect(timeAgo(NOW - 23 * HOUR)).toBe("23h ago");
  });

  it("formats days and weeks", () => {
    expect(agoByDays(1)).toBe("1d ago");
    expect(agoByDays(6)).toBe("6d ago");
    expect(agoByDays(7)).toBe("1w ago");
    expect(agoByDays(29)).toBe("4w ago");
  });

  it("formats months", () => {
    expect(agoByDays(30)).toBe("1mo ago");
    expect(agoByDays(60)).toBe("2mo ago");
    expect(agoByDays(180)).toBe("6mo ago");
  });

  // Regression: 30-day months divided into a 365-day year yielded "12mo ago"
  // for gaps of 360-364 days. Months must roll over into years at 12.
  it("rolls the last days before a year over into years", () => {
    expect(agoByDays(330)).toBe("11mo ago");
    expect(agoByDays(359)).toBe("11mo ago");
    expect(agoByDays(360)).toBe("1y ago");
    expect(agoByDays(364)).toBe("1y ago");
  });

  it("formats years", () => {
    expect(agoByDays(365)).toBe("1y ago");
    expect(agoByDays(400)).toBe("1y ago");
    expect(agoByDays(730)).toBe("2y ago");
  });
});
