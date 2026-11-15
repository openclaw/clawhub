import { type Infer, v } from "convex/values";

export const catalogTargetKindValidator = v.union(v.literal("skill"), v.literal("plugin"));
export const catalogClassificationConfidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);
const categoryCandidateValidator = v.object({
  category: v.string(),
  score: v.number(),
  sources: v.array(v.string()),
  evidence: v.array(v.string()),
  strongEvidence: v.optional(v.boolean()),
  primaryEvidence: v.optional(v.boolean()),
  strongPrimaryEvidence: v.optional(v.boolean()),
  primaryEvidenceCount: v.optional(v.number()),
});
const topicCandidateValidator = v.object({
  topic: v.string(),
  slug: v.string(),
  score: v.number(),
  sources: v.array(v.string()),
  evidence: v.array(v.string()),
  primaryEvidence: v.boolean(),
  primarySourceCount: v.number(),
  strongEvidence: v.boolean(),
  confidence: catalogClassificationConfidenceValidator,
  suppressedBy: v.optional(v.string()),
});

export const catalogClassificationResultValidator = v.object({
  targetKind: catalogTargetKindValidator,
  skillId: v.optional(v.id("skills")),
  packageId: v.optional(v.id("packages")),
  skillVersionId: v.optional(v.id("skillVersions")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  categories: v.array(v.string()),
  topics: v.array(v.string()),
  categoryCandidates: v.array(categoryCandidateValidator),
  topicCandidates: v.array(topicCandidateValidator),
  categoryCandidateCount: v.number(),
  topicCandidateCount: v.number(),
  categoryConfidence: catalogClassificationConfidenceValidator,
  topicConfidence: catalogClassificationConfidenceValidator,
  categoryNeedsReview: v.boolean(),
  topicNeedsReview: v.boolean(),
  unknownSignals: v.array(v.string()),
  classifierVersion: v.string(),
  topicClassifierVersion: v.string(),
  inputHash: v.string(),
  topicInputHash: v.string(),
});

export type CatalogClassificationConfidence = Infer<
  typeof catalogClassificationConfidenceValidator
>;
export type CatalogCategoryCandidate = Infer<typeof categoryCandidateValidator>;
export type CatalogTopicCandidate = Infer<typeof topicCandidateValidator>;
