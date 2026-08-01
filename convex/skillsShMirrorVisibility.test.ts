/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "academic-chihuahua-392");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
});

afterEach(() => vi.unstubAllEnvs());

describe("skills.sh mirror visibility operations", () => {
  it("keeps the global lane closed when stored rejection evidence is incomplete", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const leaderboardRunId = await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "skills-sh:leaderboard:missing-conflict",
        sourceView: "leaderboard",
        status: "completed",
        sourceTotal: 1,
        sourcePageSize: 500,
        sourceMeasuredAt: new Date(1).toISOString(),
        page: 1,
        offset: 0,
        counts: {
          observed: 1,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          rejected: 1,
          quarantined: 1,
          conflicts: 1,
          detailsInserted: 0,
          detailsUpdated: 0,
          detailsUnchanged: 0,
          detailsMissing: 0,
          detailsTruncated: 0,
          tombstoned: 0,
          reactivated: 0,
          scansPlanned: 0,
          scansAdmitted: 0,
        },
        operations: {
          functionCalls: 1,
          dbReads: 1,
          dbWrites: 1,
          sourceRequests: 1,
          sourceBytes: 1,
        },
        actor: "codex-test",
        reason: "CLAW-603 missing conflict proof",
        startedAt: 1,
        completedAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "skills-sh:trending:empty",
        sourceView: "trending",
        status: "completed",
        sourceTotal: 0,
        sourcePageSize: 500,
        sourceMeasuredAt: new Date(3).toISOString(),
        page: 1,
        offset: 0,
        counts: {
          observed: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          rejected: 0,
          conflicts: 0,
          detailsInserted: 0,
          detailsUpdated: 0,
          detailsUnchanged: 0,
          detailsMissing: 0,
          detailsTruncated: 0,
          tombstoned: 0,
          reactivated: 0,
          trendingJoined: 0,
          trendingMissing: 0,
          scansPlanned: 0,
          scansAdmitted: 0,
        },
        operations: {
          functionCalls: 1,
          dbReads: 0,
          dbWrites: 0,
          sourceRequests: 0,
          sourceBytes: 0,
        },
        actor: "codex-test",
        reason: "CLAW-603 empty trending proof",
        startedAt: 3,
        completedAt: 4,
        updatedAt: 4,
      });
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: leaderboardRunId,
        updatedBy: "codex-test",
        reason: "CLAW-603 missing conflict proof",
        updatedAt: 2,
      });
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 must remain hidden",
        confirm: "activate-skills-sh-public-test",
      }),
    ).rejects.toThrow("stored conflict accounting differs");
    const catalogControl = await t.run(async (ctx) =>
      ctx.db
        .query("skillsShCatalogControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
    );
    expect(catalogControl).toBeNull();
  });

  it("keeps the global lane closed when an accepted row has no stored digest", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const leaderboardRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          sourceView: "leaderboard",
          sourceTotal: 1,
          counts: mirrorRunCounts({ observed: 1, inserted: 1, detailsInserted: 1 }),
          startedAt: 1,
          completedAt: 2,
          updatedAt: 2,
        }),
      );
      await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          sourceView: "trending",
          startedAt: 3,
          completedAt: 4,
          updatedAt: 4,
        }),
      );
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: leaderboardRunId,
        updatedBy: "codex-test",
        reason: "CLAW-603 missing accepted digest proof",
        updatedAt: 2,
      });
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 must remain hidden",
        confirm: "activate-skills-sh-public-test",
      }),
    ).rejects.toThrow("stored corpus count differs from accepted rows");
  });

  it("verifies the imported corpus and only publishable Trending joins before opening", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const window = getCompletedRolling24HourWindow(now);
    const { nativeSkillId } = await t.run(async (ctx) => {
      const leaderboardRunId = await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "skills-sh:leaderboard:verified",
        sourceView: "leaderboard",
        sourceSnapshotHash: "a".repeat(64),
        status: "completed",
        sourceTotal: 4,
        sourcePageSize: 500,
        sourceMeasuredAt: new Date(now - 2_000).toISOString(),
        page: 1,
        offset: 0,
        counts: {
          observed: 4,
          inserted: 3,
          updated: 0,
          unchanged: 0,
          rejected: 1,
          quarantined: 1,
          conflicts: 1,
          detailsInserted: 3,
          detailsUpdated: 0,
          detailsUnchanged: 0,
          detailsMissing: 0,
          detailsTruncated: 0,
          tombstoned: 0,
          reactivated: 0,
          scansPlanned: 0,
          scansAdmitted: 0,
        },
        operations: {
          functionCalls: 1,
          dbReads: 2,
          dbWrites: 3,
          sourceRequests: 2,
          sourceBytes: 100,
        },
        actor: "codex-test",
        reason: "CLAW-603 verification test",
        startedAt: now - 3_000,
        completedAt: now - 2_000,
        updatedAt: now - 2_000,
      });
      const trendingRunId = await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "skills-sh:trending:verified",
        sourceView: "trending",
        sourceSnapshotHash: "b".repeat(64),
        status: "completed",
        sourceTotal: 2,
        sourcePageSize: 500,
        sourceMeasuredAt: new Date(now - 1_000).toISOString(),
        page: 1,
        offset: 0,
        counts: {
          observed: 2,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          rejected: 0,
          conflicts: 0,
          detailsInserted: 0,
          detailsUpdated: 0,
          detailsUnchanged: 0,
          detailsMissing: 0,
          detailsTruncated: 0,
          tombstoned: 0,
          reactivated: 0,
          trendingJoined: 2,
          trendingUpdated: 0,
          trendingUnchanged: 2,
          trendingMissing: 0,
          trendingStaleRejected: 0,
          trendingHydrationAttempts: 0,
          trendingHydrated: 0,
          trendingHydrationFailed: 0,
          scansPlanned: 0,
          scansAdmitted: 0,
        },
        operations: {
          functionCalls: 1,
          dbReads: 1,
          dbWrites: 1,
          sourceRequests: 1,
          sourceBytes: 50,
        },
        actor: "codex-test",
        reason: "CLAW-603 trending verification test",
        startedAt: now - 1_500,
        completedAt: now - 1_000,
        updatedAt: now - 1_000,
      });
      await ctx.db.insert(
        "skillsShMirrorDigests",
        digest({
          lastObservedRunId: leaderboardRunId,
          trendingObservedRunId: trendingRunId,
          trendingRank: 1,
          trendingLifetimeInstalls: 12,
          trendingObservedAt: now - 1_000,
        }),
      );
      await ctx.db.insert(
        "skillsShMirrorDigests",
        digest({
          externalId: "patrick/skills/ineligible",
          slug: "ineligible",
          normalizedSlug: "ineligible",
          normalizedSlugFirstToken: "ineligible",
          displayName: "Ineligible",
          normalizedDisplayName: "ineligible",
          normalizedDisplayNameFirstToken: "ineligible",
          searchText: "ineligible",
          sourceUrl: "https://skills.sh/patrick/skills/ineligible",
          githubPath: undefined,
          githubCommit: undefined,
          sourceContentHash: undefined,
          lastObservedRunId: leaderboardRunId,
          trendingObservedRunId: trendingRunId,
          trendingRank: 2,
          trendingLifetimeInstalls: 8,
          trendingObservedAt: now - 1_000,
        }),
      );
      await ctx.db.insert(
        "skillsShMirrorDigests",
        digest({
          externalId: "patrick/skills/failed-claim",
          slug: "failed-claim",
          normalizedSlug: "failed-claim",
          normalizedSlugFirstToken: "failed",
          displayName: "Failed claim",
          normalizedDisplayName: "failed claim",
          normalizedDisplayNameFirstToken: "failed",
          searchText: "failed claim",
          sourceUrl: "https://skills.sh/patrick/skills/failed-claim",
          githubPath: "skills/failed-claim",
          lastObservedRunId: leaderboardRunId,
          claimStatus: "failed",
          claimAttempt: 1,
          active: false,
          publicVisible: false,
          installable: false,
        }),
      );
      await ctx.db.insert("skillsShMirrorConflicts", {
        runId: leaderboardRunId,
        externalId: "invalid/source/row",
        kind: "source-quarantine",
        reason: "invalid source",
        observedFingerprint: "invalid",
        page: 0,
        offset: 1,
        createdAt: now - 2_000,
      });
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: leaderboardRunId,
        updatedBy: "codex-test",
        reason: "CLAW-603 verification test",
        updatedAt: now - 2_000,
      });
      const nativeOwnerId = await ctx.db.insert("users", {
        handle: "native-owner",
        displayName: "Native owner",
        createdAt: now - 10_000,
        updatedAt: now,
      });
      const createdNativeSkillId = await ctx.db.insert("skills", {
        slug: "native-ready",
        displayName: "Native ready",
        summary: "Native canonical Trending fixture",
        ownerUserId: nativeOwnerId,
        tags: {},
        statsInstallsAllTime: 900,
        stats: { downloads: 1_000, installsAllTime: 900, stars: 20, versions: 1, comments: 0 },
        createdAt: now - 10_000,
        updatedAt: now,
      });
      const nativeVersionId = await ctx.db.insert("skillVersions", {
        skillId: createdNativeSkillId,
        version: "1.0.0",
        changelog: "Initial",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: nativeOwnerId,
        createdAt: now - 10_000,
      });
      await ctx.db.insert("skillSearchDigest", {
        skillId: createdNativeSkillId,
        slug: "native-ready",
        displayName: "Native ready",
        summary: "Native canonical Trending fixture",
        ownerUserId: nativeOwnerId,
        ownerHandle: "native-owner",
        ownerKind: "user",
        ownerName: "Native owner",
        ownerDisplayName: "Native owner",
        latestVersionId: nativeVersionId,
        latestVersionSkillId: createdNativeSkillId,
        publicVersion: { status: "available", versionId: nativeVersionId },
        tags: {},
        statsInstallsAllTime: 900,
        stats: { downloads: 1_000, installsAllTime: 900, stars: 20, versions: 1, comments: 0 },
        createdAt: now - 10_000,
        updatedAt: now,
      });
      return { nativeSkillId: createdNativeSkillId };
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 unavailable native source",
        confirm: "activate-skills-sh-public-test",
      }),
    ).rejects.toThrow("skills.sh Trending activation snapshot failed source verification");

    await t.run(async (ctx) => {
      await ctx.db.insert("skillHourlyStatStates", {
        key: "canonical_trending",
        liveStartedAt: now - 3_600_000,
        eventBackfillThroughCreationTime: 100,
        activeGeneration: 1,
        backfillCompletedAt: now - 1_000,
        lastAggregationCompletedAt: window.endAt + 1,
        lastProcessedEventCreationTime: 100,
        updatedAt: now,
      });
      await ctx.db.insert("skillHourlyStats", {
        skillId: nativeSkillId,
        hour: window.endHour,
        generation: 0,
        downloads: 18,
        installs: 12,
        bookmarks: 4,
        updatedAt: now,
        expiresAt: now + 72 * 3_600_000,
      });
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.prepareNativeTrendingInternal, {
        actor: "codex-test",
        reason: "CLAW-603 persist native candidate pool",
        confirm: "deactivate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      nativeTrending: {
        status: "ready",
        sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
        nativePool: { reused: false },
      },
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 verified atomic publication",
        confirm: "activate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      ok: true,
      environment: "test",
      activated: true,
      leaderboard: { sourceTotal: 4, accepted: 3, rejected: 1 },
      trending: { sourceTotal: 2, joined: 2, missing: 0 },
      corpus: {
        total: 3,
        sourceEligible: 2,
        activationRunAccepted: 3,
        activationRunTrendingEligible: 1,
        eligible: 1,
        claimExcluded: 1,
        eligiblePublished: 1,
        unsafePublished: 0,
      },
      trendingSnapshot: {
        status: "ready",
        sourceCounts: { skillsShTrending: 1 },
        nativePool: { reused: true },
      },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    const activationState = await t.run(async (ctx) => ({
      mirrorControl: await ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
      snapshots: await ctx.db
        .query("canonicalTrendingSnapshots")
        .withIndex("by_kind_and_status_and_expires_at", (q) =>
          q.eq("kind", "skills").eq("status", "ready").gt("expiresAt", 0),
        )
        .collect(),
      runs: await ctx.db.query("skillsShMirrorRuns").withIndex("by_started_at").collect(),
    }));
    expect(activationState.mirrorControl?.activationLockToken).toBeUndefined();
    expect(activationState.snapshots).toHaveLength(2);
    const activatedLeaderboard = activationState.runs.find(
      (run) => run._id === activationState.mirrorControl?.latestCompletedLeaderboardRunId,
    );
    expect(activatedLeaderboard?.activatedTrendingRunId).toBe(
      activationState.runs.find((run) => run.sourceView === "trending")?._id,
    );
    expect(activatedLeaderboard?.activationSnapshotId).toBe(
      activationState.snapshots.find((snapshot) => snapshot.sourceCounts?.skillsShTrending === 1)
        ?.snapshotId,
    );
    expect(activatedLeaderboard?.activatedAt).toEqual(expect.any(Number));
    await expect(
      t.query(internal.canonicalTrending.getPageInternal, { cursor: null, limit: 20 }),
    ).resolves.toMatchObject({
      status: "ok",
      page: { items: [{ source: "clawhub" }, { source: "skills-sh" }] },
    });

    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("skillHourlyStatStates")
        .withIndex("by_key", (q) => q.eq("key", "canonical_trending"))
        .unique();
      if (!state) throw new Error("hourly state missing");
      await ctx.db.delete(state._id);
    });
    await expect(
      t.action(internal.skillsShMirrorVisibility.deactivateAndMaterializeInternal, {
        actor: "codex-test",
        reason: "CLAW-603 fail-closed rollback",
        confirm: "deactivate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      enabled: false,
      nativeTrending: {
        status: "ready",
        sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
        nativePool: { poolId: expect.any(String) },
        reused: true,
      },
    });
    await expect(
      t.query(internal.canonicalTrending.getPageInternal, { cursor: null, limit: 20 }),
    ).resolves.toMatchObject({
      status: "ok",
      page: { items: [{ source: "clawhub" }] },
    });
  });

  it("verifies the bounded Trending lane when eligible production rows exceed its limit", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const rowCount = 1_001;
    const { leaderboardRunId, trendingRunId } = await t.run(async (ctx) => {
      const createdLeaderboardRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          snapshotId: "skills-sh:leaderboard:bounded",
          sourceView: "leaderboard",
          sourceTotal: rowCount,
          counts: mirrorRunCounts({
            observed: rowCount,
            inserted: rowCount,
            detailsInserted: rowCount,
          }),
          startedAt: now - 3_000,
          completedAt: now - 2_000,
          updatedAt: now - 2_000,
        }),
      );
      const createdTrendingRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          snapshotId: "skills-sh:trending:bounded",
          sourceView: "trending",
          sourceTotal: rowCount,
          counts: mirrorRunCounts({
            observed: rowCount,
            trendingJoined: rowCount,
          }),
          startedAt: now - 1_500,
          completedAt: now - 1_000,
          updatedAt: now - 1_000,
        }),
      );
      for (let index = 0; index < rowCount; index += 1) {
        const slug = `bounded-${index}`;
        const owner = `publisher-${index}`;
        await ctx.db.insert(
          "skillsShMirrorDigests",
          digest({
            externalId: `${owner}/skills/${slug}`,
            owner,
            slug,
            normalizedSlug: slug,
            normalizedSlugFirstToken: slug,
            displayName: `Bounded ${index}`,
            normalizedDisplayName: `bounded ${index}`,
            normalizedDisplayNameFirstToken: "bounded",
            searchText: `bounded ${index}`,
            sourceUrl: `https://skills.sh/${owner}/skills/${slug}`,
            canonicalRepoUrl: `https://github.com/${owner}/skills`,
            githubPath: `skills/${slug}`,
            lastObservedRunId: createdLeaderboardRunId,
            trendingObservedRunId: createdTrendingRunId,
            trendingRank: index + 1,
            trendingLifetimeInstalls: rowCount - index,
            trendingObservedAt: now - 1_000,
          }),
        );
      }
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: createdLeaderboardRunId,
        updatedBy: "codex-test",
        reason: "CLAW-603 bounded activation verification",
        updatedAt: now - 2_000,
      });
      return {
        leaderboardRunId: createdLeaderboardRunId,
        trendingRunId: createdTrendingRunId,
      };
    });

    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-native-bounded",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
      windowStartHour: 960,
      windowEndHour: 983,
    });
    await t.mutation(internal.canonicalTrending.startNativePoolInternal, {
      poolId: "skills-native-bounded",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartHour: 960,
      windowEndHour: 983,
      sealedGeneration: 1,
    });
    await t.mutation(internal.canonicalTrending.finalizeNativePoolInternal, {
      poolId: "skills-native-bounded",
      completedAt: now - 500,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-native-bounded",
      completedAt: now - 500,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
      nativePoolId: "skills-native-bounded",
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 bounded production-sized activation",
        confirm: "activate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      activated: true,
      leaderboard: { sourceTotal: rowCount, accepted: rowCount, rejected: 0 },
      trending: { sourceTotal: rowCount, joined: rowCount, missing: 0 },
      corpus: {
        activationRunAccepted: rowCount,
        activationRunTrendingEligible: rowCount,
        activationRunTrendingSelected: 1_000,
      },
      trendingSnapshot: {
        sourceCounts: { skillsShTrending: 1_000 },
        nativePool: { reused: true },
      },
    });
    const activatedRuns = await t.run(async (ctx) => ({
      leaderboard: await ctx.db.get(leaderboardRunId),
      trending: await ctx.db.get(trendingRunId),
    }));
    expect(activatedRuns.leaderboard?.activationSnapshotId).toEqual(expect.any(String));
    expect(activatedRuns.leaderboard?.activatedTrendingRunId).toBe(trendingRunId);
  });

  it("keeps the public gate closed when activation has to build the native pool", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const window = getCompletedRolling24HourWindow(now);
    await t.run(async (ctx) => {
      const leaderboardRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          sourceView: "leaderboard",
          sourceTotal: 1,
          counts: mirrorRunCounts({ observed: 1, inserted: 1, detailsInserted: 1 }),
          startedAt: now - 4_000,
          completedAt: now - 3_000,
        }),
      );
      const trendingRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          sourceView: "trending",
          sourceTotal: 1,
          counts: mirrorRunCounts({ observed: 1, trendingJoined: 1 }),
          startedAt: now - 2_000,
          completedAt: now - 1_000,
        }),
      );
      await ctx.db.insert(
        "skillsShMirrorDigests",
        digest({
          lastObservedRunId: leaderboardRunId,
          trendingObservedRunId: trendingRunId,
          trendingRank: 1,
          trendingLifetimeInstalls: 10,
          trendingObservedAt: now - 1_000,
        }),
      );
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: leaderboardRunId,
        updatedBy: "codex-test",
        reason: "CLAW-603 activation fallback test",
        updatedAt: now - 3_000,
      });
      await ctx.db.insert("skillHourlyStatStates", {
        key: "canonical_trending",
        liveStartedAt: now - 3_600_000,
        eventBackfillThroughCreationTime: 100,
        activeGeneration: 1,
        backfillCompletedAt: now - 1_000,
        lastAggregationCompletedAt: window.endAt + 1,
        lastProcessedEventCreationTime: 100,
        updatedAt: now,
      });
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 must reuse native preflight",
        confirm: "activate-skills-sh-public-test",
      }),
    ).rejects.toThrow("skills.sh activation must reuse the verified native candidate pool");
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("canonicalTrendingSnapshots")
          .withIndex("by_kind_and_status_and_expires_at", (q) =>
            q.eq("kind", "skills").eq("status", "ready").gt("expiresAt", now),
          )
          .order("desc")
          .first(),
      ),
    ).resolves.toMatchObject({ sourceCounts: { skillsShTrending: 0 } });
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("skillsShCatalogControls")
          .withIndex("by_key", (q) => q.eq("key", "global"))
          .unique(),
      ),
    ).resolves.toBeNull();

    await expect(
      t.action(internal.skillsShMirrorVisibility.verifyAndActivateInternal, {
        actor: "codex-test",
        reason: "CLAW-603 retry with verified native pool",
        confirm: "activate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      activated: true,
      trendingSnapshot: {
        sourceCounts: { skillsShTrending: 1 },
        nativePool: { reused: true },
      },
    });
  });

  it("reclaims an abandoned activation lock after its bounded lease", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      const leaderboardRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          sourceView: "leaderboard",
          startedAt: now - 20 * 60_000,
          completedAt: now - 19 * 60_000,
          updatedAt: now - 19 * 60_000,
        }),
      );
      const trendingRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({
          sourceView: "trending",
          startedAt: now - 18 * 60_000,
          completedAt: now - 17 * 60_000,
          updatedAt: now - 17 * 60_000,
        }),
      );
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: leaderboardRunId,
        activationLockToken: "abandoned-lock",
        activationLockedAt: now - 16 * 60_000,
        activationLeaderboardRunId: leaderboardRunId,
        activationTrendingRunId: trendingRunId,
        updatedBy: "interrupted-action",
        reason: "abandoned activation test",
        updatedAt: now - 16 * 60_000,
      });
    });

    await expect(
      t.mutation(internal.skillsShMirrorVisibility.beginActivationInternal, {
        actor: "retrying-action",
        reason: "recover abandoned activation",
        confirm: "activate-skills-sh-public-test",
        lockToken: "replacement-lock",
      }),
    ).resolves.toMatchObject({ environment: "test" });
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("skillsShMirrorControls")
          .withIndex("by_key", (q) => q.eq("key", "global"))
          .unique(),
      ),
    ).resolves.toMatchObject({
      activationLockToken: "replacement-lock",
      updatedBy: "retrying-action",
    });
  });

  it("prepares native-only publication without enabling a missing mirror control", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShMirrorVisibility.beginNativeTrendingInternal, {
      actor: "codex-test",
      reason: "prepare native-only Trending",
      confirm: "deactivate-skills-sh-public-test",
      lockToken: "native-only-lock",
    });
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("skillsShMirrorControls")
          .withIndex("by_key", (q) => q.eq("key", "global"))
          .unique(),
      ),
    ).resolves.toMatchObject({
      enabled: false,
      paused: true,
      maxRowsPerRun: 0,
      maxRowsPerBatch: 0,
      maxDetailBytes: 0,
      activationLockToken: "native-only-lock",
    });
    await expect(
      t.mutation(internal.skillsShMirrorVisibility.beginActivationInternal, {
        actor: "codex-test",
        reason: "must wait for native-only snapshot",
        confirm: "activate-skills-sh-public-test",
        lockToken: "activation-lock",
      }),
    ).rejects.toThrow("skills.sh mirror control is not active");
  });

  it("reuses a fresh native-only snapshot instead of rematerializing preflight", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-native-preflight-existing",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
      windowStartHour: 960,
      windowEndHour: 983,
    });
    await t.mutation(internal.canonicalTrending.startNativePoolInternal, {
      poolId: "skills-native-preflight-existing",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartHour: 960,
      windowEndHour: 983,
      sealedGeneration: 1,
    });
    await t.mutation(internal.canonicalTrending.finalizeNativePoolInternal, {
      poolId: "skills-native-preflight-existing",
      completedAt: now - 500,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-native-preflight-existing",
      completedAt: now - 500,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
      nativePoolId: "skills-native-preflight-existing",
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.prepareNativeTrendingInternal, {
        actor: "codex-test",
        reason: "reuse current native-only Trending",
        confirm: "deactivate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      ok: true,
      nativeTrending: {
        status: "ready",
        snapshotId: "skills-native-preflight-existing",
        sourceCounts: { skillsShTrending: 0 },
        nativePool: { poolId: "skills-native-preflight-existing" },
        reused: true,
      },
    });
    const state = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("canonicalTrendingSnapshots").collect(),
      control: await ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
    }));
    expect(state).toMatchObject({
      snapshots: [expect.objectContaining({ snapshotId: "skills-native-preflight-existing" })],
    });
    expect(state.control?.activationLockToken).toBeUndefined();
  });

  it("rejects a completed Trending run older than the selected leaderboard import", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const leaderboardRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({ sourceView: "leaderboard", startedAt: 10, completedAt: 20, updatedAt: 20 }),
      );
      await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({ sourceView: "trending", startedAt: 1, completedAt: 2, updatedAt: 2 }),
      );
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: leaderboardRunId,
        updatedBy: "codex-test",
        reason: "current leaderboard without current trending",
        updatedAt: 20,
      });
    });

    await expect(
      t.mutation(internal.skillsShMirrorVisibility.beginActivationInternal, {
        actor: "codex-test",
        reason: "must not reuse stale trending",
        confirm: "activate-skills-sh-public-test",
        lockToken: "new-lock",
      }),
    ).rejects.toThrow("skills.sh trending run is older than the leaderboard run");
  });

  it("invalidates an in-flight activation when the public lane is deactivated", async () => {
    const t = convexTest(schema, modules);
    const { leaderboardRunId, trendingRunId } = await t.run(async (ctx) => {
      const createdLeaderboardRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({ sourceView: "leaderboard", startedAt: 1, completedAt: 2, updatedAt: 2 }),
      );
      const createdTrendingRunId = await ctx.db.insert(
        "skillsShMirrorRuns",
        mirrorRun({ sourceView: "trending", startedAt: 3, completedAt: 4, updatedAt: 4 }),
      );
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        latestCompletedLeaderboardRunId: createdLeaderboardRunId,
        activationLockToken: "in-flight-lock",
        activationLockedAt: Date.now(),
        activationLeaderboardRunId: createdLeaderboardRunId,
        activationTrendingRunId: createdTrendingRunId,
        updatedBy: "activating-action",
        reason: "activation in progress",
        updatedAt: Date.now(),
      });
      return {
        leaderboardRunId: createdLeaderboardRunId,
        trendingRunId: createdTrendingRunId,
      };
    });

    await t.mutation(internal.skillsShMirrorVisibility.beginDeactivationInternal, {
      actor: "codex-test",
      reason: "systemic rollback",
      confirm: "deactivate-skills-sh-public-test",
      lockToken: "native-rollback-lock",
    });
    const control = await t.run(async (ctx) =>
      ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
    );
    expect(control?.activationLockToken).toBe("native-rollback-lock");
    expect(control?.activationLockedAt).toEqual(expect.any(Number));
    expect(control?.activationLeaderboardRunId).toBeUndefined();
    expect(control?.activationTrendingRunId).toBeUndefined();
    await expect(
      t.mutation(internal.skillsShMirrorVisibility.finalizeActivationInternal, {
        actor: "activating-action",
        reason: "stale activation",
        confirm: "activate-skills-sh-public-test",
        lockToken: "in-flight-lock",
        leaderboardRunId,
        trendingRunId,
        snapshotId: "stale-snapshot",
        nativePoolId: "stale-native-pool",
        expectedSkillsShTrending: 0,
      }),
    ).rejects.toThrow("activation lock or source run changed before publication");
  });

  it("reconciles all row eligibility before atomically opening the scanless lane", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "snapshot",
        sourceView: "leaderboard",
        status: "completed",
        sourceTotal: 2,
        sourcePageSize: 100,
        sourceMeasuredAt: new Date(1).toISOString(),
        page: 1,
        offset: 0,
        counts: {
          observed: 2,
          inserted: 2,
          updated: 0,
          unchanged: 0,
          rejected: 0,
          conflicts: 0,
          detailsInserted: 0,
          detailsUpdated: 0,
          detailsUnchanged: 0,
          detailsMissing: 0,
          detailsTruncated: 0,
          tombstoned: 0,
          reactivated: 0,
          scansPlanned: 0,
          scansAdmitted: 0,
        },
        operations: {
          functionCalls: 1,
          dbReads: 0,
          dbWrites: 2,
          sourceRequests: 0,
          sourceBytes: 0,
        },
        actor: "codex-test",
        reason: "CLAW-603 visibility test",
        startedAt: 1,
        completedAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert(
        "skillsShMirrorDigests",
        digest({
          lastObservedRunId: runId,
          externalId: "patrick/skills/eligible",
          slug: "eligible",
          normalizedSlug: "eligible",
          normalizedSlugFirstToken: "eligible",
          displayName: "Eligible",
          normalizedDisplayName: "eligible",
          normalizedDisplayNameFirstToken: "eligible",
          searchText: "eligible",
          sourceUrl: "https://skills.sh/patrick/skills/eligible",
          githubPath: "skills/eligible",
          publicVisible: false,
          installable: false,
        }),
      );
      await ctx.db.insert(
        "skillsShMirrorDigests",
        digest({
          lastObservedRunId: runId,
          externalId: "patrick/skills/incomplete",
          slug: "incomplete",
          normalizedSlug: "incomplete",
          normalizedSlugFirstToken: "incomplete",
          displayName: "Incomplete",
          normalizedDisplayName: "incomplete",
          normalizedDisplayNameFirstToken: "incomplete",
          searchText: "incomplete",
          sourceUrl: "https://skills.sh/patrick/skills/incomplete",
          githubPath: undefined,
          publicVisible: true,
          installable: true,
        }),
      );
    });

    await expect(
      t.action(internal.skillsShMirrorVisibility.reconcileEligibilityInternal, {
        confirm: "activate-skills-sh-public-test",
      }),
    ).resolves.toMatchObject({
      scanned: 2,
      changed: 2,
      eligible: 1,
      hiddenEligible: 1,
      unsafePublished: 1,
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    await expect(
      t.action(internal.skillsShMirrorVisibility.auditInternal, {}),
    ).resolves.toMatchObject({
      counts: {
        total: 2,
        eligible: 1,
        eligiblePublished: 1,
        hiddenEligible: 0,
        unsafePublished: 0,
      },
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShCatalogControls", {
        key: "global",
        mode: "off",
        discoveryEnabled: false,
        writesEnabled: false,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
        publicVisibilityEnabled: false,
        mirrorPublicVisibilityEnabled: false,
        paused: true,
        maxEntriesPerRun: 17,
        maxEntriesPerBatch: 11,
        maxWritesPerBatch: 7,
        maxPlannedScans: 0,
        maxScanAdmissionsPerBatch: 0,
        maxScanAdmissionsPerRun: 0,
        maxScanAdmissionsPerDay: 0,
        maxCatalogQueued: 3,
        maxCatalogInFlight: 2,
        maxNativeQueued: 5,
        maxNativeInFlight: 4,
        realScanAllowlist: [],
        updatedBy: "existing-operator",
        reason: "preserve this control",
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(internal.skillsShMirrorVisibility.setPublicGateInternal, {
        enabled: true,
        actor: "codex-test",
        reason: "CLAW-603 direct activation must be rejected",
        confirm: "activate-skills-sh-public-test",
      }),
    ).rejects.toThrow("only the verified activation action can enable the skills.sh public gate");

    await t.mutation(internal.skillsShMirrorVisibility.setPublicGateInternal, {
      enabled: false,
      actor: "codex-test",
      reason: "CLAW-603 rollback test",
      confirm: "deactivate-skills-sh-public-test",
    });
    const state = await t.run(async (ctx) => ({
      control: await ctx.db
        .query("skillsShCatalogControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
      digests: await ctx.db.query("skillsShMirrorDigests").collect(),
    }));
    expect(state.control?.publicVisibilityEnabled).toBe(false);
    expect(state.control?.mirrorPublicVisibilityEnabled).toBe(false);
    expect(state.control).toMatchObject({
      mode: "off",
      paused: true,
      maxEntriesPerRun: 17,
      maxCatalogQueued: 3,
      maxNativeInFlight: 4,
    });
    expect(state.digests.find((row) => row.slug === "eligible")).toMatchObject({
      publicVisible: true,
      installable: true,
    });
  });
});

function mirrorRunCounts(
  overrides: Partial<Doc<"skillsShMirrorRuns">["counts"]> = {},
): Doc<"skillsShMirrorRuns">["counts"] {
  return {
    observed: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    quarantined: 0,
    conflicts: 0,
    detailsInserted: 0,
    detailsUpdated: 0,
    detailsUnchanged: 0,
    detailsMissing: 0,
    detailsTruncated: 0,
    tombstoned: 0,
    reactivated: 0,
    trendingJoined: 0,
    trendingMissing: 0,
    scansPlanned: 0,
    scansAdmitted: 0,
    ...overrides,
  };
}

function mirrorRun(
  overrides: Partial<Doc<"skillsShMirrorRuns">> = {},
): Omit<Doc<"skillsShMirrorRuns">, "_id" | "_creationTime"> {
  return {
    snapshotId: "skills-sh:test-run",
    sourceView: "leaderboard",
    status: "completed",
    sourceTotal: 0,
    sourcePageSize: 500,
    sourceMeasuredAt: new Date(1).toISOString(),
    page: 1,
    offset: 0,
    counts: mirrorRunCounts(),
    operations: {
      functionCalls: 1,
      dbReads: 0,
      dbWrites: 0,
      sourceRequests: 0,
      sourceBytes: 0,
    },
    actor: "codex-test",
    reason: "CLAW-603 verification test",
    startedAt: 1,
    completedAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function digest(
  overrides: Partial<Doc<"skillsShMirrorDigests">>,
): Omit<Doc<"skillsShMirrorDigests">, "_id" | "_creationTime"> {
  return {
    externalId: "patrick/skills/demo",
    sourceType: "github",
    upstreamSourceType: "github",
    owner: "patrick",
    repo: "skills",
    slug: "demo",
    normalizedSlug: "demo",
    normalizedSlugFirstToken: "demo",
    displayName: "Demo",
    normalizedDisplayName: "demo",
    normalizedDisplayNameFirstToken: "demo",
    searchText: "demo",
    sourceUrl: "https://skills.sh/patrick/skills/demo",
    canonicalRepoUrl: "https://github.com/patrick/skills",
    githubPath: "skills/demo",
    githubCommit: "c".repeat(40),
    sourceContentHash: "a".repeat(64),
    upstreamInstalls: 1,
    upstreamScanners: {
      genAgentTrustHub: { status: "pass" },
      socket: { status: "pass" },
      snyk: { status: "warn" },
    },
    inferredCategories: ["development"],
    inferredTopics: ["skills"],
    sourceFreshnessStatus: "observed-only",
    detailStatus: "available",
    observationFingerprint: "fingerprint",
    sourceSnapshotId: "snapshot",
    lastObservedRunId:
      "skillsShMirrorRuns:run" as Doc<"skillsShMirrorDigests">["lastObservedRunId"],
    active: true,
    publicVisible: false,
    installable: false,
    firstObservedAt: 1,
    lastObservedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
