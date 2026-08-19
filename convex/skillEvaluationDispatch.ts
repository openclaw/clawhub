import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./functions";
import { createGitHubAppInstallationToken } from "./lib/githubAuth";
import { dispatchGitHubRepositoryEvent } from "./lib/githubRepositoryDispatch";

const DISPATCH_STATE_KEY = "skill-evaluation-worker";
const DISPATCH_LEASE_MS = 15 * 60 * 1000;
const SCHEDULE_STALE_MS = 60 * 1000;

const internalRefs = internal as unknown as {
  skillEvaluationDispatch: {
    beginSkillEvaluationDispatchInternal: unknown;
    dispatchSkillEvaluationWorkerInternal: unknown;
    finishSkillEvaluationDispatchInternal: unknown;
  };
};

async function runMutationRef<T>(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

export function isSkillEvaluationEventDispatchEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.SECURITY_SCAN_EVENT_DISPATCH_ENABLED === "1" &&
    env.CLAWHUB_PREVIEW !== "1" &&
    Boolean(
      env.GITHUB_APP_ID?.trim() &&
      env.GITHUB_APP_INSTALLATION_ID?.trim() &&
      env.GITHUB_APP_PRIVATE_KEY?.trim(),
    )
  );
}

export async function dispatchSkillEvaluationWorkflow(
  installationToken: { token: string; permissions: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
) {
  return dispatchGitHubRepositoryEvent(
    installationToken,
    {
      eventType: "clawhub-skill-evaluation",
      clientPayload: { batch_limit: "1", max_runtime_minutes: "170" },
      userAgent: "clawhub/skill-evaluation-dispatch",
    },
    fetchImpl,
  );
}

export async function requestSkillEvaluationDispatch(ctx: MutationCtx, notBefore = 0) {
  if (!isSkillEvaluationEventDispatchEnabled()) return { scheduled: false as const };

  const earliestQueued = await ctx.db
    .query("skillEvaluationRuns")
    .withIndex("by_status_next_run_at", (q) => q.eq("status", "queued"))
    .order("asc")
    .first();
  if (!earliestQueued) return { scheduled: false as const };

  const now = Date.now();
  const state = await ctx.db
    .query("securityScanDispatchState")
    .withIndex("by_key", (q) => q.eq("key", DISPATCH_STATE_KEY))
    .unique();
  const activeUntil =
    state?.leaseExpiresAt && state.leaseExpiresAt > now ? state.leaseExpiresAt : now;
  const scheduledAt = Math.max(now, earliestQueued.nextRunAt, activeUntil, notBefore);
  if (
    state?.scheduledAt !== undefined &&
    state.scheduledAt >= now - SCHEDULE_STALE_MS &&
    state.scheduledAt <= scheduledAt
  ) {
    return { scheduled: false as const, scheduledAt: state.scheduledAt };
  }

  const scheduleToken = crypto.randomUUID();
  await ctx.scheduler.runAt(
    scheduledAt,
    internalRefs.skillEvaluationDispatch.dispatchSkillEvaluationWorkerInternal as never,
    { scheduleToken } as never,
  );
  const patch = { scheduledToken: scheduleToken, scheduledAt, updatedAt: now };
  if (state) await ctx.db.patch(state._id, patch);
  else await ctx.db.insert("securityScanDispatchState", { key: DISPATCH_STATE_KEY, ...patch });
  return { scheduled: true as const, scheduledAt };
}

export const requestSkillEvaluationDispatchInternal = internalMutation({
  args: {},
  handler: async (ctx) => requestSkillEvaluationDispatch(ctx),
});

export const beginSkillEvaluationDispatchInternal = internalMutation({
  args: { scheduleToken: v.string() },
  handler: async (ctx, args) => {
    if (!isSkillEvaluationEventDispatchEnabled()) return { shouldDispatch: false as const };
    const state = await ctx.db
      .query("securityScanDispatchState")
      .withIndex("by_key", (q) => q.eq("key", DISPATCH_STATE_KEY))
      .unique();
    if (!state || state.scheduledToken !== args.scheduleToken) {
      return { shouldDispatch: false as const };
    }
    const now = Date.now();
    const claimable = await ctx.db
      .query("skillEvaluationRuns")
      .withIndex("by_status_next_run_at", (q) => q.eq("status", "queued").lte("nextRunAt", now))
      .order("asc")
      .first();
    if (!claimable) {
      await ctx.db.patch(state._id, {
        scheduledToken: undefined,
        scheduledAt: undefined,
        updatedAt: now,
      });
      await requestSkillEvaluationDispatch(ctx);
      return { shouldDispatch: false as const };
    }
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(state._id, {
      scheduledToken: undefined,
      scheduledAt: undefined,
      leaseToken,
      leaseExpiresAt: now + DISPATCH_LEASE_MS,
      updatedAt: now,
    });
    return { shouldDispatch: true as const, leaseToken };
  },
});

export const finishSkillEvaluationDispatchInternal = internalMutation({
  args: {
    leaseToken: v.string(),
    outcome: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("unknown")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("securityScanDispatchState")
      .withIndex("by_key", (q) => q.eq("key", DISPATCH_STATE_KEY))
      .unique();
    if (!state || state.leaseToken !== args.leaseToken) return { ok: false as const, stale: true };
    const now = Date.now();
    await ctx.db.patch(state._id, {
      ...(args.outcome === "failed" ? { leaseToken: undefined, leaseExpiresAt: undefined } : {}),
      lastDispatchAt: now,
      lastDispatchStatus: args.outcome,
      lastError: args.error?.slice(0, 500),
      updatedAt: now,
    });
    if (args.outcome === "failed") await requestSkillEvaluationDispatch(ctx, now + 60_000);
    return { ok: true as const };
  },
});

export const dispatchSkillEvaluationWorkerInternal = internalAction({
  args: { scheduleToken: v.string() },
  handler: async (ctx, args) => {
    const begin = await runMutationRef<{ shouldDispatch: boolean; leaseToken?: string }>(
      ctx,
      internalRefs.skillEvaluationDispatch.beginSkillEvaluationDispatchInternal,
      args,
    );
    if (!begin.shouldDispatch || !begin.leaseToken) {
      return { dispatched: false as const, reason: "coalesced-or-empty" as const };
    }
    try {
      const installationToken = await createGitHubAppInstallationToken({
        userAgent: "clawhub/skill-evaluation-dispatch",
      });
      const result = await dispatchSkillEvaluationWorkflow(installationToken);
      if (result.ok) {
        await runMutationRef(
          ctx,
          internalRefs.skillEvaluationDispatch.finishSkillEvaluationDispatchInternal,
          { leaseToken: begin.leaseToken, outcome: "succeeded" },
        );
        return { dispatched: true as const };
      }
      await runMutationRef(
        ctx,
        internalRefs.skillEvaluationDispatch.finishSkillEvaluationDispatchInternal,
        {
          leaseToken: begin.leaseToken,
          outcome: "failed",
          error:
            result.reason === "contents-write-required"
              ? "GitHub App Contents write permission is required"
              : `GitHub repository dispatch rejected with HTTP ${result.status}`,
        },
      );
      return { dispatched: false as const, reason: result.reason };
    } catch {
      await runMutationRef(
        ctx,
        internalRefs.skillEvaluationDispatch.finishSkillEvaluationDispatchInternal,
        {
          leaseToken: begin.leaseToken,
          outcome: "unknown",
          error: "GitHub workflow dispatch outcome could not be confirmed",
        },
      );
      return { dispatched: false as const, reason: "unknown" as const };
    }
  },
});
