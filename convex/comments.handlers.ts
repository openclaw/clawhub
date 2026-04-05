import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { assertModerator, requireUser } from "./lib/access";
import { requireGitHubAccountAge } from "./lib/githubAccount";
import {
  AUTO_HIDE_REPORT_THRESHOLD,
  MAX_ACTIVE_REPORTS_PER_USER,
  MAX_REPORT_REASON_LENGTH,
} from "./lib/reporting";
import { insertStatEvent } from "./skillStatEvents";

export async function addHandler(ctx: MutationCtx, args: { skillId: Id<"skills">; body: string }) {
  const { userId } = await requireUser(ctx);
  await requireGitHubAccountAge(ctx, userId);

  const body = args.body.trim();
  if (!body) throw new Error("Comment body required");

  const skill = await ctx.db.get(args.skillId);
  if (!skill) throw new Error("Skill not found");

  await ctx.db.insert("comments", {
    skillId: args.skillId,
    userId,
    body,
    createdAt: Date.now(),
    softDeletedAt: undefined,
    deletedBy: undefined,
  });

  await insertStatEvent(ctx, { skillId: skill._id, kind: "comment" });
}

export async function removeHandler(ctx: MutationCtx, args: { commentId: Id<"comments"> }) {
  const { user } = await requireUser(ctx);
  const comment = await ctx.db.get(args.commentId);
  if (!comment) throw new Error("Comment not found");
  if (comment.softDeletedAt) return;

  const isOwner = comment.userId === user._id;
  if (!isOwner) {
    assertModerator(user);
  }

  await ctx.db.patch(comment._id, {
    softDeletedAt: Date.now(),
    deletedBy: user._id,
  });

  await insertStatEvent(ctx, { skillId: comment.skillId, kind: "uncomment" });

  await ctx.db.insert("auditLogs", {
    actorUserId: user._id,
    action: "comment.delete",
    targetType: "comment",
    targetId: comment._id,
    metadata: { skillId: comment.skillId },
    createdAt: Date.now(),
  });
}

async function countActiveReportsForUser(ctx: MutationCtx, userId: Id<"users">) {
  const reports = await ctx.db
    .query("commentReports")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  let count = 0;
  for (const report of reports) {
    const comment = await ctx.db.get(report.commentId);
    if (!comment || comment.softDeletedAt) continue;
    const skill = await ctx.db.get(comment.skillId);
    if (!skill || skill.softDeletedAt || skill.moderationStatus === "removed") continue;
    const owner = await ctx.db.get(comment.userId);
    if (!owner || owner.deletedAt || owner.deactivatedAt) continue;
    count += 1;
    if (count >= MAX_ACTIVE_REPORTS_PER_USER) break;
  }

  return count;
}

export async function reportHandler(
  ctx: MutationCtx,
  args: { commentId: Id<"comments">; reason: string },
) {
  const { userId } = await requireUser(ctx);
  const comment = await ctx.db.get(args.commentId);
  if (!comment || comment.softDeletedAt) {
    throw new Error("Comment not found");
  }
  const skill = await ctx.db.get(comment.skillId);
  if (!skill || skill.softDeletedAt || skill.moderationStatus === "removed") {
    throw new Error("Comment not found");
  }

  const reason = args.reason.trim();
  if (!reason) {
    throw new Error("Report reason required.");
  }

  const existing = await ctx.db
    .query("commentReports")
    .withIndex("by_comment_user", (q) => q.eq("commentId", args.commentId).eq("userId", userId))
    .unique();
  if (existing) return { ok: true as const, reported: false, alreadyReported: true };

  const activeReports = await countActiveReportsForUser(ctx, userId);
  if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
    throw new Error("Report limit reached. Please wait for moderation before reporting more.");
  }

  const now = Date.now();
  await ctx.db.insert("commentReports", {
    commentId: args.commentId,
    skillId: comment.skillId,
    userId,
    reason: reason.slice(0, MAX_REPORT_REASON_LENGTH),
    createdAt: now,
  });

  const nextReportCount = (comment.reportCount ?? 0) + 1;
  const shouldAutoHide = nextReportCount > AUTO_HIDE_REPORT_THRESHOLD && !comment.softDeletedAt;
  const updates: {
    reportCount: number;
    lastReportedAt: number;
    softDeletedAt?: number;
  } = {
    reportCount: nextReportCount,
    lastReportedAt: now,
  };
  if (shouldAutoHide) {
    updates.softDeletedAt = now;
  }
  await ctx.db.patch(comment._id, updates);

  if (shouldAutoHide) {
    await insertStatEvent(ctx, { skillId: comment.skillId, kind: "uncomment" });

    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "comment.auto_hide",
      targetType: "comment",
      targetId: comment._id,
      metadata: { skillId: comment.skillId, reportCount: nextReportCount },
      createdAt: now,
    });
  }

  return { ok: true as const, reported: true, alreadyReported: false };
}
