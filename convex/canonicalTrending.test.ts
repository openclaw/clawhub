/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
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
    const t = convexTest(schema, modules);
    const source = await insertEligibleNativeSource(t, "pagination-source");

    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-1000",
      generatedAt: 1_000,
      expiresAt: Date.now() + 100_000,
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
          lane: "skills-sh-trending",
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
      completedAt: 1_050,
      totalItems: 3,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 1 },
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
      generatedAt: "1970-01-01T00:00:01.000Z",
      windowHours: 24,
      rankingVersion: "skills-trending-v1",
      items: [
        { id: "clawhub:one", rank: 1, lane: "clawhub-trending" },
        { id: "clawhub:two", rank: 2, lane: "skills-sh-trending" },
      ],
    });
    expect(firstPage?.nextCursor).toEqual(expect.any(String));

    await t.mutation(internal.canonicalTrending.startSnapshotInternal, {
      snapshotId: "skills-2000",
      generatedAt: 2_000,
      expiresAt: Date.now() + 100_000,
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
      completedAt: 2_050,
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
      await ctx.db.patch(source.digestId, { softDeletedAt: Date.now() });
    });
    const revokedResult = await t.query(internal.canonicalTrending.getPageInternal, {
      cursor: firstPage.snapshotCursor,
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

  it("does not read or write source state while the rollout is dark", async () => {
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const t = convexTest(schema, modules);

    const result = await t.action(internal.canonicalTrending.materializeInternal, {});
    const snapshots = await t.run(async (ctx) =>
      ctx.db.query("canonicalTrendingSnapshots").collect(),
    );

    expect(result).toEqual({ status: "disabled" });
    expect(snapshots).toEqual([]);
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

    const result = await t.action(internal.canonicalTrending.pruneExpiredActionInternal, {});
    const rows = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("canonicalTrendingSnapshots").collect(),
      items: await ctx.db.query("canonicalTrendingItems").collect(),
    }));

    expect(result).toEqual({
      itemsDeleted: 1,
      snapshotsDeleted: 1,
      batches: 1,
      continuationScheduled: false,
    });
    expect(rows).toEqual({ snapshots: [], items: [] });
  });

  it("materializes imported 24-hour metrics into a ready snapshot", async () => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
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
      await ctx.db.insert("rankingMetricImports", {
        datasetVersion: "ranking-test-v1",
        checksum: "a".repeat(64),
        generatedAt: new Date(now).toISOString(),
        importedAt: now,
        startDay: 1,
        endDay: 60,
        targetCount: 1,
        skillTargetCount: 1,
        packageTargetCount: 0,
        dailyRowCount: 1,
        importedSkillRows: 1,
        importedPackageRows: 0,
        unresolvedTargets: 0,
        skippedOverlayRows: 0,
      });
      await ctx.db.insert("skillDailyStats", {
        skillId,
        day: 60,
        downloads: 18,
        installs: 12,
        bookmarks: 4,
        rankingDatasetVersion: "ranking-test-v1",
        rankingImportedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("skillDailyStats", {
        skillId,
        day: 61,
        downloads: 999,
        installs: 999,
        bookmarks: 999,
        updatedAt: now + 1,
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

    const result = await t.action(internal.canonicalTrending.materializeInternal, {});
    expect(result).toMatchObject({
      status: "ready",
      totalItems: 2,
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 1 },
      sample: [
        {
          rank: 1,
          lane: "clawhub-trending",
          id: expect.stringMatching(/^clawhub:/),
          trending24hInstalls: 12,
          lifetimeInstalls: 900,
        },
        {
          rank: 2,
          lane: "skills-sh-trending",
          id: "skills-sh:patrick/repo/external",
          trending24hInstalls: null,
          lifetimeInstalls: 4_200,
        },
      ],
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
          trending24hInstalls: null,
          trending24hBookmarks: null,
          lifetimeInstalls: 4_200,
          lifetimeInstallsPeriod: "lifetime",
          updatedAt: now,
        },
      }),
    ]);
  });
});
