import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./functions";
import { Events, logEvent } from "./lib/observabilityEvents";

const MAX_PREPUBLICATION_QUEUE_HEALTH_READS = 512;

type PrePublicationQueueHealth = {
  snapshotAt: number;
  pendingChecks: number;
  pendingChecksIsEstimate: boolean;
  readyChecks: number;
  activeClaims: number;
  timeoutPending: number;
  scannerFailurePending: number;
  oldestPendingAgeSeconds: number;
  oldestReadyAgeSeconds: number;
};

const internalRefs = internal as unknown as {
  prepublicationObservability: {
    getPrePublicationQueueHealthInternal: unknown;
  };
};

async function runQueryRef<T>(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

function isReady(attempt: Doc<"publishAttempts">, snapshotAt: number) {
  return (attempt.checkClaimExpiresAt ?? 0) <= snapshotAt;
}

function isClawScanTimeout(attempt: Doc<"publishAttempts">) {
  return attempt.checks.clawscan.summary?.toLowerCase().includes("timed out") ?? false;
}

export const getPrePublicationQueueHealthInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<PrePublicationQueueHealth> => {
    const snapshotAt = Date.now();
    const pendingAttempts = await ctx.db
      .query("publishAttempts")
      .withIndex("by_status_and_created", (q) => q.eq("status", "pending_checks"))
      .order("asc")
      .take(MAX_PREPUBLICATION_QUEUE_HEALTH_READS + 1);
    const sampledAttempts = pendingAttempts.slice(0, MAX_PREPUBLICATION_QUEUE_HEALTH_READS);
    const readyAttempts = sampledAttempts.filter((attempt) => isReady(attempt, snapshotAt));
    const oldestPendingAttempt = sampledAttempts[0];
    const oldestReadyAttempt = readyAttempts[0];

    return {
      snapshotAt,
      pendingChecks: sampledAttempts.length,
      pendingChecksIsEstimate: pendingAttempts.length > MAX_PREPUBLICATION_QUEUE_HEALTH_READS,
      readyChecks: readyAttempts.length,
      activeClaims: sampledAttempts.length - readyAttempts.length,
      timeoutPending: sampledAttempts.filter(isClawScanTimeout).length,
      scannerFailurePending: sampledAttempts.filter(
        (attempt) => attempt.checks.clawscan.status === "failed",
      ).length,
      oldestPendingAgeSeconds: oldestPendingAttempt
        ? Math.max(0, Math.floor((snapshotAt - oldestPendingAttempt.createdAt) / 1000))
        : 0,
      oldestReadyAgeSeconds: oldestReadyAttempt
        ? Math.max(0, Math.floor((snapshotAt - oldestReadyAttempt.createdAt) / 1000))
        : 0,
    };
  },
});

export const logPrePublicationQueueHealthInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<PrePublicationQueueHealth> => {
    const snapshot = await runQueryRef<PrePublicationQueueHealth>(
      ctx,
      internalRefs.prepublicationObservability.getPrePublicationQueueHealthInternal,
      {},
    );
    logEvent(Events.PrePublicationQueueSnapshot, snapshot);
    return snapshot;
  },
});
