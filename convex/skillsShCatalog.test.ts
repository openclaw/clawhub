/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import frozenSnapshot from "./fixtures/skills-sh-500-2026-07-21.json";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const LOCAL_ENV = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
};

const TEST_ENV = {
  CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
  CLAWHUB_DISABLE_CRONS: "1",
  CLAWHUB_ENV: "test",
  CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
};

const BASE_CONTROL = {
  actor: "codex-test",
  reason: "exercise the dark skills.sh catalog gate",
  confirm: "enable-skills-sh-fixture-control",
  mode: "fixture" as const,
  discoveryEnabled: true,
  writesEnabled: true,
  scanPlanningEnabled: true,
  scanAdmissionEnabled: true,
  maxEntriesPerRun: 500,
  maxEntriesPerBatch: 125,
  maxWritesPerBatch: 100,
  maxPlannedScans: 500,
  maxScanAdmissionsPerBatch: 50,
  maxScanAdmissionsPerRun: 500,
  maxScanAdmissionsPerDay: 500,
  maxCatalogQueued: 50,
  maxCatalogInFlight: 10,
  maxNativeQueued: 0,
  maxNativeInFlight: 0,
  realScanAllowlist: [] as string[],
};

type CatalogTest = ReturnType<typeof convexTest>;
type RunSummary = Pick<
  Doc<"skillsShCatalogRuns">,
  "status" | "cursor" | "fixtureLength" | "counts" | "snapshotCaptureFetches"
> & {
  operationsAreEstimates: boolean;
  budgetConsumed: {
    batchesProcessed: number;
  };
};

function useEnvironment(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

async function processToTerminal(
  t: CatalogTest,
  runId: Id<"skillsShCatalogRuns">,
  maxBatches = 200,
) {
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const result = (await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId,
    })) as RunSummary;
    if (result.status !== "running") return result;
  }
  throw new Error(`skills.sh run ${runId} exceeded ${maxBatches} batches`);
}

async function collectEntries(t: CatalogTest) {
  const entries: Doc<"skillsShCatalogEntries">[] = [];
  let cursor: string | null = null;
  do {
    const result = (await t.query(internal.skillsShCatalog.listEntriesPageInternal, {
      paginationOpts: { cursor, numItems: 100 },
    })) as {
      page: Doc<"skillsShCatalogEntries">[];
      isDone: boolean;
      continueCursor: string;
    };
    entries.push(...result.page);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return entries;
}

async function collectAttempts(t: CatalogTest, runId: Id<"skillsShCatalogRuns">) {
  const attempts: Doc<"skillsShCatalogScanAttempts">[] = [];
  let cursor: string | null = null;
  do {
    const result = (await t.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
      runId,
      paginationOpts: { cursor, numItems: 100 },
    })) as {
      page: Doc<"skillsShCatalogScanAttempts">[];
      isDone: boolean;
      continueCursor: string;
    };
    attempts.push(...result.page);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return attempts;
}

async function collectNativeState(t: CatalogTest) {
  const skills: Doc<"skills">[] = [];
  const jobs: Doc<"securityScanJobs">[] = [];
  let skillCursor: string | null = null;
  let jobCursor: string | null = null;
  do {
    const result = (await t.query(internal.skillsShCatalog.listNativeSkillsIsolationPageInternal, {
      paginationOpts: { cursor: skillCursor, numItems: 100 },
    })) as {
      page: Doc<"skills">[];
      isDone: boolean;
      continueCursor: string;
    };
    skills.push(...result.page);
    skillCursor = result.isDone ? null : result.continueCursor;
  } while (skillCursor);
  do {
    const result = (await t.query(
      internal.skillsShCatalog.listNativeScanJobsIsolationPageInternal,
      {
        paginationOpts: { cursor: jobCursor, numItems: 100 },
      },
    )) as {
      page: Doc<"securityScanJobs">[];
      isDone: boolean;
      continueCursor: string;
    };
    jobs.push(...result.page);
    jobCursor = result.isDone ? null : result.continueCursor;
  } while (jobCursor);
  return { skills, jobs };
}

describe("skills.sh catalog overload control plane", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("fails closed without controls and rejects spoofed Preview/Test environments", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    const initial = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(initial.control).toMatchObject({
      mode: "off",
      discoveryEnabled: false,
      writesEnabled: false,
      scanAdmissionEnabled: false,
      publicVisibilityEnabled: false,
      paused: true,
    });
    await expect(
      t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
        fixtureId: "nvidia-small-v1",
        actor: "codex-test",
        reason: "must fail closed",
      }),
    ).rejects.toThrow("controls are disabled");

    vi.stubEnv("CLAWHUB_PREVIEW", "1");
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "academic-chihuahua-392");
    vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://academic-chihuahua-392.convex.cloud");
    await expect(
      t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
        ...BASE_CONTROL,
        maxScanAdmissionsPerRun: 10,
        maxScanAdmissionsPerDay: 10,
      }),
    ).rejects.toThrow("disabled in Preview");
  });

  it("terminates explicitly when the discovery budget is exhausted", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      scanAdmissionEnabled: false,
      maxEntriesPerRun: 1,
      maxEntriesPerBatch: 1,
      maxPlannedScans: 1,
      maxScanAdmissionsPerBatch: 0,
      maxScanAdmissionsPerRun: 0,
      maxScanAdmissionsPerDay: 0,
      maxCatalogQueued: 0,
      maxCatalogInFlight: 0,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "prove budget exhaustion is terminal",
    });
    const run = await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, { runId });
    expect(run).toMatchObject({
      status: "budget-exhausted",
      cursor: 1,
      fixtureLength: 3,
      counts: {
        observed: 1,
        inserted: 1,
        scansPlanned: 1,
      },
    });
    const repeated = await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId,
    });
    expect(repeated).toMatchObject({
      status: "budget-exhausted",
      cursor: 1,
      counts: { observed: 1 },
    });
  });

  it("plans a bounded 20,000-row discovery without writing entries or enqueueing scans", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      writesEnabled: false,
      scanAdmissionEnabled: false,
      maxEntriesPerRun: 20_000,
      maxEntriesPerBatch: 250,
      maxPlannedScans: 20_000,
      maxScanAdmissionsPerBatch: 0,
      maxScanAdmissionsPerRun: 0,
      maxScanAdmissionsPerDay: 0,
      maxCatalogQueued: 0,
      maxCatalogInFlight: 0,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "prove discovery cannot enqueue scans",
      dryRun: true,
    });

    const run = await processToTerminal(t, runId);
    expect(run).toMatchObject({
      status: "completed",
      cursor: 20_000,
      fixtureLength: 20_000,
      counts: {
        observed: 20_000,
        wouldInsert: 20_000,
        inserted: 0,
        scansPlanned: 20_000,
        scansAdmitted: 0,
        scansCompleted: 0,
      },
      budgetConsumed: {
        batchesProcessed: 80,
      },
      operationsAreEstimates: true,
    });
    expect(await collectEntries(t)).toHaveLength(0);
    expect(await collectAttempts(t, runId)).toHaveLength(0);
    expect(
      await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect()),
    ).toHaveLength(0);
  }, 60_000);

  it("persists and completes 500 rows, then reruns idempotently and rescans only a changed source hash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, BASE_CONTROL);
    const nativeBefore = await collectNativeState(t);
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "codex-test",
      reason: "first frozen 500 run",
    });

    const firstBatch = await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId,
    });
    expect(firstBatch.status).toBe("running");
    const cursorBeforePause = firstBatch.cursor;
    const countsBeforePause = firstBatch.counts;
    await t.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, { runId, paused: true });
    await expect(
      t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
        runId,
      }),
    ).rejects.toThrow("run is paused");
    const paused = await t.query(internal.skillsShCatalog.getRunInternal, {
      runId,
    });
    expect(paused).toMatchObject({
      cursor: cursorBeforePause,
      counts: countsBeforePause,
    });
    await t.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, {
      runId,
      paused: false,
    });
    const firstRun = await processToTerminal(t, runId);
    expect(firstRun).toMatchObject({
      status: "completed",
      cursor: 500,
      counts: {
        observed: 500,
        wouldInsert: 500,
        wouldUpdate: 0,
        inserted: 500,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        scansPlanned: 500,
        scansAdmitted: 0,
      },
      snapshotCaptureFetches: 528,
    });

    const entries = await collectEntries(t);
    expect(entries).toHaveLength(500);
    expect(entries.filter((entry) => entry.owner === "nvidia")).toHaveLength(10);
    expect(entries.map((entry) => entry.externalId)).toEqual(
      expect.arrayContaining([
        "anthropics/skills/frontend-design",
        "anthropics/claude-code/frontend-design",
      ]),
    );
    expect(entries.every((entry) => !entry.publicVisible)).toBe(true);

    for (let offset = 0; offset < entries.length; offset += 50) {
      const externalIds = entries.slice(offset, offset + 50).map((entry) => entry.externalId);
      const admission = await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId,
        externalIds,
        dispatchKind: "deterministic",
      });
      expect(admission).toMatchObject({
        admitted: externalIds.length,
        skipped: 0,
      });
      const completion = await t.mutation(
        internal.skillsShCatalog.completeDeterministicScansInternal,
        { runId, limit: 50 },
      );
      expect(completion).toMatchObject({
        matched: externalIds.length,
        completed: externalIds.length,
        canceled: 0,
      });
    }
    const completedFirstRun = await t.query(internal.skillsShCatalog.getRunInternal, { runId });
    expect(completedFirstRun?.counts).toMatchObject({
      scansAdmitted: 500,
      scansCompleted: 500,
    });
    expect(await collectAttempts(t, runId)).toHaveLength(500);

    const repeated = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "codex-test",
      reason: "identical frozen rerun",
    });
    const repeatedRun = await processToTerminal(t, repeated.runId);
    expect(repeatedRun.counts).toEqual({
      observed: 500,
      wouldInsert: 0,
      wouldUpdate: 0,
      inserted: 0,
      updated: 0,
      unchanged: 500,
      rejected: 0,
      scansPlanned: 0,
      scansAdmitted: 0,
      scansCompleted: 0,
      scansCanceled: 0,
    });
    expect(await collectAttempts(t, repeated.runId)).toHaveLength(0);

    vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
    const changed = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21-v2",
      actor: "codex-test",
      reason: "changed frozen rerun",
    });
    const changedRun = await processToTerminal(t, changed.runId);
    expect(changedRun.counts).toEqual({
      observed: 500,
      wouldInsert: 0,
      wouldUpdate: 2,
      inserted: 0,
      updated: 2,
      unchanged: 498,
      rejected: 0,
      scansPlanned: 1,
      scansAdmitted: 0,
      scansCompleted: 0,
      scansCanceled: 0,
    });
    const changedEntries = await collectEntries(t);
    const planned = changedEntries.filter((entry) => entry.scanStatus === "planned");
    expect(planned).toHaveLength(1);
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId: changed.runId,
      externalIds: [planned[0]!.externalId],
      dispatchKind: "deterministic",
    });
    await t.mutation(internal.skillsShCatalog.completeDeterministicScansInternal, {
      runId: changed.runId,
      limit: 1,
    });
    const changedAttempts = await collectAttempts(t, changed.runId);
    expect(changedAttempts).toHaveLength(1);
    expect(changedAttempts[0]?.sourceContentHash).toBe(planned[0]?.sourceContentHash);
    expect(changedAttempts[0]?.artifactContentHash).toBeUndefined();

    const allEntries = await collectEntries(t);
    expect(allEntries).toHaveLength(500);
    expect(allEntries.every((entry) => !entry.publicVisible)).toBe(true);
    expect(await collectNativeState(t)).toEqual(nativeBefore);
  }, 60_000);

  it("allows at most ten explicitly allowlisted real Test queue records for the frozen 500", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const allowlist = frozenSnapshot.rows.slice(0, 10).map((row) => row.externalId);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxScanAdmissionsPerBatch: 10,
      maxScanAdmissionsPerRun: 10,
      maxScanAdmissionsPerDay: 10,
      maxCatalogQueued: 10,
      maxCatalogInFlight: 1,
      realScanAllowlist: allowlist,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "codex-test",
      reason: "production-shaped Test seam",
    });
    const run = await processToTerminal(t, runId);
    expect(run.counts).toMatchObject({
      observed: 500,
      scansPlanned: 500,
      scansAdmitted: 0,
    });
    await expect(
      t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId,
        externalIds: [frozenSnapshot.rows[10]!.externalId],
        dispatchKind: "real",
      }),
    ).rejects.toThrow("not allowlisted");

    const admitted = await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: allowlist,
      dispatchKind: "real",
    });
    expect(admitted.admitted).toBe(10);
    const realQueue = await t.query(internal.skillsShCatalog.listRealScanQueueInternal, {
      limit: 10,
    });
    expect(realQueue).toHaveLength(10);
    expect(
      realQueue.every(
        (attempt) =>
          attempt.priority === "low" &&
          attempt.requiresArtifactFetch &&
          !attempt.artifactContentHash,
      ),
    ).toBe(true);
    await expect(
      t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
        attemptId: realQueue[0]!._id,
        sourceContentHash: realQueue[0]!.sourceContentHash,
        verdict: "clean",
      }),
    ).rejects.toThrow("external artifact-fetch integration");
    expect(
      await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect()),
    ).toHaveLength(0);
  }, 30_000);

  it("enforces queue health and concurrent caps, then cancels only catalog state", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", {
        handle: "native-owner",
        displayName: "Native Owner",
      });
      const nativeSkillId = await ctx.db.insert("skills", {
        slug: "native-skill",
        displayName: "Native Skill",
        ownerUserId,
        tags: {},
        stats: {
          downloads: 0,
          stars: 0,
          versions: 0,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 1,
      });
      const nativeCompletedJobId = await ctx.db.insert("securityScanJobs", {
        targetKind: "skillVersion",
        status: "succeeded",
        source: "manual",
        priority: 0,
        hasMaliciousSignal: false,
        waitForVtUntil: 0,
        nextRunAt: 0,
        attempts: 1,
        completedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { nativeSkillId, nativeCompletedJobId };
    });
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 3,
      maxEntriesPerBatch: 3,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "queue and concurrency proof",
    });
    await processToTerminal(t, runId);
    const entries = await collectEntries(t);
    expect(entries).toHaveLength(2);

    const blockingJobId = await t.run(async (ctx) => {
      return await ctx.db.insert("securityScanJobs", {
        targetKind: "skillVersion",
        status: "queued",
        source: "manual",
        priority: 0,
        hasMaliciousSignal: false,
        waitForVtUntil: 0,
        nextRunAt: 0,
        attempts: 0,
        createdAt: 2,
        updatedAt: 2,
      });
    });
    await expect(
      t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId,
        externalIds: [entries[0]!.externalId],
        dispatchKind: "deterministic",
      }),
    ).rejects.toThrow("blocked by queue health");
    await t.run(async (ctx) => await ctx.db.delete(blockingJobId));
    const nativeBefore = await collectNativeState(t);

    const concurrent = await Promise.allSettled(
      entries.map((entry) =>
        t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
          runId,
          externalIds: [entry.externalId],
          dispatchKind: "deterministic",
        }),
      ),
    );
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const attempts = await collectAttempts(t, runId);
    expect(attempts).toHaveLength(1);
    await t.mutation(internal.skillsShCatalog.markScanAttemptRunningInternal, {
      attemptId: attempts[0]!._id,
    });
    const canceled = await t.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId,
      limit: 10,
    });
    expect(canceled.canceled).toBe(1);
    await t.mutation(internal.skillsShCatalog.disableCatalogInternal, {
      actor: "codex-test",
      reason: "prove reversible rollback",
      confirm: "disable-skills-sh-catalog",
    });
    const status = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(status.control).toMatchObject({
      mode: "off",
      discoveryEnabled: false,
      writesEnabled: false,
      scanPlanningEnabled: false,
      scanAdmissionEnabled: false,
      publicVisibilityEnabled: false,
      paused: true,
    });
    expect(status.entries.every((entry) => !entry.publicVisible)).toBe(true);
    expect(await collectNativeState(t)).toEqual(nativeBefore);
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.nativeSkillId))).toMatchObject({
      slug: "native-skill",
      updatedAt: 1,
    });
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.nativeCompletedJobId))).toMatchObject(
      { status: "succeeded", updatedAt: 1 },
    );
  });
});
