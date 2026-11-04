import { type Infer, v } from "convex/values";

export const displayManifestStatusValidator = v.union(
  v.literal("ok"),
  v.literal("missing"),
  v.literal("invalid"),
  v.literal("failed"),
);

export const displayManifestValidator = v.object({
  notGrouped: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
  groupings: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      skills: v.array(v.string()),
    }),
  ),
});

export type DisplayManifestStatus = Infer<typeof displayManifestStatusValidator>;
export type DisplayManifest = Infer<typeof displayManifestValidator>;
