import type { Doc } from "../_generated/dataModel";
import { readCanonicalStat } from "./skillStats";

export const INSTALL_BACKFILL_MODEL_VERSION = "skill-install-backfill-smoothed-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

export const INSTALL_BACKFILL_CLEAN_WINDOW = {
  startDay: 20616, // 2026-06-12 UTC, first full day after install telemetry shipped.
  endDay: 20622, // 2026-06-18 UTC.
};
export const INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME =
  (INSTALL_BACKFILL_CLEAN_WINDOW.endDay + 1) * DAY_MS;

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
  pendingSkillDocDownloads: number;
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
  pendingSkillDocInstallsAllTime: number;
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
    pendingSkillDocDownloads: 0,
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
    pendingSkillDocInstallsAllTime: 0,
  };
}

export function buildSkillInstallBackfillPatch(input: {
  skill: SkillInstallBackfillReadable;
  cleanStats: SkillInstallBackfillCleanStats;
  now: number;
  pendingSkillDocDownloads?: number;
  pendingSkillDocInstallsAllTime?: number;
  options?: Partial<SkillInstallBackfillOptions>;
}): SkillInstallBackfillPatch | null {
  const currentDownloads = readCanonicalStat(input.skill, "downloads");
  const pendingSkillDocDownloads = Math.max(0, finiteInteger(input.pendingSkillDocDownloads ?? 0));
  const stableDownloads = currentDownloads + pendingSkillDocDownloads;
  const currentInstallsAllTime = readCanonicalStat(input.skill, "installsAllTime");
  const pendingSkillDocInstallsAllTime = finiteInteger(input.pendingSkillDocInstallsAllTime ?? 0);
  const stableInstallsAllTime = Math.max(
    0,
    currentInstallsAllTime + pendingSkillDocInstallsAllTime,
  );
  const estimate = estimateSkillInstallBackfill({
    totalDownloads: stableDownloads,
    currentInstallsAllTime: stableInstallsAllTime,
    cleanStats: input.cleanStats,
    options: input.options,
  });
  const targetStoredInstallsAllTime = Math.max(
    0,
    estimate.targetInstallsAllTime - pendingSkillDocInstallsAllTime,
  );

  if (
    estimate.estimatedBackfilledInstalls === 0 ||
    (input.skill.installBackfill?.modelVersion === INSTALL_BACKFILL_MODEL_VERSION &&
      input.skill.installBackfill.targetInstallsAllTime === estimate.targetInstallsAllTime &&
      stableInstallsAllTime === estimate.targetInstallsAllTime)
  ) {
    return null;
  }

  return {
    statsInstallsAllTime: targetStoredInstallsAllTime,
    stats: {
      ...input.skill.stats,
      installsAllTime: targetStoredInstallsAllTime,
    },
    installBackfill: {
      ...estimate,
      pendingSkillDocDownloads,
      pendingSkillDocInstallsAllTime,
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

function finiteInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function safeRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, numerator / denominator);
}
