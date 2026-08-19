import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, requireUser } from "./lib/access";
import { isPublicSkillDoc } from "./lib/globalStats";
import {
  NVIDIA_SKILL_EVALUATION_CONFIG,
  NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
} from "./lib/skillEvaluationConfig";
import { parseSkillEvaluatorResultJson } from "./lib/skillEvaluationResult";
import { requestSkillEvaluationDispatch } from "./skillEvaluationDispatch";

const MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60 * 60 * 1000;
const BACKFILL_PAGE_SIZE = 20;
const MAX_NATIVE_RESULT_BYTES = 8 * 1024 * 1024;

const internalRefs = internal as unknown as {
  skillEvaluations: {
    backfillNvidiaSkillEvaluationsPageInternal: unknown;
    claimQueuedSkillEvaluationsInternal: unknown;
    completeSkillEvaluationInternal: unknown;
    failSkillEvaluationInternal: unknown;
    getSkillEvaluationRunInternal: unknown;
    skipSkillEvaluationInternal: unknown;
  };
  skillEvaluationDispatch: {
    requestSkillEvaluationDispatchInternal: unknown;
  };
};

async function runQueryRef<T>(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runMutationRef<T>(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function requestNextSkillEvaluationDispatch(ctx: {
  runMutation: (ref: never, args: never) => Promise<unknown>;
}) {
  try {
    await runMutationRef(
      ctx,
      internalRefs.skillEvaluationDispatch.requestSkillEvaluationDispatchInternal,
      {},
    );
  } catch {
    // The watchdog retries dispatch; a terminal run must stay terminal even if scheduling fails.
  }
}

function assertWorkerToken(token: string) {
  const expected = process.env.SECURITY_SCAN_WORKER_TOKEN;
  if (!expected || token !== expected) throw new ConvexError("Unauthorized");
}

function sanitizeWorkerError(error: string) {
  return error.replace(/\b(?:sk|nvapi)-[A-Za-z0-9_-]{12,}\b/g, "[redacted]").slice(0, 2_000);
}

export async function enqueueNvidiaSkillEvaluation(
  ctx: Parameters<typeof requestSkillEvaluationDispatch>[0],
  args: {
    skillId: Id<"skills">;
    sourceRepo: string;
    sourceCommit: string;
    sourcePath: string;
    contentHash: string;
    scanStatus: "clean" | "suspicious";
    source: "sync" | "backfill";
    now?: number;
  },
) {
  if (args.sourceRepo.trim().toLowerCase() !== NVIDIA_SKILL_EVALUATION_CONFIG.sourceRepo) {
    return { queued: false as const, reason: "source-not-allowlisted" as const };
  }
  const existing = await ctx.db
    .query("skillEvaluationRuns")
    .withIndex("by_skill_content_hash_config_key", (q) =>
      q
        .eq("skillId", args.skillId)
        .eq("contentHash", args.contentHash)
        .eq("configKey", NVIDIA_SKILL_EVALUATION_CONFIG_KEY),
    )
    .unique();
  if (existing) return { queued: false as const, reason: "already-observed" as const };

  const now = args.now ?? Date.now();
  const runId = await ctx.db.insert("skillEvaluationRuns", {
    skillId: args.skillId,
    sourceRepo: NVIDIA_SKILL_EVALUATION_CONFIG.sourceRepo,
    sourceCommit: args.sourceCommit,
    sourcePath: args.sourcePath,
    contentHash: args.contentHash,
    scanStatus: args.scanStatus,
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
    status: "queued",
    source: args.source,
    nextRunAt: now,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await requestSkillEvaluationDispatch(ctx);
  return { queued: true as const, runId };
}

export const getCurrentForSkill = query({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (
      !isPublicSkillDoc(skill) ||
      skill.installKind !== "github" ||
      skill.githubCurrentStatus !== "present" ||
      skill.githubCurrentRepo?.trim().toLowerCase() !== NVIDIA_SKILL_EVALUATION_CONFIG.sourceRepo ||
      !skill.githubCurrentContentHash
    ) {
      return null;
    }
    const run = await ctx.db
      .query("skillEvaluationRuns")
      .withIndex("by_skill_content_hash_config_key", (q) =>
        q
          .eq("skillId", skill._id)
          .eq("contentHash", skill.githubCurrentContentHash as string)
          .eq("configKey", NVIDIA_SKILL_EVALUATION_CONFIG_KEY),
      )
      .unique();
    if (run?.status !== "succeeded" || !run.metrics || !run.completedAt) return null;
    return {
      source: {
        repository: run.sourceRepo,
        commit: run.sourceCommit,
        path: run.sourcePath,
        contentHash: run.contentHash,
      },
      evaluator: {
        repository: run.evaluatorRepository,
        release: run.evaluatorRelease,
        commit: run.evaluatorCommit,
        agent: run.agent,
        agentModel: run.agentModel,
        judgeProvider: run.judgeProvider,
        judgeModel: run.judgeModel,
        environment: run.environment,
        attempts: run.attemptsPerCase,
      },
      metrics: run.metrics,
      completedAt: run.completedAt,
    };
  },
});

export const getSkillEvaluationRunInternal = internalQuery({
  args: { runId: v.id("skillEvaluationRuns") },
  handler: async (ctx, args) => ctx.db.get(args.runId),
});

export const claimQueuedSkillEvaluationsInternal = internalMutation({
  args: { workerId: v.string(), limit: v.number(), leaseMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const syncRows = await ctx.db
      .query("skillEvaluationRuns")
      .withIndex("by_status_source_next_run_at", (q) =>
        q.eq("status", "queued").eq("source", "sync").lte("nextRunAt", now),
      )
      .order("asc")
      .take(Math.max(1, Math.min(Math.floor(args.limit), 4)));
    const remaining = Math.max(0, Math.min(Math.floor(args.limit), 4) - syncRows.length);
    const backfillRows = remaining
      ? await ctx.db
          .query("skillEvaluationRuns")
          .withIndex("by_status_source_next_run_at", (q) =>
            q.eq("status", "queued").eq("source", "backfill").lte("nextRunAt", now),
          )
          .order("asc")
          .take(remaining)
      : [];
    const rows = [...syncRows, ...backfillRows];
    const claimed: Array<Doc<"skillEvaluationRuns"> & { leaseToken: string }> = [];
    for (const row of rows) {
      const skill = await ctx.db.get(row.skillId);
      if (
        !skill ||
        Boolean(skill.softDeletedAt) ||
        skill.moderationStatus === "removed" ||
        skill.githubCurrentStatus !== "present" ||
        skill.githubCurrentContentHash !== row.contentHash ||
        skill.githubCurrentRepo?.trim().toLowerCase() !== row.sourceRepo
      ) {
        await ctx.db.patch(row._id, {
          status: "skipped",
          skipReason: "stale-version",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
      const leaseToken = crypto.randomUUID();
      const patch = {
        status: "running" as const,
        attempts: row.attempts + 1,
        leaseToken,
        leaseExpiresAt: now + Math.max(60_000, args.leaseMs ?? DEFAULT_LEASE_MS),
        workerId: args.workerId,
        startedAt: now,
        updatedAt: now,
      };
      await ctx.db.patch(row._id, patch);
      claimed.push({ ...row, ...patch });
    }
    return claimed;
  },
});

export const completeSkillEvaluationInternal = internalMutation({
  args: {
    runId: v.id("skillEvaluationRuns"),
    leaseToken: v.string(),
    nativeResultStorageId: v.id("_storage"),
    metrics: v.object({
      sampleCount: v.number(),
      overall: v.object({
        withSkill: v.number(),
        withoutSkill: v.number(),
        delta: v.number(),
      }),
      cases: v.object({
        withSkillPassed: v.number(),
        withSkillTotal: v.number(),
        withoutSkillPassed: v.number(),
        withoutSkillTotal: v.number(),
      }),
      dimensions: v.array(
        v.object({
          id: v.string(),
          withSkill: v.number(),
          withoutSkill: v.number(),
          delta: v.number(),
        }),
      ),
    }),
    runIdFromEvaluator: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    taskSource: v.union(v.literal("evals_json"), v.literal("native_harbor")),
    evalDirectory: v.string(),
    evalDatasetPath: v.optional(v.string()),
    evalConfigPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.leaseToken !== args.leaseToken) {
      throw new ConvexError("Lease mismatch");
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "succeeded",
      metrics: args.metrics,
      nativeResultStorageId: args.nativeResultStorageId,
      runId: args.runIdFromEvaluator,
      durationMs: args.durationMs,
      taskSource: args.taskSource,
      evalDirectory: args.evalDirectory,
      ...(args.evalDatasetPath ? { evalDatasetPath: args.evalDatasetPath } : {}),
      ...(args.evalConfigPath ? { evalConfigPath: args.evalConfigPath } : {}),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const skipSkillEvaluationInternal = internalMutation({
  args: {
    runId: v.id("skillEvaluationRuns"),
    leaseToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.leaseToken !== args.leaseToken) {
      throw new ConvexError("Lease mismatch");
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "skipped",
      skipReason: args.reason.slice(0, 500),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const failSkillEvaluationInternal = internalMutation({
  args: { runId: v.id("skillEvaluationRuns"), leaseToken: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.leaseToken !== args.leaseToken) {
      throw new ConvexError("Lease mismatch");
    }
    const now = Date.now();
    const retry = run.attempts < MAX_ATTEMPTS;
    await ctx.db.patch(run._id, {
      status: retry ? "queued" : "failed",
      nextRunAt: retry ? now + Math.min(15 * 60_000, 60_000 * 2 ** (run.attempts - 1)) : now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastError: sanitizeWorkerError(args.error),
      completedAt: retry ? undefined : now,
      updatedAt: now,
    });
    return { ok: true as const, retry };
  },
});

export const claimSkillEvaluationJobs = action({
  args: {
    token: v.string(),
    workerId: v.string(),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    return runMutationRef<Array<Doc<"skillEvaluationRuns"> & { leaseToken: string }>>(
      ctx,
      internalRefs.skillEvaluations.claimQueuedSkillEvaluationsInternal,
      {
        workerId: args.workerId,
        limit: args.limit ?? 1,
        leaseMs: args.leaseMs,
      },
    );
  },
});

export const completeSkillEvaluation = action({
  args: {
    token: v.string(),
    runId: v.id("skillEvaluationRuns"),
    leaseToken: v.string(),
    resultJson: v.string(),
    durationMs: v.optional(v.number()),
    taskSource: v.union(v.literal("evals_json"), v.literal("native_harbor")),
    evalDirectory: v.string(),
    evalDatasetPath: v.optional(v.string()),
    evalConfigPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    if (new TextEncoder().encode(args.resultJson).byteLength > MAX_NATIVE_RESULT_BYTES) {
      throw new ConvexError("SkillEvaluator result.json exceeds the storage limit");
    }
    const run = await runQueryRef<Doc<"skillEvaluationRuns"> | null>(
      ctx,
      internalRefs.skillEvaluations.getSkillEvaluationRunInternal,
      { runId: args.runId },
    );
    if (!run || run.status !== "running" || run.leaseToken !== args.leaseToken) {
      throw new ConvexError("Lease mismatch");
    }
    const parsed = parseSkillEvaluatorResultJson(args.resultJson, run.agent);
    const storageId = await ctx.storage.store(
      new Blob([args.resultJson], { type: "application/json" }),
    );
    let result: { ok: true };
    try {
      result = await runMutationRef<{ ok: true }>(
        ctx,
        internalRefs.skillEvaluations.completeSkillEvaluationInternal,
        {
          runId: args.runId,
          leaseToken: args.leaseToken,
          nativeResultStorageId: storageId,
          metrics: parsed.metrics,
          runIdFromEvaluator: parsed.runId,
          durationMs: args.durationMs,
          taskSource: args.taskSource,
          evalDirectory: args.evalDirectory,
          ...(args.evalDatasetPath ? { evalDatasetPath: args.evalDatasetPath } : {}),
          ...(args.evalConfigPath ? { evalConfigPath: args.evalConfigPath } : {}),
        },
      );
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
    await requestNextSkillEvaluationDispatch(ctx);
    return result;
  },
});

export const skipSkillEvaluation = action({
  args: {
    token: v.string(),
    runId: v.id("skillEvaluationRuns"),
    leaseToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    const result = await runMutationRef<{ ok: true }>(
      ctx,
      internalRefs.skillEvaluations.skipSkillEvaluationInternal,
      args,
    );
    await requestNextSkillEvaluationDispatch(ctx);
    return result;
  },
});

export const failSkillEvaluation = action({
  args: {
    token: v.string(),
    runId: v.id("skillEvaluationRuns"),
    leaseToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    const result = await runMutationRef<{ ok: true; retry: boolean }>(
      ctx,
      internalRefs.skillEvaluations.failSkillEvaluationInternal,
      args,
    );
    await requestNextSkillEvaluationDispatch(ctx);
    return result;
  },
});

export const requeueExpiredSkillEvaluationLeasesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("skillEvaluationRuns")
      .withIndex("by_status_lease_expires_at", (q) =>
        q.eq("status", "running").lte("leaseExpiresAt", now),
      )
      .take(20);
    for (const run of expired) {
      const retry = run.attempts < MAX_ATTEMPTS;
      await ctx.db.patch(run._id, {
        status: retry ? "queued" : "failed",
        nextRunAt: now,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastError: "Evaluation worker lease expired",
        completedAt: retry ? undefined : now,
        updatedAt: now,
      });
    }
    if (expired.some((run) => run.attempts < MAX_ATTEMPTS)) {
      await requestSkillEvaluationDispatch(ctx);
    }
    return { recovered: expired.length };
  },
});

export const startNvidiaSkillEvaluationBackfill = mutation({
  args: { confirm: v.literal("backfill-nvidia-skill-evaluations") },
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const source = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_repo", (q) => q.eq("repo", "NVIDIA/skills"))
      .unique();
    if (!source) throw new ConvexError("NVIDIA GitHub skill source is not configured");
    await ctx.scheduler.runAfter(
      0,
      internalRefs.skillEvaluations.backfillNvidiaSkillEvaluationsPageInternal as never,
      { sourceId: source._id, cursor: null } as never,
    );
    return { started: true as const, sourceId: source._id };
  },
});

export const backfillNvidiaSkillEvaluationsPageInternal = internalMutation({
  args: {
    sourceId: v.id("githubSkillSources"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("skills")
      .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
      .paginate({ cursor: args.cursor, numItems: BACKFILL_PAGE_SIZE });
    let queued = 0;
    for (const skill of page.page) {
      if (
        skill.installKind !== "github" ||
        skill.githubCurrentStatus !== "present" ||
        !skill.githubCurrentCommit ||
        !skill.githubCurrentContentHash ||
        !skill.githubPath ||
        (skill.githubScanStatus !== "clean" && skill.githubScanStatus !== "suspicious")
      ) {
        continue;
      }
      const result = await enqueueNvidiaSkillEvaluation(ctx, {
        skillId: skill._id,
        sourceRepo: NVIDIA_SKILL_EVALUATION_CONFIG.sourceRepo,
        sourceCommit: skill.githubCurrentCommit,
        sourcePath: skill.githubPath,
        contentHash: skill.githubCurrentContentHash,
        scanStatus: skill.githubScanStatus,
        source: "backfill",
      });
      if (result.queued) queued += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internalRefs.skillEvaluations.backfillNvidiaSkillEvaluationsPageInternal as never,
        { sourceId: args.sourceId, cursor: page.continueCursor } as never,
      );
    }
    return { queued, isDone: page.isDone, cursor: page.continueCursor };
  },
});
