/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  NVIDIA_SKILL_EVALUATION_CONFIG,
  NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
} from "./lib/skillEvaluationConfig";
import schema from "./schema";
import { enqueueNvidiaSkillEvaluation } from "./skillEvaluations";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function insertNvidiaSkill(
  t: ReturnType<typeof convexTest>,
  input: { hash: string; slug: string },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const skillId = await ctx.db.insert("skills", {
      slug: input.slug,
      displayName: input.slug,
      ownerUserId: userId,
      installKind: "github",
      githubCurrentRepo: "NVIDIA/skills",
      githubPath: `skills/${input.slug}`,
      githubCurrentCommit: "a".repeat(40),
      githubCurrentContentHash: input.hash,
      githubCurrentStatus: "present",
      githubScanStatus: "clean",
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    return skillId;
  });
}

function evaluationRow(input: {
  contentHash: string;
  scanStatus: "clean" | "suspicious";
  skillId: Id<"skills">;
  source: "sync" | "backfill";
}) {
  return {
    skillId: input.skillId,
    sourceRepo: NVIDIA_SKILL_EVALUATION_CONFIG.sourceRepo,
    sourceCommit: "a".repeat(40),
    sourcePath: "skills/demo",
    contentHash: input.contentHash,
    scanStatus: input.scanStatus,
    configKey: NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
    evaluatorRepository: NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorRepository,
    evaluatorRelease: NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorRelease,
    evaluatorCommit: NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorCommit,
    agent: NVIDIA_SKILL_EVALUATION_CONFIG.agent,
    agentModel: NVIDIA_SKILL_EVALUATION_CONFIG.agentModel,
    judgeProvider: NVIDIA_SKILL_EVALUATION_CONFIG.judgeProvider,
    judgeModel: NVIDIA_SKILL_EVALUATION_CONFIG.judgeModel,
    environment: NVIDIA_SKILL_EVALUATION_CONFIG.environment,
    attemptsPerCase: NVIDIA_SKILL_EVALUATION_CONFIG.attemptsPerCase,
    status: "queued" as const,
    source: input.source,
    nextRunAt: 0,
    attempts: 0,
    createdAt: input.source === "backfill" ? 1 : 2,
    updatedAt: 1,
  };
}

describe("skill evaluation runtime queue", () => {
  async function priorityQueue() {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "priority-fixture" });
    const ids = await t.run(async (ctx) => {
      const ordinary = await ctx.db.insert("skillEvaluationRuns", {
        ...evaluationRow({
          skillId,
          contentHash: "current",
          scanStatus: "clean",
          source: "backfill",
        }),
        sourcePath: "skills/ordinary",
        nextRunAt: 100,
      });
      const large = await ctx.db.insert("skillEvaluationRuns", {
        ...evaluationRow({
          skillId,
          contentHash: "current",
          scanStatus: "clean",
          source: "backfill",
        }),
        sourcePath: "skills/large",
        nextRunAt: 200,
        attempts: 1,
        lastError: "Evaluation worker lease expired",
      });
      const sync = await ctx.db.insert("skillEvaluationRuns", {
        ...evaluationRow({ skillId, contentHash: "current", scanStatus: "clean", source: "sync" }),
        sourcePath: "skills/sync",
        nextRunAt: 300,
      });
      return { ordinary, large, sync };
    });
    return { t, skillId, ...ids };
  }

  it("previews priority without writes, then moves selected backfill ahead while retaining sync priority and history", async () => {
    const before = await priorityQueue();
    const after = await priorityQueue();
    const claimPaths = async (t: ReturnType<typeof convexTest>) => {
      const rows = await t.action(api.skillEvaluations.claimSkillEvaluationJobs, {
        token: "worker-token",
        workerId: "priority-proof",
        limit: 3,
      });
      return rows.map((row) => row.sourcePath);
    };
    expect(await claimPaths(before.t)).toEqual(["skills/sync", "skills/ordinary", "skills/large"]);
    const args = { runs: [{ runId: after.large, expectedAttempts: 1 }] };
    const original = await after.t.run((ctx) => ctx.db.get(after.large));
    const preview = await after.t.mutation(
      internal.maintenance.prioritizeQueuedSkillEvaluationsInternal,
      args,
    );
    expect(preview).toMatchObject({
      eligible: true,
      prioritized: 0,
      changes: [{ runId: after.large, attempts: 1, previousNextRunAt: 200, nextRunAt: 0 }],
    });
    expect(await after.t.run((ctx) => ctx.db.get(after.large))).toEqual(original);
    expect(
      await after.t.mutation(internal.maintenance.prioritizeQueuedSkillEvaluationsInternal, {
        ...args,
        dryRun: false,
      }),
    ).toMatchObject({ eligible: true, prioritized: 1 });
    const prioritized = await after.t.run((ctx) => ctx.db.get(after.large));
    expect(prioritized).toEqual({ ...original, nextRunAt: 0, updatedAt: expect.any(Number) });
    expect(
      await after.t.mutation(internal.maintenance.prioritizeQueuedSkillEvaluationsInternal, {
        ...args,
        dryRun: false,
      }),
    ).toMatchObject({ eligible: true, prioritized: 0, changes: [] });
    expect(await claimPaths(after.t)).toEqual(["skills/sync", "skills/large", "skills/ordinary"]);
    expect(await after.t.run((ctx) => ctx.db.get(after.large))).toMatchObject({
      attempts: 2,
      lastError: "Evaluation worker lease expired",
      status: "running",
    });
  });

  it.each([
    ["running", "not-queued"],
    ["terminal", "not-queued"],
    ["sync", "not-backfill"],
    ["configuration", "configuration-changed"],
    ["repository", "configuration-changed"],
    ["attempts", "attempts-changed"],
    ["backoff", "retry-not-due"],
    ["content", "stale-version"],
  ] as const)(
    "rejects the entire priority batch when a selected run changes %s",
    async (change, reason) => {
      const { t, skillId, ordinary, large } = await priorityQueue();
      await t.run(async (ctx) => {
        if (change === "running") await ctx.db.patch(large, { status: "running" });
        if (change === "terminal") await ctx.db.patch(large, { status: "succeeded" });
        if (change === "sync") await ctx.db.patch(large, { source: "sync" });
        if (change === "configuration") await ctx.db.patch(large, { configKey: "old" });
        if (change === "repository") await ctx.db.patch(large, { sourceRepo: "other/skills" });
        if (change === "attempts") await ctx.db.patch(large, { attempts: 2 });
        if (change === "backoff") await ctx.db.patch(large, { nextRunAt: Date.now() + 60_000 });
        if (change === "content") await ctx.db.patch(skillId, { githubCurrentContentHash: "new" });
      });
      expect(
        await t.mutation(internal.maintenance.prioritizeQueuedSkillEvaluationsInternal, {
          runs: [
            { runId: ordinary, expectedAttempts: 0 },
            { runId: large, expectedAttempts: 1 },
          ],
          dryRun: false,
        }),
      ).toMatchObject({
        eligible: false,
        prioritized: 0,
        rejected: expect.arrayContaining([{ runId: large, reason }]),
      });
      expect((await t.run((ctx) => ctx.db.get(ordinary)))?.nextRunAt).toBe(100);
    },
  );

  it("bounds priority batches and rejects duplicate or invalid selections", async () => {
    const { t, large, skillId } = await priorityQueue();
    const selection = { runId: large, expectedAttempts: 1 };
    const oversized = await t.run(async (ctx) => {
      const runs: Array<{ runId: Id<"skillEvaluationRuns">; expectedAttempts: number }> = [];
      for (let index = 0; index < 21; index += 1) {
        const runId = await ctx.db.insert("skillEvaluationRuns", {
          ...evaluationRow({
            skillId,
            contentHash: "current",
            scanStatus: "clean",
            source: "backfill",
          }),
          nextRunAt: 200,
        });
        runs.push({ runId, expectedAttempts: 0 });
      }
      return runs;
    });
    const selections = [
      [],
      [selection, selection],
      [{ ...selection, expectedAttempts: -1 }],
      [{ ...selection, expectedAttempts: 0.5 }],
      [{ ...selection, expectedAttempts: Number.NaN }],
      oversized,
    ];
    for (const runs of selections) {
      await expect(
        t.mutation(internal.maintenance.prioritizeQueuedSkillEvaluationsInternal, {
          runs,
          dryRun: false,
        }),
      ).rejects.toThrow("Select 1–20 unique runs");
    }
    expect((await t.run((ctx) => ctx.db.get(large)))?.nextRunAt).toBe(200);
  });

  it("prioritizes current skills that inherit their repository from the GitHub source", async () => {
    const { t, skillId, large } = await priorityQueue();
    await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("githubSkillSources", {
        repo: "NVIDIA/skills",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(skillId, { githubCurrentRepo: undefined, githubSourceId: sourceId });
    });
    expect(
      await t.mutation(internal.maintenance.prioritizeQueuedSkillEvaluationsInternal, {
        runs: [{ runId: large, expectedAttempts: 1 }],
        dryRun: false,
      }),
    ).toMatchObject({ eligible: true, prioritized: 1 });
  });

  it("previews and retries one failed run without erasing attempt history or duplicating work", async () => {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "demo" });
    const runId = await t.run((ctx) =>
      ctx.db.insert("skillEvaluationRuns", {
        ...evaluationRow({
          skillId,
          contentHash: "current",
          scanStatus: "clean",
          source: "backfill",
        }),
        status: "failed",
        attempts: 3,
        completedAt: 100,
        lastError: "Docker startup failed",
      }),
    );
    const args = { runId, expectedAttempts: 3 };
    expect(await t.mutation(internal.maintenance.retryFailedSkillEvaluationInternal, args)).toEqual(
      {
        eligible: true,
        requeued: false,
        attempts: 3,
      },
    );
    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("failed");
    expect(
      await t.mutation(internal.maintenance.retryFailedSkillEvaluationInternal, {
        ...args,
        dryRun: false,
      }),
    ).toEqual({ eligible: true, requeued: true, attempts: 3 });
    const [claimed] = await t.action(api.skillEvaluations.claimSkillEvaluationJobs, {
      token: "worker-token",
      workerId: "recovery-worker",
      limit: 1,
    });
    expect(claimed).toMatchObject({ _id: runId, attempts: 4, lastError: "Docker startup failed" });
    expect(claimed.completedAt).toBeUndefined();
    expect(
      await t.mutation(internal.maintenance.retryFailedSkillEvaluationInternal, {
        ...args,
        dryRun: false,
      }),
    ).toEqual({ eligible: false, requeued: false, reason: "not-failed" });
    expect(
      await t.action(api.skillEvaluations.failSkillEvaluation, {
        token: "worker-token",
        runId,
        leaseToken: claimed.leaseToken,
        error: "still broken",
      }),
    ).toMatchObject({ retry: false });
  });

  it.each(["configuration", "attempts", "source"] as const)(
    "refuses a failed-run repair after the %s changes",
    async (changed) => {
      vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
      const t = convexTest(schema, modules);
      const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "demo" });
      const runId = await t.run((ctx) =>
        ctx.db.insert("skillEvaluationRuns", {
          ...evaluationRow({
            skillId,
            contentHash: changed === "source" ? "old" : "current",
            scanStatus: "clean",
            source: "backfill",
          }),
          configKey:
            changed === "configuration" ? "old-config" : NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
          status: "failed",
          attempts: changed === "attempts" ? 4 : 3,
        }),
      );
      expect(
        await t.mutation(internal.maintenance.retryFailedSkillEvaluationInternal, {
          runId,
          expectedAttempts: 3,
          dryRun: false,
        }),
      ).toMatchObject({ eligible: false, requeued: false });
      expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("failed");
    },
  );

  it("backfills only selected canaries under the new configuration, then the rest without duplicates", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const canary = await insertNvidiaSkill(t, { hash: "canary", slug: "doca-dpa" });
    const remaining = await insertNvidiaSkill(t, { hash: "remaining", slug: "other" });
    const adminId = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("githubSkillSources", {
        repo: "NVIDIA/skills",
        createdAt: 1,
        updatedAt: 1,
      });
      for (const skillId of [canary, remaining]) {
        await ctx.db.patch(skillId, { githubSourceId: sourceId, githubCurrentRepo: undefined });
        await ctx.db.insert("skillEvaluationRuns", {
          ...evaluationRow({
            skillId,
            contentHash: skillId === canary ? "canary" : "remaining",
            scanStatus: "clean",
            source: "backfill",
          }),
          evaluatorRelease: "v0.1.0",
          configKey: "old-config",
          status: "skipped",
          skipReason: "unsupported-config",
        });
      }
      return ctx.db.insert("users", { role: "admin" });
    });
    const admin = t.withIdentity({ subject: adminId });
    await admin.mutation(api.skillEvaluations.startNvidiaSkillEvaluationBackfill, {
      confirm: "backfill-nvidia-skill-evaluations",
      sourcePaths: ["skills/doca-dpa"],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const claim = () =>
      t.action(api.skillEvaluations.claimSkillEvaluationJobs, {
        token: "worker-token",
        workerId: "worker",
        limit: 4,
      });
    const canaryRuns = await claim();
    expect(canaryRuns).toHaveLength(1);
    expect(canaryRuns[0]).toMatchObject({ skillId: canary, evaluatorRelease: "v0.5.0" });

    await admin.mutation(api.skillEvaluations.startNvidiaSkillEvaluationBackfill, {
      confirm: "backfill-nvidia-skill-evaluations",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const remainingRuns = await claim();
    expect(remainingRuns).toHaveLength(1);
    expect(remainingRuns[0]).toMatchObject({ skillId: remaining, evaluatorRelease: "v0.5.0" });
    expect(await claim()).toEqual([]);
  });

  it("keeps the canary selection when the backfill continues onto another page", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const skills: Id<"skills">[] = [];
    for (let i = 0; i < 22; i += 1) {
      skills.push(await insertNvidiaSkill(t, { hash: `hash-${i}`, slug: `skill-${i}` }));
    }
    const adminId = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("githubSkillSources", {
        repo: "NVIDIA/skills",
        createdAt: 1,
        updatedAt: 1,
      });
      for (const skillId of skills) await ctx.db.patch(skillId, { githubSourceId: sourceId });
      return ctx.db.insert("users", { role: "admin" });
    });
    await t
      .withIdentity({ subject: adminId })
      .mutation(api.skillEvaluations.startNvidiaSkillEvaluationBackfill, {
        confirm: "backfill-nvidia-skill-evaluations",
        sourcePaths: ["skills/skill-20"],
      });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const claimed = await t.action(api.skillEvaluations.claimSkillEvaluationJobs, {
      token: "worker-token",
      workerId: "worker",
      limit: 4,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ skillId: skills[20], sourcePath: "skills/skill-20" });
  });

  it("queues a verified NVIDIA skill whose repository comes from its source", async () => {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current-hash", slug: "doca-dpa" });
    await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("githubSkillSources", {
        repo: "NVIDIA/skills",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(skillId, { githubSourceId: sourceId, githubCurrentRepo: undefined });
    });

    await t.mutation(internal.githubSkillSync.applyGitHubSkillVerificationResultInternal, {
      skillId,
      contentHash: "current-hash",
      scanStatus: "clean",
    });

    const claimed = await t.action(api.skillEvaluations.claimSkillEvaluationJobs, {
      token: "worker-token",
      workerId: "worker",
      limit: 1,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      skillId,
      sourceRepo: "nvidia/skills",
      source: "sync",
      status: "running",
    });
  });

  it("enqueues one run per current content hash and evaluator configuration", async () => {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    const t = convexTest(schema, modules);
    const contentHash = "hash-v1";
    const skillId = await insertNvidiaSkill(t, { hash: contentHash, slug: "doca-dpa" });

    const enqueue = async () =>
      await t.run(async (ctx) =>
        enqueueNvidiaSkillEvaluation(ctx as unknown as MutationCtx, {
          skillId,
          sourceRepo: "NVIDIA/skills",
          sourceCommit: "a".repeat(40),
          sourcePath: "skills/doca-dpa",
          contentHash,
          scanStatus: "suspicious",
          source: "sync",
          now: 10,
        }),
      );

    await expect(enqueue()).resolves.toMatchObject({ queued: true });
    await expect(enqueue()).resolves.toEqual({ queued: false, reason: "already-observed" });
    const runs = await t.run(async (ctx) => await ctx.db.query("skillEvaluationRuns").collect());
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentModel: "gpt-6.1-sol",
      attemptsPerCase: 2,
      judgeModel: "gpt-6.1-sol",
      scanStatus: "suspicious",
      status: "queued",
    });
  });

  it("publishes only a completed result for the current hash and current config", async () => {
    const t = convexTest(schema, modules);
    const contentHash = "hash-v1";
    const skillId = await insertNvidiaSkill(t, { hash: contentHash, slug: "doca-dpa" });
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert(
          "skillEvaluationRuns",
          evaluationRow({ skillId, contentHash, scanStatus: "clean", source: "sync" }),
        ),
    );

    await expect(t.query(api.skillEvaluations.getCurrentForSkill, { skillId })).resolves.toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        status: "succeeded",
        metrics: {
          sampleCount: 8,
          overall: { withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
          cases: {
            withSkillPassed: 4,
            withSkillTotal: 4,
            withoutSkillPassed: 2,
            withoutSkillTotal: 4,
          },
          dimensions: [
            { id: "security", withSkill: 1, withoutSkill: 1, delta: 0 },
            { id: "correctness", withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
          ],
        },
        completedAt: 100,
      });
    });
    await expect(
      t.query(api.skillEvaluations.getCurrentForSkill, { skillId }),
    ).resolves.toMatchObject({
      evaluator: { agentModel: "gpt-6.1-sol", attempts: 2, judgeModel: "gpt-6.1-sol" },
      metrics: { overall: { delta: 0.3 } },
      completedAt: 100,
    });

    await t.run(
      async (ctx) => await ctx.db.patch(skillId, { githubCurrentContentHash: "hash-v2" }),
    );
    await expect(t.query(api.skillEvaluations.getCurrentForSkill, { skillId })).resolves.toBeNull();
  });

  it("publishes current results for skills whose repo comes from the GitHub source row", async () => {
    const t = convexTest(schema, modules);
    const contentHash = "hash-v1";
    const skillId = await insertNvidiaSkill(t, { hash: contentHash, slug: "doca-dpa" });
    await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("githubSkillSources", {
        repo: "NVIDIA/skills",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(skillId, {
        githubCurrentRepo: undefined,
        githubSourceId: sourceId,
      });
      await ctx.db.insert("skillEvaluationRuns", {
        ...evaluationRow({ skillId, contentHash, scanStatus: "suspicious", source: "backfill" }),
        status: "succeeded",
        metrics: {
          sampleCount: 8,
          overall: { withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
          cases: {
            withSkillPassed: 4,
            withSkillTotal: 4,
            withoutSkillPassed: 2,
            withoutSkillTotal: 4,
          },
          dimensions: [{ id: "correctness", withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 }],
        },
        completedAt: 100,
      });
    });

    await expect(
      t.query(api.skillEvaluations.getCurrentForSkill, {
        skillId,
        sourceRepo: "NVIDIA/skills",
        sourcePath: "skills/doca-dpa",
      }),
    ).resolves.toMatchObject({
      source: { repository: "nvidia/skills", path: "skills/demo" },
      metrics: { overall: { delta: 0.3 } },
    });
  });

  it("does not publish results for a skill hidden from public view", async () => {
    const t = convexTest(schema, modules);
    const contentHash = "hash-v1";
    const skillId = await insertNvidiaSkill(t, { hash: contentHash, slug: "hidden" });
    await t.run(async (ctx) => {
      await ctx.db.patch(skillId, { moderationStatus: "hidden" });
      await ctx.db.insert("skillEvaluationRuns", {
        ...evaluationRow({ skillId, contentHash, scanStatus: "suspicious", source: "sync" }),
        status: "succeeded",
        metrics: {
          sampleCount: 2,
          overall: { withSkill: 1, withoutSkill: 0, delta: 1 },
          cases: {
            withSkillPassed: 1,
            withSkillTotal: 1,
            withoutSkillPassed: 0,
            withoutSkillTotal: 1,
          },
          dimensions: [],
        },
        completedAt: 100,
      });
    });

    await expect(t.query(api.skillEvaluations.getCurrentForSkill, { skillId })).resolves.toBeNull();
  });

  it("claims sync work before backfill and accepts suspicious scan outcomes", async () => {
    const t = convexTest(schema, modules);
    const backfillSkillId = await insertNvidiaSkill(t, { hash: "backfill", slug: "backfill" });
    const syncSkillId = await insertNvidiaSkill(t, { hash: "sync", slug: "sync" });
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "skillEvaluationRuns",
        evaluationRow({
          skillId: backfillSkillId,
          contentHash: "backfill",
          scanStatus: "clean",
          source: "backfill",
        }),
      );
      await ctx.db.insert(
        "skillEvaluationRuns",
        evaluationRow({
          skillId: syncSkillId,
          contentHash: "sync",
          scanStatus: "suspicious",
          source: "sync",
        }),
      );
    });

    const claimed = await t.mutation(
      internal.skillEvaluations.claimQueuedSkillEvaluationsInternal,
      { workerId: "worker", limit: 1 },
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      skillId: syncSkillId,
      scanStatus: "suspicious",
      source: "sync",
      status: "running",
    });
  });

  it("terminalizes a queued evaluation when its content hash is stale", async () => {
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "stale" });
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert(
          "skillEvaluationRuns",
          evaluationRow({
            skillId,
            contentHash: "old",
            scanStatus: "clean",
            source: "sync",
          }),
        ),
    );

    await expect(
      t.mutation(internal.skillEvaluations.claimQueuedSkillEvaluationsInternal, {
        workerId: "worker",
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await expect(t.run(async (ctx) => await ctx.db.get(runId))).resolves.toMatchObject({
      status: "skipped",
      skipReason: "stale-version",
    });
  });

  it("does not claim evaluation work for a removed skill", async () => {
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "removed" });
    const runId = await t.run(async (ctx) => {
      await ctx.db.patch(skillId, { moderationStatus: "removed" });
      return await ctx.db.insert(
        "skillEvaluationRuns",
        evaluationRow({
          skillId,
          contentHash: "current",
          scanStatus: "clean",
          source: "sync",
        }),
      );
    });

    await expect(
      t.mutation(internal.skillEvaluations.claimQueuedSkillEvaluationsInternal, {
        workerId: "worker",
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await expect(t.run(async (ctx) => await ctx.db.get(runId))).resolves.toMatchObject({
      status: "skipped",
      skipReason: "stale-version",
    });
  });

  it("does not claim evaluation work for a deleted skill", async () => {
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "deleted" });
    const runId = await t.run(async (ctx) => {
      await ctx.db.patch(skillId, { softDeletedAt: 100 });
      return await ctx.db.insert(
        "skillEvaluationRuns",
        evaluationRow({
          skillId,
          contentHash: "current",
          scanStatus: "clean",
          source: "sync",
        }),
      );
    });

    await expect(
      t.mutation(internal.skillEvaluations.claimQueuedSkillEvaluationsInternal, {
        workerId: "worker",
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await expect(t.run(async (ctx) => await ctx.db.get(runId))).resolves.toMatchObject({
      status: "skipped",
      skipReason: "stale-version",
    });
  });

  it("does not claim evaluation work after the GitHub source disappears", async () => {
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "missing" });
    const runId = await t.run(async (ctx) => {
      await ctx.db.patch(skillId, { githubCurrentStatus: "missing" });
      return await ctx.db.insert(
        "skillEvaluationRuns",
        evaluationRow({
          skillId,
          contentHash: "current",
          scanStatus: "clean",
          source: "sync",
        }),
      );
    });

    await expect(
      t.mutation(internal.skillEvaluations.claimQueuedSkillEvaluationsInternal, {
        workerId: "worker",
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await expect(t.run(async (ctx) => await ctx.db.get(runId))).resolves.toMatchObject({
      status: "skipped",
      skipReason: "stale-version",
    });
  });

  it("terminalizes a claimed unsupported configuration through the worker action", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "unsupported" });
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert("skillEvaluationRuns", {
          ...evaluationRow({
            skillId,
            contentHash: "current",
            scanStatus: "clean",
            source: "sync",
          }),
          evaluatorCommit: "unsupported",
        }),
    );
    const [claimed] = await t.mutation(
      internal.skillEvaluations.claimQueuedSkillEvaluationsInternal,
      { workerId: "worker", limit: 1 },
    );

    await expect(
      t.action(api.skillEvaluations.skipSkillEvaluation, {
        token: "worker-token",
        runId,
        leaseToken: claimed.leaseToken,
        reason: "unsupported-config: worker configuration changed",
      }),
    ).resolves.toEqual({ ok: true });
    const run = await t.run(async (ctx) => await ctx.db.get(runId));
    expect(run).toMatchObject({
      status: "skipped",
      skipReason: "unsupported-config: worker configuration changed",
    });
    expect(run).not.toHaveProperty("leaseToken");
    expect(run).not.toHaveProperty("leaseExpiresAt");
  });

  it("applies the existing retry policy through the worker failure action", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-token");
    const t = convexTest(schema, modules);
    const skillId = await insertNvidiaSkill(t, { hash: "current", slug: "failed" });
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert(
          "skillEvaluationRuns",
          evaluationRow({
            skillId,
            contentHash: "current",
            scanStatus: "clean",
            source: "sync",
          }),
        ),
    );
    const [claimed] = await t.mutation(
      internal.skillEvaluations.claimQueuedSkillEvaluationsInternal,
      { workerId: "worker", limit: 1 },
    );

    await expect(
      t.action(api.skillEvaluations.failSkillEvaluation, {
        token: "worker-token",
        runId,
        leaseToken: claimed.leaseToken,
        error: "evaluator failed",
      }),
    ).resolves.toEqual({ ok: true, retry: true });
    const run = await t.run(async (ctx) => await ctx.db.get(runId));
    expect(run).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "evaluator failed",
    });
    expect(run).not.toHaveProperty("leaseToken");
    expect(run).not.toHaveProperty("leaseExpiresAt");
    expect(run).not.toHaveProperty("completedAt");
  });
});
