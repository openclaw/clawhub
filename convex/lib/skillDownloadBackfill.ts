import type { Doc } from "../_generated/dataModel";
import { applySkillStatDeltas, readCanonicalStat } from "./skillStats";

export const DOWNLOAD_BACKFILL_MODEL_VERSION = "nvidia-github-weekly-public-hosted-average-v1";
export const NVIDIA_GITHUB_DOWNLOAD_BACKFILL_SOURCE_REPO = "NVIDIA/skills";
export const DOWNLOAD_BACKFILL_BASIS = "public-hosted-downloads-per-published-week" as const;
export const DOWNLOAD_BACKFILL_BASELINE = {
  collectedAt: 1_782_253_618_085, // 2026-06-23T22:26:58.085Z
  publicHostedSkillCount: 65_016,
  publicHostedDownloads: 63_368_467,
  publicHostedSkillWeeks: 831_736,
  averageDownloadsPerSkillWeek: 76.18819793780719,
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type SkillDownloadBackfillPatch = ReturnType<typeof applySkillStatDeltas> & {
  downloadBackfill: SkillDownloadBackfillEstimate & {
    appliedAt: number;
  };
};

export type SkillDownloadBackfillEstimate = {
  modelVersion: string;
  sourceRepo: string;
  basis: typeof DOWNLOAD_BACKFILL_BASIS;
  baselineCollectedAt: number;
  baselinePublicHostedSkillCount: number;
  baselinePublicHostedDownloads: number;
  baselinePublicHostedSkillWeeks: number;
  baselineAverageDownloadsPerSkillWeek: number;
  publishedAt: number;
  publishedWeeks: number;
  previousDownloads: number;
  targetDownloads: number;
  estimatedBackfilledDownloads: number;
  pendingSkillDocDownloads: number;
};

type SkillDownloadBackfillReadable = {
  stats: Doc<"skills">["stats"];
  statsDownloads?: number;
  createdAt: number;
  downloadBackfill?: {
    modelVersion?: string;
    targetDownloads?: number;
  };
};

export function estimateSkillDownloadBackfill(input: {
  currentDownloads: number;
  publishedAt: number;
  now: number;
  averageDownloadsPerSkillWeek?: number;
}): SkillDownloadBackfillEstimate {
  const previousDownloads = nonNegativeInteger(input.currentDownloads);
  const publishedAt = finiteInteger(input.publishedAt);
  const publishedWeeks = calculatePublishedWeeks({ publishedAt, now: input.now });
  const baselineAverageDownloadsPerSkillWeek = finiteNonNegativeNumber(
    input.averageDownloadsPerSkillWeek ?? DOWNLOAD_BACKFILL_BASELINE.averageDownloadsPerSkillWeek,
  );
  const modeledDownloads = Math.round(publishedWeeks * baselineAverageDownloadsPerSkillWeek);
  const targetDownloads = Math.max(previousDownloads, modeledDownloads);

  return {
    modelVersion: DOWNLOAD_BACKFILL_MODEL_VERSION,
    sourceRepo: NVIDIA_GITHUB_DOWNLOAD_BACKFILL_SOURCE_REPO,
    basis: DOWNLOAD_BACKFILL_BASIS,
    baselineCollectedAt: DOWNLOAD_BACKFILL_BASELINE.collectedAt,
    baselinePublicHostedSkillCount: DOWNLOAD_BACKFILL_BASELINE.publicHostedSkillCount,
    baselinePublicHostedDownloads: DOWNLOAD_BACKFILL_BASELINE.publicHostedDownloads,
    baselinePublicHostedSkillWeeks: DOWNLOAD_BACKFILL_BASELINE.publicHostedSkillWeeks,
    baselineAverageDownloadsPerSkillWeek,
    publishedAt,
    publishedWeeks,
    previousDownloads,
    targetDownloads,
    estimatedBackfilledDownloads: targetDownloads - previousDownloads,
    pendingSkillDocDownloads: 0,
  };
}

export function buildSkillDownloadBackfillPatch(input: {
  skill: SkillDownloadBackfillReadable;
  now: number;
  pendingSkillDocDownloads?: number;
  averageDownloadsPerSkillWeek?: number;
}): SkillDownloadBackfillPatch | null {
  const currentDownloads = readCanonicalStat(input.skill, "downloads");
  const pendingSkillDocDownloads = Math.max(0, finiteInteger(input.pendingSkillDocDownloads ?? 0));
  const stableDownloads = currentDownloads + pendingSkillDocDownloads;
  const estimate = estimateSkillDownloadBackfill({
    currentDownloads: stableDownloads,
    publishedAt: input.skill.createdAt,
    now: input.now,
    averageDownloadsPerSkillWeek: input.averageDownloadsPerSkillWeek,
  });

  if (estimate.estimatedBackfilledDownloads === 0) return null;

  const targetStoredDownloads = Math.max(0, estimate.targetDownloads - pendingSkillDocDownloads);
  const downloadDelta = targetStoredDownloads - currentDownloads;
  if (downloadDelta <= 0) return null;

  return {
    ...applySkillStatDeltas(input.skill as Doc<"skills">, { downloads: downloadDelta }),
    downloadBackfill: {
      ...estimate,
      pendingSkillDocDownloads,
      appliedAt: input.now,
    },
  };
}

export function calculatePublishedWeeks(input: { publishedAt: number; now: number }) {
  const publishedAt = finiteInteger(input.publishedAt);
  const now = finiteInteger(input.now);
  if (publishedAt <= 0 || now <= publishedAt) return 1;
  return Math.max(1, Math.ceil((now - publishedAt) / WEEK_MS));
}

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function finiteInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function finiteNonNegativeNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}
