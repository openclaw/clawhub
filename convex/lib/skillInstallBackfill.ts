import type { Doc } from "../_generated/dataModel";
import { readCanonicalStat } from "./skillStats";

export const INSTALL_BACKFILL_MODEL_VERSION = "skill-install-backfill-smoothed-v1";

export const INSTALL_BACKFILL_CLEAN_WINDOW = {
  startDay: 20616, // 2026-06-12 UTC, first full day after install telemetry shipped.
  endDay: 20622, // 2026-06-18 UTC.
};

// Aggregate clean-window totals from skillDailyStats. The model only uses
// per-skill daily totals and all-time download counts; it does not read
// userSkillInstalls, install dedupe rows, IP hashes, or user-level telemetry.
export const INSTALL_BACKFILL_DEFAULTS = {
  globalCleanDownloads: 10_777,
  globalCleanInstalls: 407,
  priorDownloads: 1_000,
  minimumCleanDownloads: 100,
  maxSmoothedRate: 0.1,
};

export type SkillInstallBackfillCleanStats = {
  downloads: number;
  installs: number;
};

export type SkillInstallBackfillEstimate = {
  modelVersion: string;
  totalDownloads: number;
  previousInstallsAllTime: number;
  targetInstallsAllTime: number;
  estimatedBackfilledInstalls: number;
  cleanDownloads: number;
  cleanInstalls: number;
  globalCleanRate: number;
  priorDownloads: number;
  minimumCleanDownloads: number;
  maxSmoothedRate: number;
  smoothedRate: number;
};

export type SkillInstallBackfillOptions = typeof INSTALL_BACKFILL_DEFAULTS;

export type SkillInstallBackfillPatch = {
  statsInstallsAllTime: number;
  stats: SkillInstallBackfillReadable["stats"];
  installBackfill: SkillInstallBackfillEstimate & {
    cleanWindowStartDay: number;
    cleanWindowEndDay: number;
    appliedAt: number;
  };
};

type SkillInstallBackfillReadable = {
  stats: Doc<"skills">["stats"];
  statsDownloads?: number;
  statsInstallsAllTime?: number;
  installBackfill?: {
    modelVersion?: string;
    targetInstallsAllTime?: number;
  };
};

export function estimateSkillInstallBackfill(input: {
  totalDownloads: number;
  currentInstallsAllTime: number;
  cleanStats: SkillInstallBackfillCleanStats;
  options?: Partial<SkillInstallBackfillOptions>;
}): SkillInstallBackfillEstimate {
  const options = { ...INSTALL_BACKFILL_DEFAULTS, ...input.options };
  const totalDownloads = nonNegativeInteger(input.totalDownloads);
  const previousInstallsAllTime = nonNegativeInteger(input.currentInstallsAllTime);
  const cleanDownloads = nonNegativeInteger(input.cleanStats.downloads);
  const cleanInstalls = nonNegativeInteger(input.cleanStats.installs);
  const globalCleanRate = safeRatio(options.globalCleanInstalls, options.globalCleanDownloads);
  const priorDownloads = Math.max(0, options.priorDownloads);
  const minimumCleanDownloads = Math.max(0, options.minimumCleanDownloads);
  const maxSmoothedRate = Math.max(0, options.maxSmoothedRate);
  const skillRate =
    cleanDownloads >= minimumCleanDownloads
      ? safeRatio(cleanInstalls + globalCleanRate * priorDownloads, cleanDownloads + priorDownloads)
      : globalCleanRate;
  const smoothedRate = Math.min(maxSmoothedRate, skillRate);
  const estimatedInstallsAllTime = Math.round(totalDownloads * smoothedRate);
  const targetInstallsAllTime = Math.max(previousInstallsAllTime, estimatedInstallsAllTime);

  return {
    modelVersion: INSTALL_BACKFILL_MODEL_VERSION,
    totalDownloads,
    previousInstallsAllTime,
    targetInstallsAllTime,
    estimatedBackfilledInstalls: targetInstallsAllTime - previousInstallsAllTime,
    cleanDownloads,
    cleanInstalls,
    globalCleanRate,
    priorDownloads,
    minimumCleanDownloads,
    maxSmoothedRate,
    smoothedRate,
  };
}

export function buildSkillInstallBackfillPatch(input: {
  skill: SkillInstallBackfillReadable;
  cleanStats: SkillInstallBackfillCleanStats;
  now: number;
  options?: Partial<SkillInstallBackfillOptions>;
}): SkillInstallBackfillPatch | null {
  const estimate = estimateSkillInstallBackfill({
    totalDownloads: readCanonicalStat(input.skill, "downloads"),
    currentInstallsAllTime: readCanonicalStat(input.skill, "installsAllTime"),
    cleanStats: input.cleanStats,
    options: input.options,
  });

  if (
    estimate.estimatedBackfilledInstalls === 0 ||
    (input.skill.installBackfill?.modelVersion === INSTALL_BACKFILL_MODEL_VERSION &&
      input.skill.installBackfill.targetInstallsAllTime === estimate.targetInstallsAllTime &&
      readCanonicalStat(input.skill, "installsAllTime") === estimate.targetInstallsAllTime)
  ) {
    return null;
  }

  return {
    statsInstallsAllTime: estimate.targetInstallsAllTime,
    stats: {
      ...input.skill.stats,
      installsAllTime: estimate.targetInstallsAllTime,
    },
    installBackfill: {
      ...estimate,
      cleanWindowStartDay: INSTALL_BACKFILL_CLEAN_WINDOW.startDay,
      cleanWindowEndDay: INSTALL_BACKFILL_CLEAN_WINDOW.endDay,
      appliedAt: input.now,
    },
  };
}

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function safeRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, numerator / denominator);
}
