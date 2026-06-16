import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./functions";
import { insertStatEvent } from "./skillStatEvents";

export const ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION = "DELETE_ROOT_INSTALL_TELEMETRY";

const CLEANUP_PHASES = ["activeRoots", "rootInstalls", "roots"] as const;
type CleanupPhase = (typeof CLEANUP_PHASES)[number];

type CleanupBatchResult = {
  phase: CleanupPhase;
  nextPhase?: CleanupPhase;
  scanned: number;
  matched: number;
  reactivated: number;
  cursor: string | null;
  phaseDone: boolean;
  isDone: boolean;
  dryRun: boolean;
};

function nextCleanupPhase(phase: CleanupPhase): CleanupPhase | undefined {
  const index = CLEANUP_PHASES.indexOf(phase);
  return CLEANUP_PHASES[index + 1];
}

function clampInt(value: number | undefined, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), max));
}

function requireCleanupConfirmation(dryRun: boolean, confirm: string | undefined) {
  if (!dryRun && confirm !== ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION) {
    throw new ConvexError(
      `Destructive cleanup requires confirm="${ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION}"`,
    );
  }
}

export async function cleanupRootInstallTelemetryBatchHandler(
  ctx: MutationCtx,
  args: {
    phase: CleanupPhase;
    cursor?: string;
    batchSize?: number;
    dryRun: boolean;
    confirm?: string;
  },
): Promise<CleanupBatchResult> {
  requireCleanupConfirmation(args.dryRun, args.confirm);
  const batchSize = clampInt(args.batchSize, 50, 100);
  const table =
    args.phase === "activeRoots"
      ? "userSkillInstalls"
      : args.phase === "rootInstalls"
        ? "userSkillRootInstalls"
        : "userSyncRoots";
  const page = await ctx.db
    .query(table)
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

  let matched = 0;
  let reactivated = 0;
  for (const entry of page.page) {
    if (args.phase === "activeRoots") {
      if (!("activeRoots" in entry) || typeof entry.activeRoots !== "number") continue;
      matched++;
      if (entry.activeRoots <= 0) {
        reactivated++;
        if (!args.dryRun) {
          await insertStatEvent(ctx, {
            skillId: entry.skillId,
            kind: "install_reactivate",
          });
        }
      }
      if (!args.dryRun) {
        await ctx.db.patch(entry._id, { activeRoots: undefined });
      }
      continue;
    }

    matched++;
    if (!args.dryRun) {
      await ctx.db.delete(entry._id);
    }
  }

  const nextPhase = page.isDone ? nextCleanupPhase(args.phase) : undefined;
  return {
    phase: args.phase,
    ...(nextPhase ? { nextPhase } : {}),
    scanned: page.page.length,
    matched,
    reactivated,
    cursor: page.isDone ? null : page.continueCursor,
    phaseDone: page.isDone,
    isDone: page.isDone && !nextPhase,
    dryRun: args.dryRun,
  };
}

export const cleanupRootInstallTelemetryBatchInternal = internalMutation({
  args: {
    phase: v.union(v.literal("activeRoots"), v.literal("rootInstalls"), v.literal("roots")),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.boolean(),
    confirm: v.optional(v.string()),
  },
  handler: cleanupRootInstallTelemetryBatchHandler,
});

export async function cleanupRootInstallTelemetryHandler(
  ctx: ActionCtx,
  args: {
    phase?: CleanupPhase;
    cursor?: string;
    batchSize?: number;
    maxBatches?: number;
    dryRun?: boolean;
    confirm?: string;
  },
) {
  const dryRun = args.dryRun !== false;
  requireCleanupConfirmation(dryRun, args.confirm);

  const batchSize = clampInt(args.batchSize, 50, 100);
  const maxBatches = clampInt(args.maxBatches, 20, 200);
  let phase = args.phase ?? "activeRoots";
  let cursor = args.cursor;
  let batches = 0;
  let scanned = 0;
  let matched = 0;
  let reactivated = 0;

  while (batches < maxBatches) {
    const result: CleanupBatchResult = await ctx.runMutation(
      internal.rootInstallTelemetryCleanup.cleanupRootInstallTelemetryBatchInternal,
      {
        phase,
        cursor,
        batchSize,
        dryRun,
        confirm: args.confirm,
      },
    );
    batches++;
    scanned += result.scanned;
    matched += result.matched;
    reactivated += result.reactivated;

    if (result.isDone) {
      return {
        dryRun,
        isDone: true,
        phase: result.phase,
        cursor: null,
        batches,
        scanned,
        matched,
        reactivated,
      };
    }
    if (result.phaseDone && result.nextPhase) {
      phase = result.nextPhase;
      cursor = undefined;
      continue;
    }
    cursor = result.cursor ?? undefined;
  }

  return {
    dryRun,
    isDone: false,
    phase,
    cursor: cursor ?? null,
    batches,
    scanned,
    matched,
    reactivated,
  };
}

// Temporary operator surface. Remove after production cleanup is verified.
export const cleanupRootInstallTelemetryInternal = internalAction({
  args: {
    phase: v.optional(
      v.union(v.literal("activeRoots"), v.literal("rootInstalls"), v.literal("roots")),
    ),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
  },
  handler: cleanupRootInstallTelemetryHandler,
});
