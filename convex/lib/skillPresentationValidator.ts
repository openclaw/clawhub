import { v } from "convex/values";

export const skillPresentationValidator = v.object({
  displayName: v.string(),
  displayNameSource: v.optional(
    v.union(v.literal("publisher"), v.literal("openai"), v.literal("skill"), v.literal("slug")),
  ),
  summary: v.optional(v.string()),
  summarySource: v.optional(
    v.union(
      v.literal("publisher"),
      v.literal("openai"),
      v.literal("skill"),
      v.literal("generated"),
    ),
  ),
  icon: v.optional(v.string()),
});
