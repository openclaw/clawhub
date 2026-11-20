import { v } from "convex/values";

export const skillsShMirrorDetailValidator = v.object({
  contentKind: v.union(v.literal("skill-md"), v.literal("readme")),
  path: v.string(),
  content: v.string(),
  contentBytes: v.number(),
  sourceBytes: v.number(),
  sourceFileCount: v.number(),
  truncated: v.boolean(),
});

const upstreamScannerValidator = v.object({
  status: v.string(),
  sourceCheckedAt: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

const upstreamScannersValidator = v.object({
  genAgentTrustHub: upstreamScannerValidator,
  socket: upstreamScannerValidator,
  snyk: upstreamScannerValidator,
});

const classificationConfidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const skillsShMirrorSourceRowValidator = v.object({
  id: v.string(),
  installUrl: v.union(v.string(), v.null()),
  installs: v.number(),
  name: v.string(),
  slug: v.string(),
  source: v.string(),
  sourceType: v.string(),
  url: v.string(),
});

export const skillsShMirrorRowValidator = v.object({
  externalId: v.string(),
  sourceType: v.union(v.literal("github"), v.literal("well-known")),
  upstreamSourceType: v.string(),
  owner: v.optional(v.string()),
  repo: v.optional(v.string()),
  sourceHost: v.optional(v.string()),
  slug: v.string(),
  displayName: v.string(),
  sourceUrl: v.string(),
  canonicalRepoUrl: v.optional(v.string()),
  githubPath: v.optional(v.string()),
  githubCommit: v.optional(v.string()),
  sourceContentHash: v.optional(v.string()),
  upstreamInstalls: v.number(),
  upstreamScanners: upstreamScannersValidator,
  inferredCategories: v.array(v.string()),
  inferredTopics: v.array(v.string()),
  inferredCategoryConfidence: classificationConfidenceValidator,
  inferredTopicConfidence: classificationConfidenceValidator,
  inferredClassifierVersion: v.string(),
  inferredTopicClassifierVersion: v.string(),
  inferredInputHash: v.string(),
  inferredTopicInputHash: v.string(),
  inferredAt: v.number(),
  detail: v.optional(skillsShMirrorDetailValidator),
});

// Older stored mirrors can predate source classification; new observations require it.
export const skillsShMirrorStoredRowValidator = v.object({
  ...skillsShMirrorRowValidator.omit("detail").fields,
  ...skillsShMirrorRowValidator
    .pick(
      "upstreamSourceType",
      "inferredCategories",
      "inferredTopics",
      "inferredCategoryConfidence",
      "inferredTopicConfidence",
      "inferredClassifierVersion",
      "inferredTopicClassifierVersion",
      "inferredInputHash",
      "inferredTopicInputHash",
      "inferredAt",
    )
    .partial().fields,
});
