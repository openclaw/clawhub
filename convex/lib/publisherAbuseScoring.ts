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
  pressure: number;
  recent7Downloads: number;
  recent7Installs: number;
  previous30Downloads: number;
  baseline7Downloads: number;
  spikeMultiplier: number;
  recent30Downloads: number;
  recent30Installs: number;
  downloadInstallRatio30: number;
  spikeWindowStartDay?: number;
  spikeWindowEndDay?: number;
  sustainedWindowStartDay?: number;
  sustainedWindowEndDay?: number;
  reasonCodes: string[];
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
const TEMPORAL_MIN_SPIKE_DOWNLOADS = 1_000;
const TEMPORAL_MAX_SPIKE_INSTALLS = 2;
const TEMPORAL_MIN_SPIKE_MULTIPLIER = 10;
const TEMPORAL_MIN_SUSTAINED_DOWNLOADS = 3_000;
const TEMPORAL_MAX_SUSTAINED_INSTALLS = 5;
const TEMPORAL_MIN_SUSTAINED_DOWNLOAD_INSTALL_RATIO = 1_000;
const TEMPORAL_MIN_BASELINE_7_DOWNLOADS = 100;

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
}): SkillTemporalAbuseScore {
  const statsByDay = aggregateSkillTemporalDailyStats(input.dailyStats);
  return computeSkillTemporalAbuseScoreForWindows({
    statsByDay,
    spikeStartDay: input.todayDay - TEMPORAL_SPIKE_RECENT_DAYS + 1,
    sustainedStartDay: input.todayDay - TEMPORAL_SUSTAINED_DAYS + 1,
  });
}

export function computeHistoricalSkillTemporalAbuseScore(input: {
  dailyStats: SkillTemporalAbuseDailyStat[];
}): SkillTemporalAbuseScore {
  const statsByDay = aggregateSkillTemporalDailyStats(input.dailyStats);
  const days = [...statsByDay.keys()];
  if (days.length === 0) return emptySkillTemporalAbuseScore();

  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  let bestSpike = emptySkillTemporalAbuseScore();
  let bestSustained = emptySkillTemporalAbuseScore();

  for (let startDay = minDay; startDay <= maxDay; startDay += 1) {
    if (startDay + TEMPORAL_SPIKE_RECENT_DAYS - 1 <= maxDay) {
      const score = computeSkillTemporalAbuseScoreForWindows({
        statsByDay,
        spikeStartDay: startDay,
        sustainedStartDay: startDay,
      });
      if (score.spike && score.spikeMultiplier > bestSpike.spikeMultiplier) {
        bestSpike = score;
      }
    }

    if (startDay + TEMPORAL_SUSTAINED_DAYS - 1 <= maxDay) {
      const score = computeSkillTemporalAbuseScoreForWindows({
        statsByDay,
        spikeStartDay: startDay,
        sustainedStartDay: startDay,
      });
      if (score.sustained && score.downloadInstallRatio30 > bestSustained.downloadInstallRatio30) {
        bestSustained = score;
      }
    }
  }

  return mergeTemporalAbuseWindowScores(bestSpike, bestSustained);
}

export function labelForTemporalPublisherAbuse(input: {
  highTemporalSkillCount: number;
}): PublisherAbuseLabel {
  if (input.highTemporalSkillCount >= 2) return "potential_ban_candidate";
  if (input.highTemporalSkillCount >= 1) return "review";
  return "pass";
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
  const spike =
    recent7.downloads >= TEMPORAL_MIN_SPIKE_DOWNLOADS &&
    recent7.installs <= TEMPORAL_MAX_SPIKE_INSTALLS &&
    spikeMultiplier >= TEMPORAL_MIN_SPIKE_MULTIPLIER;
  const sustained =
    recent30.downloads >= TEMPORAL_MIN_SUSTAINED_DOWNLOADS &&
    recent30.installs <= TEMPORAL_MAX_SUSTAINED_INSTALLS &&
    downloadInstallRatio30 >= TEMPORAL_MIN_SUSTAINED_DOWNLOAD_INSTALL_RATIO;
  const reasonCodes: string[] = [];
  if (spike) reasonCodes.push("temporal_download_spike_flat_installs");
  if (sustained) reasonCodes.push("temporal_sustained_downloads_flat_installs");

  return {
    spike,
    sustained,
    pressure: Math.max(spike ? spikeMultiplier : 0, sustained ? downloadInstallRatio30 / 1_000 : 0),
    recent7Downloads: recent7.downloads,
    recent7Installs: recent7.installs,
    previous30Downloads: previous30.downloads,
    baseline7Downloads,
    spikeMultiplier,
    recent30Downloads: recent30.downloads,
    recent30Installs: recent30.installs,
    downloadInstallRatio30,
    spikeWindowStartDay: spike ? input.spikeStartDay : undefined,
    spikeWindowEndDay: spike ? spikeEndDay : undefined,
    sustainedWindowStartDay: sustained ? input.sustainedStartDay : undefined,
    sustainedWindowEndDay: sustained ? sustainedEndDay : undefined,
    reasonCodes,
  };
}

function mergeTemporalAbuseWindowScores(
  bestSpike: SkillTemporalAbuseScore,
  bestSustained: SkillTemporalAbuseScore,
): SkillTemporalAbuseScore {
  if (!bestSpike.spike && !bestSustained.sustained) return emptySkillTemporalAbuseScore();
  const reasonCodes: string[] = [];
  if (bestSpike.spike) reasonCodes.push("temporal_download_spike_flat_installs");
  if (bestSustained.sustained) reasonCodes.push("temporal_sustained_downloads_flat_installs");

  return {
    spike: bestSpike.spike,
    sustained: bestSustained.sustained,
    pressure: Math.max(bestSpike.pressure, bestSustained.pressure),
    recent7Downloads: bestSpike.recent7Downloads,
    recent7Installs: bestSpike.recent7Installs,
    previous30Downloads: bestSpike.previous30Downloads,
    baseline7Downloads: bestSpike.baseline7Downloads,
    spikeMultiplier: bestSpike.spikeMultiplier,
    recent30Downloads: bestSustained.recent30Downloads,
    recent30Installs: bestSustained.recent30Installs,
    downloadInstallRatio30: bestSustained.downloadInstallRatio30,
    spikeWindowStartDay: bestSpike.spikeWindowStartDay,
    spikeWindowEndDay: bestSpike.spikeWindowEndDay,
    sustainedWindowStartDay: bestSustained.sustainedWindowStartDay,
    sustainedWindowEndDay: bestSustained.sustainedWindowEndDay,
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
    pressure: 0,
    recent7Downloads: 0,
    recent7Installs: 0,
    previous30Downloads: 0,
    baseline7Downloads: TEMPORAL_MIN_BASELINE_7_DOWNLOADS,
    spikeMultiplier: 0,
    recent30Downloads: 0,
    recent30Installs: 0,
    downloadInstallRatio30: 0,
    reasonCodes: [],
  };
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number) {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
