import { v } from "convex/values";
import { internalMutation } from "./functions";

export const markStatusInternal = internalMutation({
  args: {
    requestId: v.id("rescanRequests"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.requestId, {
      status: args.status,
      error: args.error,
      updatedAt: now,
      completedAt: now,
    });
  },
});
