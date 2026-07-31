import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction } from "./functions";
import { createGitHubAppInstallationToken } from "./lib/githubAuth";
import { dispatchGitHubRepositoryEvent } from "./lib/githubRepositoryDispatch";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

const internalRefs = internal as unknown as {
  publishAttemptDispatch: {
    dispatchPublishAttemptInternal: unknown;
  };
  publishAttempts: {
    getPendingPublishAttemptDispatchTargetInternal: unknown;
  };
};

export function isPublishAttemptEventDispatchEnabled(env: NodeJS.ProcessEnv = process.env) {
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

export async function requestPublishAttemptDispatch(
  ctx: Pick<MutationCtx, "scheduler">,
  attemptId: Id<"publishAttempts">,
) {
  if (!isPublishAttemptEventDispatchEnabled()) return { scheduled: false as const };
  await ctx.scheduler.runAfter(
    0,
    internalRefs.publishAttemptDispatch.dispatchPublishAttemptInternal as never,
    {
      attemptId,
      retryCount: 0,
    } as never,
  );
  return { scheduled: true as const };
}

export async function dispatchPublishAttemptWorkflow(
  installationToken: {
    token: string;
    permissions: Record<string, string>;
  },
  target: {
    attemptId: Id<"publishAttempts">;
    kind: "skill" | "package";
    slug: string;
    version: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return dispatchGitHubRepositoryEvent(
    installationToken,
    {
      eventType: "clawhub-prepublication-publish",
      clientPayload: {
        attempt_id: target.attemptId,
        kind: target.kind,
        slug: target.slug,
        version: target.version,
        batch_limit: "1",
        max_jobs: "1",
        max_runtime_minutes: "20",
      },
      userAgent: "clawhub/prepublication-publish-dispatch",
    },
    fetchImpl,
  );
}

export const dispatchPublishAttemptInternal = internalAction({
  args: {
    attemptId: v.id("publishAttempts"),
    retryCount: v.number(),
  },
  handler: async (ctx, args) => {
    if (!isPublishAttemptEventDispatchEnabled()) {
      return { dispatched: false as const, reason: "disabled" as const };
    }

    const target = (await ctx.runQuery(
      internalRefs.publishAttempts.getPendingPublishAttemptDispatchTargetInternal as never,
      { attemptId: args.attemptId } as never,
    )) as {
      attemptId: Id<"publishAttempts">;
      kind: "skill" | "package";
      slug: string;
      version: string;
    } | null;
    if (!target) {
      return { dispatched: false as const, reason: "not-pending" as const };
    }

    try {
      const installationToken = await createGitHubAppInstallationToken({
        userAgent: "clawhub/prepublication-publish-dispatch",
      });
      const result = await dispatchPublishAttemptWorkflow(installationToken, target);
      if (result.ok) return { dispatched: true as const };

      await scheduleRetry(ctx, args);
      return { dispatched: false as const, reason: result.reason };
    } catch {
      await scheduleRetry(ctx, args);
      return { dispatched: false as const, reason: "unknown" as const };
    }
  },
});

async function scheduleRetry(
  ctx: {
    scheduler: {
      runAfter: (delayMs: number, ref: never, args: never) => Promise<unknown>;
    };
  },
  args: {
    attemptId: Id<"publishAttempts">;
    retryCount: number;
  },
) {
  const delayMs = RETRY_DELAYS_MS[args.retryCount];
  if (delayMs === undefined) return false;
  await ctx.scheduler.runAfter(
    delayMs,
    internalRefs.publishAttemptDispatch.dispatchPublishAttemptInternal as never,
    {
      attemptId: args.attemptId,
      retryCount: args.retryCount + 1,
    } as never,
  );
  return true;
}
