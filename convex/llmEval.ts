import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const llmEvalModerationModeValidator = v.optional(
  v.union(v.literal("normal"), v.literal("preserve")),
);

const suspiciousSkillLlmRescanBucketValidator = v.union(
  v.literal("all"),
  v.literal("llm-only"),
  v.literal("vt-only"),
  v.literal("both"),
);

export async function retiredLlmEvalHandler() {
  return { ok: true as const, retired: true as const };
}

export const evaluateWithLlm = internalAction({
  args: {
    versionId: v.id("skillVersions"),
    moderationMode: llmEvalModerationModeValidator,
  },
  handler: retiredLlmEvalHandler,
});

export const evaluatePackageReleaseWithLlm = internalAction({
  args: {
    releaseId: v.id("packageReleases"),
  },
  handler: retiredLlmEvalHandler,
});

export const evaluateBySlug = internalAction({
  args: {
    slug: v.string(),
  },
  handler: retiredLlmEvalHandler,
});

export const backfillLlmEval = internalAction({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    maxToSchedule: v.optional(v.number()),
    moderationMode: llmEvalModerationModeValidator,
    accTotal: v.optional(v.number()),
    accScheduled: v.optional(v.number()),
    accSkipped: v.optional(v.number()),
    startTime: v.optional(v.number()),
  },
  handler: retiredLlmEvalHandler,
});

export const scheduleSuspiciousSkillLlmRescanInternal = internalAction({
  args: {
    bucket: suspiciousSkillLlmRescanBucketValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    pageDelayMs: v.optional(v.number()),
    evalDelayStepMs: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    maxToSchedule: v.optional(v.number()),
    moderationMode: llmEvalModerationModeValidator,
    accExamined: v.optional(v.number()),
    accScheduled: v.optional(v.number()),
    accSkipped: v.optional(v.number()),
    startTime: v.optional(v.number()),
  },
  handler: retiredLlmEvalHandler,
});

export const scheduleSuspiciousPluginLlmRescanInternal = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    pageDelayMs: v.optional(v.number()),
    evalDelayStepMs: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    maxToSchedule: v.optional(v.number()),
    accExamined: v.optional(v.number()),
    accScheduled: v.optional(v.number()),
    accSkipped: v.optional(v.number()),
    startTime: v.optional(v.number()),
  },
  handler: retiredLlmEvalHandler,
});

export const countSuspiciousInventoryInternal = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: retiredLlmEvalHandler,
});

export const evaluateCommentForScam = internalAction({
  args: {
    commentId: v.id("comments"),
    skillId: v.id("skills"),
    userId: v.id("users"),
    body: v.string(),
  },
  handler: retiredLlmEvalHandler,
});
