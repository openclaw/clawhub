import { type Infer, v } from "convex/values";

export const packageInspectorIssueInputValidator = v.object({
  id: v.optional(v.string()),
  code: v.string(),
  severity: v.optional(v.string()),
  level: v.optional(v.string()),
  issueClass: v.optional(v.string()),
  compatStatus: v.optional(v.string()),
  deprecated: v.optional(v.boolean()),
  deprecatedApi: v.optional(v.string()),
  replacement: v.optional(v.string()),
  removeAfter: v.optional(v.string()),
  message: v.string(),
  evidence: v.optional(v.array(v.string())),
  authorRemediation: v.optional(
    v.object({
      summary: v.string(),
      docsUrl: v.optional(v.string()),
    }),
  ),
  fixture: v.optional(v.string()),
  decision: v.optional(v.string()),
});

export type PackageInspectorFinding = Infer<typeof packageInspectorIssueInputValidator>;
export type PackageInspectorAuthorRemediation = NonNullable<
  PackageInspectorFinding["authorRemediation"]
>;
