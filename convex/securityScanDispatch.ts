import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./functions";
import { createGitHubAppInstallationToken, isGitHubAppConfigured } from "./lib/githubAuth";

const DISPATCH_STATE_KEY = "codex-worker";
const DISPATCH_LEASE_MS = 5 * 60 * 1000;
const SCHEDULE_STALE_MS = 60 * 1000;
const GITHUB_WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/openclaw/clawhub/actions/workflows/security-scan-codex.yml/dispatches";

const internalRefs = internal as unknown as {
  securityScanDispatch: {
    beginSecurityScanDispatchInternal: unknown;
    dispatchSecurityScanWorkerInternal: unknown;
    finishSecurityScanDispatchInternal: unknown;
  };
};

async function runMutationRef<T>(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

export function isSecurityScanEventDispatchEnabled(env: NodeJS.ProcessEnv = process.env) {
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

export async function dispatchSecurityScanWorkflow(
  installationToken: {
    token: string;
    permissions: Record<string, string>;
  },
  fetchImpl: typeof fetch = fetch,
) {
  if (installationToken.permissions.actions !== "write") {
    return { ok: false as const, reason: "actions-write-required" as const };
  }

  const response = await fetchImpl(GITHUB_WORKFLOW_DISPATCH_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken.token}`,
      "Content-Type": "application/json",
      "User-Agent": "clawhub/security-scan-dispatch",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        "batch-limit": "4",
        "max-runtime-minutes": "8",
      },
    }),
  });
  if (!response.ok) {
    return {
      ok: false as const,
      reason: "github-rejected" as const,
      status: response.status,
    };
  }
  return { ok: true as const };
}

export async function requestSecurityScanDispatch(ctx: MutationCtx, notBefore = 0) {
  if (!isSecurityScanEventDispatchEnabled()) return { scheduled: false as const };

  const earliestQueued = await ctx.db
    .query("securityScanJobs")
    .withIndex("by_status_and_next_run_at", (q) => q.eq("status", "queued"))
    .order("asc")
    .first();
  if (!earliestQueued) return { scheduled: false as const };

  const now = Date.now();
  const state = await ctx.db
    .query("securityScanDispatchState")
    .withIndex("by_key", (q) => q.eq("key", DISPATCH_STATE_KEY))
    .unique();
  const activeUntil =
    state?.leaseExpiresAt !== undefined && state.leaseExpiresAt > now ? state.leaseExpiresAt : now;
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
    internalRefs.securityScanDispatch.dispatchSecurityScanWorkerInternal as never,
    { scheduleToken } as never,
  );
  const patch = {
    scheduledToken: scheduleToken,
    scheduledAt,
    updatedAt: now,
  };
  if (state) {
    await ctx.db.patch(state._id, patch);
  } else {
    await ctx.db.insert("securityScanDispatchState", {
      key: DISPATCH_STATE_KEY,
      ...patch,
    });
  }
  return { scheduled: true as const, scheduledAt };
}

export const requestSecurityScanDispatchInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return requestSecurityScanDispatch(ctx);
  },
});

export const beginSecurityScanDispatchInternal = internalMutation({
  args: {
    scheduleToken: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isSecurityScanEventDispatchEnabled()) return { shouldDispatch: false as const };

    const state = await ctx.db
      .query("securityScanDispatchState")
      .withIndex("by_key", (q) => q.eq("key", DISPATCH_STATE_KEY))
      .unique();
    if (!state || state.scheduledToken !== args.scheduleToken) {
      return { shouldDispatch: false as const };
    }

    const now = Date.now();
    const claimable = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_status_and_next_run_at", (q) => q.eq("status", "queued").lte("nextRunAt", now))
      .order("asc")
      .first();
    if (!claimable) {
      await ctx.db.patch(state._id, {
        scheduledToken: undefined,
        scheduledAt: undefined,
        updatedAt: now,
      });
      await requestSecurityScanDispatch(ctx);
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

export const finishSecurityScanDispatchInternal = internalMutation({
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
    if (!state || state.leaseToken !== args.leaseToken) {
      return { ok: false as const, stale: true as const };
    }

    const now = Date.now();
    await ctx.db.patch(state._id, {
      ...(args.outcome === "failed"
        ? {
            leaseToken: undefined,
            leaseExpiresAt: undefined,
          }
        : {}),
      lastDispatchAt: now,
      lastDispatchStatus: args.outcome,
      lastError: args.error?.slice(0, 500),
      updatedAt: now,
    });
    if (args.outcome === "failed") {
      await requestSecurityScanDispatch(ctx, now + 60_000);
    }
    return { ok: true as const };
  },
});

export const checkGitHubActionsPermissionInternal = internalAction({
  args: {},
  handler: async () => {
    if (!isGitHubAppConfigured()) {
      return {
        configured: false as const,
        actionsPermission: null,
        canDispatch: false,
      };
    }
    const installationToken = await createGitHubAppInstallationToken({
      userAgent: "clawhub/security-scan-dispatch-preflight",
    });
    const actionsPermission = installationToken.permissions.actions ?? "none";
    return {
      configured: true as const,
      actionsPermission,
      canDispatch: actionsPermission === "write",
    };
  },
});

export const dispatchSecurityScanWorkerInternal = internalAction({
  args: {
    scheduleToken: v.string(),
  },
  handler: async (ctx, args) => {
    const begin = await runMutationRef<{ shouldDispatch: boolean; leaseToken?: string }>(
      ctx,
      internalRefs.securityScanDispatch.beginSecurityScanDispatchInternal,
      args,
    );
    if (!begin.shouldDispatch || !begin.leaseToken) {
      return { dispatched: false as const, reason: "coalesced-or-empty" as const };
    }

    try {
      const installationToken = await createGitHubAppInstallationToken({
        userAgent: "clawhub/security-scan-dispatch",
      });
      const result = await dispatchSecurityScanWorkflow(installationToken);
      if (result.ok) {
        await runMutationRef(
          ctx,
          internalRefs.securityScanDispatch.finishSecurityScanDispatchInternal,
          {
            leaseToken: begin.leaseToken,
            outcome: "succeeded",
          },
        );
        return { dispatched: true as const };
      }

      const error =
        result.reason === "actions-write-required"
          ? "GitHub App Actions write permission is required"
          : `GitHub workflow dispatch rejected with HTTP ${result.status}`;
      await runMutationRef(
        ctx,
        internalRefs.securityScanDispatch.finishSecurityScanDispatchInternal,
        {
          leaseToken: begin.leaseToken,
          outcome: "failed",
          error,
        },
      );
      return { dispatched: false as const, reason: result.reason };
    } catch {
      await runMutationRef(
        ctx,
        internalRefs.securityScanDispatch.finishSecurityScanDispatchInternal,
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
