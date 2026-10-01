/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  buildSkillDownloadBackfillPatch,
  calculatePublishedWeeks,
  DOWNLOAD_BACKFILL_BASIS,
  DOWNLOAD_BACKFILL_MODEL_VERSION,
  NVIDIA_GITHUB_DOWNLOAD_BACKFILL_SOURCE_REPO,
} from "./skillDownloadBackfill";

const PUBLISHED_AT = 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function makeSkill(input: {
  downloads: number;
  createdAt?: number;
  downloadBackfill?: { modelVersion: string; targetDownloads: number };
}) {
  return {
    createdAt: input.createdAt ?? 0,
    statsDownloads: input.downloads,
    statsStars: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    downloadBackfill: input.downloadBackfill,
    stats: {
      downloads: input.downloads,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 0,
      comments: 0,
    },
  };
}

describe("buildSkillDownloadBackfillPatch", () => {
  it("raises downloads to the modeled published-week target and records the model inputs", () => {
    const patch = buildSkillDownloadBackfillPatch({
      skill: makeSkill({ downloads: 0, createdAt: PUBLISHED_AT }),
      now: PUBLISHED_AT + 15 * 24 * 60 * 60 * 1000,
      averageDownloadsPerSkillWeek: 10,
    });

    expect(patch).not.toBeNull();
    expect(patch?.statsDownloads).toBe(30);
    expect(patch?.stats.downloads).toBe(30);
    expect(patch?.downloadBackfill).toMatchObject({
      modelVersion: DOWNLOAD_BACKFILL_MODEL_VERSION,
      sourceRepo: NVIDIA_GITHUB_DOWNLOAD_BACKFILL_SOURCE_REPO,
      basis: DOWNLOAD_BACKFILL_BASIS,
      previousDownloads: 0,
      publishedAt: PUBLISHED_AT,
      publishedWeeks: 3,
      baselineAverageDownloadsPerSkillWeek: 10,
      targetDownloads: 30,
      estimatedBackfilledDownloads: 30,
      appliedAt: PUBLISHED_AT + 15 * 24 * 60 * 60 * 1000,
    });
  });

  it("is idempotent after the target has been reached", () => {
    expect(
      buildSkillDownloadBackfillPatch({
        skill: makeSkill({
          downloads: 30,
          createdAt: PUBLISHED_AT,
          downloadBackfill: {
            modelVersion: DOWNLOAD_BACKFILL_MODEL_VERSION,
            targetDownloads: 30,
          },
        }),
        now: PUBLISHED_AT + 15 * 24 * 60 * 60 * 1000,
        averageDownloadsPerSkillWeek: 10,
      }),
    ).toBeNull();
  });

  it("compensates for pending stat events so later doc sync cannot double count", () => {
    const patch = buildSkillDownloadBackfillPatch({
      skill: makeSkill({ downloads: 0, createdAt: PUBLISHED_AT }),
      pendingSkillDocDownloads: 2,
      now: PUBLISHED_AT + 15 * 24 * 60 * 60 * 1000,
      averageDownloadsPerSkillWeek: 10,
    });

    expect(patch?.statsDownloads).toBe(28);
    expect(patch?.stats.downloads).toBe(28);
    expect(patch?.downloadBackfill).toMatchObject({
      previousDownloads: 2,
      targetDownloads: 30,
      pendingSkillDocDownloads: 2,
      estimatedBackfilledDownloads: 28,
    });
  });

  it("skips skills whose downloads already exceed the modeled target", () => {
    expect(
      buildSkillDownloadBackfillPatch({
        skill: makeSkill({ downloads: 31, createdAt: PUBLISHED_AT }),
        now: PUBLISHED_AT + 15 * 24 * 60 * 60 * 1000,
        averageDownloadsPerSkillWeek: 10,
      }),
    ).toBeNull();
  });
});

describe("calculatePublishedWeeks", () => {
  it("ceil-rounds partial published weeks with a minimum of one week", () => {
    expect(calculatePublishedWeeks({ publishedAt: PUBLISHED_AT, now: PUBLISHED_AT + 1 })).toBe(1);
    expect(
      calculatePublishedWeeks({ publishedAt: PUBLISHED_AT, now: PUBLISHED_AT + WEEK_MS }),
    ).toBe(1);
    expect(
      calculatePublishedWeeks({ publishedAt: PUBLISHED_AT, now: PUBLISHED_AT + WEEK_MS + 1 }),
    ).toBe(2);
  });
});
