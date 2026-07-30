/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TEST_ENV = {
  CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
  CLAWHUB_DISABLE_CRONS: "1",
  CLAWHUB_ENV: "test",
  CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
  CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
};

function useTestEnvironment() {
  for (const [name, value] of Object.entries(TEST_ENV)) vi.stubEnv(name, value);
}

function useProductionEnvironment() {
  vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "wry-manatee-359");
  vi.stubEnv("CLAWHUB_ENV", "production");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "production");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://wry-manatee-359.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://wry-manatee-359.convex.site");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const githubRow = {
  externalId: "vercel-labs/skills/find-skills",
  sourceType: "github" as const,
  upstreamSourceType: "github",
  owner: "vercel-labs",
  repo: "skills",
  slug: "find-skills",
  displayName: "Find Skills",
  sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills",
  canonicalRepoUrl: "https://github.com/vercel-labs/skills",
  upstreamInstalls: 42,
  upstreamScanners: {
    genAgentTrustHub: {
      status: "pass",
      sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/agent-trust-hub",
    },
    socket: {
      status: "pass",
      sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/socket",
    },
    snyk: {
      status: "warn",
      sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/snyk",
    },
  },
  inferredCategories: ["development"],
  inferredTopics: ["skill-discovery"],
  inferredCategoryConfidence: "high" as const,
  inferredTopicConfidence: "medium" as const,
  inferredClassifierVersion: "taxonomy-prototype-v9",
  inferredTopicClassifierVersion: "topic-prototype-v1",
  inferredInputHash: "github-input-hash",
  inferredTopicInputHash: "github-topic-input-hash",
  inferredAt: 123,
  sourceContentHash: "a".repeat(64),
  detail: {
    contentKind: "skill-md" as const,
    path: "SKILL.md",
    content: "# Find Skills",
    contentBytes: 13,
    sourceBytes: 13,
    sourceFileCount: 1,
    truncated: false,
  },
};

const exactGithubRow = {
  ...githubRow,
  githubPath: "skills/find-skills",
  githubCommit: "c".repeat(40),
};

const wellKnownRow = {
  externalId: "open.feishu.cn/lark-doc",
  sourceType: "well-known" as const,
  upstreamSourceType: "well-known",
  sourceHost: "open.feishu.cn",
  slug: "lark-doc",
  displayName: "lark-doc",
  sourceUrl: "https://www.skills.sh/site/open.feishu.cn/lark-doc",
  upstreamInstalls: 7,
  upstreamScanners: {
    genAgentTrustHub: { status: "unavailable" },
    socket: { status: "unavailable" },
    snyk: { status: "unavailable" },
  },
  inferredCategories: ["productivity"],
  inferredTopics: ["documents"],
  inferredCategoryConfidence: "medium" as const,
  inferredTopicConfidence: "medium" as const,
  inferredClassifierVersion: "taxonomy-prototype-v9",
  inferredTopicClassifierVersion: "topic-prototype-v1",
  inferredInputHash: "well-known-input-hash",
  inferredTopicInputHash: "well-known-topic-input-hash",
  inferredAt: 123,
  sourceContentHash: "b".repeat(64),
  detail: {
    contentKind: "readme" as const,
    path: "README.md",
    content: "# Lark Doc",
    contentBytes: 10,
    sourceBytes: 10,
    sourceFileCount: 1,
    truncated: false,
  },
};

async function configure(t: ReturnType<typeof convexTest>) {
  return await t.mutation(internal.skillsShMirror.configureInternal, {
    actor: "codex-test",
    reason: "CLAW-563 mirror test",
    confirm: "enable-skills-sh-mirror-test",
    enabled: true,
    maxRowsPerRun: 10_000,
    maxRowsPerBatch: 50,
    maxDetailBytes: 64 * 1024,
  });
}

async function startRun(
  t: ReturnType<typeof convexTest>,
  snapshotId: string,
  sourceTotal = 2,
  sourceSnapshotHash?: string,
  sourceView?: "leaderboard" | "trending",
  sourceMeasuredAt = "2026-07-22T20:14:10.881Z",
) {
  const run = (await t.mutation(internal.skillsShMirror.startRunInternal, {
    actor: "codex-test",
    reason: "CLAW-563 mirror test",
    snapshotId,
    ...(sourceSnapshotHash ? { sourceSnapshotHash } : {}),
    ...(sourceView ? { sourceView } : {}),
    sourceTotal,
    sourcePageSize: 500,
    sourceMeasuredAt,
  })) as { runId: Id<"skillsShMirrorRuns"> };
  if (sourceSnapshotHash) {
    await t.run(async (ctx) => {
      const existing = (await ctx.db.query("skillsShMirrorSourcePages").collect()).find(
        (page) => page.snapshotHash === sourceSnapshotHash && page.page === 0,
      );
      if (existing) return;
      await ctx.db.insert("skillsShMirrorSourcePages", {
        snapshotHash: sourceSnapshotHash,
        sourceView: sourceView ?? "leaderboard",
        page: 0,
        sourceTotal,
        pageLength: 1,
        hasMore: sourceTotal > 1,
        identityHash: "b".repeat(64),
        contentHash: "c".repeat(64),
        sourceBytes: 1,
        serializedBytes: 1,
        rows: [],
        createdAt: Date.parse(sourceMeasuredAt),
      });
    });
  }
  return run;
}

async function completeLeaderboardRun(
  t: ReturnType<typeof convexTest>,
  runId: Id<"skillsShMirrorRuns">,
  args: { legacy?: boolean; startedAt?: number; completedAt: number },
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(runId, {
      status: "completed",
      ...(args.legacy ? { sourceView: undefined } : {}),
      ...(args.startedAt === undefined ? {} : { startedAt: args.startedAt }),
      completedAt: args.completedAt,
    });
    const control = (await ctx.db.query("skillsShMirrorControls").collect())[0];
    if (!control) throw new Error("mirror control missing");
    await ctx.db.patch(control._id, { latestCompletedLeaderboardRunId: runId });
  });
}

const mirrorLeaseRefs = internal.skillsShMirror as unknown as {
  claimBatchLeaseInternal: Parameters<ReturnType<typeof convexTest>["mutation"]>[0];
  releaseBatchLeaseInternal: Parameters<ReturnType<typeof convexTest>["mutation"]>[0];
};

const trendingRefs = internal.skillsShMirror as unknown as {
  hydrateTrendingBatchInternal: Parameters<ReturnType<typeof convexTest>["mutation"]>[0];
  processTrendingBatchInternal: Parameters<ReturnType<typeof convexTest>["mutation"]>[0];
};

let leaseSequence = 0;

async function processBatch(
  t: ReturnType<typeof convexTest>,
  args: Omit<FunctionArgs<typeof internal.skillsShMirror.processBatchInternal>, "leaseToken">,
) {
  const leaseToken = `test-lease:${(leaseSequence += 1)}`;
  await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
    runId: args.runId,
    page: args.page,
    offset: args.offset,
    leaseToken,
  });
  return await t.mutation(internal.skillsShMirror.processBatchInternal, {
    ...args,
    leaseToken,
  });
}

async function claimLease(
  t: ReturnType<typeof convexTest>,
  runId: Id<"skillsShMirrorRuns">,
  page: number,
  offset: number,
) {
  const leaseToken = `test-trending-lease:${(leaseSequence += 1)}`;
  await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
    runId,
    page,
    offset,
    leaseToken,
  });
  return leaseToken;
}

describe("skills.sh external mirror", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not start a mirror run while atomic public activation holds the corpus lock", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    await t.run(async (ctx) => {
      const control = await ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      if (!control) throw new Error("mirror control missing");
      await ctx.db.patch(control._id, {
        activationLockToken: "activation-lock",
        activationLockedAt: Date.now(),
      });
    });

    await expect(startRun(t, "blocked-by-activation", 1)).rejects.toThrow(
      "public activation is in progress",
    );
  });

  it("reports the live public gate instead of a hard-coded hidden invariant", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
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
        updatedBy: "codex-test",
        reason: "live status test",
        updatedAt: 1,
      });
    });

    await expect(t.query(internal.skillsShMirror.getStatusInternal, {})).resolves.toMatchObject({
      invariants: {
        publicVisible: true,
        installable: true,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
      },
    });
  });

  it("requires a production-specific confirmation before configuring the shared importer", async () => {
    useProductionEnvironment();
    const t = convexTest(schema, modules);
    const args = {
      actor: "codex-test",
      reason: "CLAW-603 production guard test",
      enabled: true,
      maxRowsPerRun: 10_000,
      maxRowsPerBatch: 50,
      maxDetailBytes: 64 * 1024,
    };
    await expect(
      t.mutation(internal.skillsShMirror.configureInternal, {
        ...args,
        confirm: "enable-skills-sh-mirror-test",
      }),
    ).rejects.toThrow('Pass confirm="enable-skills-sh-mirror-production"');
    await expect(
      t.mutation(internal.skillsShMirror.configureInternal, {
        ...args,
        confirm: "enable-skills-sh-mirror-production",
      }),
    ).resolves.toMatchObject({
      environment: "production",
      publicGateEnabled: false,
      scanPlanningEnabled: false,
      scanAdmissionEnabled: false,
    });
  });

  it("publishes every exact Test import without scheduling a ClawHub scan", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const run = await startRun(t, "snapshot:exact-public", 1);

    const result = await processBatch(t, {
      runId: run.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [exactGithubRow],
    });

    expect(result).toMatchObject({
      counts: { scansPlanned: 0, scansAdmitted: 0 },
    });
    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: exactGithubRow.externalId,
      }),
    ).resolves.toMatchObject({
      active: true,
      publicVisible: true,
      installable: true,
      githubPath: exactGithubRow.githubPath,
      githubCommit: exactGithubRow.githubCommit,
      sourceContentHash: exactGithubRow.sourceContentHash,
      upstreamScanners: {
        snyk: { status: "warn" },
      },
    });
    await expect(
      t.run(async (ctx) => await ctx.db.query("skillsShCatalogScanAttempts").collect()),
    ).resolves.toEqual([]);
    await expect(
      t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect()),
    ).resolves.toEqual([]);
  });

  it("hides an imported mirror when an exact source becomes incomplete", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const first = await startRun(t, "snapshot:exact-before-invalid", 1);
    await processBatch(t, {
      runId: first.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [exactGithubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: first.runId,
      limit: 10,
    });
    const second = await startRun(t, "snapshot:invalid-after-exact", 1);
    await processBatch(t, {
      runId: second.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [{ ...exactGithubRow, githubCommit: undefined }],
    });

    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: exactGithubRow.externalId,
      }),
    ).resolves.toMatchObject({
      active: true,
      publicVisible: false,
      installable: false,
    });
  });

  it("contains a duplicate identity conflict to the affected mirror row", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const run = await startRun(t, "snapshot:duplicate-conflict", 3);
    const result = await processBatch(t, {
      runId: run.runId,
      page: 0,
      offset: 0,
      pageLength: 3,
      hasMore: false,
      sourceTotal: 3,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [
        exactGithubRow,
        { ...exactGithubRow, displayName: "Conflicting Name" },
        exactGithubRow,
      ],
    });

    expect(result).toMatchObject({ counts: { rejected: 2, conflicts: 2 } });
    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: exactGithubRow.externalId,
      }),
    ).resolves.toMatchObject({
      active: true,
      sourceFreshnessStatus: "stale",
      publicVisible: false,
      installable: false,
    });
  });

  it("joins trending rank onto one mirror identity without scan work", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const foundation = await startRun(t, "snapshot:foundation", 1);
    await processBatch(t, {
      runId: foundation.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 0,
      sourceBytes: 0,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: foundation.runId,
      limit: 250,
    });

    const trending = await startRun(t, "skills-sh:trending:snapshot-1", 1, undefined, "trending");
    const leaseToken = await claimLease(t, trending.runId, 0, 0);
    const result = await t.mutation(trendingRefs.processTrendingBatchInternal, {
      runId: trending.runId,
      page: 0,
      offset: 0,
      leaseToken,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      rows: [{ externalId: githubRow.externalId, lifetimeInstalls: 17, rank: 1 }],
    });

    expect(result).toMatchObject({
      status: "completed",
      counts: {
        observed: 1,
        trendingJoined: 1,
        trendingUpdated: 1,
        trendingMissing: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      externalId: githubRow.externalId,
      trendingRank: 1,
      trendingLifetimeInstalls: 17,
      trendingObservedAt: Date.parse("2026-07-22T20:14:10.881Z"),
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShMirrorDigests").collect()),
    ).toHaveLength(1);
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShCatalogScanAttempts").collect()),
    ).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
      [],
    );
  });

  it("keeps trending replays idempotent and rejects stale observations", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const foundation = await startRun(t, "snapshot:foundation", 1);
    await processBatch(t, {
      runId: foundation.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 0,
      sourceBytes: 0,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: foundation.runId,
      limit: 250,
    });

    const apply = async (snapshotId: string, observedAt: string, rank: number) => {
      const { runId } = await startRun(t, snapshotId, 1, undefined, "trending", observedAt);
      const leaseToken = await claimLease(t, runId, 0, 0);
      return await t.mutation(trendingRefs.processTrendingBatchInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken,
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        rows: [{ externalId: githubRow.externalId, lifetimeInstalls: 17, rank }],
      });
    };

    await expect(
      apply("skills-sh:trending:new", "2026-07-22T20:14:10.881Z", 1),
    ).resolves.toMatchObject({ counts: { trendingUpdated: 1 } });
    await expect(
      apply("skills-sh:trending:replay", "2026-07-22T20:14:10.881Z", 1),
    ).resolves.toMatchObject({ counts: { trendingUnchanged: 1, trendingUpdated: 0 } });
    await expect(
      apply("skills-sh:trending:stale", "2026-07-21T20:14:10.881Z", 1),
    ).resolves.toMatchObject({ counts: { trendingStaleRejected: 1, trendingUpdated: 0 } });
    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).resolves.toMatchObject({
      trendingRank: 1,
      trendingLifetimeInstalls: 17,
      trendingObservedAt: Date.parse("2026-07-22T20:14:10.881Z"),
    });
  });

  it("hydrates bounded trending drift through the mirror upsert path", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const trending = await startRun(t, "skills-sh:trending:drift", 1, undefined, "trending");
    const leaseToken = await claimLease(t, trending.runId, 0, 0);

    await expect(
      t.mutation(trendingRefs.hydrateTrendingBatchInternal, {
        runId: trending.runId,
        page: 0,
        offset: 0,
        leaseToken,
        rows: [githubRow],
      }),
    ).resolves.toMatchObject({
      counts: { trendingHydrationAttempts: 1, trendingHydrated: 1 },
    });
    await expect(
      t.mutation(trendingRefs.processTrendingBatchInternal, {
        runId: trending.runId,
        page: 0,
        offset: 0,
        leaseToken,
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        rows: [{ externalId: githubRow.externalId, lifetimeInstalls: 17, rank: 1 }],
      }),
    ).resolves.toMatchObject({
      status: "completed",
      counts: { trendingJoined: 1, trendingMissing: 0 },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShMirrorDigests").collect()),
    ).toHaveLength(1);
  });

  it("keeps hydrated same-run drift quarantined when the first observation repeats", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const trending = await startRun(t, "skills-sh:trending:a-b-a", 1, undefined, "trending");
    const leaseToken = await claimLease(t, trending.runId, 0, 0);
    const hydrate = async (row: typeof githubRow) =>
      await t.mutation(trendingRefs.hydrateTrendingBatchInternal, {
        runId: trending.runId,
        page: 0,
        offset: 0,
        leaseToken,
        rows: [row],
      });

    await hydrate(githubRow);
    await hydrate({ ...githubRow, displayName: "Conflicting Name" });
    await expect(hydrate(githubRow)).resolves.toMatchObject({
      counts: { rejected: 2, conflicts: 2, trendingHydrationFailed: 2 },
    });
    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).resolves.toMatchObject({
      sourceFreshnessStatus: "stale",
      staleQuarantineReason: "same-run-drift",
      publicVisible: false,
      installable: false,
    });
  });

  it("fails closed when exceptional trending hydration exceeds the run bound", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const trending = await startRun(
      t,
      "skills-sh:trending:bounded-drift",
      51,
      undefined,
      "trending",
    );
    const leaseToken = await claimLease(t, trending.runId, 0, 0);
    const rows = Array.from({ length: 50 }, (_, index) => ({
      ...githubRow,
      externalId: `owner/repo/skill-${index}`,
    }));

    await expect(
      t.mutation(trendingRefs.hydrateTrendingBatchInternal, {
        runId: trending.runId,
        page: 0,
        offset: 0,
        leaseToken,
        rows,
      }),
    ).resolves.toMatchObject({ counts: { trendingHydrationAttempts: 50 } });
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId: trending.runId,
        page: 0,
        offset: 0,
        leaseToken,
      }),
    ).resolves.toMatchObject({ trendingHydrationAttempts: 50 });

    await expect(
      t.mutation(trendingRefs.hydrateTrendingBatchInternal, {
        runId: trending.runId,
        page: 0,
        offset: 0,
        leaseToken,
        rows: [{ ...githubRow, externalId: "owner/repo/skill-50" }],
      }),
    ).rejects.toThrow("exceptional hydration exceeds 50 rows");
    const conflicts = await t.run(async (ctx) => ctx.db.query("skillsShMirrorConflicts").collect());
    expect(conflicts).toHaveLength(50);
    expect(conflicts.some((conflict) => conflict.externalId === "owner/repo/skill-50")).toBe(false);
  });

  it("separates known normalizer conflicts from hydratable trending drift", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const foundation = await startRun(t, "skills-sh:proof:known-quarantine", 1, "a".repeat(64));
    const quarantinedExternalId = "owner/repo/known-quarantine";
    const unseenExternalId = "owner/repo/unseen";
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShMirrorConflicts", {
        runId: foundation.runId,
        externalId: quarantinedExternalId,
        kind: "source-quarantine",
        reason: "unsupported-source-type",
        observedFingerprint: "known-quarantine",
        page: 0,
        offset: 0,
        createdAt: Date.now(),
      });
    });
    await completeLeaderboardRun(t, foundation.runId, {
      legacy: true,
      completedAt: Date.now(),
    });

    await expect(
      t.query(internal.skillsShMirror.getTrendingJoinStateInternal, {
        externalIds: [quarantinedExternalId, unseenExternalId],
      }),
    ).resolves.toEqual({
      joinedExternalIds: [],
      missingExternalIds: [quarantinedExternalId, unseenExternalId],
      knownConflictExternalIds: [quarantinedExternalId],
      hydratableExternalIds: [unseenExternalId],
    });
  });

  it("keeps completed leaderboard quarantine authoritative over later replay and capture", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const externalId = "owner/repo/known-quarantine";
    const foundation = await startRun(
      t,
      "skills-sh:proof:authoritative-leaderboard",
      1,
      "a".repeat(64),
      "leaderboard",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShMirrorConflicts", {
        runId: foundation.runId,
        externalId,
        kind: "source-quarantine",
        reason: "unsupported-source-type",
        observedFingerprint: "known-quarantine",
        page: 0,
        offset: 0,
        createdAt: 1,
      });
    });
    await completeLeaderboardRun(t, foundation.runId, { startedAt: 1, completedAt: 2 });
    const replay = await startRun(
      t,
      "skills-sh:proof:captured-replay",
      1,
      undefined,
      "leaderboard",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(replay.runId, {
        status: "completed",
        startedAt: 3,
        completedAt: 4,
      });
    });
    await startRun(
      t,
      "skills-sh:proof:unfinished-capture",
      1,
      "b".repeat(64),
      "leaderboard",
      "2026-07-22T20:14:11.881Z",
    );
    await t.run(async (ctx) => {
      const control = (await ctx.db.query("skillsShMirrorControls").collect())[0];
      if (!control) throw new Error("mirror control missing");
      const sourcePage = (await ctx.db.query("skillsShMirrorSourcePages").collect()).find(
        (page) => page.snapshotHash === "a".repeat(64) && page.page === 0,
      );
      if (!sourcePage) throw new Error("leaderboard source page missing");
      await ctx.db.patch(sourcePage._id, { sourceView: undefined });
      await ctx.db.patch(control._id, { latestCompletedLeaderboardRunId: replay.runId });
    });
    await configure(t);

    await expect(
      t.query(internal.skillsShMirror.getTrendingJoinStateInternal, { externalIds: [externalId] }),
    ).resolves.toEqual({
      joinedExternalIds: [],
      missingExternalIds: [externalId],
      knownConflictExternalIds: [externalId],
      hydratableExternalIds: [],
    });
  });

  it("keeps stale normalizer conflicts eligible for bounded trending hydration", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const externalId = "owner/repo/recovered-upstream";
    const oldFoundation = await startRun(t, "skills-sh:proof:old-quarantine", 1, "a".repeat(64));
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShMirrorConflicts", {
        runId: oldFoundation.runId,
        externalId,
        kind: "source-quarantine",
        reason: "unsupported-source-type",
        observedFingerprint: "old-quarantine",
        page: 0,
        offset: 0,
        createdAt: Date.now() - 1,
      });
    });
    await completeLeaderboardRun(t, oldFoundation.runId, {
      legacy: true,
      completedAt: Date.now() - 1,
    });
    const currentFoundation = await startRun(
      t,
      "skills-sh:proof:current-source",
      1,
      "b".repeat(64),
      "leaderboard",
      "2026-07-22T20:14:11.881Z",
    );
    await completeLeaderboardRun(t, currentFoundation.runId, { completedAt: Date.now() });

    await expect(
      t.query(internal.skillsShMirror.getTrendingJoinStateInternal, { externalIds: [externalId] }),
    ).resolves.toEqual({
      joinedExternalIds: [],
      missingExternalIds: [externalId],
      knownConflictExternalIds: [],
      hydratableExternalIds: [externalId],
    });
  });

  it("does not let a later unrelated conflict mask the current leaderboard quarantine", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const externalId = "owner/repo/current-quarantine";
    const foundation = await startRun(t, "skills-sh:proof:current-quarantine", 1, "a".repeat(64));
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShMirrorConflicts", {
        runId: foundation.runId,
        externalId,
        kind: "source-quarantine",
        reason: "unsupported-source-type",
        observedFingerprint: "current-quarantine",
        page: 0,
        offset: 0,
        createdAt: Date.now() - 1,
      });
    });
    await completeLeaderboardRun(t, foundation.runId, {
      legacy: true,
      completedAt: Date.now() - 1,
    });
    const trending = await startRun(
      t,
      "skills-sh:trending:later-conflict",
      1,
      undefined,
      "trending",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShMirrorConflicts", {
        runId: trending.runId,
        externalId,
        kind: "source-quarantine",
        reason: "later-unrelated-quarantine",
        observedFingerprint: "later-unrelated-conflict",
        page: 0,
        offset: 0,
        createdAt: Date.now(),
      });
    });

    await expect(
      t.query(internal.skillsShMirror.getTrendingJoinStateInternal, { externalIds: [externalId] }),
    ).resolves.toEqual({
      joinedExternalIds: [],
      missingExternalIds: [externalId],
      knownConflictExternalIds: [externalId],
      hydratableExternalIds: [],
    });
  });

  it("returns the durable cursor summary when starting a run", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);

    const started = await t.mutation(internal.skillsShMirror.startRunInternal, {
      actor: "codex-test",
      reason: "CLAW-563 mirror test",
      snapshotId: "snapshot:start-summary",
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T20:14:10.881Z",
    });

    expect(started).toMatchObject({
      snapshotId: "snapshot:start-summary",
      status: "running",
      sourceTotal: 9_571,
      sourcePageSize: 500,
      page: 0,
      offset: 0,
      completedAt: null,
    });
    expect(started.runId).toEqual(expect.any(String));
  });

  it("records bounded source accounting above 100 MiB", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:large-source-accounting", 1);

    await expect(
      processBatch(t, {
        runId,
        page: 0,
        offset: 0,
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 1,
        sourceBytes: 50 * 8 * 1024 * 1024,
        rows: [githubRow],
      }),
    ).resolves.toMatchObject({
      status: "reconciling",
      operations: { sourceBytes: 50 * 8 * 1024 * 1024 },
    });
  });

  it("stores immutable source pages and returns them with the exact leased cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const snapshotHash = "a".repeat(64);
    const rows = [
      {
        id: "vercel-labs/skills/find-skills",
        installUrl: "https://github.com/vercel-labs/skills",
        installs: 42,
        name: "Find Skills",
        slug: "find-skills",
        source: "vercel-labs/skills",
        sourceType: "github",
        url: "https://skills.sh/vercel-labs/skills/find-skills",
      },
    ];
    const identityHash = await sha256Hex(`${rows[0]!.id}\n`);
    const contentHash = await sha256Hex(JSON.stringify(rows));
    const sourcePage = {
      snapshotHash,
      page: 0,
      sourceTotal: 1,
      pageLength: 1,
      hasMore: false,
      identityHash,
      contentHash,
      sourceBytes: 512,
      serializedBytes: 768,
      rows,
    };

    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, sourcePage),
    ).resolves.toEqual({ stored: true, page: 0, rows: 1 });
    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, sourcePage),
    ).resolves.toEqual({ stored: false, page: 0, rows: 1 });
    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, {
        ...sourcePage,
        sourceBytes: sourcePage.sourceBytes + 1,
      }),
    ).rejects.toThrow("captured skills.sh source page is immutable");
    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, {
        ...sourcePage,
        contentHash: "d".repeat(64),
      }),
    ).rejects.toThrow("captured skills.sh source page content hash mismatch");

    const { runId } = await startRun(t, "skills-sh:proof:captured", 1, snapshotHash);
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:captured",
      }),
    ).resolves.toMatchObject({
      sourcePage: {
        snapshotHash,
        page: 0,
        sourceTotal: 1,
        pageLength: 1,
        hasMore: false,
        identityHash,
        contentHash,
        rows,
      },
    });
    await expect(
      t.query(internal.skillsShMirror.getSourceCaptureSummaryInternal, { snapshotHash }),
    ).resolves.toEqual({
      snapshotHash,
      sourceView: "leaderboard",
      pageDocuments: 1,
      rows: 1,
      sourceBytes: 512,
      serializedBytes: 768,
    });
  });

  it("counts a captured-page lookup even when the controlled page has no source document", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const snapshotHash = "a".repeat(64);
    const { runId } = await startRun(t, "skills-sh:proof:controlled", 1, snapshotHash);
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { page: 1 });
    });

    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 1,
        offset: 0,
        leaseToken: "lease:controlled",
      }),
    ).resolves.toMatchObject({ sourcePage: null });
    const run = await t.run(async (ctx) => await ctx.db.get(runId));
    expect(run?.operations.dbReads).toBe(5);
  });

  it("cancels a stale captured run so a fresh authenticated run can start", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const stale = await startRun(t, "skills-sh-captured:missing-live-run");

    await expect(startRun(t, "skills-sh:fresh-blocked")).rejects.toThrow(
      "already has an active run",
    );
    await expect(
      t.mutation(internal.skillsShMirror.cancelRunInternal, {
        runId: stale.runId,
        actor: "codex-test",
        reason: "discard stale captured recovery",
        confirm: "cancel-skills-sh-mirror-test-run",
      }),
    ).resolves.toMatchObject({
      runId: stale.runId,
      status: "canceled",
    });
    await expect(startRun(t, "skills-sh:fresh-live")).resolves.toMatchObject({
      status: "running",
      snapshotId: "skills-sh:fresh-live",
    });
  });

  it("allows only one active batch lease for an exact durable cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:lease", 1);

    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:first",
      }),
    ).resolves.toMatchObject({
      runId,
      page: 0,
      offset: 0,
      leaseExpiresAt: expect.any(Number),
    });
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:second",
      }),
    ).rejects.toThrow("already leased");
  });

  it("renews an active batch lease when the same worker heartbeats", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:lease-renewal", 1);
    const first = (await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:worker",
    })) as {
      leaseExpiresAt: number;
      snapshotId: string;
      sourcePageSize: number;
      sourceTotal: number;
    };
    expect(first).toMatchObject({
      snapshotId: "snapshot:lease-renewal",
      sourcePageSize: 500,
      sourceTotal: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { batchLeaseExpiresAt: first.leaseExpiresAt - 60_000 });
    });

    const renewed = (await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:worker",
    })) as { leaseExpiresAt: number };

    expect(renewed.leaseExpiresAt).toBeGreaterThan(first.leaseExpiresAt - 1_000);
  });

  it("permits stale lease takeover and rejects the superseded token", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:stale-lease", 1);
    await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:stale",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { batchLeaseExpiresAt: Date.now() - 1 });
    });

    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:fresh",
      }),
    ).resolves.toMatchObject({ leaseToken: "lease:fresh" });
    await expect(
      t.mutation(internal.skillsShMirror.processBatchInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:stale",
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 3,
        sourceBytes: 1_024,
        rows: [githubRow],
      }),
    ).rejects.toThrow("lease token mismatch");
  });

  it("requires the exact lease token to release or commit a batch", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:lease-token", 1);
    await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:owner",
    });

    await expect(
      t.mutation(mirrorLeaseRefs.releaseBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:wrong",
      }),
    ).rejects.toThrow("lease token mismatch");
    await expect(
      t.mutation(internal.skillsShMirror.processBatchInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:wrong",
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 3,
        sourceBytes: 1_024,
        rows: [githubRow],
      }),
    ).rejects.toThrow("lease token mismatch");

    await expect(
      t.mutation(mirrorLeaseRefs.releaseBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:owner",
      }),
    ).resolves.toMatchObject({ released: true });
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:replacement",
      }),
    ).resolves.toMatchObject({ leaseToken: "lease:replacement" });

    const committed = await t.mutation(internal.skillsShMirror.processBatchInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:replacement",
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    expect(committed).toMatchObject({ status: "reconciling", page: 1, offset: 0 });
    const storedRun = await t.run(async (ctx) => await ctx.db.get(runId));
    expect(storedRun).not.toHaveProperty("batchLeaseToken");
    expect(storedRun).not.toHaveProperty("batchLeaseExpiresAt");
  });

  it("processes durable source cursors without creating scan work", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "skills-sh:proof:compact.evidence-hash.evidence");

    const result = await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });

    expect(result).toMatchObject({
      status: "reconciling",
      page: 1,
      offset: 0,
      counts: {
        observed: 2,
        inserted: 2,
        conflicts: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShCatalogScanAttempts").collect()),
    ).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
      [],
    );
    const storedSourceReferences = await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", githubRow.externalId))
        .unique();
      const detail = await ctx.db
        .query("skillsShMirrorDetails")
        .withIndex("by_external_id", (q) => q.eq("externalId", githubRow.externalId))
        .unique();
      return {
        digest: digest?.sourceSnapshotId,
        detail: detail?.sourceSnapshotId,
      };
    });
    expect(storedSourceReferences).toEqual({
      digest: "skills-sh:proof:compact.evidence-hash",
      detail: "skills-sh:proof:compact.evidence-hash",
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      normalizedSlug: "find-skills",
      normalizedSlugFirstToken: "find",
      normalizedDisplayName: "find skills",
      normalizedDisplayNameFirstToken: "find",
      searchSummary: "# Find Skills",
      searchText: expect.stringContaining("# Find Skills"),
      upstreamScanners: githubRow.upstreamScanners,
      inferredCategories: ["development"],
      inferredTopics: ["skill-discovery"],
    });
  });

  it("preserves classifier topic labels and indexes their normalized topic slugs", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:topic-labels", 1);
    const topicRow = {
      ...githubRow,
      inferredTopics: ["Code Review", "股票分析"],
    };

    await expect(
      processBatch(t, {
        runId,
        page: 0,
        offset: 0,
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 3,
        sourceBytes: 1_024,
        rows: [topicRow],
      }),
    ).resolves.toMatchObject({
      counts: {
        inserted: 1,
        rejected: 0,
        conflicts: 0,
      },
    });
    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: topicRow.externalId,
      }),
    ).resolves.toMatchObject({
      inferredTopics: ["Code Review", "股票分析"],
    });

    for (const topic of ["Code Review", "股票分析"]) {
      const result = await t.query(internal.skillsShMirror.listActiveByTopicInternal, {
        topic,
        paginationOpts: { cursor: null, numItems: 10 },
      });
      expect(result.page.map((digest) => digest.externalId)).toEqual([topicRow.externalId]);
    }
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId,
      limit: 250,
    });
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", topicRow.externalId))
        .unique();
      if (!digest) throw new Error("topic digest missing");
      const canonical = await ctx.db
        .query("skillsShMirrorFacets")
        .withIndex("by_digest_id_and_kind_and_term", (q) => q.eq("digestId", digest._id))
        .filter((q) => q.eq(q.field("term"), "code-review"))
        .unique();
      if (!canonical) throw new Error("canonical topic facet missing");
      await ctx.db.delete(canonical._id);
      await ctx.db.insert("skillsShMirrorFacets", {
        digestId: canonical.digestId,
        externalId: canonical.externalId,
        kind: "topic",
        term: "code review",
        active: true,
        installs: canonical.installs,
        createdAt: canonical.createdAt,
        updatedAt: canonical.updatedAt,
      });
    });
    const replay = await startRun(t, "snapshot:topic-label-replay", 1);
    await processBatch(t, {
      runId: replay.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [topicRow],
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("skillsShMirrorFacets").collect())
          .filter((facet) => facet.kind === "topic" && facet.active)
          .map((facet) => facet.term)
          .sort(),
      ),
    ).toEqual(["code-review", "股票分析"]);
  });

  it("serves bounded active exact, prefix, first-token, and full-text recall", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:search");
    await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 5,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });

    const externalIds = (rows: Doc<"skillsShMirrorDigests">[]) => rows.map((row) => row.externalId);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedSlugInternal, {
          value: "find-skills",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedDisplayNameInternal, {
          value: "find skills",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedSlugPrefixInternal, {
          prefix: "find",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedDisplayNamePrefixInternal, {
          prefix: "find",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedSlugFirstTokenPrefixInternal, {
          prefix: "fi",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(
          internal.skillsShMirror.listActiveByNormalizedDisplayNameFirstTokenPrefixInternal,
          {
            prefix: "fi",
            limit: 10,
          },
        ),
      ),
    ).toEqual([githubRow.externalId]);

    const fullText = (await t.query(internal.skillsShMirror.searchActiveBySearchTextInternal, {
      query: "vercel find",
      limit: 10,
    })) as Doc<"skillsShMirrorDigests">[];
    expect(fullText.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    const byOwner = await t.query(internal.skillsShMirror.listActiveGithubByOwnerInternal, {
      owner: " VERCEL-LABS ",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(byOwner.page.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    expect(byOwner.isDone).toBe(true);
    const byCategory = await t.query(internal.skillsShMirror.listActiveByCategoryInternal, {
      categorySlug: " DEVELOPMENT ",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(byCategory.page.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    const byTopic = await t.query(internal.skillsShMirror.listActiveByTopicInternal, {
      topic: "skill-discovery",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(byTopic.page.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    const byPopularity = await t.query(
      internal.skillsShMirror.listActiveByUpstreamInstallsInternal,
      { limit: 10 },
    );
    expect(byPopularity.map((row) => row.externalId)).toEqual([
      githubRow.externalId,
      wellKnownRow.externalId,
    ]);
    const classificationStates = await t.query(
      internal.skillsShMirror.getClassificationStatesInternal,
      { externalIds: [githubRow.externalId, "missing/repo/skill"] },
    );
    expect(classificationStates).toEqual([
      expect.objectContaining({
        externalId: githubRow.externalId,
        sourceContentHash: githubRow.sourceContentHash,
        inferredClassifierVersion: githubRow.inferredClassifierVersion,
      }),
    ]);
    const replayRows = await t.query(internal.skillsShMirror.getReplayRowsInternal, {
      externalIds: [githubRow.externalId],
    });
    expect(replayRows).toEqual([
      {
        digest: expect.objectContaining({
          externalId: githubRow.externalId,
          active: true,
        }),
        detail: expect.objectContaining({
          externalId: githubRow.externalId,
          content: githubRow.detail.content,
        }),
      },
    ]);
    await expect(
      t.query(internal.skillsShMirror.listActiveByNormalizedSlugPrefixInternal, {
        prefix: "",
        limit: 10,
      }),
    ).rejects.toThrow("prefix is required");
  });

  it("records a quarantined source row and continues the batch cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:quarantine", 2);

    const result = await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 4,
      sourceBytes: 2_048,
      rows: [
        {
          quarantined: true,
          externalId: "larksuite/cli/lark-doc",
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
        githubRow,
      ],
    });

    expect(result).toMatchObject({
      status: "reconciling",
      page: 1,
      offset: 0,
      counts: {
        observed: 2,
        inserted: 1,
        rejected: 1,
        quarantined: 1,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShMirrorConflicts").collect()),
    ).toEqual([
      expect.objectContaining({
        externalId: "larksuite/cli/lark-doc",
        kind: "source-quarantine",
        reason: "identity-page-fetch-failed",
      }),
    ]);
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: "larksuite/cli/lark-doc",
      }),
    ).toBeNull();
    expect(await t.query(internal.skillsShMirror.getStatusInternal, {})).toMatchObject({
      latestRunConflicts: [
        {
          externalId: "larksuite/cli/lark-doc",
          kind: "source-quarantine",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    expect(
      await t.query(internal.skillsShMirror.listConflictsByRunInternal, {
        runId,
        limit: 50,
      }),
    ).toEqual([
      expect.objectContaining({
        runId,
        externalId: "larksuite/cli/lark-doc",
        kind: "source-quarantine",
      }),
    ]);
  });

  it("removes stale detail when an available observation becomes missing before replay", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:detail-available", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });

    const secondRun = await startRun(t, "snapshot:detail-missing", 1);
    await processBatch(t, {
      runId: secondRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 512,
      rows: [{ ...githubRow, detail: undefined }],
    });

    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({ detailStatus: "missing", lastObservedRunId: secondRun.runId });
    expect(
      await t.query(internal.skillsShMirror.getDetailByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toBeNull();
    expect(
      await t.query(internal.skillsShMirror.getReplayRowsInternal, {
        externalIds: [githubRow.externalId],
      }),
    ).toEqual([
      {
        digest: expect.objectContaining({ detailStatus: "missing" }),
        detail: null,
      },
    ]);
  });

  it("preserves an existing digest when identity-page transport is quarantined", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:before-transient-quarantine", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", githubRow.externalId))
        .unique();
      expect(existing).not.toBeNull();
      await ctx.db.patch(existing!._id, { upstreamSourceType: undefined });
    });

    const secondRun = await startRun(t, "snapshot:transient-quarantine", 1);
    const result = await processBatch(t, {
      runId: secondRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 1_024,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: secondRun.runId,
      limit: 10,
    });

    expect(result.counts).toMatchObject({
      quarantined: 1,
      quarantinedPreserved: 1,
      tombstoned: 0,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: secondRun.runId,
      sourceFreshnessStatus: "stale",
      staleQuarantineReason: "identity-page-fetch-failed",
      upstreamSourceType: "well-known",
    });
    expect(
      await t.query(internal.skillsShMirror.getDetailByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      lastObservedRunId: firstRun.runId,
    });

    const disappearanceRun = await startRun(t, "snapshot:disappearance-before-quarantine", 1);
    await processBatch(t, {
      runId: disappearanceRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [wellKnownRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: disappearanceRun.runId,
      limit: 10,
    });

    const inactiveQuarantineRun = await startRun(t, "snapshot:inactive-quarantine", 1);
    const inactiveResult = await processBatch(t, {
      runId: inactiveQuarantineRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 1_024,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    expect(inactiveResult.counts.quarantinedPreserved).toBe(0);
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: false,
      lastObservedRunId: secondRun.runId,
    });
  });

  it("replays a preserved stale digest as the same quarantine observation", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:before-stale-replay", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });

    const quarantineRun = await startRun(t, "snapshot:stale-replay-source", 1);
    await processBatch(t, {
      runId: quarantineRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 1_024,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: quarantineRun.runId,
      limit: 10,
    });
    const [replayRow] = await t.query(internal.skillsShMirror.getReplayRowsInternal, {
      externalIds: [githubRow.externalId],
    });

    expect(replayRow).toEqual({
      quarantined: true,
      externalId: githubRow.externalId,
      upstreamSourceType: "well-known",
      reason: "identity-page-fetch-failed",
    });
    if (!replayRow || replayRow.quarantined !== true) {
      throw new Error("stale replay row was not quarantined");
    }

    const replayRun = await startRun(t, "snapshot:stale-replay", 1);
    const replayResult = await processBatch(t, {
      runId: replayRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 0,
      sourceBytes: 0,
      rows: [replayRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: replayRun.runId,
      limit: 10,
    });

    expect(replayResult.counts).toMatchObject({
      rejected: 1,
      quarantined: 1,
      quarantinedPreserved: 1,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: replayRun.runId,
      sourceFreshnessStatus: "stale",
      staleQuarantineReason: "identity-page-fetch-failed",
    });
    expect(
      await t.query(internal.skillsShMirror.getDetailByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      lastObservedRunId: firstRun.runId,
      content: githubRow.detail.content,
    });
  });

  it("keeps a successful same-run observation authoritative over a later quarantine", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:same-run-quarantine", 2);

    const result = await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 4,
      sourceBytes: 2_048,
      rows: [
        githubRow,
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-http-404",
        },
      ],
    });

    expect(result.counts).toMatchObject({
      inserted: 1,
      quarantined: 1,
      quarantinedPreserved: 0,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: runId,
      sourceFreshnessStatus: "observed-only",
    });
  });

  it("accepts a valid observation after preserving an earlier-run quarantined digest", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:before-quarantine-first", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });

    const secondRun = await startRun(t, "snapshot:quarantine-first", 2);
    const result = await processBatch(t, {
      runId: secondRun.runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 4,
      sourceBytes: 2_048,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
        { ...githubRow, upstreamInstalls: githubRow.upstreamInstalls + 1 },
      ],
    });

    expect(result.counts).toMatchObject({
      updated: 1,
      quarantined: 1,
      quarantinedPreserved: 0,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: secondRun.runId,
      sourceFreshnessStatus: "observed-only",
      upstreamInstalls: githubRow.upstreamInstalls + 1,
    });
  });

  it("pauses and resumes from the exact page and offset", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:pause", 3);

    await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 3,
      hasMore: false,
      sourceTotal: 3,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.setPausedInternal, {
      runId,
      paused: true,
      actor: "codex-test",
      reason: "prove pause",
      confirm: "set-skills-sh-mirror-pause",
    });
    await expect(
      processBatch(t, {
        runId,
        page: 0,
        offset: 1,
        pageLength: 3,
        hasMore: false,
        sourceTotal: 3,
        sourceRequests: 2,
        sourceBytes: 512,
        rows: [wellKnownRow],
      }),
    ).rejects.toThrow("paused");
    await t.mutation(internal.skillsShMirror.setPausedInternal, {
      runId,
      paused: false,
      actor: "codex-test",
      reason: "resume exact cursor",
      confirm: "set-skills-sh-mirror-pause",
    });
    const resumed = await processBatch(t, {
      runId,
      page: 0,
      offset: 1,
      pageLength: 3,
      hasMore: false,
      sourceTotal: 3,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [wellKnownRow, { ...githubRow, externalId: "vercel-labs/skills/other", slug: "other" }],
    });
    expect(resumed).toMatchObject({ status: "reconciling", page: 1, offset: 0 });
  });

  it("records conflicting same-run observations instead of overwriting them", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:conflict", 2);

    await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [githubRow],
    });
    const conflicted = await processBatch(t, {
      runId,
      page: 0,
      offset: 1,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [{ ...githubRow, upstreamInstalls: 99 }],
    });

    expect(conflicted).toMatchObject({
      status: "reconciling",
      counts: { observed: 2, conflicts: 1, rejected: 1 },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShMirrorConflicts").collect()),
    ).toHaveLength(1);
  });

  it("tombstones disappeared rows and restores them on a later run", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const first = await startRun(t, "snapshot:all");
    await processBatch(t, {
      runId: first.runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: first.runId,
      limit: 100,
    });

    const second = await startRun(t, "snapshot:missing", 1);
    await processBatch(t, {
      runId: second.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [githubRow],
    });
    const reconciled = await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: second.runId,
      limit: 100,
    });
    expect(reconciled).toMatchObject({ status: "completed", counts: { tombstoned: 1 } });
    const activeFacets = await t.query(internal.skillsShMirror.listFacetsPageInternal, {
      cursor: null,
      limit: 500,
    });
    expect(activeFacets.page.every((facet) => facet.active)).toBe(true);
    expect(activeFacets.page.some((facet) => facet.externalId === wellKnownRow.externalId)).toBe(
      false,
    );

    const third = await startRun(t, "snapshot:return", 2);
    await processBatch(t, {
      runId: third.runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: third.runId,
      limit: 100,
    });
    const restored = (await t.query(internal.skillsShMirror.getByExternalIdInternal, {
      externalId: wellKnownRow.externalId,
    })) as Doc<"skillsShMirrorDigests"> | null;
    expect(restored).toMatchObject({ active: true });
    expect(restored).not.toHaveProperty("tombstonedAt");
    expect(
      await t.query(internal.skillsShMirror.getRunInternal, { runId: third.runId }),
    ).toMatchObject({ counts: { reactivated: 1 } });
  });

  it("bounds detail proof pages below the worst-case response byte limit", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);

    await expect(
      t.query(internal.skillsShMirror.listDetailsPageInternal, {
        cursor: null,
        limit: 50,
      }),
    ).resolves.toMatchObject({ page: [] });
    await expect(
      t.query(internal.skillsShMirror.listDetailsPageInternal, {
        cursor: null,
        limit: 51,
      }),
    ).rejects.toThrow("limit must be an integer between 1 and 50");
  });
});
