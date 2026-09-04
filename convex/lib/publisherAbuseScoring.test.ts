/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  computeCurrentSkillTemporalAbuseScore,
  computePublisherAbusePressure,
  computePublisherAbuseRawScore,
  computeTemporalAbuseCohortBenchmark,
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  labelForPublisherAbuseScore,
  labelForPublisherAbuseZScore,
  isPublisherSynchronyTemporalCandidate,
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

  it("reserves proportional 7-day spikes for publisher synchrony", () => {
    const todayDay = 100;
    const benchmark = temporalBenchmark({
      downloads30dP95: 500,
      downloads30dP99: 600,
      spikeMultiplier7dP95: 5,
      spikeMultiplier7dP99: 20,
      excess7DownloadsP95: 1_000,
      excess7DownloadsP99: 2_000,
    });
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay,
      benchmark,
      dailyStats: [
        ...dailyRange(64, 30, { downloads: 5, installs: 0 }),
        ...dailyRange(94, 7, { downloads: 400, installs: 0 }),
      ],
    });

    expect(score.spike).toBe(false);
    expect(score.sustained).toBe(false);
    expect(score.recent7Downloads).toBe(2_800);
    expect(score.recent7Installs).toBe(0);
    expect(score.previous30Downloads).toBe(150);
    expect(score.spikeMultiplier).toBeCloseTo(28);
    expect(score.expected7Downloads).toBe(35);
    expect(score.excess7Downloads).toBe(2_765);
    expect(score.spikeMultiplierCohortBand).toBe("p99");
    expect(score.excess7DownloadsCohortBand).toBe("p99");
    expect(score.reasonCodes).not.toContain("temporal_download_spike_flat_installs");
    expect(isPublisherSynchronyTemporalCandidate(score, benchmark)).toBe(true);
  });

  it("flags a standalone spike at 6,400 downloads in seven days", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP99: 600,
        spikeMultiplier7dP99: 1,
        excess7DownloadsP99: 76.5,
      }),
      dailyStats: [
        ...dailyRange(64, 30, { downloads: 1, installs: 0 }),
        ...dailyRange(94, 6, { downloads: 914, installs: 0 }),
        { day: 100, downloads: 916, installs: 0 },
      ],
    });

    expect(score.recent7Downloads).toBe(6_400);
    expect(score.spike).toBe(true);
  });

  it("does not flag a 7-day spike below the proportional extreme-traffic floor", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP99: 636,
        spikeMultiplier7dP99: 1,
        excess7DownloadsP99: 76.5,
      }),
      dailyStats: dailyRange(94, 7, { downloads: 180, installs: 0 }),
    });

    expect(score.recent7Downloads).toBe(1_260);
    expect(score.spikeMultiplierCohortBand).toBe("p99");
    expect(score.excess7DownloadsCohortBand).toBe("p99");
    expect(score.spike).toBe(false);
    expect(score.reasonCodes).not.toContain("temporal_download_spike_flat_installs");
  });

  it("raises the proportional 7-day floor when the platform P99 rises", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP99: 3_000,
        spikeMultiplier7dP99: 1,
        excess7DownloadsP99: 76.5,
      }),
      dailyStats: dailyRange(94, 7, { downloads: 929, installs: 0 }),
    });

    expect(score.recent7Downloads).toBe(6_503);
    expect(score.spikeMultiplierCohortBand).toBe("p99");
    expect(score.excess7DownloadsCohortBand).toBe("p99");
    expect(score.spike).toBe(false);
  });

  it("flags an extreme 7-day download spike regardless of install count", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        spikeMultiplier7dP95: 5,
        spikeMultiplier7dP99: 20,
        excess7DownloadsP95: 1_000,
        excess7DownloadsP99: 2_000,
      }),
      dailyStats: [
        ...dailyRange(64, 30, { downloads: 5, installs: 0 }),
        ...dailyRange(94, 7, { downloads: 10_000, installs: 100 }),
      ],
    });

    expect(score.recent7Downloads).toBe(70_000);
    expect(score.recent7Installs).toBe(700);
    expect(score.nearConversion).toBe(false);
    expect(score.spike).toBe(true);
  });

  it("does not flag a large multiplier without unusually high excess downloads", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        spikeMultiplier7dP95: 3,
        spikeMultiplier7dP99: 5,
        excess7DownloadsP95: 1_000,
        excess7DownloadsP99: 2_000,
      }),
      dailyStats: dailyRange(94, 7, { downloads: 150, installs: 0 }),
    });

    expect(score.spikeMultiplier).toBe(10.5);
    expect(score.excess7Downloads).toBe(1_050);
    expect(score.spikeMultiplierCohortBand).toBe("p99");
    expect(score.excess7DownloadsCohortBand).toBeUndefined();
    expect(score.spike).toBe(false);
  });

  it.each([
    { installs: 5, expectedSustained: true },
    { installs: 6, expectedSustained: false },
  ])(
    "checks sustained traffic with $installs recorded installs",
    ({ installs, expectedSustained }) => {
      const todayDay = 100;
      const score = computeCurrentSkillTemporalAbuseScore({
        todayDay,
        benchmark: temporalBenchmark({
          downloads30dP99: 600,
          spikeMultiplier7dP95: 5,
          excess7DownloadsP95: 500,
        }),
        dailyStats: [
          ...dailyRange(41, 30, { downloads: 5, installs: 0 }),
          ...dailyRange(87, 10, { downloads: 640, installs: 0 }),
          ...dailyRange(97, 4, { downloads: 0, installs: 0 }),
          { day: 100, downloads: 0, installs },
        ],
      });

      expect(score.spike).toBe(false);
      expect(score.sustained).toBe(expectedSustained);
      expect(score.sustainedDaysAboveThreshold).toBe(10);
      expect(score.sustainedWindowDays).toBe(14);
      expect(score.sustainedExpectedDailyDownloads).toBe(5);
      expect(score.sustainedDailyDownloadThreshold).toBeCloseTo(76.43, 2);
      expect(score.downloads30dCohortBand).toBe("p99");
      expect(score.reasonCodes.includes("temporal_sustained_abnormal_download_days")).toBe(
        expectedSustained,
      );
    },
  );

  it.each([
    { burstDay: 80, expectedSpike: false, expectedWindowDownloads: 210 },
    { burstDay: 100, expectedSpike: true, expectedWindowDownloads: 10_210 },
  ])(
    "does not call a burst on day $burstDay followed by modest traffic sustained",
    ({ burstDay, expectedSpike, expectedWindowDownloads }) => {
      const score = computeCurrentSkillTemporalAbuseScore({
        todayDay: 100,
        benchmark: temporalBenchmark({
          downloads30dP99: 600,
          spikeMultiplier7dP95: 1,
          spikeMultiplier7dP99: 1,
          excess7DownloadsP95: 0,
          excess7DownloadsP99: 76.5,
        }),
        dailyStats: [
          ...dailyRange(41, 30, { downloads: 5, installs: 0 }),
          ...dailyRange(87, 14, { downloads: 15, installs: 0 }),
          { day: burstDay, downloads: 10_000, installs: 0 },
        ],
      });

      expect(score.recent30Downloads).toBe(10_210);
      expect(score.sustainedWindowDownloads).toBe(expectedWindowDownloads);
      expect(score.sustainedDaysAboveThreshold).toBe(14);
      expect(score.sustained).toBe(false);
      expect(score.spike).toBe(expectedSpike);
      expect(score.reasonCodes).not.toContain("temporal_sustained_abnormal_download_days");
    },
  );

  it.each([
    {
      downloads30dP99: 600,
      lowerDailyDownloads: 400,
      higherDailyDownloads: 700,
      totalDownloads: 6_800,
    },
    {
      downloads30dP99: 1_000,
      lowerDailyDownloads: 700,
      higherDailyDownloads: 1_000,
      totalDownloads: 11_000,
    },
  ])(
    "keeps uneven but distributed sustained traffic at platform P99 $downloads30dP99",
    ({ downloads30dP99, lowerDailyDownloads, higherDailyDownloads, totalDownloads }) => {
      const score = computeCurrentSkillTemporalAbuseScore({
        todayDay: 100,
        benchmark: temporalBenchmark({ downloads30dP99 }),
        dailyStats: [
          ...dailyRange(87, 10, { downloads: lowerDailyDownloads, installs: 0 }),
          ...dailyRange(97, 4, { downloads: higherDailyDownloads, installs: 0 }),
        ],
      });

      expect(score.recent30Downloads).toBe(totalDownloads);
      expect(score.sustainedWindowDownloads).toBe(totalDownloads);
      expect(score.sustainedDaysAboveThreshold).toBe(14);
      expect(score.sustained).toBe(true);
    },
  );

  it.each([
    {
      downloads30dP99: 1_000,
      dailyDownloads: Array<number>(14).fill(500),
      expectedSustained: false,
    },
    {
      downloads30dP99: 600,
      dailyDownloads: [...Array<number>(9).fill(700), 639],
      expectedSustained: false,
    },
    {
      downloads30dP99: 600,
      dailyDownloads: [...Array<number>(9).fill(700), 640],
      expectedSustained: true,
    },
  ])(
    "enforces the capped, peer-scaled sustained volume boundary in case %#",
    ({ downloads30dP99, dailyDownloads, expectedSustained }) => {
      const score = computeCurrentSkillTemporalAbuseScore({
        todayDay: 100,
        benchmark: temporalBenchmark({ downloads30dP99 }),
        dailyStats: dailyDownloads.map((downloads, index) => ({
          day: 87 + index,
          downloads,
          installs: 0,
        })),
      });

      expect(score.sustainedDaysAboveThreshold).toBeGreaterThanOrEqual(10);
      expect(score.sustained).toBe(expectedSustained);
    },
  );

  it("keeps sustained traffic below the 6,400-download floor below the signal", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP99: 600,
        spikeMultiplier7dP95: 5,
        excess7DownloadsP95: 500,
      }),
      dailyStats: dailyRange(87, 10, { downloads: 639, installs: 0 }),
    });

    expect(score.sustainedDaysAboveThreshold).toBe(10);
    expect(score.recent30Downloads).toBe(6_390);
    expect(score.downloads30dCohortBand).toBeUndefined();
    expect(score.sustained).toBe(false);
  });

  it("does not call nine abnormal days sustained", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        downloads30dP99: 600,
        spikeMultiplier7dP95: 5,
        excess7DownloadsP95: 500,
      }),
      dailyStats: [
        ...dailyRange(41, 30, { downloads: 50, installs: 0 }),
        ...dailyRange(87, 9, { downloads: 1_000, installs: 0 }),
        ...dailyRange(96, 5, { downloads: 200, installs: 0 }),
      ],
    });

    expect(score.sustainedWindowDownloads).toBe(10_000);
    expect(score.sustainedDailyDownloadThreshold).toBe(250);
    expect(score.sustainedDaysAboveThreshold).toBe(9);
    expect(score.sustained).toBe(false);
  });

  it("does not treat an established steady download rate as a new sustained incident", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        spikeMultiplier7dP95: 5,
        excess7DownloadsP95: 500,
      }),
      dailyStats: dailyRange(41, 60, { downloads: 120, installs: 0 }),
    });

    expect(score.sustainedExpectedDailyDownloads).toBe(120);
    expect(score.sustainedDaysAboveThreshold).toBe(0);
    expect(score.sustained).toBe(false);
  });

  it("detects 30 days of constant high traffic after a cold baseline", () => {
    const score = computeCurrentSkillTemporalAbuseScore({
      todayDay: 100,
      benchmark: temporalBenchmark({
        spikeMultiplier7dP95: 5,
        excess7DownloadsP95: 500,
      }),
      dailyStats: [
        ...dailyRange(41, 30, { downloads: 0, installs: 0 }),
        ...dailyRange(71, 30, { downloads: 11_000, installs: 0 }),
      ],
    });

    expect(score.sustainedExpectedDailyDownloads).toBe(0);
    expect(score.sustainedDaysAboveThreshold).toBe(14);
    expect(score.sustained).toBe(true);
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

  it("computes cohort benchmark percentiles from scanned skill windows", () => {
    const benchmark = computeTemporalAbuseCohortBenchmark([
      ...Array.from({ length: 95 }, () => ({
        recent30Downloads: 100,
        spikeMultiplier: 1,
        excess7Downloads: 20,
      })),
      ...Array.from({ length: 4 }, () => ({
        recent30Downloads: 500,
        spikeMultiplier: 2,
        excess7Downloads: 100,
      })),
      { recent30Downloads: 10_000, spikeMultiplier: 30, excess7Downloads: 5_000 },
    ]);

    expect(benchmark.sampleSize).toBe(100);
    expect(benchmark.downloads30dMedian).toBe(100);
    expect(benchmark.downloads30dP95).toBe(100);
    expect(benchmark.downloads30dP99).toBe(500);
    expect(benchmark.spikeMultiplier7dP99).toBe(2);
    expect(benchmark.excess7DownloadsP99).toBe(100);
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
    excess7DownloadsP95: 500,
    excess7DownloadsP99: 2_000,
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
