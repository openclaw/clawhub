export const PUBLISHER_ABUSE_MODEL_VERSION = "publisher-abuse-pressure.v1";

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

export function labelForPublisherAbuseZScore(
  zScore: number,
  config: PublisherAbuseModelConfig = DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
): PublisherAbuseLabel {
  if (zScore >= config.potentialBanCandidateZThreshold) return "potential_ban_candidate";
  if (zScore >= config.reviewZThreshold) return "review";
  return "pass";
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

function reasonCodesForPublisher(input: {
  publishedSkills: number;
  installsPerSkill: number;
  starsPerSkill: number;
  downloadsPerSkill: number;
  config: PublisherAbuseModelConfig;
}) {
  const codes: string[] = [];
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
