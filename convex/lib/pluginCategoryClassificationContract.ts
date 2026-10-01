import { type Infer, v } from "convex/values";

// Schema evaluation must not import the classifier's storage, model, or registry dependencies.
const classificationEvidence = v.object({
  classifierVersion: v.string(),
  inputHash: v.string(),
  evidence: v.string(),
});
export const pluginCategoryClassificationValidator = v.union(
  classificationEvidence.extend({
    source: v.union(
      v.literal("manifest"),
      v.literal("generated"),
      v.literal("fallback"),
      v.literal("bundled"),
    ),
  }),
  classificationEvidence.extend({
    source: v.literal("reviewed"),
    reviewId: v.id("pluginCategoryRefreshes"),
  }),
);
export const pluginCategoryCorrectionValidator = v.object({
  id: v.id("pluginCategoryRefreshes"),
  category: v.string(),
  evidence: v.string(),
});
export const pluginCategoryReviewProvenanceValidator = v.object({
  actor: v.string(),
  repository: v.literal("openclaw/clawhub"),
  runId: v.string(),
  runAttempt: v.string(),
  sha: v.string(),
});
export const pluginCategoryReviewValidator = pluginCategoryCorrectionValidator.omit("id").extend({
  sourceHash: v.string(),
  provenance: pluginCategoryReviewProvenanceValidator,
});
export type PluginCategoryClassification = Infer<typeof pluginCategoryClassificationValidator>;
