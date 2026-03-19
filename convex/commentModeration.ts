import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery } from "./functions";
import { assertRole, requireUserFromAction } from "./lib/access";
import {
  buildCommentScamBanReason,
  isCertainScam,
  type CommentScamConfidence,
  type CommentScamVerdict,
} from "./lib/commentScamPrompt";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_BATCHES = 10;
const MAX_MAX_BATCHES = 200;

type CommentBackfillPageItem = {
  commentId: Id<"comments">;
  skillId: Id<"skills">;
  userId: Id<"users">;
  body: string;
  softDeletedAt?: number;
  scamScanCheckedAt?: number;
};

type CommentBackfillPageResult = {
  items: CommentBackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type ApplyCommentScamResult = {
  ok: true;
  shouldBan: boolean;
  banned: boolean;
  alreadyBanned: boolean;
  protectedRole: boolean;
  wouldBan: boolean;
};

export type CommentScamBackfillStats = {
  commentsScanned: number;
  commentsEvaluated: number;
  certainScams: number;
  banCandidates: number;
  usersBanned: number;
  usersAlreadyBanned: number;
  usersWouldBeBanned: number;
  protectedRoleSkips: number;
  skippedSoftDeleted: number;
  skippedAlreadyScanned: number;
  skippedEmptyBody: number;
  evalErrors: number;
};

export type CommentScamBackfillActionArgs = {
  actorUserId: Id<"users">;
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  cursor?: string;
  rescan?: boolean;
  includeSoftDeleted?: boolean;
};

export type CommentScamBackfillActionResult = {
  ok: true;
  stats: CommentScamBackfillStats;
  isDone: boolean;
  cursor: string | null;
};

export const getCommentScamBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CommentBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("comments")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    return {
      items: page.map((comment) => ({
        commentId: comment._id,
        skillId: comment.skillId,
        userId: comment.userId,
        body: comment.body,
        softDeletedAt: comment.softDeletedAt,
        scamScanCheckedAt: comment.scamScanCheckedAt,
      })),
      cursor: continueCursor,
      isDone,
    };
  },
});

export async function applyCommentScamResultInternalHandler(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    commentId: Id<"comments">;
    verdict: CommentScamVerdict;
    confidence: CommentScamConfidence;
    explanation: string;
    evidence: string[];
    model: string;
    checkedAt: number;
    dryRun?: boolean;
  },
): Promise<ApplyCommentScamResult> {
  const comment = await ctx.db.get(args.commentId);
  if (!comment) {
    throw new ConvexError("Comment not found");
  }

  const user = await ctx.db.get(comment.userId);
  if (!user) {
    throw new ConvexError("Comment author not found");
  }

  const dryRun = Boolean(args.dryRun);
  const shouldBan = isCertainScam({
    verdict: args.verdict,
    confidence: args.confidence,
  });

  const explanation = args.explanation.trim().slice(0, 1200);
  const evidence = args.evidence
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!dryRun) {
    await ctx.db.patch(comment._id, {
      scamScanVerdict: args.verdict,
      scamScanConfidence: args.confidence,
      scamScanExplanation: explanation,
      scamScanEvidence: evidence,
      scamScanModel: args.model,
      scamScanCheckedAt: args.checkedAt,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "comment.scam_scan",
      targetType: "comment",
      targetId: comment._id,
      metadata: {
        skillId: comment.skillId,
        commentAuthorId: comment.userId,
        verdict: args.verdict,
        confidence: args.confidence,
        shouldBan,
        model: args.model,
      },
      createdAt: args.checkedAt,
    });
  }

  if (!shouldBan) {
    return {
      ok: true,
      shouldBan,
      banned: false,
      alreadyBanned: false,
      protectedRole: false,
      wouldBan: false,
    };
  }

  if (user.role === "admin" || user.role === "moderator") {
    return {
      ok: true,
      shouldBan,
      banned: false,
      alreadyBanned: false,
      protectedRole: true,
      wouldBan: false,
    };
  }

  if (user.deletedAt || user.deactivatedAt) {
    return {
      ok: true,
      shouldBan,
      banned: false,
      alreadyBanned: true,
      protectedRole: false,
      wouldBan: false,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      shouldBan,
      banned: false,
      alreadyBanned: false,
      protectedRole: false,
      wouldBan: true,
    };
  }

  const reason = buildCommentScamBanReason({
    commentId: String(comment._id),
    skillId: String(comment.skillId),
    explanation,
    evidence,
  });

  const banResult = await ctx.runMutation(internal.users.banUserInternal, {
    actorUserId: args.actorUserId,
    targetUserId: comment.userId,
    reason,
  });

  if (!banResult.alreadyBanned) {
    await ctx.db.patch(comment._id, {
      scamBanTriggeredAt: args.checkedAt,
    });
  }

  return {
    ok: true,
    shouldBan,
    banned: !banResult.alreadyBanned,
    alreadyBanned: Boolean(banResult.alreadyBanned),
    protectedRole: false,
    wouldBan: false,
  };
}

export const applyCommentScamResultInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    commentId: v.id("comments"),
    verdict: v.union(v.literal("not_scam"), v.literal("likely_scam"), v.literal("certain_scam")),
    confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    explanation: v.string(),
    evidence: v.array(v.string()),
    model: v.string(),
    checkedAt: v.number(),
    dryRun: v.optional(v.boolean()),
  },
  handler: applyCommentScamResultInternalHandler,
});

export async function backfillCommentScamModerationInternalHandler(
  ctx: ActionCtx,
  args: CommentScamBackfillActionArgs,
): Promise<CommentScamBackfillActionResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ConvexError("OPENAI_API_KEY not configured");
  }

  const dryRun = Boolean(args.dryRun);
  const rescan = Boolean(args.rescan);
  const includeSoftDeleted = Boolean(args.includeSoftDeleted);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  const stats: CommentScamBackfillStats = {
    commentsScanned: 0,
    commentsEvaluated: 0,
    certainScams: 0,
    banCandidates: 0,
    usersBanned: 0,
    usersAlreadyBanned: 0,
    usersWouldBeBanned: 0,
    protectedRoleSkips: 0,
    skippedSoftDeleted: 0,
    skippedAlreadyScanned: 0,
    skippedEmptyBody: 0,
    evalErrors: 0,
  };

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(
      internal.commentModeration.getCommentScamBackfillPageInternal,
      {
        cursor: cursor ?? undefined,
        batchSize,
      },
    )) as CommentBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const comment of page.items) {
      stats.commentsScanned++;

      if (!includeSoftDeleted && comment.softDeletedAt) {
        stats.skippedSoftDeleted++;
        continue;
      }
      if (!rescan && comment.scamScanCheckedAt) {
        stats.skippedAlreadyScanned++;
        continue;
      }

      const body = comment.body.trim();
      if (!body) {
        stats.skippedEmptyBody++;
        continue;
      }

      const evalResult = (await ctx.runAction(internal.llmEval.evaluateCommentForScam, {
        commentId: comment.commentId,
        skillId: comment.skillId,
        userId: comment.userId,
        body,
      })) as
        | {
            ok: true;
            model: string;
            verdict: CommentScamVerdict;
            confidence: CommentScamConfidence;
            explanation: string;
            evidence: string[];
          }
        | { ok: false; error: string };

      if (!evalResult.ok) {
        stats.evalErrors++;
        continue;
      }

      stats.commentsEvaluated++;
      const shouldBan = isCertainScam(evalResult);
      if (evalResult.verdict === "certain_scam") {
        stats.certainScams++;
      }
      if (shouldBan) {
        stats.banCandidates++;
      }

      const applyResult = (await ctx.runMutation(
        internal.commentModeration.applyCommentScamResultInternal,
        {
          actorUserId: args.actorUserId,
          commentId: comment.commentId,
          verdict: evalResult.verdict,
          confidence: evalResult.confidence,
          explanation: evalResult.explanation,
          evidence: evalResult.evidence,
          model: evalResult.model,
          checkedAt: Date.now(),
          dryRun,
        },
      )) as ApplyCommentScamResult;

      if (applyResult.banned) stats.usersBanned++;
      if (applyResult.alreadyBanned) stats.usersAlreadyBanned++;
      if (applyResult.wouldBan) stats.usersWouldBeBanned++;
      if (applyResult.protectedRole) stats.protectedRoleSkips++;
    }

    if (isDone) break;
  }

  return {
    ok: true,
    stats,
    isDone,
    cursor,
  };
}

export const backfillCommentScamModerationInternal = internalAction({
  args: {
    actorUserId: v.id("users"),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    cursor: v.optional(v.string()),
    rescan: v.optional(v.boolean()),
    includeSoftDeleted: v.optional(v.boolean()),
  },
  handler: backfillCommentScamModerationInternalHandler,
});

export const backfillCommentScamModeration: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    cursor: v.optional(v.string()),
    rescan: v.optional(v.boolean()),
    includeSoftDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CommentScamBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin", "moderator"]);

    return ctx.runAction(internal.commentModeration.backfillCommentScamModerationInternal, {
      actorUserId: user._id,
      ...args,
    }) as Promise<CommentScamBackfillActionResult>;
  },
});

export const continueCommentScamModerationJobInternal = internalAction({
  args: {
    actorUserId: v.id("users"),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
    rescan: v.optional(v.boolean()),
    includeSoftDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const result = await backfillCommentScamModerationInternalHandler(ctx, {
      actorUserId: args.actorUserId,
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      cursor: args.cursor,
      maxBatches: 1,
      rescan: args.rescan,
      includeSoftDeleted: args.includeSoftDeleted,
    });

    if (!result.isDone && result.cursor) {
      await ctx.scheduler.runAfter(
        2_000,
        internal.commentModeration.continueCommentScamModerationJobInternal,
        {
          actorUserId: args.actorUserId,
          dryRun: Boolean(args.dryRun),
          batchSize: args.batchSize ?? DEFAULT_BATCH_SIZE,
          cursor: result.cursor,
          rescan: Boolean(args.rescan),
          includeSoftDeleted: Boolean(args.includeSoftDeleted),
        },
      );
    }

    return result;
  },
});

export const scheduleCommentScamModeration: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    rescan: v.optional(v.boolean()),
    includeSoftDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin", "moderator"]);

    await ctx.scheduler.runAfter(
      0,
      internal.commentModeration.continueCommentScamModerationJobInternal,
      {
        actorUserId: user._id,
        dryRun: Boolean(args.dryRun),
        batchSize: clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
        cursor: undefined,
        rescan: Boolean(args.rescan),
        includeSoftDeleted: Boolean(args.includeSoftDeleted),
      },
    );

    return { ok: true as const };
  },
});

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
