import { ConvexError, type Value } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type ArtifactReportStatus = "open" | "confirmed" | "dismissed";
export type StoredArtifactReportStatus = ArtifactReportStatus | "triaged";
export type ArtifactAppealStatus = "open" | "accepted" | "rejected";

type BaseArtifactModerationEventInput = {
  kind: "report" | "appeal";
  actorUserId: Id<"users">;
  action: string;
  timelineMetadata?: Value;
  auditAction: string;
  auditTargetType: string;
  auditTargetId: string;
  auditMetadata?: Value;
  createdAt: number;
};

type SkillModerationEventInput = BaseArtifactModerationEventInput & {
  reportId?: Id<"skillReports">;
  appealId?: Id<"skillAppeals">;
};

type PackageModerationEventInput = BaseArtifactModerationEventInput & {
  reportId?: Id<"packageReports">;
  appealId?: Id<"packageAppeals">;
};

const reportStatusTransitions = {
  open: ["confirmed", "dismissed"],
  confirmed: ["open"],
  dismissed: ["open"],
} satisfies Record<ArtifactReportStatus, ArtifactReportStatus[]>;

const appealStatusTransitions = {
  open: ["accepted", "rejected"],
  accepted: ["open"],
  rejected: ["open"],
} satisfies Record<ArtifactAppealStatus, ArtifactAppealStatus[]>;

function assertAllowedStatusTransition<TStatus extends string>(
  kind: "report" | "appeal",
  previousStatus: TStatus,
  nextStatus: TStatus,
  transitions: Record<TStatus, readonly TStatus[]>,
) {
  if (transitions[previousStatus]?.includes(nextStatus)) return;
  throw new ConvexError(
    `Invalid ${kind} status transition from ${previousStatus} to ${nextStatus}. Reopen the case before recording a different outcome.`,
  );
}

export function assertArtifactReportTransition(
  previousStatus: ArtifactReportStatus | undefined,
  nextStatus: ArtifactReportStatus,
) {
  assertAllowedStatusTransition(
    "report",
    previousStatus ?? "open",
    nextStatus,
    reportStatusTransitions,
  );
}

export function readArtifactReportStatus(
  status: StoredArtifactReportStatus | undefined,
): ArtifactReportStatus {
  if (!status) return "open";
  return status === "triaged" ? "confirmed" : status;
}

export function assertArtifactAppealTransition(
  previousStatus: ArtifactAppealStatus | undefined,
  nextStatus: ArtifactAppealStatus,
) {
  assertAllowedStatusTransition(
    "appeal",
    previousStatus ?? "open",
    nextStatus,
    appealStatusTransitions,
  );
}

export function assertArtifactReportFinalAction<TAction extends string>(
  status: ArtifactReportStatus,
  finalAction: TAction | "none",
  allowedResolvedActions: readonly TAction[],
) {
  if (finalAction === "none") return;
  if (status === "open") {
    throw new ConvexError("Reopened reports cannot apply a final action.");
  }
  if (status === "dismissed") {
    throw new ConvexError("Dismissed reports cannot apply a final action.");
  }
  if (allowedResolvedActions.includes(finalAction)) return;
  throw new ConvexError(`Unsupported report final action: ${finalAction}.`);
}

export function assertArtifactAppealFinalAction<TAction extends string>(
  status: ArtifactAppealStatus,
  finalAction: TAction | "none",
  allowedAcceptedActions: readonly TAction[],
) {
  if (finalAction === "none") return;
  if (status === "open") {
    throw new ConvexError("Reopened appeals cannot apply a final action.");
  }
  if (status === "rejected") {
    throw new ConvexError("Rejected appeals cannot apply a final action.");
  }
  if (allowedAcceptedActions.includes(finalAction)) return;
  throw new ConvexError(`Unsupported appeal final action: ${finalAction}.`);
}

export async function appendSkillModerationEventLog(
  ctx: MutationCtx,
  event: SkillModerationEventInput,
) {
  await ctx.db.insert("skillModerationEventLogs", {
    kind: event.kind,
    ...(event.reportId ? { reportId: event.reportId } : {}),
    ...(event.appealId ? { appealId: event.appealId } : {}),
    actorUserId: event.actorUserId,
    action: event.action,
    ...(event.timelineMetadata ? { metadata: event.timelineMetadata } : {}),
    createdAt: event.createdAt,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: event.actorUserId,
    action: event.auditAction,
    targetType: event.auditTargetType,
    targetId: event.auditTargetId,
    ...(event.auditMetadata ? { metadata: event.auditMetadata } : {}),
    createdAt: event.createdAt,
  });
}

export async function appendPackageModerationEventLog(
  ctx: MutationCtx,
  event: PackageModerationEventInput,
) {
  await ctx.db.insert("packageModerationEventLogs", {
    kind: event.kind,
    ...(event.reportId ? { reportId: event.reportId } : {}),
    ...(event.appealId ? { appealId: event.appealId } : {}),
    actorUserId: event.actorUserId,
    action: event.action,
    ...(event.timelineMetadata ? { metadata: event.timelineMetadata } : {}),
    createdAt: event.createdAt,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: event.actorUserId,
    action: event.auditAction,
    targetType: event.auditTargetType,
    targetId: event.auditTargetId,
    ...(event.auditMetadata ? { metadata: event.auditMetadata } : {}),
    createdAt: event.createdAt,
  });
}
