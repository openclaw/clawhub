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
      agentModel: "gpt-5.4-mini",
      attemptsPerCase: 2,
      judgeModel: "gpt-5.4",
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
      evaluator: { agentModel: "gpt-5.4-mini", attempts: 2, judgeModel: "gpt-5.4" },
      metrics: { overall: { delta: 0.3 } },
      completedAt: 100,
    });

    await t.run(
      async (ctx) => await ctx.db.patch(skillId, { githubCurrentContentHash: "hash-v2" }),
    );
    await expect(t.query(api.skillEvaluations.getCurrentForSkill, { skillId })).resolves.toBeNull();
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
});
