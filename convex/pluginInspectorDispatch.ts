import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./functions";
import { createGitHubAppInstallationToken } from "./lib/githubAuth";
import { dispatchGitHubRepositoryEvent } from "./lib/githubRepositoryDispatch";
import {
  isPluginInspectorReleaseScanDispatchEnabled,
  PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT,
} from "./lib/pluginInspectorReleaseScan";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const USER_AGENT = "clawhub/plugin-inspector-release-scan-dispatch";

const internalRefs = internal as unknown as {
  pluginInspectorDispatch: {
    dispatchPluginInspectorReleaseScanInternal: unknown;
  };
  packages: {
    getPluginInspectorReleaseScanTargetInternal: unknown;
  };
};

type ReleaseScanTarget = {
  packageName: string;
  version: string;
  releaseId: Id<"packageReleases">;
};

export async function dispatchPluginInspectorReleaseScanWorkflow(
  installationToken: { token: string; permissions: Record<string, string> },
  target: ReleaseScanTarget,
  fetchImpl: typeof fetch = fetch,
) {
  return dispatchGitHubRepositoryEvent(
    installationToken,
    {
      eventType: PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT,
      clientPayload: {
        package_name: target.packageName,
        version: target.version,
        release_id: target.releaseId,
      },
      userAgent: USER_AGENT,
    },
    fetchImpl,
  );
}

// Advisory monitoring: failures retry a few times and otherwise fall back to the
// nightly sweep. Nothing here can affect the release that was just accepted.
export const dispatchPluginInspectorReleaseScanInternal = internalAction({
  args: {
    releaseId: v.id("packageReleases"),
    retryCount: v.number(),
  },
  handler: async (ctx, args) => {
    if (!isPluginInspectorReleaseScanDispatchEnabled()) {
      return { dispatched: false as const, reason: "disabled" as const };
    }
    const target = (await ctx.runQuery(
      internalRefs.packages.getPluginInspectorReleaseScanTargetInternal as never,
      { releaseId: args.releaseId } as never,
    )) as ReleaseScanTarget | null;
    if (!target) {
      return { dispatched: false as const, reason: "not-eligible" as const };
    }

    try {
      const installationToken = await createGitHubAppInstallationToken({ userAgent: USER_AGENT });
      const result = await dispatchPluginInspectorReleaseScanWorkflow(installationToken, target);
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
  ctx: { scheduler: { runAfter: (delayMs: number, ref: never, args: never) => Promise<unknown> } },
  args: { releaseId: Id<"packageReleases">; retryCount: number },
) {
  const delayMs = RETRY_DELAYS_MS[args.retryCount];
  if (delayMs === undefined) return false;
  await ctx.scheduler.runAfter(
    delayMs,
    internalRefs.pluginInspectorDispatch.dispatchPluginInspectorReleaseScanInternal as never,
    { releaseId: args.releaseId, retryCount: args.retryCount + 1 } as never,
  );
  return true;
}
