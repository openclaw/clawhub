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

async function sha256Hex(value: string | Blob) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(await value.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeTestArtifact(
  t: CatalogTest,
  externalId: string,
  content: string,
  path = "SKILL.md",
) {
  const blob = new Blob([content], { type: "text/markdown" });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(blob));
  const sha256 = await sha256Hex(blob);
  return {
    externalId,
    artifactContentHash: await sha256Hex(`${path}\0${sha256}\n`),
    files: [
      {
        path,
        size: blob.size,
        storageId,
        sha256,
        contentType: "text/markdown",
      },
    ],
  };
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

  it("rejects a fixture observation that collides with a live-source entry", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    const row = frozenSnapshot.rows[0]!;
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShCatalogEntries", {
        ...row,
        sourceKind: "staging-live",
        sourceSnapshotId: "skills-sh-test-live-500:existing",
        publicVisible: false,
        scanStatus: "not-planned",
        firstObservedAt: 1,
        lastObservedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
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
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "codex-test",
      reason: "preserve live source ownership",
    });

    const result = await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId,
    });

    expect(result).toMatchObject({
      counts: { observed: 1, rejected: 1, inserted: 0, updated: 0, scansPlanned: 0 },
    });
    expect((await collectEntries(t))[0]).toMatchObject({
      sourceKind: "staging-live",
      sourceSnapshotId: "skills-sh-test-live-500:existing",
      updatedAt: 1,
    });
  });

  it("rejects a live observation that collides with a fixture-source entry", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const row = frozenSnapshot.rows[0]!;
    await t.run(async (ctx) => {
      await ctx.db.insert("skillsShCatalogEntries", {
        ...row,
        sourceKind: "frozen-snapshot",
        sourceSnapshotId: "skills-sh-500-2026-07-21",
        publicVisible: false,
        scanStatus: "not-planned",
        firstObservedAt: 1,
        lastObservedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerBatch: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "codex-test",
      reason: "preserve fixture source ownership",
      snapshotId: "skills-sh-test-live-500:new",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 1,
      fixtureLength: 500,
    });

    const result = await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [row],
    });

    expect(result).toMatchObject({
      counts: { observed: 1, rejected: 1, inserted: 0, updated: 0, scansPlanned: 0 },
    });
    expect((await collectEntries(t))[0]).toMatchObject({
      sourceKind: "frozen-snapshot",
      sourceSnapshotId: "skills-sh-500-2026-07-21",
      updatedAt: 1,
    });
  });

  it("plans a changed hash once when the previous hash is still unadmitted", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      scanAdmissionEnabled: false,
      maxScanAdmissionsPerBatch: 0,
      maxScanAdmissionsPerRun: 0,
      maxScanAdmissionsPerDay: 0,
      maxCatalogQueued: 0,
      maxCatalogInFlight: 0,
    });
    const first = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "leave the first hash planned and unadmitted",
    });
    await processToTerminal(t, first.runId);

    const changed = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "plan the changed hash exactly once",
    });
    const changedRun = await processToTerminal(t, changed.runId);
    expect(changedRun.counts).toMatchObject({
      observed: 1,
      wouldUpdate: 1,
      updated: 1,
      scansPlanned: 1,
      scansAdmitted: 0,
    });

    const repeated = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "do not replan the unchanged hash",
    });
    const repeatedRun = await processToTerminal(t, repeated.runId);
    expect(repeatedRun.counts).toMatchObject({
      observed: 1,
      unchanged: 1,
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(await collectAttempts(t, first.runId)).toHaveLength(0);
    expect(await collectAttempts(t, changed.runId)).toHaveLength(0);
    expect(await collectAttempts(t, repeated.runId)).toHaveLength(0);
  });

  it("replans unchanged fixture content after its prior attempt was canceled", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 2,
      maxEntriesPerBatch: 2,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
    });
    const first = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "cancel one fixture attempt",
    });
    await processToTerminal(t, first.runId);
    const [entry] = await collectEntries(t);
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId: first.runId,
      externalIds: [entry!.externalId],
      dispatchKind: "deterministic",
    });
    await t.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId: first.runId,
      limit: 10,
    });

    const repeated = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "replan canceled fixture content",
    });
    const repeatedRun = await processToTerminal(t, repeated.runId);

    expect(repeatedRun.counts).toMatchObject({
      observed: 2,
      unchanged: 2,
      scansPlanned: 1,
    });
    expect(
      (await collectEntries(t)).find((row) => row.externalId === entry!.externalId),
    ).toMatchObject({
      scanStatus: "planned",
    });
    const readmitted = await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId: repeated.runId,
      externalIds: [entry!.externalId],
      dispatchKind: "deterministic",
    });
    expect(readmitted).toMatchObject({ admitted: 1, skipped: 0 });
    expect(await collectAttempts(t, first.runId)).toHaveLength(1);
    expect(await collectAttempts(t, repeated.runId)).toMatchObject([
      { status: "queued", sourceContentHash: entry!.sourceContentHash },
    ]);
  });

  it("replans unchanged staging content after its prior attempt was canceled", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const row = frozenSnapshot.rows.find(
      (candidate) => candidate.externalId === "nvidia/skills/aiq-deploy",
    )!;
    const actorUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        handle: "catalog-retry-operator",
        displayName: "Catalog Retry Operator",
        role: "admin",
      });
    });
    const artifact = await storeTestArtifact(t, row.externalId, "staging retry artifact");
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerRun: 500,
      maxEntriesPerBatch: 1,
      maxPlannedScans: 500,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: [row.externalId],
    });
    const first = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "codex-test",
      reason: "cancel one staging attempt",
      snapshotId: "skills-sh-test-live-500:canceled-first",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 1,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId: first.runId,
      cursor: 0,
      rows: [row],
    });
    await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId: first.runId,
      externalIds: [row.externalId],
      actorUserId,
      artifacts: [artifact],
    });
    await t.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId: first.runId,
      limit: 10,
    });

    const repeated = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "codex-test",
      reason: "replan canceled staging content",
      snapshotId: "skills-sh-test-live-500:canceled-repeat",
      sourceCapturedAt: "2026-07-21T00:05:00.000Z",
      snapshotCaptureFetches: 1,
      fixtureLength: 500,
    });
    const repeatedRun = await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId: repeated.runId,
      cursor: 0,
      rows: [row],
    });

    expect(repeatedRun.counts).toMatchObject({
      observed: 1,
      unchanged: 1,
      scansPlanned: 1,
    });
    expect(
      (await collectEntries(t)).find((entry) => entry.externalId === row.externalId),
    ).toMatchObject({
      scanStatus: "planned",
      sourceSnapshotId: "skills-sh-test-live-500:canceled-repeat",
    });
    const readmitted = await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId: repeated.runId,
      externalIds: [row.externalId],
      actorUserId,
      artifacts: [artifact],
    });
    expect(readmitted).toMatchObject({ admitted: 1, skipped: 0 });
    expect(await collectAttempts(t, first.runId)).toHaveLength(1);
    expect(await collectAttempts(t, repeated.runId)).toMatchObject([
      { status: "queued", sourceContentHash: row.sourceContentHash },
    ]);
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

    for (let offset = 0; offset < entries.length; offset += 49) {
      const externalIds = entries.slice(offset, offset + 49).map((entry) => entry.externalId);
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
        { runId, limit: externalIds.length },
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

    const repeatedAt = new Date("2026-07-21T04:00:00.000Z");
    vi.setSystemTime(repeatedAt);
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
    expect(
      (await collectEntries(t)).every((entry) => entry.lastObservedAt === repeatedAt.getTime()),
    ).toBe(true);

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

    vi.setSystemTime(new Date("2026-07-23T03:00:00.000Z"));
    const reverted = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "codex-test",
      reason: "reuse the original exact-hash verdict",
    });
    const revertedRun = await processToTerminal(t, reverted.runId);
    expect(revertedRun.counts).toMatchObject({
      observed: 500,
      wouldUpdate: 2,
      updated: 2,
      unchanged: 498,
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(await collectAttempts(t, reverted.runId)).toHaveLength(0);
    const allEntries = await collectEntries(t);
    const revertedEntry = allEntries.find((entry) => entry.externalId === planned[0]!.externalId);
    const originalEntry = entries.find((entry) => entry.externalId === planned[0]!.externalId);
    expect(revertedEntry).toMatchObject({
      sourceContentHash: originalEntry?.sourceContentHash,
      scanStatus: "clean",
      publicVisible: false,
    });
    expect(allEntries).toHaveLength(500);
    expect(allEntries.every((entry) => !entry.publicVisible)).toBe(true);
    expect(await collectNativeState(t)).toEqual(nativeBefore);
  }, 60_000);

  it("rejects real Test admission from a fixture run after controls switch to staging-live", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const allowlist = frozenSnapshot.rows.slice(0, 10).map((row) => row.externalId);
    const actorUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        handle: "catalog-test-operator",
        displayName: "Catalog Test Operator",
        role: "admin",
      });
    });
    const storedArtifact = await storeTestArtifact(t, allowlist[0]!, "catalog test artifact");
    const artifacts = allowlist.map((externalId) => ({
      ...storedArtifact,
      externalId,
    }));
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
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
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId,
        externalIds: [allowlist[0]!],
        actorUserId,
        artifacts: [artifacts[0]!],
      }),
    ).rejects.toThrow("requires staging-live controls");
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
    await expect(
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId,
        externalIds: allowlist,
        actorUserId,
        artifacts,
      }),
    ).rejects.toThrow("requires a staging-live run");
    expect(
      await t.query(internal.skillsShCatalog.listRealScanQueueInternal, {
        limit: 10,
      }),
    ).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
      [],
    );
  }, 30_000);

  it("rejects fixture discovery after controls switch to staging-live", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxScanAdmissionsPerRun: 10,
      maxScanAdmissionsPerDay: 10,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "fixture run before staging-live switch",
    });
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxScanAdmissionsPerRun: 10,
      maxScanAdmissionsPerDay: 10,
    });

    await expect(
      t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
        fixtureId: "nvidia-small-v1",
        actor: "codex-test",
        reason: "fixture start under staging-live controls",
      }),
    ).rejects.toThrow("fixture work requires fixture controls");
    await expect(
      t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, { runId }),
    ).rejects.toThrow("fixture work requires fixture controls");
    expect(await collectEntries(t)).toEqual([]);
  });

  it("rejects deterministic fixture scan lifecycle after a staging-live mode switch", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 2,
      maxEntriesPerBatch: 2,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 2,
      maxScanAdmissionsPerRun: 2,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 2,
      maxCatalogInFlight: 1,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "fixture attempts before staging-live switch",
    });
    await processToTerminal(t, runId);
    const entries = await collectEntries(t);
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: [entries[0]!.externalId],
      dispatchKind: "deterministic",
    });
    const [attempt] = await collectAttempts(t, runId);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerRun: 2,
      maxEntriesPerBatch: 2,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 2,
      maxScanAdmissionsPerRun: 2,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 2,
      maxCatalogInFlight: 1,
    });

    await expect(
      t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId,
        externalIds: [entries[1]!.externalId],
        dispatchKind: "deterministic",
      }),
    ).rejects.toThrow("fixture work requires fixture controls");
    await expect(
      t.mutation(internal.skillsShCatalog.markScanAttemptRunningInternal, {
        attemptId: attempt!._id,
      }),
    ).rejects.toThrow("fixture work requires fixture controls");
    await expect(
      t.mutation(internal.skillsShCatalog.completeDeterministicScansInternal, {
        runId,
        limit: 1,
      }),
    ).rejects.toThrow("fixture work requires fixture controls");
    await expect(
      t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
        attemptId: attempt!._id,
        sourceContentHash: attempt!.sourceContentHash,
        verdict: "clean",
      }),
    ).rejects.toThrow("fixture work requires fixture controls");
    expect((await collectAttempts(t, runId))[0]).toMatchObject({ status: "queued" });
    expect((await collectEntries(t)).every((entry) => !entry.publicVisible)).toBe(true);
  });

  it("rejects non-admin real scan admission", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-test-user",
          displayName: "Catalog Test User",
          role: "user",
        }),
    );
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerBatch: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-test-user",
      reason: "reject non-admin admission",
      snapshotId: "skills-sh-test-live-500:non-admin",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 1,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [frozenSnapshot.rows.find((row) => row.externalId === "nvidia/skills/aiq-deploy")!],
    });
    const artifact = await storeTestArtifact(t, "nvidia/skills/aiq-deploy", "non-admin artifact");

    await expect(
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId,
        externalIds: ["nvidia/skills/aiq-deploy"],
        actorUserId,
        artifacts: [artifact],
      }),
    ).rejects.toThrow("requires an admin operator");
    expect(await collectAttempts(t, runId)).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
      [],
    );
  });

  it("validates every stored real artifact before writing scan state", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-artifact-admin",
          displayName: "Catalog Artifact Admin",
          role: "admin",
        }),
    );
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerBatch: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-artifact-admin",
      reason: "validate stored artifact bytes",
      snapshotId: "skills-sh-test-live-500:artifact-validation",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 1,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [frozenSnapshot.rows.find((row) => row.externalId === "nvidia/skills/aiq-deploy")!],
    });
    const valid = await storeTestArtifact(t, "nvidia/skills/aiq-deploy", "verified artifact bytes");
    const invalidArtifacts = [
      {
        ...valid,
        files: [{ ...valid.files[0]!, path: "../SKILL.md" }],
      },
      {
        ...valid,
        files: [valid.files[0]!, { ...valid.files[0]! }],
      },
      {
        ...valid,
        files: [{ ...valid.files[0]!, size: valid.files[0]!.size + 1 }],
      },
      {
        ...valid,
        files: [{ ...valid.files[0]!, sha256: "0".repeat(64) }],
      },
      {
        ...valid,
        artifactContentHash: "0".repeat(64),
      },
    ];

    for (const artifact of invalidArtifacts) {
      await expect(
        t.action(internal.skillsShCatalog.admitRealScansInternal, {
          runId,
          externalIds: ["nvidia/skills/aiq-deploy"],
          actorUserId,
          artifacts: [artifact],
        }),
      ).rejects.toThrow();
      expect(await collectAttempts(t, runId)).toEqual([]);
      expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
        [],
      );
    }
  });

  it("charges retry budgets only for newly admitted scan attempts", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 2,
      maxEntriesPerBatch: 2,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 2,
      maxScanAdmissionsPerRun: 2,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 2,
      maxCatalogInFlight: 1,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "idempotent admission retry budget",
    });
    await processToTerminal(t, runId);
    const entries = await collectEntries(t);
    expect(entries).toHaveLength(2);

    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: [entries[0]!.externalId],
      dispatchKind: "deterministic",
    });
    const retried = await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: entries.map((entry) => entry.externalId),
      dispatchKind: "deterministic",
    });
    expect(retried).toMatchObject({ requested: 2, admitted: 1, skipped: 1 });
    expect(await collectAttempts(t, runId)).toHaveLength(2);
  });

  it("applies a lowered current daily admission cap to an existing run", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 2,
      maxEntriesPerBatch: 2,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 2,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 2,
      maxCatalogInFlight: 1,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "current daily cap overrides stale run budget",
    });
    await processToTerminal(t, runId);
    const entries = await collectEntries(t);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 2,
      maxEntriesPerBatch: 2,
      maxPlannedScans: 2,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 2,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 2,
      maxCatalogInFlight: 1,
    });
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: [entries[0]!.externalId],
      dispatchKind: "deterministic",
    });

    await expect(
      t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId,
        externalIds: [entries[1]!.externalId],
        dispatchKind: "deterministic",
      }),
    ).rejects.toThrow("daily scan-admission budget exceeded");
    expect(await collectAttempts(t, runId)).toHaveLength(1);
  });

  it("completes deterministic work when real in-flight capacity is zero", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 1,
      maxEntriesPerBatch: 1,
      maxPlannedScans: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 0,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "deterministic completion does not consume real in-flight capacity",
    });
    await processToTerminal(t, runId);
    const [entry] = await collectEntries(t);
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: [entry!.externalId],
      dispatchKind: "deterministic",
    });

    const completed = await t.mutation(
      internal.skillsShCatalog.completeDeterministicScansInternal,
      {
        runId,
        limit: 1,
      },
    );
    expect(completed).toMatchObject({ matched: 1, completed: 1, canceled: 0 });
  });

  it("does not complete queued deterministic work while the run is paused", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 3,
      maxEntriesPerBatch: 1,
      maxPlannedScans: 3,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "pause queued deterministic completion",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, { runId });
    const [entry] = await collectEntries(t);
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: [entry!.externalId],
      dispatchKind: "deterministic",
    });
    await t.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, {
      runId,
      paused: true,
    });

    await expect(
      t.mutation(internal.skillsShCatalog.completeDeterministicScansInternal, {
        runId,
        limit: 1,
      }),
    ).rejects.toThrow("Cannot complete scans for paused run");
    expect((await collectAttempts(t, runId))[0]).toMatchObject({ status: "queued" });
    expect((await collectEntries(t))[0]).toMatchObject({ scanStatus: "queued" });
  });

  it("blocks queued starts and late results while a catalog run is canceling", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      maxEntriesPerRun: 3,
      maxEntriesPerBatch: 3,
      maxPlannedScans: 3,
      maxScanAdmissionsPerBatch: 3,
      maxScanAdmissionsPerRun: 3,
      maxScanAdmissionsPerDay: 3,
      maxCatalogQueued: 3,
      maxCatalogInFlight: 3,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "codex-test",
      reason: "partial cancellation lifecycle",
    });
    await processToTerminal(t, runId);
    const entries = await collectEntries(t);
    await t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId,
      externalIds: entries.map((entry) => entry.externalId),
      dispatchKind: "deterministic",
    });
    const attempts = await collectAttempts(t, runId);
    expect(attempts).toHaveLength(3);
    await t.mutation(internal.skillsShCatalog.markScanAttemptRunningInternal, {
      attemptId: attempts[2]!._id,
    });

    const partial = await t.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId,
      limit: 1,
    });
    expect(partial).toMatchObject({ canceled: 1, hasMore: true, status: "canceling" });
    await expect(
      t.mutation(internal.skillsShCatalog.markScanAttemptRunningInternal, {
        attemptId: attempts[1]!._id,
      }),
    ).rejects.toThrow("Cannot start scan for canceling run");
    await expect(
      t.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId,
        externalIds: [entries[1]!.externalId],
        dispatchKind: "deterministic",
      }),
    ).rejects.toThrow("Cannot admit scans for canceling run");

    const lateResult = await t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
      attemptId: attempts[2]!._id,
      sourceContentHash: attempts[2]!.sourceContentHash,
      verdict: "clean",
    });
    expect(lateResult).toEqual({ applied: false, reason: "run-canceled" });
    const finished = await t.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId,
      limit: 10,
    });
    expect(finished).toMatchObject({ canceled: 1, hasMore: false, status: "canceled" });
    expect(
      (await collectAttempts(t, runId)).every((attempt) => attempt.status === "canceled"),
    ).toBe(true);
    expect((await collectEntries(t)).every((entry) => !entry.publicVisible)).toBe(true);
  });

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

  it("persists live Test batches dark and links an admitted artifact to the real scan queue", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        handle: "catalog-test-operator",
        displayName: "Catalog Test Operator",
        role: "admin",
      });
    });
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerRun: 500,
      maxEntriesPerBatch: 100,
      maxPlannedScans: 500,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      maxNativeQueued: 0,
      maxNativeInFlight: 0,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });

    const rows = frozenSnapshot.rows.map((row) => ({ ...row }));
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-test-operator",
      reason: "prove exact live Test batching",
      snapshotId: "skills-sh-test-live-500:test",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 528,
      fixtureLength: rows.length,
    });
    for (let cursor = 0; cursor < rows.length; cursor += 50) {
      await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
        runId,
        cursor,
        rows: rows.slice(cursor, cursor + 50),
      });
    }

    const run = await t.query(internal.skillsShCatalog.getRunInternal, { runId });
    expect(run).toMatchObject({
      status: "completed",
      cursor: 500,
      counts: {
        observed: 500,
        inserted: 500,
        scansPlanned: 500,
        scansAdmitted: 0,
      },
    });
    expect((await collectEntries(t)).every((entry) => !entry.publicVisible)).toBe(true);

    const artifact = await storeTestArtifact(t, "nvidia/skills/aiq-deploy", "hello catalog");
    const admitted = await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId,
      externalIds: ["nvidia/skills/aiq-deploy"],
      actorUserId,
      artifacts: [artifact],
    });
    expect(admitted).toMatchObject({ admitted: 1, skipped: 0 });

    const [attempt] = await collectAttempts(t, runId);
    expect(attempt).toMatchObject({
      dispatchKind: "real",
      source: "skills-sh-catalog-test",
      artifactContentHash: artifact.artifactContentHash,
    });
    const linked = await t.run(async (ctx) => {
      const request = attempt?.skillScanRequestId
        ? await ctx.db.get(attempt.skillScanRequestId)
        : null;
      const job = attempt?.securityScanJobId ? await ctx.db.get(attempt.securityScanJobId) : null;
      return { request, job };
    });
    expect(linked.request).toMatchObject({
      actorUserId,
      sourceKind: "skills-sh-catalog",
      status: "queued",
      sha256hash: artifact.artifactContentHash,
      skillsShCatalogAttemptId: attempt?._id,
    });
    expect(linked.request).not.toHaveProperty("skillId");
    expect(linked.job).toMatchObject({
      targetKind: "skillScanRequest",
      source: "skills-sh-catalog-test",
      priority: -100,
      status: "queued",
      skillScanRequestId: linked.request?._id,
    });

    const operationsBeforeStaleResult = (await t.query(internal.skillsShCatalog.getRunInternal, {
      runId,
    }))!.operations;
    await t.run(async (ctx) => {
      const entry = await ctx.db.get(attempt!.entryId);
      await ctx.db.patch(entry!._id, {
        sourceContentHash: "changed-after-admission",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt!.securityScanJobId!, {
        status: "running",
        leaseToken: "lease-token",
        leaseExpiresAt: Date.now() + 60_000,
        workerId: "catalog-worker",
        updatedAt: Date.now(),
      });
    });
    const staleResult = await t.mutation(
      internal.securityScan.completeCatalogSkillScanJobInternal,
      {
        attemptId: attempt!._id,
        scanId: attempt!.skillScanRequestId!,
        jobId: attempt!.securityScanJobId!,
        leaseToken: "lease-token",
        artifactContentHash: attempt!.artifactContentHash!,
        verdict: "clean",
        runId: "clawscan-run",
        llmAnalysis: { status: "clean", checkedAt: Date.now() },
      },
    );
    expect(staleResult).toEqual({ ok: true, applied: false, reason: "stale-attempt" });
    const staleRun = await t.query(internal.skillsShCatalog.getRunInternal, { runId });
    expect(staleRun).toMatchObject({
      counts: {
        scansAdmitted: 1,
        scansCanceled: 1,
        scansCompleted: 0,
      },
    });
    expect(staleRun!.operations.dbWrites).toBe(operationsBeforeStaleResult.dbWrites + 4);
    expect((await collectAttempts(t, runId))[0]).toMatchObject({
      status: "canceled",
    });
    expect(
      await t.run(async (ctx) => await ctx.db.get(attempt!.skillScanRequestId!)),
    ).toMatchObject({
      status: "failed",
      lastError: "Catalog source changed before scan completion",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(attempt!.securityScanJobId!))).toMatchObject(
      {
        status: "failed",
        lastError: "Catalog source changed before scan completion",
      },
    );
  });

  it("defers expiry cleanup for an active catalog job and accepts its later result", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-expiry-operator",
          displayName: "Catalog Expiry Operator",
          role: "admin",
        }),
    );
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerRun: 500,
      maxEntriesPerBatch: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-expiry-operator",
      reason: "prove active request expiry is deferred",
      snapshotId: "skills-sh-test-live-500:active-expiry",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 528,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [frozenSnapshot.rows.find((row) => row.externalId === "nvidia/skills/aiq-deploy")!],
    });
    const artifact = await storeTestArtifact(
      t,
      "nvidia/skills/aiq-deploy",
      "active expiry artifact",
    );
    await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId,
      externalIds: ["nvidia/skills/aiq-deploy"],
      actorUserId,
      artifacts: [artifact],
    });
    const [attempt] = await collectAttempts(t, runId);
    await t.run(async (ctx) => {
      await ctx.db.patch(attempt!.skillScanRequestId!, {
        status: "running",
        expiresAt: 0,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt!.securityScanJobId!, {
        status: "running",
        leaseToken: "lease-token",
        leaseExpiresAt: Date.now() + 60_000,
        workerId: "catalog-worker",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt!._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    });

    const pruned = await t.mutation(internal.securityScan.pruneExpiredSkillScanRequestsInternal, {
      batchSize: 10,
    });
    expect(pruned).toMatchObject({
      deletedRequests: 0,
      deferredRequests: 1,
      deletedJobs: 0,
      deletedFiles: 0,
      done: false,
    });
    expect(
      await t.run(async (ctx) => await ctx.db.get(attempt!.skillScanRequestId!)),
    ).toMatchObject({ status: "running" });
    expect(await t.run(async (ctx) => await ctx.db.get(attempt!.securityScanJobId!))).toMatchObject(
      { status: "running" },
    );
    expect((await collectAttempts(t, runId))[0]).toMatchObject({ status: "running" });

    const result = await t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
      attemptId: attempt!._id,
      scanId: attempt!.skillScanRequestId!,
      jobId: attempt!.securityScanJobId!,
      leaseToken: "lease-token",
      artifactContentHash: attempt!.artifactContentHash!,
      verdict: "clean",
      runId: "clawscan-run",
      llmAnalysis: { status: "clean", checkedAt: Date.now() },
    });
    expect(result).toEqual({ ok: true, applied: true, publicVisible: false });
    expect((await collectAttempts(t, runId))[0]).toMatchObject({
      status: "succeeded",
      verdict: "clean",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(attempt!.entryId))).toMatchObject({
      scanStatus: "clean",
      publicVisible: false,
    });
    expect(
      await t.run(async (ctx) => await ctx.db.get(attempt!.skillScanRequestId!)),
    ).toMatchObject({
      status: "succeeded",
      runId: "clawscan-run",
      llmAnalysis: { status: "clean" },
    });
    const completedJob = await t.run(async (ctx) => await ctx.db.get(attempt!.securityScanJobId!));
    expect(completedJob).toMatchObject({
      status: "succeeded",
      runId: "clawscan-run",
    });
    expect(completedJob).not.toHaveProperty("leaseToken");
    expect(completedJob).not.toHaveProperty("leaseExpiresAt");
    expect(await t.query(internal.skillsShCatalog.getRunInternal, { runId })).toMatchObject({
      counts: { scansCompleted: 1 },
    });
  });

  it("keeps a running real job active until its terminal callback after cancellation", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-cancel-operator",
          displayName: "Catalog Cancel Operator",
          role: "admin",
        }),
    );
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerRun: 500,
      maxEntriesPerBatch: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-cancel-operator",
      reason: "defer running real cancellation",
      snapshotId: "skills-sh-test-live-500:cancel-running",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 528,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [frozenSnapshot.rows.find((row) => row.externalId === "nvidia/skills/aiq-deploy")!],
    });
    const artifact = await storeTestArtifact(
      t,
      "nvidia/skills/aiq-deploy",
      "running cancellation artifact",
    );
    await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId,
      externalIds: ["nvidia/skills/aiq-deploy"],
      actorUserId,
      artifacts: [artifact],
    });
    const [attempt] = await collectAttempts(t, runId);
    await t.run(async (ctx) => {
      await ctx.db.patch(attempt!.skillScanRequestId!, {
        status: "running",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt!.securityScanJobId!, {
        status: "running",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt!._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    });

    const canceling = await t.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId,
      limit: 10,
    });
    expect(canceling).toMatchObject({ canceled: 0, hasMore: true, status: "canceling" });
    expect((await collectAttempts(t, runId))[0]).toMatchObject({ status: "running" });
    expect(await t.run(async (ctx) => await ctx.db.get(attempt!.securityScanJobId!))).toMatchObject(
      {
        status: "running",
      },
    );

    const terminal = await t.mutation(internal.skillsShCatalog.recordRealScanResultInternal, {
      attemptId: attempt!._id,
      artifactContentHash: attempt!.artifactContentHash!,
      verdict: "clean",
    });
    expect(terminal).toEqual({ applied: false, reason: "run-canceled" });
    expect((await collectAttempts(t, runId))[0]).toMatchObject({ status: "canceled" });
    expect(await t.query(internal.skillsShCatalog.getRunInternal, { runId })).toMatchObject({
      status: "canceled",
      counts: { scansCanceled: 1 },
    });
  });

  it("fixture queue cleanup leaves real staging attempts untouched", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const counts = {
        observed: 1,
        wouldInsert: 1,
        wouldUpdate: 0,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        scansPlanned: 1,
        scansAdmitted: 1,
        scansCompleted: 0,
        scansCanceled: 0,
      };
      const budgets = {
        maxEntriesPerRun: 1,
        maxEntriesPerBatch: 1,
        maxWritesPerBatch: 10,
        maxPlannedScans: 1,
        maxScanAdmissionsPerBatch: 1,
        maxScanAdmissionsPerRun: 1,
        maxScanAdmissionsPerDay: 2,
      };
      const operations = { functionCalls: 1, dbReads: 1, dbWrites: 1 };
      const deterministicRunId = await ctx.db.insert("skillsShCatalogRuns", {
        fixtureId: "nvidia-small-v1",
        snapshotId: "nvidia-small-v1",
        sourceKind: "fixture",
        snapshotCaptureFetches: 0,
        dryRun: false,
        status: "completed",
        cursor: 1,
        scanCursor: 1,
        fixtureLength: 1,
        counts,
        budgets,
        operations,
        actor: "codex-test",
        reason: "fixture cleanup regression",
        batchesProcessed: 1,
        scanAdmissionBatches: 1,
        lastBatchWrites: 1,
        lastBatchReads: 1,
        startedAt: 1,
        completedAt: 1,
        updatedAt: 1,
      });
      const realRunId = await ctx.db.insert("skillsShCatalogRuns", {
        fixtureId: "skills-sh-test-live-500",
        snapshotId: "skills-sh-test-live-500:cleanup-regression",
        sourceKind: "staging-live",
        sourceCapturedAt: "2026-07-21T00:00:00.000Z",
        snapshotCaptureFetches: 1,
        dryRun: false,
        status: "completed",
        cursor: 1,
        scanCursor: 1,
        fixtureLength: 1,
        counts,
        budgets,
        operations,
        actor: "codex-test",
        reason: "real cleanup regression",
        batchesProcessed: 1,
        scanAdmissionBatches: 1,
        lastBatchWrites: 1,
        lastBatchReads: 1,
        startedAt: 2,
        completedAt: 2,
        updatedAt: 2,
      });
      const deterministicEntryId = await ctx.db.insert("skillsShCatalogEntries", {
        externalId: "fixture/fixture/deterministic",
        sourceKind: "fixture",
        githubOwnerId: 1,
        owner: "fixture",
        repo: "fixture",
        slug: "deterministic",
        displayName: "Deterministic",
        sourceUrl: "https://example.invalid/deterministic",
        githubRepoUrl: "https://github.com/fixture/fixture",
        sourceContentHash: "deterministic-hash",
        installs: 0,
        sourceSnapshotId: "nvidia-small-v1",
        publicVisible: false,
        scanStatus: "queued",
        firstObservedAt: 1,
        lastObservedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const realEntryId = await ctx.db.insert("skillsShCatalogEntries", {
        externalId: "nvidia/skills/aiq-deploy",
        sourceKind: "staging-live",
        githubOwnerId: 1_728_152,
        owner: "nvidia",
        repo: "skills",
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        sourceUrl: "https://skills.sh/nvidia/skills/aiq-deploy",
        githubRepoUrl: "https://github.com/nvidia/skills",
        sourceContentHash: "real-hash",
        installs: 0,
        sourceSnapshotId: "skills-sh-test-live-500:cleanup-regression",
        publicVisible: false,
        scanStatus: "queued",
        firstObservedAt: 2,
        lastObservedAt: 2,
        createdAt: 2,
        updatedAt: 2,
      });
      const deterministicAttemptId = await ctx.db.insert("skillsShCatalogScanAttempts", {
        entryId: deterministicEntryId,
        runId: deterministicRunId,
        externalId: "fixture/fixture/deterministic",
        sourceContentHash: "deterministic-hash",
        source: "skills-sh-catalog-fixture",
        dispatchKind: "deterministic",
        priority: "low",
        status: "queued",
        createdAt: 1,
        updatedAt: 1,
      });
      const realAttemptId = await ctx.db.insert("skillsShCatalogScanAttempts", {
        entryId: realEntryId,
        runId: realRunId,
        externalId: "nvidia/skills/aiq-deploy",
        sourceContentHash: "real-hash",
        artifactContentHash: "a".repeat(64),
        source: "skills-sh-catalog-test",
        dispatchKind: "real",
        priority: "low",
        status: "queued",
        createdAt: 2,
        updatedAt: 2,
      });
      return {
        deterministicAttemptId,
        deterministicEntryId,
        deterministicRunId,
        realAttemptId,
        realEntryId,
        realRunId,
      };
    });

    const result = await t.mutation(internal.skillsShCatalog.cancelQueuedFixtureScansInternal, {
      limit: 100,
    });

    expect(result).toEqual({ matched: 1, canceled: 1 });
    expect(
      await t.run(async (ctx) => await ctx.db.get(seeded.deterministicAttemptId)),
    ).toMatchObject({ status: "canceled" });
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.realAttemptId))).toMatchObject({
      status: "queued",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.deterministicEntryId))).toMatchObject(
      {
        scanStatus: "canceled",
      },
    );
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.realEntryId))).toMatchObject({
      scanStatus: "queued",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.deterministicRunId))).toMatchObject({
      counts: { scansCanceled: 1 },
    });
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.realRunId))).toMatchObject({
      counts: { scansCanceled: 0 },
    });
  });

  it("rejects real admission when only six writes remain in the batch budget", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-budget-operator",
          displayName: "Catalog Budget Operator",
          role: "admin",
        }),
    );
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerBatch: 1,
      maxWritesPerBatch: 6,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-budget-operator",
      reason: "prove admission write reservation",
      snapshotId: "skills-sh-test-live-500:write-budget",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 528,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [frozenSnapshot.rows.find((row) => row.externalId === "nvidia/skills/aiq-deploy")!],
    });
    const artifact = await storeTestArtifact(t, "nvidia/skills/aiq-deploy", "budget artifact");

    await expect(
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId,
        externalIds: ["nvidia/skills/aiq-deploy"],
        actorUserId,
        artifacts: [artifact],
      }),
    ).rejects.toThrow("scan-admission write budget exceeded");
    expect(await collectAttempts(t, runId)).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
      [],
    );
  });

  it("admits one real scan within seven writes and terminalizes a failed verdict", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-six-write-operator",
          displayName: "Catalog Six Write Operator",
          role: "admin",
        }),
    );
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...BASE_CONTROL,
      mode: "staging-live",
      maxEntriesPerBatch: 1,
      maxWritesPerBatch: 7,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: ["nvidia/skills/aiq-deploy"],
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startStagingLiveRunInternal, {
      actor: "catalog-six-write-operator",
      reason: "prove exact admission write reservation",
      snapshotId: "skills-sh-test-live-500:six-write-budget",
      sourceCapturedAt: "2026-07-21T00:00:00.000Z",
      snapshotCaptureFetches: 528,
      fixtureLength: 500,
    });
    await t.mutation(internal.skillsShCatalog.processStagingLiveBatchInternal, {
      runId,
      cursor: 0,
      rows: [frozenSnapshot.rows.find((row) => row.externalId === "nvidia/skills/aiq-deploy")!],
    });
    const artifact = await storeTestArtifact(t, "nvidia/skills/aiq-deploy", "six write artifact");

    const result = await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId,
      externalIds: ["nvidia/skills/aiq-deploy"],
      actorUserId,
      artifacts: [artifact],
    });

    expect(result).toMatchObject({ requested: 1, admitted: 1, skipped: 0 });
    expect(await collectAttempts(t, runId)).toHaveLength(1);
    expect(
      await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect()),
    ).toHaveLength(1);

    const [attempt] = await collectAttempts(t, runId);
    await t.run(async (ctx) => {
      await ctx.db.patch(attempt!.securityScanJobId!, {
        status: "running",
        leaseToken: "lease-token",
        leaseExpiresAt: Date.now() + 60_000,
        workerId: "catalog-worker",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt!._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    });
    const completed = await t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
      attemptId: attempt!._id,
      scanId: attempt!.skillScanRequestId!,
      jobId: attempt!.securityScanJobId!,
      leaseToken: "lease-token",
      artifactContentHash: attempt!.artifactContentHash!,
      verdict: "failed",
      runId: "clawscan-run",
      llmAnalysis: { status: "error", checkedAt: Date.now() },
    });

    expect(completed).toEqual({ ok: true, applied: true, publicVisible: false });
    expect((await collectAttempts(t, runId))[0]).toMatchObject({
      status: "failed",
      verdict: "failed",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(attempt!.entryId))).toMatchObject({
      scanStatus: "failed",
      publicVisible: false,
    });
    expect(
      await t.run(async (ctx) => await ctx.db.get(attempt!.skillScanRequestId!)),
    ).toMatchObject({
      status: "failed",
      lastError: "Catalog scan analysis failed",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(attempt!.securityScanJobId!))).toMatchObject(
      {
        status: "failed",
        lastError: "Catalog scan analysis failed",
      },
    );
    const runAfterCompletion = await t.query(internal.skillsShCatalog.getRunInternal, { runId });
    const repeated = await t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
      attemptId: attempt!._id,
      scanId: attempt!.skillScanRequestId!,
      jobId: attempt!.securityScanJobId!,
      leaseToken: "lease-token",
      artifactContentHash: attempt!.artifactContentHash!,
      verdict: "failed",
      runId: "clawscan-run",
      llmAnalysis: { status: "error", checkedAt: Date.now() },
    });
    expect(repeated).toEqual({ ok: true, applied: true, publicVisible: false });
    expect(await t.query(internal.skillsShCatalog.getRunInternal, { runId })).toEqual(
      runAfterCompletion,
    );
    await expect(
      t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
        attemptId: attempt!._id,
        scanId: attempt!.skillScanRequestId!,
        jobId: attempt!.securityScanJobId!,
        leaseToken: "lease-token",
        artifactContentHash: attempt!.artifactContentHash!,
        verdict: "clean",
        runId: "clawscan-run",
        llmAnalysis: { status: "clean", checkedAt: Date.now() },
      }),
    ).rejects.toThrow("Catalog scan terminal result mismatch");
  });

  it("fails closed when an active real attempt has no run", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("skillsShCatalogRuns", {
        fixtureId: "skills-sh-test-live-500",
        snapshotId: "skills-sh-test-live-500:missing-run",
        sourceKind: "staging-live",
        sourceCapturedAt: "2026-07-21T00:00:00.000Z",
        snapshotCaptureFetches: 1,
        dryRun: false,
        status: "completed",
        cursor: 1,
        scanCursor: 1,
        fixtureLength: 500,
        counts: {
          observed: 1,
          wouldInsert: 1,
          wouldUpdate: 0,
          inserted: 1,
          updated: 0,
          unchanged: 0,
          rejected: 0,
          scansPlanned: 1,
          scansAdmitted: 1,
          scansCompleted: 0,
          scansCanceled: 0,
        },
        budgets: {
          maxEntriesPerRun: 500,
          maxEntriesPerBatch: 1,
          maxWritesPerBatch: 10,
          maxPlannedScans: 500,
          maxScanAdmissionsPerBatch: 1,
          maxScanAdmissionsPerRun: 1,
          maxScanAdmissionsPerDay: 1,
        },
        operations: { functionCalls: 1, dbReads: 1, dbWrites: 1 },
        actor: "catalog-test-admin",
        reason: "missing run regression",
        batchesProcessed: 1,
        scanAdmissionBatches: 1,
        lastBatchWrites: 1,
        lastBatchReads: 1,
        startedAt: 1,
        completedAt: 1,
        updatedAt: 1,
      });
      const entryId = await ctx.db.insert("skillsShCatalogEntries", {
        externalId: "nvidia/skills/aiq-deploy",
        sourceKind: "staging-live",
        githubOwnerId: 1_728_152,
        owner: "nvidia",
        repo: "skills",
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        sourceUrl: "https://skills.sh/nvidia/skills/aiq-deploy",
        githubRepoUrl: "https://github.com/nvidia/skills",
        sourceContentHash: "source-hash",
        installs: 1,
        sourceSnapshotId: "skills-sh-test-live-500:missing-run",
        publicVisible: false,
        scanStatus: "queued",
        firstObservedAt: 1,
        lastObservedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const attemptId = await ctx.db.insert("skillsShCatalogScanAttempts", {
        entryId,
        runId,
        externalId: "nvidia/skills/aiq-deploy",
        sourceContentHash: "source-hash",
        artifactContentHash: "a".repeat(64),
        source: "skills-sh-catalog-test",
        dispatchKind: "real",
        priority: "low",
        status: "running",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete(runId);
      return { attemptId, entryId };
    });

    await expect(
      t.mutation(internal.skillsShCatalog.recordRealScanResultInternal, {
        attemptId: seeded.attemptId,
        artifactContentHash: "a".repeat(64),
        verdict: "clean",
      }),
    ).rejects.toThrow("run not found");
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.attemptId))).toMatchObject({
      status: "running",
    });
    expect(await t.run(async (ctx) => await ctx.db.get(seeded.entryId))).toMatchObject({
      scanStatus: "queued",
      publicVisible: false,
    });
  });
});
