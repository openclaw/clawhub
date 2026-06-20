/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  buildSkillInstallBackfillPatch,
  estimateSkillInstallBackfill,
  INSTALL_BACKFILL_CLEAN_WINDOW,
  INSTALL_BACKFILL_DEFAULTS,
  INSTALL_BACKFILL_MODEL_VERSION,
} from "./skillInstallBackfill";

function makeSkill(input: {
  downloads: number;
  installsAllTime: number;
  installBackfill?: { modelVersion: string; targetInstallsAllTime: number };
}) {
  return {
    statsDownloads: input.downloads,
    statsInstallsAllTime: input.installsAllTime,
    installBackfill: input.installBackfill,
    stats: {
      downloads: input.downloads,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: input.installsAllTime,
      versions: 1,
      comments: 0,
    },
  };
}

describe("estimateSkillInstallBackfill", () => {
  it("credits old downloads while letting stronger clean-window conversion rank higher", () => {
    const shared = { totalDownloads: 180_000, currentInstallsAllTime: 17 };

    const skillscan = estimateSkillInstallBackfill({
      ...shared,
      cleanStats: { downloads: 245, installs: 4 },
    });
    const ontology = estimateSkillInstallBackfill({
      ...shared,
      cleanStats: { downloads: 781, installs: 29 },
    });

    expect(skillscan.targetInstallsAllTime).toBeGreaterThan(shared.currentInstallsAllTime);
    expect(ontology.targetInstallsAllTime).toBeGreaterThan(skillscan.targetInstallsAllTime);
    expect(skillscan.smoothedRate).toBeLessThan(ontology.smoothedRate);
  });

  it("uses the global clean rate for tiny clean windows instead of trusting noisy ratios", () => {
    const estimate = estimateSkillInstallBackfill({
      totalDownloads: 10_000,
      currentInstallsAllTime: 0,
      cleanStats: { downloads: 6, installs: 1 },
    });

    expect(estimate.cleanInstalls / estimate.cleanDownloads).toBeCloseTo(1 / 6);
    expect(estimate.smoothedRate).toBeCloseTo(
      INSTALL_BACKFILL_DEFAULTS.globalCleanInstalls /
        INSTALL_BACKFILL_DEFAULTS.globalCleanDownloads,
    );
  });

  it("does not lower already higher install totals", () => {
    const estimate = estimateSkillInstallBackfill({
      totalDownloads: 1_000,
      currentInstallsAllTime: 900,
      cleanStats: { downloads: 100, installs: 0 },
    });

    expect(estimate.targetInstallsAllTime).toBe(900);
    expect(estimate.estimatedBackfilledInstalls).toBe(0);
  });
});

describe("buildSkillInstallBackfillPatch", () => {
  it("patches all-time installs and records the one-time estimate inputs", () => {
    const patch = buildSkillInstallBackfillPatch({
      skill: makeSkill({ downloads: 180_000, installsAllTime: 17 }),
      cleanStats: { downloads: 245, installs: 4 },
      now: 1_000,
    });

    expect(patch).not.toBeNull();
    expect(patch?.statsInstallsAllTime).toBeGreaterThan(17);
    expect(patch?.stats.installsAllTime).toBe(patch?.statsInstallsAllTime);
    expect(patch?.installBackfill).toMatchObject({
      modelVersion: INSTALL_BACKFILL_MODEL_VERSION,
      previousInstallsAllTime: 17,
      cleanDownloads: 245,
      cleanInstalls: 4,
      cleanWindowStartDay: INSTALL_BACKFILL_CLEAN_WINDOW.startDay,
      cleanWindowEndDay: INSTALL_BACKFILL_CLEAN_WINDOW.endDay,
      appliedAt: 1_000,
    });
    expect(patch?.installBackfill.estimatedBackfilledInstalls).toBe(
      (patch?.statsInstallsAllTime ?? 0) - 17,
    );
  });

  it("is idempotent after the same model target has been applied", () => {
    const applied = estimateSkillInstallBackfill({
      totalDownloads: 180_000,
      currentInstallsAllTime: 17,
      cleanStats: { downloads: 245, installs: 4 },
    });
    const skill = makeSkill({
      downloads: 180_000,
      installsAllTime: applied.targetInstallsAllTime,
      installBackfill: {
        modelVersion: INSTALL_BACKFILL_MODEL_VERSION,
        targetInstallsAllTime: applied.targetInstallsAllTime,
      },
    });

    expect(
      buildSkillInstallBackfillPatch({
        skill,
        cleanStats: { downloads: 245, installs: 4 },
        now: 2_000,
      }),
    ).toBeNull();
  });

  it("compensates for pending counted install events before the doc sync drains", () => {
    const pendingSkillDocDownloads = 100;
    const pendingSkillDocInstallsAllTime = 3;
    const expected = estimateSkillInstallBackfill({
      totalDownloads: 180_000 + pendingSkillDocDownloads,
      currentInstallsAllTime: 17 + pendingSkillDocInstallsAllTime,
      cleanStats: { downloads: 245, installs: 4 },
    });

    const patch = buildSkillInstallBackfillPatch({
      skill: makeSkill({ downloads: 180_000, installsAllTime: 17 }),
      cleanStats: { downloads: 245, installs: 4 },
      pendingSkillDocDownloads,
      pendingSkillDocInstallsAllTime,
      now: 2_000,
    });

    expect(patch?.statsInstallsAllTime).toBe(
      expected.targetInstallsAllTime - pendingSkillDocInstallsAllTime,
    );
    expect(patch?.installBackfill).toMatchObject({
      totalDownloads: 180_100,
      pendingSkillDocDownloads,
      previousInstallsAllTime: 20,
      targetInstallsAllTime: expected.targetInstallsAllTime,
      pendingSkillDocInstallsAllTime,
    });
  });

  it("skips skills whose existing all-time installs already exceed the estimate", () => {
    expect(
      buildSkillInstallBackfillPatch({
        skill: makeSkill({ downloads: 1_000, installsAllTime: 900 }),
        cleanStats: { downloads: 100, installs: 0 },
        now: 3_000,
      }),
    ).toBeNull();
  });
});
