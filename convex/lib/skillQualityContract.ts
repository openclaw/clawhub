import { type Infer, v } from "convex/values";

const qualitySignalsValidator = v.object({
  bodyChars: v.number(),
  bodyWords: v.number(),
  uniqueWordRatio: v.number(),
  headingCount: v.number(),
  bulletCount: v.number(),
  templateMarkerHits: v.number(),
  genericSummary: v.boolean(),
  cjkChars: v.optional(v.number()),
});

export const qualitySummaryValidator = v.object({
  score: v.number(),
  trustTier: v.union(v.literal("low"), v.literal("medium"), v.literal("trusted")),
  signals: qualitySignalsValidator,
});

export const qualityAssessmentValidator = qualitySummaryValidator.extend({
  decision: v.union(v.literal("pass"), v.literal("quarantine"), v.literal("reject")),
  reason: v.string(),
  similarRecentCount: v.number(),
});

export type StoredQualityAssessment = Infer<typeof qualityAssessmentValidator>;
