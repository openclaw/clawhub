/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  computeCurrentSkillTemporalAbuseScore,
  computeHistoricalSkillTemporalAbuseScore,
  computePublisherAbusePressure,
  computePublisherAbuseRawScore,
  computeTemporalAbuseCohortBenchmark,
  computeTemporalPublisherAbuseZScore,
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  labelForPublisherAbuseScore,
  labelForTemporalPublisherAbuse,
  labelForPublisherAbuseZScore,
  scorePublisherAbuseCohort,
} from "./publisherAbuseScoring";

describe("publisher abuse scoring", () => {
  it("uses the mature catalog pivot for publisher spam abuse checks", () => {
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.modelVersion).toBe("publisher-abuse-pressure.v4");
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.skillPivot).toBe(200);
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.outputElasticity).toBe(1.2);
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.engagementElasticity).toBe(0.25);
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.minPublishedSkillsForAggregateLabel).toBe(200);
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.installTrustElasticity).toBe(1);
    expect(DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG.starTrustElasticity).toBe(1.1);
  });

  it("uses the dry-run z-score thresholds", () => {
    expect(labelForPublisherAbuseZScore(1.49, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe("pass");
    expect(labelForPublisherAbuseZScore(1.5, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe("review");
    expect(labelForPublisherAbuseZScore(2.49, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe("review");
    expect(labelForPublisherAbuseZScore(2.5, DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG)).toBe(
      "potential_ban_candidate",
    );
  });

  it("honors stored minimum published skill floors while labeling score rows", () => {
    const storedConfig = {
      ...DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
      minPublishedSkillsForAggregateLabel: 200,
    };

    expect(labelForPublisherAbuseScore({ publishedSkills: 199 }, 3, storedConfig)).toBe("pass");
    expect(labelForPublisherAbuseScore({ publishedSkills: 200 }, 3, storedConfig)).toBe(
      "potential_ban_candidate",
    );
  });

  it("preserves legacy stored configs without engagement elasticity", () => {
    const legacyConfig = {
      ...DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
      skillPivot: 100,
      engagementElasticity: undefined,
      minPublishedSkillsForAggregateLabel: undefined,
    };

    const pressure = computePublisherAbusePressure(
      {
        publishedSkills: 25,
        totalInstalls: 50,
        totalStars: 1.25,
        totalDownloads: 6_250,
      },
      legacyConfig,
    );

    expect(pressure).toBeCloseTo(0.25);
  });

  it("uses whole-publisher engagement calibration for stored configs that define it", () => {
    const storedConfig = {
      ...DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
      engagementElasticity: 0.25,
    };
    const score200 = computePublisherAbuseRawScore(
      publisher("bulk-200", {
        publishedSkills: 200,
        totalInstalls: 200,
        totalStars: 5,
        totalDownloads: 25_000,
      }),
      storedConfig,
    );
    const score400 = computePublisherAbuseRawScore(
      publisher("bulk-400", {
        publishedSkills: 400,
        totalInstalls: 200,
        totalStars: 5,
        totalDownloads: 25_000,
      }),
      storedConfig,
    );

    expect(score200.pressure).toBeGreaterThan(0);
    expect(score400.pressure / score200.pressure).toBeGreaterThan(2);
  });

  it("maps temporal labels to review-compatible z-scores", () => {
    const review = computeTemporalPublisherAbuseZScore({
      label: "review",
      highTemporalSkillCount: 1,
      maxTemporalPressure: 20,
    });
    const potentialBan = computeTemporalPublisherAbuseZScore({
      label: "potential_ban_candidate",
      highTemporalSkillCount: 2,
      maxTemporalPressure: 20,
    });

    expect(
      computeTemporalPublisherAbuseZScore({
        label: "pass",
        highTemporalSkillCount: 0,
        maxTemporalPressure: 0,
      }),
    ).toBe(0);
    expect(review).toBeGreaterThanOrEqual(1.5);
    expect(review).toBeLessThan(2.5);
    expect(potentialBan).toBeGreaterThanOrEqual(2.5);
    expect(potentialBan).toBeGreaterThan(review);
  });

  it("keeps P99 temporal hits as review-only signals", () => {
    expect(
      labelForTemporalPublisherAbuse({ highTemporalSkillCount: 1, p99TemporalSkillCount: 1 }),
    ).toBe("review");
    expect(
      labelForTemporalPublisherAbuse({ highTemporalSkillCount: 2, p99TemporalSkillCount: 2 }),
    ).toBe("review");
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

  it("keeps high-adoption bulk publishers out of aggregate spam labels", () => {
    const scored = scorePublisherAbuseCohort([
      ...Array.from({ length: 200 }, (_, index) =>
        publisher(`ordinary-${index}`, {
          publishedSkills: 3,
          totalInstalls: 30,
          totalStars: 2,
          totalDownloads: 600,
        }),
      ),
      publisher("ivangdavila-shape", {
        publishedSkills: 955,
        totalInstalls: 84_756,
        totalStars: 4_924,
        totalDownloads: 2_347_109,
      }),
      publisher("harrylabsj-shape", {
        publishedSkills: 600,
        totalInstalls: 7_521,
        totalStars: 17,
        totalDownloads: 201_855,
      }),
      publisher("oomol-shape", {
        publishedSkills: 582,
        totalInstalls: 4_153,
        totalStars: 0,
        totalDownloads: 111_003,
      }),
      publisher("justoneapi-shape", {
        publishedSkills: 224,
        totalInstalls: 3_164,
        totalStars: 0,
        totalDownloads: 83_782,
      }),
      publisher("ai-gaoqian-shape", {
        publishedSkills: 212,
        totalInstalls: 855,
        totalStars: 5,
        totalDownloads: 24_362,
      }),
    ]);

    const byHandle = new Map(scored.map((score) => [score.input.handleSnapshot, score]));
    expect(byHandle.get("ivangdavila-shape")?.label).toBe("pass");
    expect(byHandle.get("harrylabsj-shape")?.label).toBe("pass");
    expect(byHandle.get("oomol-shape")?.label).toBe("potential_ban_candidate");
    expect(byHandle.get("justoneapi-shape")?.label).toBe("review");
    expect(byHandle.get("ai-gaoqian-shape")?.label).toBe("potential_ban_candidate");
  });

  it("keeps below-pivot catalogs out of aggregate spam abuse labels", () => {
    const score199 = computePublisherAbuseRawScore(
      publisher("ordinary-199", {
        publishedSkills: 199,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 50_000,
      }),
    );
    const score200 = computePublisherAbuseRawScore(
      publisher("bulk-200", {
        publishedSkills: 200,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 50_000,
      }),
    );

    expect(score199.pressure).toBeGreaterThan(0);
    expect(score199.logPressure).toBeGreaterThan(0);
    expect(score199.reasonCodes).toEqual([]);
    expect(labelForPublisherAbuseScore(score199, 3)).toBe("pass");
    expect(score200.pressure).toBeGreaterThan(0);
  });

  it("keeps tiny catalogs out of aggregate spam abuse labels", () => {
    const score6 = computePublisherAbuseRawScore(
      publisher("tiny-6", {
        publishedSkills: 6,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 0,
      }),
    );
    const score200 = computePublisherAbuseRawScore(
      publisher("bulk-200", {
        publishedSkills: 200,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 0,
      }),
    );

    expect(score6.pressure).toBeGreaterThan(0);
    expect(score6.reasonCodes).toEqual([]);
    expect(score200.pressure).toBeGreaterThan(0);
  });

  it("does not nominate publishers before the catalog reaches the bulk maturity pivot", () => {
    const belowPivot = computePublisherAbuseRawScore(
      publisher("spacesq-shape", {
        publishedSkills: 62,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 29_906,
      }),
    );
    const abovePivot = computePublisherAbuseRawScore(
      publisher("justoneapi-shape", {
        publishedSkills: 224,
        totalInstalls: 33,
        totalStars: 0,
        totalDownloads: 83_543,
      }),
    );

    expect(labelForPublisherAbuseScore(belowPivot, 3)).toBe("pass");
    expect(labelForPublisherAbuseScore(abovePivot, 3)).toBe("potential_ban_candidate");
  });

  it("preserves legacy configs where the skill pivot was not a label floor", () => {
    const legacyConfig = {
      ...DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
      modelVersion: "publisher-abuse-pressure.v2",
      skillPivot: 100,
      minPublishedSkillsForAggregateLabel: undefined,
    };
    const score99 = computePublisherAbuseRawScore(
      publisher("legacy-99", {
        publishedSkills: 99,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 100,
      }),
      legacyConfig,
    );

    expect(labelForPublisherAbuseScore(score99, 3, legacyConfig)).toBe("potential_ban_candidate");
  });

  it("preserves legacy below-pivot catalog pressure for resumed stored configs", () => {
    const legacyConfig = {
      ...DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
      modelVersion: "publisher-abuse-pressure.v2",
      skillPivot: 100,
      outputElasticity: 1.5,
      engagementElasticity: undefined,
      minPublishedSkillsForAggregateLabel: undefined,
    };

    const pressure = computePublisherAbusePressure(
      {
        publishedSkills: 25,
        totalInstalls: 50,
        totalStars: 1.25,
        totalDownloads: 6_250,
      },
      legacyConfig,
    );

    expect(pressure).toBeCloseTo(0.25);
  });

  it("increases catalog pressure when catalog grows without matching adoption", () => {
    const score200 = computePublisherAbuseRawScore(
      publisher("bulk-200", {
        publishedSkills: 200,
        totalInstalls: 200,
        totalStars: 5,
        totalDownloads: 25_000,
      }),
    );
    const score400 = computePublisherAbuseRawScore(
      publisher("bulk-400", {
        publishedSkills: 400,
        totalInstalls: 200,
        totalStars: 5,
        totalDownloads: 25_000,
      }),
    );

    expect(score200.pressure).toBeGreaterThan(0);
    expect(score400.pressure / score200.pressure).toBeGreaterThan(2);
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

  it("keeps zero-skill publishers out of review nominations", () => {
    const rawScore = computePublisherAbuseRawScore(
      publisher("empty-publisher", {
        publishedSkills: 0,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 0,
      }),
    );
    expect(rawScore.pressure).toBe(0);
    expect(rawScore.reasonCodes).toEqual([]);

    const scored = scorePublisherAbuseCohort([
      ...Array.from({ length: 99 }, (_, index) =>
        publisher(`ordinary-${index}`, {
          publishedSkills: 3,
          totalInstalls: 15,
          totalStars: 1,
          totalDownloads: 600,
        }),
      ),
      publisher("empty-publisher", {
        publishedSkills: 0,
        totalInstalls: 0,
        totalStars: 0,
        totalDownloads: 0,
      }),
    ]);

    expect(scored.find((score) => score.input.handleSnapshot === "empty-publisher")?.label).toBe(
      "pass",
    );
  });

  it("flags a current 7-day download spike with flat installs", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      benchmark: temporalBenchmark({
        downloads30dP95: 2_000,
        downloads30dP99: 5_000,
        spikeMultiplier7dP95: 5,
        spikeMultiplier7dP99: 20,
      }),
      dailyStats: [
        ...dailyRange(64, 30, { downloads: 5, installs: 0 }),
        ...dailyRange(94, 7, { downloads: 400, installs: 0 }),
      ],
    });

    expect(score.spike).toBe(true);
    expect(score.sustained).toBe(false);
    expect(score.recent7Downloads).toBe(2_800);
    expect(score.recent7Installs).toBe(0);
    expect(score.previous30Downloads).toBe(150);
    expect(score.spikeMultiplier).toBeCloseTo(28);
    expect(score.spikeMultiplierCohortBand).toBe("p99");
    expect(score.reasonCodes).toContain("temporal_download_spike_flat_installs");
  });

  it("flags sustained high downloads with flat installs", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      benchmark: temporalBenchmark({
        downloads30dP95: 3_000,
        downloads30dP99: 3_000,
        spikeMultiplier7dP95: 20,
        spikeMultiplier7dP99: 50,
      }),
      dailyStats: dailyRange(71, 30, { downloads: 120, installs: 0 }),
    });

    expect(score.spike).toBe(false);
    expect(score.sustained).toBe(true);
    expect(score.recent30Downloads).toBe(3_600);
    expect(score.recent30Installs).toBe(0);
    expect(score.downloadInstallRatio30).toBe(3_600);
    expect(score.downloads30dCohortBand).toBe("p99");
    expect(score.reasonCodes).toContain("temporal_sustained_downloads_flat_installs");
  });

  it("keeps P95-only sustained download traffic below review thresholds", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP95: 3_000,
        downloads30dP99: 6_000,
      }),
      dailyStats: dailyRange(71, 30, { downloads: 120, installs: 0 }),
    });

    expect(score.recent30Downloads).toBe(3_600);
    expect(score.sustained).toBe(false);
    expect(score.downloads30dCohortBand).toBeUndefined();
  });

  it("keeps sub-3000 P99 download traffic below the absolute review floor", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP95: 1_000,
        downloads30dP99: 2_000,
      }),
      dailyStats: dailyRange(71, 30, { downloads: 90, installs: 0 }),
    });

    expect(score.recent30Downloads).toBe(2_700);
    expect(score.sustained).toBe(false);
    expect(score.downloads30dCohortBand).toBeUndefined();
  });

  it("flags high-volume installs that track downloads too closely", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      dailyStats: dailyRange(94, 7, { downloads: 200, installs: 180 }),
    });

    expect(score.nearConversion).toBe(true);
    expect(score.recent7Downloads).toBe(1_400);
    expect(score.recent7Installs).toBe(1_260);
    expect(score.installDownloadRatio7).toBeCloseTo(0.9);
    expect(score.reasonCodes).toContain("temporal_installs_track_downloads");
  });

  it("flags recent install/download ratios at least twice the observed high end", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      dailyStats: dailyRange(94, 7, { downloads: 100, installs: 10 }),
    });

    expect(score.recent7Downloads).toBe(700);
    expect(score.recent7Installs).toBe(70);
    expect(score.installDownloadRatio7).toBeCloseTo(0.1);
    expect(score.nearConversion).toBe(true);
    expect(score.reasonCodes).toContain("temporal_installs_track_downloads");
  });

  it("keeps low-volume one-to-one install traffic below close-ratio thresholds", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      dailyStats: dailyRange(94, 7, { downloads: 1, installs: 1 }),
    });

    expect(score.nearConversion).toBe(false);
    expect(score.reasonCodes).not.toContain("temporal_installs_track_downloads");
  });

  it("keeps observed high-end install ratios below close-ratio thresholds", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      dailyStats: dailyRange(94, 7, { downloads: 20, installs: 1 }),
    });

    expect(score.recent7Downloads).toBe(140);
    expect(score.recent7Installs).toBe(7);
    expect(score.installDownloadRatio7).toBeCloseTo(0.05);
    expect(score.nearConversion).toBe(false);
    expect(score.reasonCodes).not.toContain("temporal_installs_track_downloads");
  });

  it("requires installs to clear the doubled observed high-end ratio", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      dailyStats: dailyRange(94, 7, { downloads: 300, installs: 15 }),
    });

    expect(score.recent7Downloads).toBe(2_100);
    expect(score.recent7Installs).toBe(105);
    expect(score.installDownloadRatio7).toBeCloseTo(0.05);
    expect(score.installDownloadExcessZScore7).toBeGreaterThan(10);
    expect(score.nearConversion).toBe(false);
    expect(score.reasonCodes).not.toContain("temporal_installs_track_downloads");
  });

  it("reports a 30-day close-ratio window when the 7-day threshold is not met", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      dailyStats: [
        ...dailyRange(71, 23, { downloads: 100, installs: 13 }),
        ...dailyRange(94, 7, { downloads: 100, installs: 3 }),
      ],
    });

    expect(score.nearConversion).toBe(true);
    expect(score.installDownloadRatio7).toBeCloseTo(0.03);
    expect(score.installDownloadRatio30).toBeCloseTo(0.1067, 4);
    expect(score.nearConversionWindowStartDay).toBe(71);
    expect(score.nearConversionWindowEndDay).toBe(100);
  });

  it("keeps ordinary steady download traffic below temporal thresholds", () => {
    const todayDay = 100;
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      benchmark: temporalBenchmark({
        downloads30dP95: 4_000,
        downloads30dP99: 8_000,
        spikeMultiplier7dP95: 20,
        spikeMultiplier7dP99: 50,
      }),
      dailyStats: [
        ...dailyRange(64, 30, { downloads: 80, installs: 1 }),
        ...dailyRange(94, 7, { downloads: 85, installs: 1 }),
      ],
    });

    expect(score.spike).toBe(false);
    expect(score.sustained).toBe(false);
    expect(score.pressure).toBe(0);
    expect(score.reasonCodes).toEqual([]);
  });

  it("finds historical spike and sustained windows for backfill scans", () => {
    const score = computeHistoricalSkillTemporalAbuseScore({
      benchmark: temporalBenchmark({
        downloads30dP95: 3_000,
        downloads30dP99: 10_000,
        spikeMultiplier7dP95: 5,
        spikeMultiplier7dP99: 25,
      }),
      dailyStats: [
        ...dailyRange(10, 30, { downloads: 3, installs: 0 }),
        ...dailyRange(40, 7, { downloads: 400, installs: 0 }),
        ...dailyRange(80, 30, { downloads: 400, installs: 0 }),
      ],
    });

    expect(score.spike).toBe(true);
    expect(score.sustained).toBe(true);
    expect(score.spikeWindowStartDay).toBe(40);
    expect(score.sustainedWindowStartDay).toBe(80);
    expect(score.reasonCodes).toEqual([
      "temporal_download_spike_flat_installs",
      "temporal_sustained_downloads_flat_installs",
    ]);
  });

  it("computes cohort benchmark percentiles from scanned skill windows", () => {
    const benchmark = computeTemporalAbuseCohortBenchmark([
      ...Array.from({ length: 95 }, () => ({ recent30Downloads: 100, spikeMultiplier: 1 })),
      ...Array.from({ length: 4 }, () => ({ recent30Downloads: 500, spikeMultiplier: 2 })),
      { recent30Downloads: 10_000, spikeMultiplier: 30 },
    ]);

    expect(benchmark.sampleSize).toBe(100);
    expect(benchmark.downloads30dMedian).toBe(100);
    expect(benchmark.downloads30dP95).toBe(100);
    expect(benchmark.downloads30dP99).toBe(500);
    expect(benchmark.spikeMultiplier7dP99).toBe(2);
  });
});

function temporalBenchmark(overrides = {}) {
  return {
    sampleSize: 100,
    downloads30dAverage: 500,
    downloads30dMedian: 100,
    downloads30dP95: 1_000,
    downloads30dP99: 5_000,
    spikeMultiplier7dP95: 5,
    spikeMultiplier7dP99: 25,
    ...overrides,
  };
}

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

function dailyRange(
  startDay: number,
  length: number,
  stats: { downloads: number; installs: number },
) {
  return Array.from({ length }, (_, index) => ({
    day: startDay + index,
    downloads: stats.downloads,
    installs: stats.installs,
  }));
}
