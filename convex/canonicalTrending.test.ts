/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
});

function nativeCard(id: string, installs24h: number) {
  const slug = id.replace("clawhub:", "");
  return {
    id,
    source: "clawhub" as const,
    slug,
    displayName: slug,
    summary: null,
    canonicalUrl: `/patrick/skills/${slug}`,
    links: { canonical: `/patrick/skills/${slug}`, source: null },
    publisher: {
      kind: "user" as const,
      handle: "patrick",
      displayName: "Patrick",
      image: null,
      official: false,
    },
    official: false,
    featured: false,
    install: { kind: "clawhub" as const, reference: `patrick/${slug}`, sourceUrl: null },
    sourceIdentity: {
      id,
      owner: "patrick",
      repo: null,
      host: null,
      lifetimeInstalls: null,
    },
    trust: {
      visibility: "public" as const,
      installability: "installable" as const,
      clawHubVerdict: null,
      upstreamScanners: null,
      sourceFreshness: "native" as const,
    },
    metrics: {
      trending24hInstalls: installs24h,
      trending24hBookmarks: 0,
      lifetimeInstalls: null,
      lifetimeInstallsPeriod: "lifetime" as const,
      updatedAt: 1_000,
    },
  };
}

async function insertEligibleNativeSource(t: ReturnType<typeof convexTest>, slug: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      handle: "patrick",
      displayName: "Patrick",
      createdAt: now,
      updatedAt: now,
    });
    const skillId = await ctx.db.insert("skills", {
      slug,
      displayName: slug,
      ownerUserId: userId,
      tags: {},
      stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Initial",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: now,
    });
    const digestId = await ctx.db.insert("skillSearchDigest", {
      skillId,
      slug,
      displayName: slug,
      ownerUserId: userId,
      ownerHandle: "patrick",
      ownerKind: "user",
      ownerName: "patrick",
      ownerDisplayName: "Patrick",
      latestVersionId: versionId,
      latestVersionSkillId: skillId,
      publicVersion: { status: "available", versionId },
      tags: {},
      stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
      createdAt: now,
      updatedAt: now,
    });
    return { digestId, skillId };
  });
}

async function insertReadyNativePool(
  t: ReturnType<typeof convexTest>,
  input: {
    poolId: string;
    skillId: Awaited<ReturnType<typeof insertEligibleNativeSource>>["skillId"];
    now: number;
  },
) {
  await t.mutation(internal.canonicalTrending.startNativePoolInternal, {
    poolId: input.poolId,
    generatedAt: input.now - 1_000,
    expiresAt: input.now + 24 * 60 * 60 * 1_000,
    windowStartHour: 100,
    windowEndHour: 123,
    sealedGeneration: 7,
  });
  await t.mutation(internal.canonicalTrending.writeNativePoolItemsInternal, {
    poolId: input.poolId,
    lane: "clawhub-trending",
    items: [
      {
        identity: `clawhub:${input.poolId}`,
        publisherKey: "user:patrick",
        installs24h: 8,
        bookmarks24h: 1,
        createdAt: input.now - 10_000,
        updatedAt: input.now - 1_000,
        upstreamRank: null,
        sourceRef: { kind: "clawhub", skillId: input.skillId },
        card: nativeCard(`clawhub:${input.poolId}`, 8),
      },
    ],
  });
  await t.mutation(internal.canonicalTrending.finalizeNativePoolInternal, {
    poolId: input.poolId,
    completedAt: input.now - 500,
    sourceCounts: { clawhubTrending: 1, clawhubRising: 0 },
    operations: { documentsRead: 10, documentsWritten: 4, functionCalls: 3 },
  });
}

describe("canonical Trending snapshot storage", () => {
  it("selects the newest completed Trending run even when no digest references it", async () => {
    const t = convexTest(schema, modules);
    const makeRun = (snapshotId: string, startedAt: number) => ({
      snapshotId,
      sourceView: "trending" as const,
      sourceSnapshotHash: snapshotId.padEnd(64, "a").slice(0, 64),
      status: "completed" as const,
      sourceTotal: 0,
      sourcePageSize: 100,
      sourceMeasuredAt: new Date(startedAt).toISOString(),
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
        scansPlanned: 0 as const,
        scansAdmitted: 0 as const,
      },
      operations: { functionCalls: 1, dbReads: 1, dbWrites: 1, sourceRequests: 1, sourceBytes: 0 },
      actor: "runtime-test",
      reason: "canonical Trending run selection test",
      startedAt,
      completedAt: startedAt + 1,
      updatedAt: startedAt + 1,
    });
    const { latestId } = await t.run(async (ctx) => {
      await ctx.db.insert("skillsShMirrorRuns", makeRun("older-run", 100));
      const insertedLatestId = await ctx.db.insert(
        "skillsShMirrorRuns",
        makeRun("empty-latest-run", 200),
      );
      return { latestId: insertedLatestId };
    });

    const result = await t.query(
      internal.canonicalTrending.getLatestCompletedTrendingRunInternal,
      {},
    );

    expect(result.runId).toBe(latestId);
  });

  it("keeps pagination pinned to the snapshot encoded by the cursor", async () => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
    const t = convexTest(schema, modules);
    const source = await insertEligibleNativeSource(t, "pagination-source");
    const now = Date.now();

    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-1000",
      generatedAt: now - 1_000,
      expiresAt: now + 100_000,
      windowStartDay: 40,
      windowEndDay: 40,
    });
    await t.mutation(internal.canonicalTrending.writeItemsInternal, {
      snapshotId: "skills-1000",
      items: [
        {
          position: 0,
          lane: "clawhub-trending",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: nativeCard("clawhub:one", 3),
        },
        {
          position: 1,
          lane: "clawhub-trending",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: nativeCard("clawhub:two", 2),
        },
        {
          position: 2,
          lane: "clawhub-rising",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: nativeCard("clawhub:three", 1),
        },
      ],
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-1000",
      completedAt: now - 950,
      totalItems: 3,
      sourceCounts: { clawhubTrending: 2, clawhubRising: 1, skillsShTrending: 0 },
      operations: { documentsRead: 12, documentsWritten: 4, functionCalls: 3 },
    });

    const firstResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: null,
      limit: 2,
    });
    expect(firstResult.status).toBe("ok");
    if (firstResult.status !== "ok") throw new Error("Expected a ready Trending page");
    const firstPage = firstResult.page;
    expect(firstPage).toMatchObject({
      kind: "skills",
      snapshotId: "skills-1000",
      generatedAt: new Date(now - 1_000).toISOString(),
      windowHours: 24,
      rankingVersion: "skills-trending-v4",
      items: [
        { id: "clawhub:one", rank: 1, lane: "clawhub-trending" },
        { id: "clawhub:two", rank: 2, lane: "clawhub-trending" },
      ],
    });
    expect(firstPage?.nextCursor).toEqual(expect.any(String));

    const beyondVisibleTotalCursor = btoa(
      JSON.stringify({ v: 1, s: "skills-1000", o: 5, e: 4, p: false }),
    ).replace(/=+$/g, "");
    await expect(
      t.query(internal.canonicalTrending.getPageInternal, {
        cursor: beyondVisibleTotalCursor,
        limit: 2,
      }),
    ).resolves.toEqual({ status: "invalid-cursor" });

    const ambiguousLegacyCursor = btoa(JSON.stringify({ v: 1, s: "skills-1000", o: 2 })).replace(
      /=+$/g,
      "",
    );
    await expect(
      t.query(internal.canonicalTrending.getPageInternal, {
        cursor: ambiguousLegacyCursor,
        limit: 2,
      }),
    ).resolves.toEqual({ status: "invalid-cursor" });

    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-2000",
      generatedAt: now,
      expiresAt: now + 100_000,
      windowStartDay: 41,
      windowEndDay: 41,
    });
    await t.mutation(internal.canonicalTrending.writeItemsInternal, {
      snapshotId: "skills-2000",
      items: [
        {
          position: 0,
          lane: "clawhub-trending",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: nativeCard("clawhub:new", 10),
        },
      ],
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-2000",
      completedAt: now + 50,
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 5, documentsWritten: 2, functionCalls: 3 },
    });

    const secondResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: firstPage?.nextCursor ?? null,
      limit: 2,
    });
    expect(secondResult.status).toBe("ok");
    if (secondResult.status !== "ok") throw new Error("Expected the pinned Trending page");
    const secondPage = secondResult.page;
    expect(secondPage?.snapshotId).toBe("skills-1000");
    expect(secondPage?.items).toEqual([
      expect.objectContaining({ id: "clawhub:three", rank: 3, lane: "clawhub-rising" }),
    ]);
    expect(secondPage?.nextCursor).toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShCatalogControls", {
        key: "global",
        mode: "off",
        discoveryEnabled: false,
        writesEnabled: false,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
        publicVisibilityEnabled: true,
        mirrorPublicVisibilityEnabled: true,
        paused: true,
        maxEntriesPerRun: 0,
        maxEntriesPerBatch: 0,
        maxWritesPerBatch: 0,
        maxPlannedScans: 0,
        maxScanAdmissionsPerBatch: 0,
        maxScanAdmissionsPerRun: 0,
        maxScanAdmissionsPerDay: 0,
        maxCatalogQueued: 0,
        maxCatalogInFlight: 0,
        maxNativeQueued: 0,
        maxNativeInFlight: 0,
        realScanAllowlist: [],
        updatedBy: "pagination-test",
        reason: "visibility generation changed",
        updatedAt: now,
      });
    });
    await expect(
      t.query(internal.canonicalTrending.getPageInternal, {
        cursor: firstPage.nextCursor,
        limit: 2,
      }),
    ).resolves.toEqual({ status: "invalid-cursor" });

    const postActivationResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: null,
      limit: 2,
    });
    expect(postActivationResult.status).toBe("ok");
    if (postActivationResult.status !== "ok") {
      throw new Error("Expected a fresh cursor after the visibility generation changed");
    }

    await t.run(async (ctx) => {
      await ctx.db.patch(source.digestId, { softDeletedAt: Date.now() });
    });
    const revokedResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: postActivationResult.page.snapshotCursor,
      limit: 2,
    });
    expect(revokedResult.status).toBe("ok");
    if (revokedResult.status !== "ok") throw new Error("Expected the pinned Trending page");
    expect(revokedResult.page.items).toEqual([]);
  });

  it("rejects an expired stable cursor before reading pruned item rows", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-expired",
      generatedAt: 1_000,
      expiresAt: Date.now() - 1,
      windowStartDay: 40,
      windowEndDay: 40,
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-expired",
      completedAt: 1_050,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 1, documentsWritten: 2, functionCalls: 2 },
    });

    expect(
      await t.query(internal.canonicalTrending.getPageInternal, {
        cursor: "eyJ2IjoxLCJzIjoic2tpbGxzLWV4cGlyZWQiLCJvIjowfQ",
        limit: 20,
      }),
    ).toEqual({ status: "expired" });
    expect(
      await t.query(internal.canonicalTrending.getPageInternal, { cursor: null, limit: 20 }),
    ).toEqual({ status: "unavailable" });
  });

  it("returns a typed error for malformed cursors", async () => {
    const t = convexTest(schema, modules);

    expect(
      await t.query(internal.canonicalTrending.getPageInternal, {
        cursor: "not-a-cursor",
        limit: 20,
      }),
    ).toEqual({ status: "invalid-cursor" });
  });

  it("reports unavailable without writing when native hourly stats are not ready", async () => {
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const t = convexTest(schema, modules);

    const result = await t.action(internal.canonicalTrending.materializeInternal, {});
    const snapshots = await t.run(async (ctx) =>
      ctx.db.query("canonicalTrendingSnapshots").collect(),
    );

    expect(result).toEqual({ status: "unavailable", reason: "hourly-stats-not-ready" });
    expect(snapshots).toEqual([]);
  });

  it("anchors the rolling window to a fresh completed aggregation across cron boundaries", async () => {
    const t = convexTest(schema, modules);
    const now = 100 * 60 * 60 * 1_000 + 7 * 60 * 1_000;
    const lastAggregationCompletedAt = now - 15 * 60 * 1_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("skillHourlyStatStates", {
        key: "canonical_trending",
        liveStartedAt: now - 60 * 60 * 1_000,
        eventBackfillThroughCreationTime: 100,
        activeGeneration: 1,
        backfillCompletedAt: now - 30 * 60 * 1_000,
        lastAggregationCompletedAt,
        updatedAt: lastAggregationCompletedAt,
      });
    });

    await expect(
      t.mutation(internal.skillHourlyStats.sealForSnapshotInternal, { now }),
    ).resolves.toMatchObject({
      startHour: 75,
      endHour: 98,
      startAt: 75 * 60 * 60 * 1_000,
      endAt: 99 * 60 * 60 * 1_000,
      lastAggregationCompletedAt,
      sealedGeneration: 1,
    });
  });

  it("rejects hourly aggregation state once it is two hours old", async () => {
    const t = convexTest(schema, modules);
    const now = 100 * 60 * 60 * 1_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("skillHourlyStatStates", {
        key: "canonical_trending",
        liveStartedAt: now - 3 * 60 * 60 * 1_000,
        eventBackfillThroughCreationTime: 100,
        activeGeneration: 1,
        backfillCompletedAt: now - 3 * 60 * 60 * 1_000,
        lastAggregationCompletedAt: now - 2 * 60 * 60 * 1_000,
        updatedAt: now - 2 * 60 * 60 * 1_000,
      });
    });

    await expect(
      t.mutation(internal.skillHourlyStats.sealForSnapshotInternal, { now }),
    ).resolves.toBeNull();
  });

  it("materializes native rolling activity while skills.sh is disabled", async () => {
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const t = convexTest(schema, modules);
    const source = await insertEligibleNativeSource(t, "native-only");
    const now = Date.now();
    const window = getCompletedRolling24HourWindow(now);
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
        skillId: source.skillId,
        hour: window.endHour,
        generation: 0,
        downloads: 6,
        installs: 8,
        bookmarks: 3,
        updatedAt: now,
        expiresAt: now + 72 * 3_600_000,
      });
    });

    const result = await t.action(internal.canonicalTrending.materializeInternal, {});

    expect(result).toMatchObject({
      status: "ready",
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
      sample: [
        expect.objectContaining({
          id: expect.stringMatching(/^clawhub:/),
          trending24hDownloads: 6,
          trending24hInstalls: 8,
        }),
      ],
    });
  });

  it("reads native digests only for skills with rolling activity", async () => {
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const t = convexTest(schema, modules);
    const activeSource = await insertEligibleNativeSource(t, "active-source");
    for (let index = 0; index < 12; index += 1) {
      await insertEligibleNativeSource(t, `inactive-source-${index}`);
    }
    const now = Date.now();
    const window = getCompletedRolling24HourWindow(now);
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
        skillId: activeSource.skillId,
        hour: window.endHour,
        generation: 0,
        downloads: 1,
        installs: 4,
        bookmarks: 0,
        updatedAt: now,
        expiresAt: now + 72 * 3_600_000,
      });
    });

    const result = await t.action(internal.canonicalTrending.materializeInternal, {});

    expect(result).toMatchObject({
      status: "ready",
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
      operations: { documentsRead: 2 },
      sample: [expect.objectContaining({ id: `clawhub:${activeSource.skillId}` })],
    });
  });

  it("stops serving the last good snapshot after two hours", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-stale-serving",
      generatedAt: now - 2 * 60 * 60 * 1_000 - 1,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-stale-serving",
      completedAt: now - 2 * 60 * 60 * 1_000,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 1, documentsWritten: 2, functionCalls: 2 },
    });

    expect(
      await t.query(internal.canonicalTrending.getPageInternal, { cursor: null, limit: 20 }),
    ).toEqual({ status: "unavailable" });
  });

  it("returns the current native-only snapshot for guarded preflight reuse", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const source = await insertEligibleNativeSource(t, "native-preflight-ready");
    await insertReadyNativePool(t, {
      poolId: "skills-native-preflight-ready",
      skillId: source.skillId,
      now,
    });
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-native-preflight-ready",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
      windowStartHour: 100,
      windowEndHour: 123,
    });
    await t.mutation(internal.canonicalTrending.writeItemsInternal, {
      snapshotId: "skills-native-preflight-ready",
      items: [
        {
          position: 0,
          lane: "clawhub-trending",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: {
            ...nativeCard("clawhub:native-preflight-ready", 8),
            metrics: {
              ...nativeCard("clawhub:native-preflight-ready", 8).metrics,
              trending24hDownloads: 6,
            },
          },
        },
      ],
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-native-preflight-ready",
      completedAt: now - 500,
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
      nativePoolId: "skills-native-preflight-ready",
    });

    await expect(
      t.query(internal.canonicalTrending.getReadyNativeSnapshotInternal, { now }),
    ).resolves.toEqual({
      status: "ready",
      snapshotId: "skills-native-preflight-ready",
      generatedAt: new Date(now - 1_000).toISOString(),
      windowHours: 24,
      rankingVersion: "skills-trending-v4",
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
      nativePool: {
        poolId: "skills-native-preflight-ready",
        sourceCounts: { clawhubTrending: 1, clawhubRising: 0 },
        operations: { documentsRead: 10, documentsWritten: 4, functionCalls: 3 },
      },
      reused: true,
    });
  });

  it("does not expose an orphan native pool as ready for mixed activation", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const source = await insertEligibleNativeSource(t, "orphan-native-pool");
    await insertReadyNativePool(t, {
      poolId: "skills-orphan-native-pool",
      skillId: source.skillId,
      now,
    });

    await expect(
      t.query(internal.canonicalTrending.getReadyNativePoolInternal, { now }),
    ).resolves.toBeNull();
  });

  it("reuses the verified native pool linked to a mixed hourly snapshot", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const source = await insertEligibleNativeSource(t, "mixed-hourly-native-pool");
    await insertReadyNativePool(t, {
      poolId: "skills-mixed-hourly-native-pool",
      skillId: source.skillId,
      now,
    });
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-mixed-hourly-native-pool",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
      windowStartHour: 100,
      windowEndHour: 123,
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-mixed-hourly-native-pool",
      completedAt: now - 500,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0, skillsShTrending: 1 },
      operations: { documentsRead: 20, documentsWritten: 5, functionCalls: 4 },
      nativePoolId: "skills-mixed-hourly-native-pool",
    });

    await expect(
      t.query(internal.canonicalTrending.getReadyNativePoolInternal, { now }),
    ).resolves.toMatchObject({
      poolId: "skills-mixed-hourly-native-pool",
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0 },
    });
  });

  it("reuses an older verified native pool when a newer orphan exists", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const source = await insertEligibleNativeSource(t, "verified-before-orphan");
    await insertReadyNativePool(t, {
      poolId: "skills-verified-before-orphan",
      skillId: source.skillId,
      now,
    });
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-verified-before-orphan",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
      windowStartHour: 100,
      windowEndHour: 123,
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-verified-before-orphan",
      completedAt: now - 500,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
      nativePoolId: "skills-verified-before-orphan",
    });
    await insertReadyNativePool(t, {
      poolId: "skills-newer-orphan",
      skillId: source.skillId,
      now: now + 500,
    });

    await expect(
      t.query(internal.canonicalTrending.getReadyNativePoolInternal, { now }),
    ).resolves.toMatchObject({ poolId: "skills-verified-before-orphan" });
  });

  it("keeps a native snapshot ready but marks a mismatched pool unusable", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const source = await insertEligibleNativeSource(t, "mismatched-native-pool");
    await insertReadyNativePool(t, {
      poolId: "skills-mismatched-native-pool",
      skillId: source.skillId,
      now,
    });
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-mismatched-native-pool",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
      windowStartHour: 100,
      windowEndHour: 123,
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-mismatched-native-pool",
      completedAt: now - 500,
      totalItems: 0,
      sourceCounts: { clawhubTrending: 0, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 1, documentsWritten: 2, functionCalls: 2 },
      nativePoolId: "skills-mismatched-native-pool",
    });

    await expect(
      t.query(internal.canonicalTrending.getReadyNativeSnapshotInternal, { now }),
    ).resolves.toMatchObject({
      snapshotId: "skills-mismatched-native-pool",
      nativePool: null,
    });
    await expect(
      t.query(internal.canonicalTrending.getReadyNativePoolInternal, { now }),
    ).resolves.toBeNull();
  });

  it("does not reuse a native-only snapshot from the pre-download ranking version", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const source = await insertEligibleNativeSource(t, "legacy-native-preflight");
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-legacy-native-preflight",
      generatedAt: now - 1_000,
      expiresAt: now + 24 * 60 * 60 * 1_000,
      windowStartDay: 40,
      windowEndDay: 40,
    });
    await t.mutation(internal.canonicalTrending.writeItemsInternal, {
      snapshotId: "skills-legacy-native-preflight",
      items: [
        {
          position: 0,
          lane: "clawhub-trending",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: {
            ...nativeCard("clawhub:legacy-native-preflight", 8),
            metrics: {
              ...nativeCard("clawhub:legacy-native-preflight", 8).metrics,
              trending24hDownloads: 6,
            },
          },
        },
      ],
    });
    await t.mutation(internal.canonicalTrending.finalizeSnapshotInternal, {
      snapshotId: "skills-legacy-native-preflight",
      completedAt: now - 500,
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 0, skillsShTrending: 0 },
      operations: { documentsRead: 10, documentsWritten: 2, functionCalls: 3 },
    });
    await t.run(async (ctx) => {
      const snapshot = await ctx.db
        .query("canonicalTrendingSnapshots")
        .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", "skills-legacy-native-preflight"))
        .unique();
      if (!snapshot) throw new Error("Expected legacy native snapshot");
      await ctx.db.patch(snapshot._id, { rankingVersion: "skills-trending-v2" });
    });

    await expect(
      t.query(internal.canonicalTrending.getReadyNativeSnapshotInternal, { now }),
    ).resolves.toBeNull();
  });

  it("never serves a snapshot produced by the legacy ranking algorithm", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("canonicalTrendingSnapshots", {
        snapshotId: "skills-legacy-ranking",
        kind: "skills",
        status: "ready",
        rankingVersion: "skills-trending-v1",
        generatedAt: now,
        completedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1_000,
        windowHours: 24,
        windowStartDay: 40,
        windowEndDay: 40,
        writtenItems: 0,
        totalItems: 0,
      });
    });

    expect(
      await t.query(internal.canonicalTrending.getPageInternal, { cursor: null, limit: 20 }),
    ).toEqual({ status: "unavailable" });
  });

  it("prunes expired snapshots independently while materialization is dark", async () => {
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const t = convexTest(schema, modules);
    const source = await insertEligibleNativeSource(t, "cleanup-source");
    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-expired-cleanup",
      generatedAt: 1_000,
      expiresAt: Date.now() - 1,
      windowStartDay: 40,
      windowEndDay: 40,
    });
    await t.mutation(internal.canonicalTrending.writeItemsInternal, {
      snapshotId: "skills-expired-cleanup",
      items: [
        {
          position: 0,
          lane: "clawhub-trending",
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: nativeCard("clawhub:old", 1),
        },
      ],
    });
    await t.mutation(internal.canonicalTrending.startNativePoolInternal, {
      poolId: "skills-expired-cleanup",
      generatedAt: 1_000,
      expiresAt: Date.now() - 1,
      windowStartHour: 100,
      windowEndHour: 123,
      sealedGeneration: 1,
    });
    await t.mutation(internal.canonicalTrending.writeNativePoolItemsInternal, {
      poolId: "skills-expired-cleanup",
      lane: "clawhub-trending",
      items: [
        {
          identity: "clawhub:old",
          publisherKey: "user:patrick",
          installs24h: 1,
          bookmarks24h: 0,
          createdAt: 1_000,
          updatedAt: 1_000,
          upstreamRank: null,
          sourceRef: { kind: "clawhub", skillId: source.skillId },
          card: nativeCard("clawhub:old", 1),
        },
      ],
    });

    const result = await t.action(internal.canonicalTrending.pruneExpiredActionInternal, {});
    const rows = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("canonicalTrendingSnapshots").collect(),
      items: await ctx.db.query("canonicalTrendingItems").collect(),
      nativePools: await ctx.db.query("canonicalTrendingNativePools").collect(),
      nativePoolItems: await ctx.db.query("canonicalTrendingNativePoolItems").collect(),
    }));

    expect(result).toEqual({
      itemsDeleted: 2,
      snapshotsDeleted: 2,
      batches: 1,
      continuationScheduled: false,
    });
    expect(rows).toEqual({ snapshots: [], items: [], nativePools: [], nativePoolItems: [] });
  });

  it("materializes hourly native metrics with verified skills.sh rows under the activation lock", async () => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
    const t = convexTest(schema, modules);
    const now = Date.now();
    const window = getCompletedRolling24HourWindow(now);

    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShCatalogControls", {
        key: "global",
        mode: "staging-live",
        discoveryEnabled: true,
        writesEnabled: false,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
        publicVisibilityEnabled: false,
        mirrorPublicVisibilityEnabled: false,
        paused: false,
        maxEntriesPerRun: 0,
        maxEntriesPerBatch: 0,
        maxWritesPerBatch: 0,
        maxPlannedScans: 0,
        maxScanAdmissionsPerBatch: 0,
        maxScanAdmissionsPerRun: 0,
        maxScanAdmissionsPerDay: 0,
        maxCatalogQueued: 0,
        maxCatalogInFlight: 0,
        maxNativeQueued: 0,
        maxNativeInFlight: 0,
        realScanAllowlist: [],
        updatedBy: "runtime-test",
        reason: "canonical Trending runtime test",
        updatedAt: now,
      });
      await ctx.db.insert("skillsShMirrorControls", {
        key: "global",
        enabled: true,
        paused: false,
        maxRowsPerRun: 50_000,
        maxRowsPerBatch: 50,
        maxDetailBytes: 65_536,
        activationLockToken: "activation-lock",
        activationLockedAt: now,
        updatedBy: "runtime-test",
        reason: "canonical Trending hidden activation test",
        updatedAt: now,
      });
      const userId = await ctx.db.insert("users", {
        handle: "patrick",
        displayName: "Patrick",
        createdAt: now,
        updatedAt: now,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "native",
        displayName: "Native",
        summary: "Native summary",
        ownerUserId: userId,
        tags: {},
        statsInstallsAllTime: 900,
        stats: { downloads: 1_000, installsAllTime: 900, stars: 20, versions: 1, comments: 0 },
        createdAt: now - 1_000,
        updatedAt: now,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Initial",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: now,
      });
      await ctx.db.insert("skillSearchDigest", {
        skillId,
        slug: "native",
        displayName: "Native",
        summary: "Native summary",
        ownerUserId: userId,
        ownerHandle: "patrick",
        ownerKind: "user",
        ownerName: "patrick",
        ownerDisplayName: "Patrick",
        latestVersionId: versionId,
        latestVersionSkillId: skillId,
        publicVersion: { status: "available", versionId },
        tags: {},
        statsInstallsAllTime: 900,
        stats: { downloads: 1_000, installsAllTime: 900, stars: 20, versions: 1, comments: 0 },
        createdAt: now - 1_000,
        updatedAt: now,
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
      await ctx.db.insert("skillHourlyStats", {
        skillId,
        hour: window.endHour,
        generation: 0,
        downloads: 18,
        installs: 12,
        bookmarks: 4,
        updatedAt: now,
        expiresAt: now + 72 * 3_600_000,
      });
      const trendingRunId = await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "skills-sh-trending-runtime",
        sourceView: "trending",
        sourceSnapshotHash: "b".repeat(64),
        status: "completed",
        sourceTotal: 1,
        sourcePageSize: 100,
        sourceMeasuredAt: new Date(now).toISOString(),
        page: 1,
        offset: 0,
        counts: {
          observed: 1,
          inserted: 0,
          updated: 1,
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
          dbReads: 1,
          dbWrites: 1,
          sourceRequests: 1,
          sourceBytes: 100,
        },
        actor: "runtime-test",
        reason: "canonical Trending runtime test",
        startedAt: now - 100,
        completedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("skillsShMirrorDigests", {
        externalId: "patrick/repo/external",
        sourceType: "github",
        owner: "patrick",
        repo: "repo",
        slug: "external",
        normalizedSlug: "external",
        normalizedSlugFirstToken: "external",
        displayName: "External",
        normalizedDisplayName: "external",
        normalizedDisplayNameFirstToken: "external",
        searchSummary: "External summary",
        searchText: "external external summary",
        sourceUrl: "https://skills.sh/patrick/repo/external",
        canonicalRepoUrl: "https://github.com/patrick/repo",
        upstreamInstalls: 4_000,
        trendingRank: 1,
        trendingLifetimeInstalls: 4_200,
        trendingObservedAt: now,
        trendingSnapshotId: "skills-sh-trending-runtime",
        trendingObservedRunId: trendingRunId,
        upstreamScanners: {
          genAgentTrustHub: { status: "pass" },
          socket: { status: "pass" },
          snyk: { status: "pass" },
        },
        sourceFreshnessStatus: "observed-only",
        detailStatus: "available",
        observationFingerprint: "c".repeat(64),
        sourceSnapshotId: "skills-sh-trending-runtime",
        lastObservedRunId: trendingRunId,
        active: true,
        publicVisible: true,
        installable: true,
        firstObservedAt: now - 500,
        lastObservedAt: now,
        createdAt: now - 500,
        updatedAt: now,
      });
    });

    const nativePreflight = await t.action(internal.canonicalTrending.materializeInternal, {
      activationLockToken: "activation-lock",
    });
    expect(nativePreflight).toMatchObject({
      status: "ready",
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
      nativePool: { reused: false },
    });

    const result = await t.action(internal.canonicalTrending.materializeInternal, {
      activationLockToken: "activation-lock",
    });
    expect(result).toMatchObject({
      status: "ready",
      totalItems: 2,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 1 },
      nativePool: { poolId: nativePreflight.snapshotId, reused: true },
      sample: [
        {
          rank: 1,
          lane: "clawhub-trending",
          id: expect.stringMatching(/^clawhub:/),
          trending24hDownloads: 18,
          trending24hInstalls: 12,
          lifetimeInstalls: 900,
        },
        {
          rank: 2,
          lane: "skills-sh-trending",
          id: "skills-sh:patrick/repo/external",
          trending24hDownloads: null,
          trending24hInstalls: null,
          lifetimeInstalls: 4_200,
        },
      ],
    });
    if (!result.snapshotId) throw new Error("Expected a materialized Trending snapshot ID");
    const snapshotId = result.snapshotId;

    await t.run(async (ctx) => {
      const items = await ctx.db
        .query("canonicalTrendingItems")
        .withIndex("by_snapshot_id_and_position", (q) => q.eq("snapshotId", snapshotId))
        .collect();
      const native = items.find((item) => item.sourceRef.kind === "clawhub");
      const external = items.find((item) => item.sourceRef.kind === "skills-sh");
      if (!native || !external) throw new Error("mixed Trending fixture missing");
      await ctx.db.patch(native._id, { position: 99 });
      await ctx.db.patch(external._id, { position: 0 });
      await ctx.db.patch(native._id, { position: 1 });
    });
    const hiddenPageResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: null,
      limit: 1,
    });
    expect(hiddenPageResult.status).toBe("ok");
    if (hiddenPageResult.status !== "ok") throw new Error("Expected a hidden Trending page");
    expect(hiddenPageResult.page.items.map((item) => item.source)).toEqual(["clawhub"]);

    await t.run(async (ctx) => {
      const items = await ctx.db
        .query("canonicalTrendingItems")
        .withIndex("by_snapshot_id_and_position", (q) => q.eq("snapshotId", snapshotId))
        .collect();
      const native = items.find((item) => item.sourceRef.kind === "clawhub");
      const external = items.find((item) => item.sourceRef.kind === "skills-sh");
      if (!native || !external) throw new Error("mixed Trending fixture missing");
      await ctx.db.patch(native._id, { position: 99 });
      await ctx.db.patch(external._id, { position: 1 });
      await ctx.db.patch(native._id, { position: 0 });
      const control = await ctx.db
        .query("skillsShCatalogControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      if (!control) throw new Error("catalog control missing");
      await ctx.db.patch(control._id, { mirrorPublicVisibilityEnabled: true });
      const mirrorControl = await ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      if (!mirrorControl) throw new Error("mirror control missing");
      await ctx.db.patch(mirrorControl._id, {
        activationLockToken: "native-only-lock",
        activationLockedAt: now,
      });
    });
    const pageResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: null,
      limit: 20,
    });
    expect(pageResult.status).toBe("ok");
    if (pageResult.status !== "ok") throw new Error("Expected a materialized Trending page");
    const page = pageResult.page;
    expect(page?.items).toEqual([
      expect.objectContaining({
        source: "clawhub",
        rank: 1,
        metrics: {
          trending24hDownloads: 18,
          trending24hInstalls: 12,
          trending24hBookmarks: 4,
          lifetimeInstalls: 900,
          lifetimeInstallsPeriod: "lifetime",
          updatedAt: now,
        },
      }),
      expect.objectContaining({
        source: "skills-sh",
        rank: 2,
        install: {
          kind: "skills-sh",
          reference: "skills-sh:patrick/repo/external",
          sourceUrl: "https://skills.sh/patrick/repo/external",
        },
        metrics: {
          trending24hDownloads: null,
          trending24hInstalls: null,
          trending24hBookmarks: null,
          lifetimeInstalls: 4_200,
          lifetimeInstallsPeriod: "lifetime",
          updatedAt: now,
        },
      }),
    ]);

    const nativeOnly = await t.action(internal.canonicalTrending.materializeInternal, {
      activationLockToken: "native-only-lock",
      skillsShMode: "native-only",
    });
    expect(nativeOnly).toMatchObject({
      status: "ready",
      totalItems: 1,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
      nativePool: {
        reused: false,
        sourceCounts: { clawhubTrending: 1, clawhubRising: 1 },
        operations: { documentsWritten: 6 },
      },
    });
    await expect(
      t.query(internal.canonicalTrending.getPageInternal, { cursor: null, limit: 20 }),
    ).resolves.toMatchObject({
      status: "ok",
      page: { items: [{ source: "clawhub" }] },
    });

    await t.run(async (ctx) => {
      const hourlyRows = await ctx.db.query("skillHourlyStats").collect();
      for (const row of hourlyRows) await ctx.db.delete(row._id);
      const mirrorControl = await ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      if (!mirrorControl) throw new Error("mirror control missing");
      await ctx.db.patch(mirrorControl._id, {
        activationLockToken: "mixed-pool-lock",
        activationLockedAt: Date.now(),
      });
    });

    const mixedFromPool = await t.action(internal.canonicalTrending.materializeInternal, {
      activationLockToken: "mixed-pool-lock",
    });
    expect(mixedFromPool).toMatchObject({
      status: "ready",
      totalItems: 2,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 1 },
      nativePool: {
        reused: true,
        poolId: nativeOnly.snapshotId,
        sourceCounts: { clawhubTrending: 1, clawhubRising: 1 },
      },
      sample: [
        expect.objectContaining({
          lane: "clawhub-trending",
          trending24hDownloads: 18,
          trending24hInstalls: 12,
        }),
        expect.objectContaining({
          lane: "skills-sh-trending",
          id: "skills-sh:patrick/repo/external",
        }),
      ],
    });
  });
});
