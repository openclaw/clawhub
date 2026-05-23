/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  labelForPublisherAbuseZScore,
  scorePublisherAbuseCohort,
} from "./publisherAbuseScoring";

describe("publisher abuse scoring", () => {
  it("uses the dry-run z-score thresholds", () => {
    expect(labelForPublisherAbuseZScore(1.49, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe("pass");
    expect(labelForPublisherAbuseZScore(1.5, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe("review");
    expect(labelForPublisherAbuseZScore(2.49, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe("review");
    expect(labelForPublisherAbuseZScore(2.5, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe(
      "potential_ban_candidate",
    );
  });

  it("keeps a high-volume publisher with strong usage below low-engagement publishers", () => {
    const scored = scorePublisherAbuseCohort([
      publisher("byungkyu", {
        publishedSkills: 148,
        totalInstalls: 900,
        totalStars: 45,
        totalDownloads: 120_000,
      }),
      publisher("gora050", {
        publishedSkills: 1_200,
        totalInstalls: 8,
        totalStars: 0,
        totalDownloads: 120,
      }),
      publisher("membranedev", {
        publishedSkills: 850,
        totalInstalls: 5,
        totalStars: 0,
        totalDownloads: 90,
      }),
      publisher("peand-rover", {
        publishedSkills: 340,
        totalInstalls: 4,
        totalStars: 0,
        totalDownloads: 80,
      }),
      publisher("ordinary-one", {
        publishedSkills: 3,
        totalInstalls: 15,
        totalStars: 1,
        totalDownloads: 400,
      }),
      publisher("ordinary-two", {
        publishedSkills: 5,
        totalInstalls: 20,
        totalStars: 2,
        totalDownloads: 600,
      }),
    ]);

    const byHandle = new Map(scored.map((score) => [score.input.handleSnapshot, score]));
    expect(byHandle.get("byungkyu")?.label).toBe("pass");
    expect(byHandle.get("gora050")?.rank).toBeLessThan(byHandle.get("byungkyu")?.rank ?? 0);
    expect(byHandle.get("membranedev")?.rank).toBeLessThan(byHandle.get("byungkyu")?.rank ?? 0);
    expect(byHandle.get("peand-rover")?.rank).toBeLessThan(byHandle.get("byungkyu")?.rank ?? 0);
  });

  it("weights stars ahead of installs and downloads", () => {
    const [withStars, withInstalls, withDownloads] = scorePublisherAbuseCohort([
      publisher("with-stars", {
        publishedSkills: 500,
        totalInstalls: 1_000,
        totalStars: 50,
        totalDownloads: 125_000,
      }),
      publisher("with-installs", {
        publishedSkills: 500,
        totalInstalls: 2_000,
        totalStars: 25,
        totalDownloads: 125_000,
      }),
      publisher("with-downloads", {
        publishedSkills: 500,
        totalInstalls: 1_000,
        totalStars: 25,
        totalDownloads: 250_000,
      }),
    ]).sort((left, right) => left.pressure - right.pressure);

    expect(withStars?.input.handleSnapshot).toBe("with-stars");
    expect(withInstalls?.input.handleSnapshot).toBe("with-installs");
    expect(withDownloads?.input.handleSnapshot).toBe("with-downloads");
  });
});

function publisher(
  handleSnapshot: string,
  stats: {
    publishedSkills: number;
    totalInstalls: number;
    totalStars: number;
    totalDownloads: number;
  },
) {
  return {
    ownerKey: `publisher:${handleSnapshot}`,
    handleSnapshot,
    ownerPublisherId: `publishers:${handleSnapshot}`,
    ...stats,
  };
}
