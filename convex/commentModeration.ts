import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export async function retiredCommentModerationHandler() {
  return { ok: true as const, retired: true as const };
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
  handler: retiredCommentModerationHandler,
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
  handler: retiredCommentModerationHandler,
});
