import { describe, expect, it } from "vitest";
import { installsTooltip } from "./installsTooltip";

describe("installsTooltip", () => {
  it("shows both all-time and current counts", () => {
    expect(installsTooltip(120, 30)).toBe(
      "120 unique users installed · 30 currently active",
    );
  });

  it("formats large numbers with compact notation", () => {
    expect(installsTooltip(1_500, 800)).toBe(
      "1.5k unique users installed · 800 currently active",
    );
  });

  it("handles zero current installs", () => {
    expect(installsTooltip(59, 0)).toBe(
      "59 unique users installed · 0 currently active",
    );
  });

  it("handles equal current and all-time", () => {
    expect(installsTooltip(59, 59)).toBe(
      "59 unique users installed · 59 currently active",
    );
  });
});
