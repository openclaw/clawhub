import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { addHandler, removeHandler, reportHandler } from "./comments.handlers";
import { mutation, query } from "./functions";
import { type PublicUser, toPublicUser } from "./lib/public";

export const listBySkill = query({
  args: { skillId: v.id("skills"), limit: v.optional(v.number()) },
  handler: listBySkillHandler,
});

export async function listBySkillHandler(
  ctx: import("./_generated/server").QueryCtx,
  args: { skillId: import("./_generated/dataModel").Id<"skills">; limit?: number },
) {
  const limit = args.limit ?? 50;
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_skill", (q) => q.eq("skillId", args.skillId))
    .order("desc")
    .take(limit);

  const rows = await Promise.all(
    comments.map(
      async (comment): Promise<{ comment: Doc<"comments">; user: PublicUser } | null> => {
        if (comment.softDeletedAt) return null;
        const user = toPublicUser(await ctx.db.get(comment.userId));
        if (!user) return null;
        return { comment, user };
      },
    ),
  );
  return rows.filter((row): row is { comment: Doc<"comments">; user: PublicUser } => row !== null);
}

export const add = mutation({
  args: { skillId: v.id("skills"), body: v.string() },
  handler: addHandler,
});

export const remove = mutation({
  args: { commentId: v.id("comments") },
  handler: removeHandler,
});

export const report = mutation({
  args: { commentId: v.id("comments"), reason: v.string() },
  handler: reportHandler,
});
