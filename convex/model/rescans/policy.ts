import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

export const MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE = 3;
const ACTIVE_RESCAN_STATUS = "in_progress" as const;
const NON_TERMINAL_SCAN_STATUSES = new Set(["loading", "not_found", "pending"]);
const FAILED_SCAN_STATUSES = new Set(["error", "failed", "stale"]);

export type RescanTarget =
  | {
      kind: "skill";
      artifactId: Id<"skillVersions">;
    }
  | {
      kind: "plugin";
      artifactId: Id<"packageReleases">;
    };

export function serializeRescanRequest(request: Doc<"rescanRequests"> | null) {
  if (!request) return null;
  return {
    _id: request._id,
    targetKind: request.targetKind,
    targetVersion: request.targetVersion,
    requestedByUserId: request.requestedByUserId,
    status: request.status,
    error: request.error,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
  };
}

type ScanSignal = {
  status: string;
  checkedAt: number;
};

export type RescanScanState = {
  staticScan?: ScanSignal;
  vtAnalysis?: ScanSignal;
  llmAnalysis?: ScanSignal;
};

function freshTerminalSignal(signal: ScanSignal | undefined, requestedAt: number) {
  if (!signal || signal.checkedAt < requestedAt) return null;
  const status = signal.status.trim().toLowerCase();
  if (NON_TERMINAL_SCAN_STATUSES.has(status)) return null;
  return status;
}

function terminalRequestStatusForScanState(
  scanState: RescanScanState,
  requestedAt: number,
): "completed" | "failed" | null {
  const statuses = [
    freshTerminalSignal(scanState.staticScan, requestedAt),
    freshTerminalSignal(scanState.vtAnalysis, requestedAt),
    freshTerminalSignal(scanState.llmAnalysis, requestedAt),
  ];
  if (statuses.some((status) => status === null)) return null;
  if (statuses.some((status) => FAILED_SCAN_STATUSES.has(status!))) return "failed";
  return "completed";
}

export async function listRequestsForTarget(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  target: RescanTarget,
) {
  if (target.kind === "skill") {
    return await ctx.db
      .query("rescanRequests")
      .withIndex("by_skill_version", (q) =>
        q.eq("targetKind", "skill").eq("skillVersionId", target.artifactId),
      )
      .order("desc")
      .take(MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE + 1);
  }

  return await ctx.db
    .query("rescanRequests")
    .withIndex("by_package_release", (q) =>
      q.eq("targetKind", "plugin").eq("packageReleaseId", target.artifactId),
    )
    .order("desc")
    .take(MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE + 1);
}

export async function getInProgressRequestForTarget(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  target: RescanTarget,
) {
  if (target.kind === "skill") {
    return await ctx.db
      .query("rescanRequests")
      .withIndex("by_skill_version_status", (q) =>
        q
          .eq("targetKind", "skill")
          .eq("skillVersionId", target.artifactId)
          .eq("status", ACTIVE_RESCAN_STATUS),
      )
      .order("desc")
      .first();
  }

  return await ctx.db
    .query("rescanRequests")
    .withIndex("by_package_release_status", (q) =>
      q
        .eq("targetKind", "plugin")
        .eq("packageReleaseId", target.artifactId)
        .eq("status", ACTIVE_RESCAN_STATUS),
    )
    .order("desc")
    .first();
}

export async function assertCanRequestRescan(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  target: RescanTarget,
) {
  const existingInProgress = await getInProgressRequestForTarget(ctx, target);
  if (existingInProgress) {
    throw new ConvexError("A rescan request is already in progress for this release");
  }

  const existingRequests = await listRequestsForTarget(ctx, target);
  if (existingRequests.length >= MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE) {
    throw new ConvexError(
      `Rescan request limit reached for this release (${MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE})`,
    );
  }
}

export async function buildRescanState(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  target: RescanTarget,
) {
  const requests = await listRequestsForTarget(ctx, target);
  const inProgressRequest =
    requests.find((request) => request.status === ACTIVE_RESCAN_STATUS) ?? null;
  const requestCount = Math.min(requests.length, MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE);
  return {
    maxRequests: MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE,
    requestCount,
    remainingRequests: Math.max(0, MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE - requestCount),
    canRequest:
      requestCount < MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE && inProgressRequest === null,
    inProgressRequest: serializeRescanRequest(inProgressRequest),
    latestRequest: serializeRescanRequest(requests[0] ?? null),
  };
}

async function listInProgressRequestsForTarget(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  target: RescanTarget,
) {
  if (target.kind === "skill") {
    return await ctx.db
      .query("rescanRequests")
      .withIndex("by_skill_version_status", (q) =>
        q
          .eq("targetKind", "skill")
          .eq("skillVersionId", target.artifactId)
          .eq("status", ACTIVE_RESCAN_STATUS),
      )
      .order("desc")
      .take(MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE);
  }

  return await ctx.db
    .query("rescanRequests")
    .withIndex("by_package_release_status", (q) =>
      q
        .eq("targetKind", "plugin")
        .eq("packageReleaseId", target.artifactId)
        .eq("status", ACTIVE_RESCAN_STATUS),
    )
    .order("desc")
    .take(MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE);
}

export async function finalizeInProgressRescanRequestsForTarget(
  ctx: Pick<MutationCtx, "db">,
  target: RescanTarget,
  scanState: RescanScanState,
) {
  const requests = await listInProgressRequestsForTarget(ctx, target);
  const now = Date.now();
  for (const request of requests) {
    const status = terminalRequestStatusForScanState(scanState, request.createdAt);
    if (!status) continue;
    await ctx.db.patch(request._id, {
      status,
      updatedAt: now,
      completedAt: now,
    });
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown rescan dispatch error";
}
