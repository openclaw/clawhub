import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./functions";
import { getClientIp } from "./lib/httpRateLimit";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import { hashToken } from "./lib/tokens";
import { insertStatEvent } from "./skillStatEvents";

const DAY_MS = 86_400_000;
const DEDUPE_RETENTION_MS = 14 * DAY_MS;
const PRUNE_BATCH_SIZE = RETENTION_STANDARD_BATCH_SIZE;

const identityKindValidator = v.union(v.literal("user"), v.literal("ip"));

const targetValidator = v.union(
  v.object({ kind: v.literal("skill"), id: v.id("skills") }),
  v.object({ kind: v.literal("package"), id: v.id("packages") }),
);

type DownloadIdentityKind = "user" | "ip";

type DownloadIdentity = {
  identityKind: DownloadIdentityKind;
  identityValue: string;
};

export function getDownloadIdentity(
  request: Request,
  userId: string | null,
): DownloadIdentity | null {
  if (userId) return { identityKind: "user", identityValue: userId };
  const ip = getClientIp(request);
  if (!ip) return null;
  return { identityKind: "ip", identityValue: ip };
}

export async function buildDownloadMetricArgs(params: {
  target: { kind: "skill"; id: Id<"skills"> } | { kind: "package"; id: Id<"packages"> };
  identity: DownloadIdentity;
  now: number;
}) {
  return {
    target: params.target,
    identityKind: params.identity.identityKind,
    identityHash: await hashToken(
      `${params.identity.identityKind}:${params.identity.identityValue}`,
    ),
    dayStart: getDayStart(params.now),
    occurredAt: params.now,
  };
}

export const recordDownloadMetricInternal = internalMutation({
  args: {
    target: targetValidator,
    identityKind: identityKindValidator,
    identityHash: v.string(),
    dayStart: v.number(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const targetId = args.target.id;
    const existing = await ctx.db
      .query("downloadMetricDedupes")
      .withIndex("by_target_identity_day", (q) =>
        q
          .eq("targetKind", args.target.kind)
          .eq("targetId", targetId)
          .eq("identityKind", args.identityKind)
          .eq("identityHash", args.identityHash)
          .eq("dayStart", args.dayStart),
      )
      .unique();
    if (existing) return;

    const now = Date.now();
    await ctx.db.insert("downloadMetricDedupes", {
      targetKind: args.target.kind,
      targetId,
      identityKind: args.identityKind,
      identityHash: args.identityHash,
      dayStart: args.dayStart,
      createdAt: now,
    });

    if (args.target.kind === "skill") {
      await insertStatEvent(ctx, {
        skillId: args.target.id,
        kind: "download",
        occurredAt: args.occurredAt,
      });
      return;
    }

    await ctx.db.insert("packageStatEvents", {
      packageId: args.target.id,
      kind: "download",
      occurredAt: args.occurredAt ?? now,
      processedAt: undefined,
    });
  },
});

export const pruneDownloadMetricDedupesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoffDayStart = getDayStart(Date.now() - DEDUPE_RETENTION_MS);
    const staleDownloads = await ctx.db
      .query("downloadMetricDedupes")
      .withIndex("by_day", (q) => q.lt("dayStart", cutoffDayStart))
      .take(PRUNE_BATCH_SIZE);
    const remainingBatchSize = PRUNE_BATCH_SIZE - staleDownloads.length;
    const staleInstalls =
      remainingBatchSize > 0
        ? await ctx.db
            .query("packageInstallMetricDedupes")
            .withIndex("by_day", (q) => q.lt("dayStart", cutoffDayStart))
            .take(remainingBatchSize)
        : [];

    for (const entry of staleDownloads) {
      await ctx.db.delete(entry._id);
    }
    for (const entry of staleInstalls) {
      await ctx.db.delete(entry._id);
    }

    const deleted = staleDownloads.length + staleInstalls.length;
    const hasMore = deleted === PRUNE_BATCH_SIZE;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.downloadMetrics.pruneDownloadMetricDedupesInternal,
        {},
      );
    }

    return { deleted, hasMore };
  },
});

function getDayStart(timestamp: number) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

export const __test = {
  getDayStart,
  getDownloadIdentity,
};
