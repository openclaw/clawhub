import { describe, expect, it } from "vitest";
import {
  detectPublisherAbuseOwnerSynchrony,
  PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS,
} from "./publisherAbuseOwnerSynchrony";

function coordinatedCurve(index: number) {
  const dailyDownloads = Array.from(
    { length: PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS },
    (_, day) => {
      const sharedTraffic = day < 20 ? 0 : day < 45 ? (day - 19) * 10 : Math.max(0, 400 - day * 6);
      return Math.round(sharedTraffic * (1 + index * 0.01) + ((day + index) % 3));
    },
  );
  return {
    skillId: `skills:${index}`,
    skillSlug: `skill-${index}`,
    dailyDownloads,
  };
}

describe("publisher owner download synchrony", () => {
  it("detects a large group with nearly identical trends and peaks", () => {
    const result = detectPublisherAbuseOwnerSynchrony(
      Array.from({ length: 23 }, (_, index) => coordinatedCurve(index)),
      122,
    );

    expect(result).not.toBeNull();
    expect(result?.skillIds).toHaveLength(23);
    expect(result?.correlationFloor).toBeGreaterThanOrEqual(0.98);
    expect(result?.catalogCoverage).toBeCloseTo(23 / 122);
    expect((result?.peak7DownloadsMax ?? 0) / (result?.peak7DownloadsMin ?? 1)).toBeLessThanOrEqual(
      1.25,
    );
  });

  it("uses catalogue coverage rather than a fixed skill count", () => {
    const result = detectPublisherAbuseOwnerSynchrony(
      [coordinatedCurve(0), coordinatedCurve(1)],
      2,
    );

    expect(result?.skillIds).toHaveLength(2);
    expect(result?.catalogCoverage).toBe(1);
  });

  it("compares only complete seven-day peak windows", () => {
    const curves = [150, 200].map((firstDay, index) => ({
      skillId: `skills:boundary-${index}`,
      skillSlug: `boundary-${index}`,
      dailyDownloads: [firstDay, ...Array(6).fill(0), ...Array(53).fill(116)],
    }));

    const result = detectPublisherAbuseOwnerSynchrony(curves, 2);

    expect(result?.skillIds).toHaveLength(2);
    expect(result?.peak7DownloadsMin).toBe(116);
    expect(result?.peak7DownloadsMax).toBe(116);
  });

  it("rejects a synchronized group that covers too little of the catalogue", () => {
    expect(
      detectPublisherAbuseOwnerSynchrony(
        Array.from({ length: 5 }, (_, index) => coordinatedCurve(index)),
        100,
      ),
    ).toBeNull();
  });

  it("does not count one unmatched skill as a synchronized group", () => {
    const unrelated = {
      skillId: "skills:unrelated",
      skillSlug: "unrelated",
      dailyDownloads: Array.from(
        { length: PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS },
        (_, day) => (day % 4 === 0 ? 500 : 0),
      ),
    };

    expect(detectPublisherAbuseOwnerSynchrony([coordinatedCurve(0), unrelated], 2)).toBeNull();
  });

  it("keeps a coordinated group when the publisher also has an unrelated outlier", () => {
    const outlier = {
      skillId: "skills:outlier",
      skillSlug: "outlier",
      dailyDownloads: Array.from(
        { length: PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS },
        (_, day) => (day % 4 === 0 ? 500 : 0),
      ),
    };
    const result = detectPublisherAbuseOwnerSynchrony(
      [...Array.from({ length: 6 }, (_, index) => coordinatedCurve(index)), outlier],
      7,
    );

    expect(result?.skillIds).toHaveLength(6);
    expect(result?.skillIds).not.toContain("skills:outlier");
  });

  it("excludes a correlated skill whose absolute peak is much larger", () => {
    const curves = Array.from({ length: 5 }, (_, index) => coordinatedCurve(index));
    curves[4] = {
      ...curves[4],
      dailyDownloads: curves[4].dailyDownloads.map((value) => value * 10),
    };

    const result = detectPublisherAbuseOwnerSynchrony(curves, 5);

    expect(result?.skillIds).toHaveLength(4);
    expect(result?.skillIds).not.toContain("skills:4");
  });

  it("requires one similar-peak group to contain a strict majority", () => {
    const base = coordinatedCurve(0).dailyDownloads;
    const curves = [1, 1, 10, 10].map((scale, index) => ({
      skillId: `skills:split-${index}`,
      skillSlug: `split-${index}`,
      dailyDownloads: base.map((value) => value * scale),
    }));

    expect(detectPublisherAbuseOwnerSynchrony(curves, 4)).toBeNull();
  });

  it("does not treat flat traffic as a synchronized trend", () => {
    const flatCurve = (index: number) => ({
      skillId: `skills:flat-${index}`,
      skillSlug: `flat-${index}`,
      dailyDownloads: Array(60).fill(100),
    });

    expect(detectPublisherAbuseOwnerSynchrony([flatCurve(0), flatCurve(1)], 2)).toBeNull();
  });
});
