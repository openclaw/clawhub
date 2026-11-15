import { type Infer, v } from "convex/values";

export const packagePublishActorValidator = v.optional(
  v.union(
    v.object({
      kind: v.literal("user"),
      userId: v.id("users"),
    }),
    v.object({
      kind: v.literal("github-actions"),
      repository: v.string(),
      workflow: v.string(),
      runId: v.string(),
      runAttempt: v.string(),
      sha: v.string(),
    }),
  ),
);

export const packageTemplateInventoryValidator = v.optional(
  v.array(
    v.union(
      v.object({
        kind: v.union(v.literal("skill"), v.literal("plugin")),
        source: v.literal("clawhub"),
        ref: v.string(),
        version: v.string(),
      }),
      v.object({
        kind: v.union(v.literal("skill"), v.literal("plugin")),
        source: v.literal("bundled"),
        path: v.string(),
        name: v.optional(v.string()),
      }),
    ),
  ),
);

export type PackagePublishActor = NonNullable<Infer<typeof packagePublishActorValidator>>;
