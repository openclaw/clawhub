/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const TEST_ENV = {
  CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
  CLAWHUB_DISABLE_CRONS: "1",
  CLAWHUB_ENV: "test",
};

function useTestEnvironment() {
  for (const [name, value] of Object.entries(TEST_ENV)) vi.stubEnv(name, value);
}

describe("skills.sh catalog dark control plane", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs the committed NVIDIA fixture idempotently without exposing public state", async () => {
    useTestEnvironment();

    const t = convexTest(schema, modules);
    const nativeSkillId = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", {
        handle: "native-owner",
        displayName: "Native Owner",
      });
      return await ctx.db.insert("skills", {
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
    });
    const initial = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(initial.control).toMatchObject({
      mode: "off",
      writesEnabled: false,
      scanPlanningEnabled: false,
      publicVisibilityEnabled: false,
      paused: true,
    });

    await expect(
      t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
        fixtureId: "nvidia-small-v1",
        actor: "codex-test",
        reason: "prove dark fixture behavior",
      }),
    ).rejects.toThrow("skills.sh catalog writes are disabled");

    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "codex-test",
      reason: "enable bounded fixture proof",
      confirm: "enable-skills-sh-fixture-control",
      writesEnabled: true,
      scanPlanningEnabled: true,
      maxEntriesPerRun: 10,
      maxWritesPerBatch: 10,
      maxPlannedScans: 5,
    });

    const firstRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "first fixture run",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: firstRun.runId,
    });

    const afterFirstRun = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(afterFirstRun.runs[0]).toMatchObject({
      status: "completed",
      cursor: 3,
      counts: {
        observed: 3,
        inserted: 2,
        updated: 0,
        unchanged: 1,
        rejected: 0,
        scansPlanned: 2,
        scansCompleted: 0,
        scansCanceled: 0,
      },
      budgetConsumed: {
        entriesObserved: 3,
        scansPlanned: 2,
        batchesProcessed: 1,
        lastBatchWrites: 5,
      },
      errors: [],
    });
    expect(afterFirstRun.entries).toHaveLength(2);
    expect(afterFirstRun.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "nvidia/skills/aiq-deploy",
          githubOwnerId: 1728152,
          publicVisible: false,
          resolution: {
            externalRoute: "/skills-sh/nvidia/skills/aiq-deploy",
            installRef: "skills-sh:nvidia/skills/aiq-deploy",
            installable: false,
          },
          scanStatus: "queued",
        }),
        expect.objectContaining({
          externalId: "nvidia/skills/cuda-agent",
          githubOwnerId: 1728152,
          publicVisible: false,
          scanStatus: "queued",
        }),
      ]),
    );
    expect(afterFirstRun.scanAttempts).toHaveLength(2);
    expect(afterFirstRun.scanAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "skills-sh-catalog-fixture",
          priority: "low",
          status: "queued",
        }),
      ]),
    );

    const aiqAttempt = afterFirstRun.scanAttempts.find(
      (attempt) => attempt.externalId === "nvidia/skills/aiq-deploy",
    );
    expect(aiqAttempt).toBeDefined();
    await t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
      attemptId: aiqAttempt!._id,
      contentHash: aiqAttempt!.contentHash,
      verdict: "clean",
    });

    const afterScan = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(
      afterScan.entries.find((entry) => entry.externalId === "nvidia/skills/aiq-deploy"),
    ).toMatchObject({
      scanStatus: "clean",
      publicVisible: false,
    });
    expect(afterScan.runs[0].counts.scansCompleted).toBe(1);

    const repeatedRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "repeat identical fixture",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: repeatedRun.runId,
    });

    const afterRepeat = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(afterRepeat.runs[0]).toMatchObject({
      status: "completed",
      counts: {
        observed: 3,
        inserted: 0,
        updated: 0,
        unchanged: 3,
        rejected: 0,
        scansPlanned: 0,
        scansCompleted: 0,
        scansCanceled: 0,
      },
    });
    expect(afterRepeat.scanAttempts).toHaveLength(2);

    const canceled = await t.mutation(internal.skillsShCatalog.cancelQueuedFixtureScansInternal, {
      limit: 10,
    });
    expect(canceled).toMatchObject({ matched: 1, canceled: 1 });

    await t.mutation(internal.skillsShCatalog.disableCatalogInternal, {
      actor: "codex-test",
      reason: "exercise non-destructive rollback",
      confirm: "disable-skills-sh-catalog",
    });
    const disabled = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(disabled.control).toMatchObject({
      mode: "off",
      writesEnabled: false,
      scanPlanningEnabled: false,
      publicVisibilityEnabled: false,
      paused: true,
    });
    expect(disabled.entries).toHaveLength(2);
    expect(disabled.runs).toHaveLength(2);
    expect(await t.run(async (ctx) => await ctx.db.get(nativeSkillId))).toMatchObject({
      slug: "native-skill",
      displayName: "Native Skill",
      updatedAt: 1,
    });
  });

  it("pauses a bounded run and resumes from its stored cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);

    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "codex-test",
      reason: "force a multi-batch fixture run",
      confirm: "enable-skills-sh-fixture-control",
      writesEnabled: true,
      scanPlanningEnabled: true,
      maxEntriesPerRun: 10,
      maxWritesPerBatch: 3,
      maxPlannedScans: 5,
    });
    const { runId } = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "pause and resume proof",
    });

    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, { runId });
    const beforePause = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(beforePause.runs.find((run) => run._id === runId)).toMatchObject({
      status: "running",
      cursor: 2,
      counts: {
        observed: 2,
        inserted: 1,
        unchanged: 1,
        scansPlanned: 1,
      },
      budgetConsumed: {
        entriesObserved: 2,
        scansPlanned: 1,
        batchesProcessed: 1,
        lastBatchWrites: 3,
      },
    });

    await t.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, {
      runId,
      paused: true,
    });
    await expect(
      t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, { runId }),
    ).rejects.toThrow("skills.sh catalog run is paused");

    await t.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, {
      runId,
      paused: false,
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, { runId });

    const completed = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(completed.runs.find((run) => run._id === runId)).toMatchObject({
      status: "completed",
      cursor: 3,
      counts: {
        observed: 3,
        inserted: 2,
        unchanged: 1,
        scansPlanned: 2,
      },
      budgetConsumed: {
        entriesObserved: 3,
        scansPlanned: 2,
        batchesProcessed: 2,
        lastBatchWrites: 3,
      },
    });
  });

  it("plans each exact hash once and ignores a stale scan callback", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);

    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "codex-test",
      reason: "apply hidden metadata before scan planning",
      confirm: "enable-skills-sh-fixture-control",
      writesEnabled: true,
      scanPlanningEnabled: false,
      maxEntriesPerRun: 10,
      maxWritesPerBatch: 10,
      maxPlannedScans: 0,
    });
    const metadataRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "metadata-only fixture pass",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: metadataRun.runId,
    });

    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "codex-test",
      reason: "enable deterministic scans",
      confirm: "enable-skills-sh-fixture-control",
      writesEnabled: true,
      scanPlanningEnabled: true,
      maxEntriesPerRun: 10,
      maxWritesPerBatch: 10,
      maxPlannedScans: 5,
    });
    const scanRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v1",
      actor: "codex-test",
      reason: "plan previously deferred scans",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: scanRun.runId,
    });

    const afterPlanning = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(afterPlanning.runs.find((run) => run._id === scanRun.runId)).toMatchObject({
      counts: {
        observed: 3,
        inserted: 0,
        updated: 0,
        unchanged: 3,
        scansPlanned: 2,
      },
    });
    expect(afterPlanning.scanAttempts).toHaveLength(2);
    const oldAttempt = afterPlanning.scanAttempts.find(
      (attempt) => attempt.externalId === "nvidia/skills/aiq-deploy",
    );
    expect(oldAttempt).toBeDefined();

    const changedRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "observe a changed exact hash",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: changedRun.runId,
    });
    const afterChange = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(afterChange.runs.find((run) => run._id === changedRun.runId)).toMatchObject({
      counts: {
        observed: 1,
        inserted: 0,
        updated: 1,
        unchanged: 0,
        scansPlanned: 1,
      },
    });
    expect(afterChange.scanAttempts).toHaveLength(3);
    const newAttempt = afterChange.scanAttempts.find(
      (attempt) =>
        attempt.externalId === "nvidia/skills/aiq-deploy" &&
        attempt.contentHash !== oldAttempt!.contentHash,
    );
    expect(newAttempt).toBeDefined();

    await expect(
      t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
        attemptId: oldAttempt!._id,
        contentHash: oldAttempt!.contentHash,
        verdict: "clean",
      }),
    ).resolves.toEqual({ applied: false, reason: "stale-attempt" });
    const afterStaleCallback = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(
      afterStaleCallback.scanAttempts.find((attempt) => attempt._id === oldAttempt!._id),
    ).toMatchObject({
      status: "canceled",
      completedAt: expect.any(Number),
    });
    expect(afterStaleCallback.runs.find((run) => run._id === oldAttempt!.runId)).toMatchObject({
      counts: {
        scansCanceled: 1,
      },
    });
    await expect(
      t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
        attemptId: newAttempt!._id,
        contentHash: newAttempt!.contentHash,
        verdict: "clean",
      }),
    ).resolves.toEqual({ applied: true, publicVisible: false });

    const repeatedRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "repeat changed fixture",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: repeatedRun.runId,
    });
    const afterRepeat = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(afterRepeat.runs.find((run) => run._id === repeatedRun.runId)).toMatchObject({
      counts: {
        observed: 1,
        inserted: 0,
        updated: 0,
        unchanged: 1,
        scansPlanned: 0,
      },
    });
    expect(afterRepeat.scanAttempts).toHaveLength(3);
  });

  it("records a malicious verdict as a completed scan, not an execution failure", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);

    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "codex-test",
      reason: "prove malicious verdict accounting",
      confirm: "enable-skills-sh-fixture-control",
      writesEnabled: true,
      scanPlanningEnabled: true,
      maxEntriesPerRun: 10,
      maxWritesPerBatch: 10,
      maxPlannedScans: 5,
    });
    const run = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "malicious verdict fixture",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: run.runId,
    });
    const queued = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    const attempt = queued.scanAttempts[0];
    expect(attempt).toBeDefined();

    await t.mutation(internal.skillsShCatalog.recordFixtureScanResultInternal, {
      attemptId: attempt!._id,
      contentHash: attempt!.contentHash,
      verdict: "malicious",
    });
    const completed = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(completed.scanAttempts.find((item) => item._id === attempt!._id)).toMatchObject({
      status: "succeeded",
      verdict: "malicious",
    });
    expect(
      completed.entries.find((entry) => entry.externalId === "nvidia/skills/aiq-deploy"),
    ).toMatchObject({
      scanStatus: "malicious",
      publicVisible: false,
    });
  });

  it("does not automatically re-plan an exact hash after operator cancellation", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);

    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "codex-test",
      reason: "prove cancellation remains durable",
      confirm: "enable-skills-sh-fixture-control",
      writesEnabled: true,
      scanPlanningEnabled: true,
      maxEntriesPerRun: 10,
      maxWritesPerBatch: 10,
      maxPlannedScans: 5,
    });
    const firstRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "queue exact hash",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: firstRun.runId,
    });
    await t.mutation(internal.skillsShCatalog.cancelQueuedFixtureScansInternal, {
      limit: 10,
    });

    const repeatedRun = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "nvidia-small-v2",
      actor: "codex-test",
      reason: "repeat canceled exact hash",
    });
    await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: repeatedRun.runId,
    });
    const status = await t.query(internal.skillsShCatalog.getStatusInternal, {});
    expect(status.runs.find((run) => run._id === repeatedRun.runId)).toMatchObject({
      counts: {
        observed: 1,
        unchanged: 1,
        scansPlanned: 0,
      },
    });
    expect(status.scanAttempts).toHaveLength(1);
    expect(status.scanAttempts[0]).toMatchObject({
      status: "canceled",
    });
  });

  it("rejects fixture mutations in Preview", async () => {
    vi.stubEnv("CLAWHUB_PREVIEW", "1");
    vi.stubEnv("CONVEX_DEPLOYMENT", "anonymous:clawhub");
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.skillsShCatalog.cancelQueuedFixtureScansInternal, {
        limit: 10,
      }),
    ).rejects.toThrow("skills.sh catalog fixture work is disabled in Preview");
    await expect(
      t.mutation(internal.skillsShCatalog.disableCatalogInternal, {
        actor: "codex-test",
        reason: "Preview mutation should stay disabled",
        confirm: "disable-skills-sh-catalog",
      }),
    ).rejects.toThrow("skills.sh catalog control mutations are disabled in Preview");
  });
});
