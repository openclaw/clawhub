export const PUBLISHER_ABUSE_MODEL_VERSION = "publisher-abuse-pressure.v1";
export const PUBLISHER_TEMPORAL_ABUSE_MODEL_VERSION = "publisher-abuse-temporal.v1";

export type PublisherAbuseLabel = "pass" | "review" | "potential_ban_candidate";

export type PublisherAbuseModelConfig = {
  modelVersion: string;
  skillPivot: number;
  installsPerSkillPivot: number;
  starsPerSkillPivot: number;
  downloadsPerSkillPivot: number;
  outputElasticity: number;
  installTrustElasticity: number;
  starTrustElasticity: number;
  downloadDemandElasticity: number;
  minInstallsPerSkill: number;
  minStarsPerSkill: number;
  minDownloadsPerSkill: number;
  reviewZThreshold: number;
  potentialBanCandidateZThreshold: number;
};

export type PublisherAbuseInput = {
  ownerKey: string;
  ownerPublisherId?: string;
  ownerUserId?: string;
  handleSnapshot: string;
  publishedSkills: number;
  totalInstalls: number;
  totalStars: number;
  totalDownloads: number;
};

export type PublisherAbuseRawScore = {
  input: PublisherAbuseInput;
  pressure: number;
  logPressure: number;
  publishedSkills: number;
  totalInstalls: number;
  totalStars: number;
  totalDownloads: number;
  installsPerSkill: number;
  starsPerSkill: number;
  downloadsPerSkill: number;
  reasonCodes: string[];
};

export type PublisherAbuseScore = PublisherAbuseRawScore & {
  label: PublisherAbuseLabel;
  rank: number;
  zScore: number;
};

export type SkillTemporalAbuseDailyStat = {
  day: number;
  downloads: number;
  installs: number;
};

export type SkillTemporalAbuseScore = {
  spike: boolean;
  sustained: boolean;
  nearConversion: boolean;
  pressure: number;
  recent7Downloads: number;
  recent7Installs: number;
  previous30Downloads: number;
  baseline7Downloads: number;
  spikeMultiplier: number;
  recent30Downloads: number;
  recent30Installs: number;
  downloadInstallRatio30: number;
  downloads30dCohortBand?: "p95" | "p99";
  spikeMultiplierCohortBand?: "p95" | "p99";
  downloads30dVsPeerP95?: number;
  spikeMultiplierVsPeerP95?: number;
  installDownloadRatio7: number;
  installDownloadRatio30: number;
  installDownloadExcessZScore7: number;
  installDownloadExcessZScore30: number;
  spikeWindowStartDay?: number;
  spikeWindowEndDay?: number;
  sustainedWindowStartDay?: number;
  sustainedWindowEndDay?: number;
  nearConversionWindowStartDay?: number;
  nearConversionWindowEndDay?: number;
  reasonCodes: string[];
};

export type TemporalAbuseCohortBenchmark = {
  sampleSize: number;
  downloads30dAverage: number;
  downloads30dMedian: number;
  downloads30dP95: number;
  downloads30dP99: number;
  spikeMultiplier7dP95: number;
  spikeMultiplier7dP99: number;
};

export const DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG = {
  modelVersion: PUBLISHER_ABUSE_MODEL_VERSION,
  skillPivot: 100,
  // Two installs per skill is only a rough review calibration point. It can be
  // the author plus one friend, so it is not proof of legitimacy or abuse.
  installsPerSkillPivot: 2,
  starsPerSkillPivot: 0.05,
  downloadsPerSkillPivot: 250,
  outputElasticity: 1,
  installTrustElasticity: 0.8,
  starTrustElasticity: 1,
  downloadDemandElasticity: 0.2,
  minInstallsPerSkill: 0.05,
  minStarsPerSkill: 0.02,
  minDownloadsPerSkill: 1,
  reviewZThreshold: 1.5,
  potentialBanCandidateZThreshold: 2.5,
} satisfies PublisherAbuseModelConfig;

const MIN_PRESSURE_FOR_LOG = 1e-9;
const TEMPORAL_SPIKE_RECENT_DAYS = 7;
const TEMPORAL_SPIKE_BASELINE_DAYS = 30;
const TEMPORAL_SUSTAINED_DAYS = 30;
const TEMPORAL_MAX_SPIKE_INSTALLS = 2;
const TEMPORAL_MAX_SUSTAINED_INSTALLS = 5;
const TEMPORAL_MIN_BASELINE_7_DOWNLOADS = 100;
const TEMPORAL_MIN_NEAR_CONVERSION_7_DOWNLOADS = 1_000;
const TEMPORAL_MIN_NEAR_CONVERSION_30_DOWNLOADS = 2_000;
const TEMPORAL_MIN_NEAR_CONVERSION_INSTALLS = 500;
const TEMPORAL_EXPECTED_INSTALL_DOWNLOAD_RATIO = 0.012;
const TEMPORAL_MIN_INSTALL_DOWNLOAD_RATIO = 0.5;
const TEMPORAL_MIN_INSTALL_DOWNLOAD_EXCESS_Z_SCORE = 50;

export function labelForPublisherAbuseZScore(
  zScore: number,
  config: PublisherAbuseModelConfig = DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
): PublisherAbuseLabel {
  if (zScore >= config.potentialBanCandidateZThreshold) return "potential_ban_candidate";
  if (zScore >= config.reviewZThreshold) return "review";
  return "pass";
}

export function computeTemporalPublisherAbuseZScore(input: {
  label: PublisherAbuseLabel;
  highTemporalSkillCount: number;
  maxTemporalPressure: number;
}): number {
  if (input.label === "pass") return 0;

  const pressureBoost = Math.log10(Math.max(input.maxTemporalPressure, 1) + 1) / 2;
  const skillCountBoost = Math.max(0, input.highTemporalSkillCount - 2) * 0.2;
  if (input.label === "potential_ban_candidate") {
    return 2.5 + Math.min(2, pressureBoost + skillCountBoost);
  }
  return 1.5 + Math.min(0.99, pressureBoost);
}

export function computePublisherAbuseRawScore(
  input: PublisherAbuseInput,
  config: PublisherAbuseModelConfig = DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
): PublisherAbuseRawScore {
  const publishedSkills = nonNegative(input.publishedSkills);
  const totalInstalls = nonNegative(input.totalInstalls);
  const totalStars = nonNegative(input.totalStars);
  const totalDownloads = nonNegative(input.totalDownloads);
  const skillDivisor = Math.max(1, publishedSkills);
  const installsPerSkill = totalInstalls / skillDivisor;
  const starsPerSkill = totalStars / skillDivisor;
  const downloadsPerSkill = totalDownloads / skillDivisor;
  const pressure = computePublisherAbusePressure(
    {
      publishedSkills,
      installsPerSkill,
      starsPerSkill,
      downloadsPerSkill,
    },
    config,
  );

  return {
    input,
    pressure,
    logPressure: Math.log10(Math.max(pressure, MIN_PRESSURE_FOR_LOG)),
    publishedSkills,
    totalInstalls,
    totalStars,
    totalDownloads,
    installsPerSkill,
    starsPerSkill,
    downloadsPerSkill,
    reasonCodes: reasonCodesForPublisher({
      publishedSkills,
      installsPerSkill,
      starsPerSkill,
      downloadsPerSkill,
      config,
    }),
  };
}

export function computePublisherAbusePressure(
  input: {
    publishedSkills: number;
    installsPerSkill: number;
    starsPerSkill: number;
    downloadsPerSkill: number;
  },
  config: PublisherAbuseModelConfig = DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
): number {
  if (input.publishedSkills <= 0) return 0;
  const skills = Math.max(1, input.publishedSkills);
  const skillPivot = Math.max(1, config.skillPivot);
  const installsPerSkill = Math.max(config.minInstallsPerSkill, input.installsPerSkill);
  const installsPerSkillPivot = Math.max(config.minInstallsPerSkill, config.installsPerSkillPivot);
  const starsPerSkill = Math.max(config.minStarsPerSkill, input.starsPerSkill);
  const starsPerSkillPivot = Math.max(config.minStarsPerSkill, config.starsPerSkillPivot);
  const downloadsPerSkill = Math.max(config.minDownloadsPerSkill, input.downloadsPerSkill);
  const downloadsPerSkillPivot = Math.max(
    config.minDownloadsPerSkill,
    config.downloadsPerSkillPivot,
  );

  return (
    (skills / skillPivot) ** config.outputElasticity *
    (installsPerSkillPivot / installsPerSkill) ** config.installTrustElasticity *
    (starsPerSkillPivot / starsPerSkill) ** config.starTrustElasticity *
    (downloadsPerSkillPivot / downloadsPerSkill) ** config.downloadDemandElasticity
  );
}

export function scorePublisherAbuseCohort(
  inputs: PublisherAbuseInput[],
  config: PublisherAbuseModelConfig = DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
): PublisherAbuseScore[] {
  const rawScores = inputs.map((input) => computePublisherAbuseRawScore(input, config));
  const mean = average(rawScores.map((score) => score.logPressure));
  const stdDev = standardDeviation(
    rawScores.map((score) => score.logPressure),
    mean,
  );
  const safeStdDev = stdDev === 0 ? 1 : stdDev;

  return rawScores
    .map((score) => {
      const zScore = (score.logPressure - mean) / safeStdDev;
      return {
        ...score,
        zScore,
        label: labelForPublisherAbuseZScore(zScore, config),
        rank: 0,
      };
    })
    .sort(comparePublisherAbuseScores)
    .map((score, index) => ({ ...score, rank: index + 1 }));
}

export function comparePublisherAbuseScores(
  left: Pick<PublisherAbuseScore, "pressure" | "publishedSkills" | "input">,
  right: Pick<PublisherAbuseScore, "pressure" | "publishedSkills" | "input">,
) {
  return (
    right.pressure - left.pressure ||
    right.publishedSkills - left.publishedSkills ||
    left.input.handleSnapshot.localeCompare(right.input.handleSnapshot)
  );
}

export function summarizePublisherAbuseLogPressure(
  sumLogPressure: number,
  sumSquaredLogPressure: number,
  count: number,
) {
  if (count <= 0) return { meanLogPressure: 0, stdDevLogPressure: 0 };
  const meanLogPressure = sumLogPressure / count;
  const variance = Math.max(0, sumSquaredLogPressure / count - meanLogPressure ** 2);
  return {
    meanLogPressure,
    stdDevLogPressure: Math.sqrt(variance),
  };
}

export function computeCurrentSkillTemporalAbuseScore(input: {
  todayDay: number;
  dailyStats: SkillTemporalAbuseDailyStat[];
  benchmark?: TemporalAbuseCohortBenchmark;
}): SkillTemporalAbuseScore {
  const statsByDay = aggregateSkillTemporalDailyStats(input.dailyStats);
  const score = computeSkillTemporalAbuseScoreForWindows({
    statsByDay,
    spikeStartDay: input.todayDay - TEMPORAL_SPIKE_RECENT_DAYS + 1,
    sustainedStartDay: input.todayDay - TEMPORAL_SUSTAINED_DAYS + 1,
  });
  return classifySkillTemporalAbuseScore(score, input.benchmark);
}

export function computeHistoricalSkillTemporalAbuseScore(input: {
  dailyStats: SkillTemporalAbuseDailyStat[];
  benchmark?: TemporalAbuseCohortBenchmark;
}): SkillTemporalAbuseScore {
  const statsByDay = aggregateSkillTemporalDailyStats(input.dailyStats);
  const days = [...statsByDay.keys()];
  if (days.length === 0) return emptySkillTemporalAbuseScore();

  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  let bestSpike = emptySkillTemporalAbuseScore();
  let bestSustained = emptySkillTemporalAbuseScore();
  let bestNearConversion = emptySkillTemporalAbuseScore();

  for (let startDay = minDay; startDay <= maxDay; startDay += 1) {
    if (startDay + TEMPORAL_SPIKE_RECENT_DAYS - 1 <= maxDay) {
      const score = classifySkillTemporalAbuseScore(
        computeSkillTemporalAbuseScoreForWindows({
          statsByDay,
          spikeStartDay: startDay,
          sustainedStartDay: startDay,
        }),
        input.benchmark,
      );
      if (score.spike && score.spikeMultiplier > bestSpike.spikeMultiplier) {
        bestSpike = score;
      }
      if (
        score.nearConversion &&
        score.nearConversionWindowEndDay === startDay + TEMPORAL_SPIKE_RECENT_DAYS - 1 &&
        score.installDownloadRatio7 > bestNearConversion.installDownloadRatio7
      ) {
        bestNearConversion = score;
      }
    }

    if (startDay + TEMPORAL_SUSTAINED_DAYS - 1 <= maxDay) {
      const score = classifySkillTemporalAbuseScore(
        computeSkillTemporalAbuseScoreForWindows({
          statsByDay,
          spikeStartDay: startDay,
          sustainedStartDay: startDay,
        }),
        input.benchmark,
      );
      if (score.sustained && score.recent30Downloads > bestSustained.recent30Downloads) {
        bestSustained = score;
      }
      if (
        score.nearConversion &&
        score.nearConversionWindowEndDay === startDay + TEMPORAL_SUSTAINED_DAYS - 1 &&
        score.installDownloadRatio30 > bestNearConversion.installDownloadRatio30
      ) {
        bestNearConversion = score;
      }
    }
  }

  return mergeTemporalAbuseWindowScores(bestSpike, bestSustained, bestNearConversion);
}

export function labelForTemporalPublisherAbuse(input: {
  highTemporalSkillCount: number;
  p99TemporalSkillCount?: number;
}): PublisherAbuseLabel {
  if ((input.p99TemporalSkillCount ?? 0) >= 1 || input.highTemporalSkillCount >= 2) {
    return "potential_ban_candidate";
  }
  if (input.highTemporalSkillCount >= 1) return "review";
  return "pass";
}

export function computeTemporalAbuseCohortBenchmark(
  scores: Pick<SkillTemporalAbuseScore, "recent30Downloads" | "spikeMultiplier">[],
): TemporalAbuseCohortBenchmark {
  const downloads30d = scores.map((score) => nonNegative(score.recent30Downloads));
  const spikeMultipliers = scores.map((score) => nonNegative(score.spikeMultiplier));
  return {
    sampleSize: scores.length,
    downloads30dAverage: average(downloads30d),
    downloads30dMedian: percentile(downloads30d, 0.5),
    downloads30dP95: percentile(downloads30d, 0.95),
    downloads30dP99: percentile(downloads30d, 0.99),
    spikeMultiplier7dP95: percentile(spikeMultipliers, 0.95),
    spikeMultiplier7dP99: percentile(spikeMultipliers, 0.99),
  };
}

export function classifySkillTemporalAbuseScore(
  score: SkillTemporalAbuseScore,
  benchmark: TemporalAbuseCohortBenchmark | undefined,
): SkillTemporalAbuseScore {
  if (!benchmark || benchmark.sampleSize <= 0) return score;

  const downloads30dVsPeerP95 = score.recent30Downloads / Math.max(1, benchmark.downloads30dP95);
  const spikeMultiplierVsPeerP95 =
    score.spikeMultiplier / Math.max(1, benchmark.spikeMultiplier7dP95);
  const downloads30dCohortBand =
    score.recent30Installs <= TEMPORAL_MAX_SUSTAINED_INSTALLS
      ? percentileBand({
          value: score.recent30Downloads,
          p95: benchmark.downloads30dP95,
          p99: benchmark.downloads30dP99,
        })
      : undefined;
  const spikeMultiplierCohortBand =
    score.recent7Installs <= TEMPORAL_MAX_SPIKE_INSTALLS && score.recent7Downloads > 0
      ? percentileBand({
          value: score.spikeMultiplier,
          p95: benchmark.spikeMultiplier7dP95,
          p99: benchmark.spikeMultiplier7dP99,
        })
      : undefined;
  const spike = Boolean(spikeMultiplierCohortBand);
  const sustained = Boolean(downloads30dCohortBand);
  const nearConversion = score.nearConversion;
  const nearConversionPressure = nearConversion
    ? Math.max(score.installDownloadExcessZScore7, score.installDownloadExcessZScore30)
    : 0;
  const reasonCodes: string[] = [];
  if (spike) reasonCodes.push("temporal_download_spike_flat_installs");
  if (sustained) reasonCodes.push("temporal_sustained_downloads_flat_installs");
  if (nearConversion) reasonCodes.push("temporal_installs_track_downloads");

  return {
    ...score,
    spike,
    sustained,
    nearConversion,
    pressure: Math.max(
      spike ? spikeMultiplierVsPeerP95 : 0,
      sustained ? downloads30dVsPeerP95 : 0,
      nearConversionPressure,
    ),
    downloads30dCohortBand,
    spikeMultiplierCohortBand,
    downloads30dVsPeerP95,
    spikeMultiplierVsPeerP95,
    spikeWindowStartDay: spike ? score.spikeWindowStartDay : undefined,
    spikeWindowEndDay: spike ? score.spikeWindowEndDay : undefined,
    sustainedWindowStartDay: sustained ? score.sustainedWindowStartDay : undefined,
    sustainedWindowEndDay: sustained ? score.sustainedWindowEndDay : undefined,
    nearConversionWindowStartDay: nearConversion ? score.nearConversionWindowStartDay : undefined,
    nearConversionWindowEndDay: nearConversion ? score.nearConversionWindowEndDay : undefined,
    reasonCodes,
  };
}

function reasonCodesForPublisher(input: {
  publishedSkills: number;
  installsPerSkill: number;
  starsPerSkill: number;
  downloadsPerSkill: number;
  config: PublisherAbuseModelConfig;
}) {
  const codes: string[] = [];
  if (input.publishedSkills <= 0) return codes;
  if (input.publishedSkills >= input.config.skillPivot) codes.push("high_catalog_volume");
  if (input.installsPerSkill < input.config.installsPerSkillPivot) {
    codes.push("low_installs_per_skill");
  }
  if (input.starsPerSkill < input.config.starsPerSkillPivot) {
    codes.push("low_stars_per_skill");
  }
  if (input.downloadsPerSkill < input.config.downloadsPerSkillPivot) {
    codes.push("low_downloads_per_skill");
  }
  if (input.publishedSkills >= 1000 && input.installsPerSkill < 0.1 && input.starsPerSkill < 0.02) {
    codes.push("extreme_volume_low_engagement");
  }
  return codes;
}

function computeSkillTemporalAbuseScoreForWindows(input: {
  statsByDay: Map<number, { downloads: number; installs: number }>;
  spikeStartDay: number;
  sustainedStartDay: number;
}): SkillTemporalAbuseScore {
  const spikeEndDay = input.spikeStartDay + TEMPORAL_SPIKE_RECENT_DAYS - 1;
  const sustainedEndDay = input.sustainedStartDay + TEMPORAL_SUSTAINED_DAYS - 1;
  const recent7 = sumTemporalStatsRange(input.statsByDay, input.spikeStartDay, spikeEndDay);
  const previous30 = sumTemporalStatsRange(
    input.statsByDay,
    input.spikeStartDay - TEMPORAL_SPIKE_BASELINE_DAYS,
    input.spikeStartDay - 1,
  );
  const recent30 = sumTemporalStatsRange(
    input.statsByDay,
    input.sustainedStartDay,
    sustainedEndDay,
  );
  const baseline7Downloads = Math.max(
    TEMPORAL_MIN_BASELINE_7_DOWNLOADS,
    (previous30.downloads / TEMPORAL_SPIKE_BASELINE_DAYS) * TEMPORAL_SPIKE_RECENT_DAYS,
  );
  const spikeMultiplier = baseline7Downloads > 0 ? recent7.downloads / baseline7Downloads : 0;
  const downloadInstallRatio30 = recent30.downloads / Math.max(1, recent30.installs);
  const installDownloadRatio7 = recent7.installs / Math.max(1, recent7.downloads);
  const installDownloadRatio30 = recent30.installs / Math.max(1, recent30.downloads);
  const installDownloadExcessZScore7 = installDownloadExcessZScore({
    downloads: recent7.downloads,
    installs: recent7.installs,
  });
  const installDownloadExcessZScore30 = installDownloadExcessZScore({
    downloads: recent30.downloads,
    installs: recent30.installs,
  });
  const nearConversion7 =
    recent7.downloads >= TEMPORAL_MIN_NEAR_CONVERSION_7_DOWNLOADS &&
    recent7.installs >= TEMPORAL_MIN_NEAR_CONVERSION_INSTALLS &&
    installDownloadRatio7 >= TEMPORAL_MIN_INSTALL_DOWNLOAD_RATIO &&
    installDownloadExcessZScore7 >= TEMPORAL_MIN_INSTALL_DOWNLOAD_EXCESS_Z_SCORE;
  const nearConversion30 =
    recent30.downloads >= TEMPORAL_MIN_NEAR_CONVERSION_30_DOWNLOADS &&
    recent30.installs >= TEMPORAL_MIN_NEAR_CONVERSION_INSTALLS &&
    installDownloadRatio30 >= TEMPORAL_MIN_INSTALL_DOWNLOAD_RATIO &&
    installDownloadExcessZScore30 >= TEMPORAL_MIN_INSTALL_DOWNLOAD_EXCESS_Z_SCORE;
  const nearConversion = nearConversion7 || nearConversion30;
  const reasonCodes: string[] = [];
  if (nearConversion) reasonCodes.push("temporal_installs_track_downloads");

  return {
    spike: false,
    sustained: false,
    nearConversion,
    pressure: nearConversion
      ? Math.max(installDownloadExcessZScore7, installDownloadExcessZScore30)
      : 0,
    recent7Downloads: recent7.downloads,
    recent7Installs: recent7.installs,
    previous30Downloads: previous30.downloads,
    baseline7Downloads,
    spikeMultiplier,
    recent30Downloads: recent30.downloads,
    recent30Installs: recent30.installs,
    downloadInstallRatio30,
    installDownloadRatio7,
    installDownloadRatio30,
    installDownloadExcessZScore7,
    installDownloadExcessZScore30,
    spikeWindowStartDay: input.spikeStartDay,
    spikeWindowEndDay: spikeEndDay,
    sustainedWindowStartDay: input.sustainedStartDay,
    sustainedWindowEndDay: sustainedEndDay,
    nearConversionWindowStartDay: nearConversion7
      ? input.spikeStartDay
      : nearConversion30
        ? input.sustainedStartDay
        : undefined,
    nearConversionWindowEndDay: nearConversion7
      ? spikeEndDay
      : nearConversion30
        ? sustainedEndDay
        : undefined,
    reasonCodes,
  };
}

function mergeTemporalAbuseWindowScores(
  bestSpike: SkillTemporalAbuseScore,
  bestSustained: SkillTemporalAbuseScore,
  bestNearConversion: SkillTemporalAbuseScore,
): SkillTemporalAbuseScore {
  if (!bestSpike.spike && !bestSustained.sustained && !bestNearConversion.nearConversion) {
    return emptySkillTemporalAbuseScore();
  }
  const reasonCodes: string[] = [];
  if (bestSpike.spike) reasonCodes.push("temporal_download_spike_flat_installs");
  if (bestSustained.sustained) reasonCodes.push("temporal_sustained_downloads_flat_installs");
  if (bestNearConversion.nearConversion) reasonCodes.push("temporal_installs_track_downloads");

  return {
    spike: bestSpike.spike,
    sustained: bestSustained.sustained,
    nearConversion: bestNearConversion.nearConversion,
    pressure: Math.max(bestSpike.pressure, bestSustained.pressure, bestNearConversion.pressure),
    recent7Downloads: bestSpike.spike
      ? bestSpike.recent7Downloads
      : bestNearConversion.recent7Downloads,
    recent7Installs: bestSpike.spike
      ? bestSpike.recent7Installs
      : bestNearConversion.recent7Installs,
    previous30Downloads: bestSpike.spike
      ? bestSpike.previous30Downloads
      : bestNearConversion.previous30Downloads,
    baseline7Downloads: bestSpike.spike
      ? bestSpike.baseline7Downloads
      : bestNearConversion.baseline7Downloads,
    spikeMultiplier: bestSpike.spike
      ? bestSpike.spikeMultiplier
      : bestNearConversion.spikeMultiplier,
    recent30Downloads: bestSustained.sustained
      ? bestSustained.recent30Downloads
      : bestNearConversion.recent30Downloads,
    recent30Installs: bestSustained.sustained
      ? bestSustained.recent30Installs
      : bestNearConversion.recent30Installs,
    downloadInstallRatio30: bestSustained.sustained
      ? bestSustained.downloadInstallRatio30
      : bestNearConversion.downloadInstallRatio30,
    installDownloadRatio7: bestNearConversion.installDownloadRatio7,
    installDownloadRatio30: bestNearConversion.installDownloadRatio30,
    installDownloadExcessZScore7: bestNearConversion.installDownloadExcessZScore7,
    installDownloadExcessZScore30: bestNearConversion.installDownloadExcessZScore30,
    downloads30dCohortBand: bestSustained.downloads30dCohortBand,
    spikeMultiplierCohortBand: bestSpike.spikeMultiplierCohortBand,
    downloads30dVsPeerP95: bestSustained.downloads30dVsPeerP95,
    spikeMultiplierVsPeerP95: bestSpike.spikeMultiplierVsPeerP95,
    spikeWindowStartDay: bestSpike.spikeWindowStartDay,
    spikeWindowEndDay: bestSpike.spikeWindowEndDay,
    sustainedWindowStartDay: bestSustained.sustainedWindowStartDay,
    sustainedWindowEndDay: bestSustained.sustainedWindowEndDay,
    nearConversionWindowStartDay: bestNearConversion.nearConversionWindowStartDay,
    nearConversionWindowEndDay: bestNearConversion.nearConversionWindowEndDay,
    reasonCodes,
  };
}

function aggregateSkillTemporalDailyStats(dailyStats: SkillTemporalAbuseDailyStat[]) {
  const byDay = new Map<number, { downloads: number; installs: number }>();
  for (const point of dailyStats) {
    if (!Number.isFinite(point.day)) continue;
    const day = Math.trunc(point.day);
    const existing = byDay.get(day) ?? { downloads: 0, installs: 0 };
    existing.downloads += nonNegative(point.downloads);
    existing.installs += nonNegative(point.installs);
    byDay.set(day, existing);
  }
  return byDay;
}

function sumTemporalStatsRange(
  statsByDay: Map<number, { downloads: number; installs: number }>,
  startDay: number,
  endDay: number,
) {
  let downloads = 0;
  let installs = 0;
  for (let day = startDay; day <= endDay; day += 1) {
    const point = statsByDay.get(day);
    if (!point) continue;
    downloads += point.downloads;
    installs += point.installs;
  }
  return { downloads, installs };
}

function emptySkillTemporalAbuseScore(): SkillTemporalAbuseScore {
  return {
    spike: false,
    sustained: false,
    nearConversion: false,
    pressure: 0,
    recent7Downloads: 0,
    recent7Installs: 0,
    previous30Downloads: 0,
    baseline7Downloads: TEMPORAL_MIN_BASELINE_7_DOWNLOADS,
    spikeMultiplier: 0,
    recent30Downloads: 0,
    recent30Installs: 0,
    downloadInstallRatio30: 0,
    installDownloadRatio7: 0,
    installDownloadRatio30: 0,
    installDownloadExcessZScore7: 0,
    installDownloadExcessZScore30: 0,
    reasonCodes: [],
  };
}

function installDownloadExcessZScore(input: { downloads: number; installs: number }) {
  if (input.downloads <= 0) return 0;
  const expected = input.downloads * TEMPORAL_EXPECTED_INSTALL_DOWNLOAD_RATIO;
  const variance =
    input.downloads *
    TEMPORAL_EXPECTED_INSTALL_DOWNLOAD_RATIO *
    (1 - TEMPORAL_EXPECTED_INSTALL_DOWNLOAD_RATIO);
  const stdDev = Math.sqrt(Math.max(variance, 1));
  return (input.installs - expected) / stdDev;
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function percentileBand(input: {
  value: number;
  p95: number;
  p99: number;
}): "p95" | "p99" | undefined {
  if (input.value <= 0) return undefined;
  if (input.p99 > 0 && input.value > input.p99) return "p99";
  if (input.p95 > 0 && input.value > input.p95) return "p95";
  return undefined;
}

function standardDeviation(values: number[], mean: number) {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
