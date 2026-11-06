import { v } from "convex/values";

// Stored alongside the exact artifact's inspection result, not publisher declarations.
export const intermediaryAnalysisValidator = v.object({
  requiresIntermediary: v.union(v.boolean(), v.null()),
  intermediaryDetails: v.union(v.string(), v.null()),
  checkedAt: v.number(),
  recipe: v.string(),
  model: v.string(),
  evidence: v.array(v.object({ path: v.string(), snippet: v.string() })),
});
