import { type Infer, v } from "convex/values";

// Schema evaluation must not import the classifier's storage, model, or registry dependencies.
export const pluginCategoryClassificationValidator = v.object({
  source: v.union(
    v.literal("manifest"),
    v.literal("generated"),
    v.literal("fallback"),
    v.literal("bundled"),
  ),
  classifierVersion: v.string(),
  inputHash: v.string(),
  evidence: v.string(),
});

export type PluginCategoryClassification = Infer<typeof pluginCategoryClassificationValidator>;
