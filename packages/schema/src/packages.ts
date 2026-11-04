import { type inferred, type } from "arktype";
import {
  ApiV1PackageSecurityResponseSchema,
  ApiV1PackageVersionListResponseSchema,
  BundlePublishMetadataSchema,
  PackageAigAnalysisSchema,
  PackageArtifactSummarySchema,
  PackageChannelSchema,
  PackageCompatibilitySchema,
  PackageEndorAnalysisSchema,
  PackageFamilySchema,
  PackageLlmAnalysisSchema,
  PackagePublishArtifactSchema,
  PackageSkillSpectorIssueSchema,
  PackageStaticScanSchema,
  PackageStatsSchema,
  PackageVerificationScopeSchema,
  PackageVerificationTierSchema,
  PackageVtAnalysisSchema,
  PluginManifestSummarySchema,
} from "./packageShared.js";
import { CliPublishFileSchema, PublishSourceSchema } from "./schemas.js";
import { TemplateManifestSummarySchema } from "./templates.js";

export * from "./packageShared.js";

export const PACKAGE_TRENDING_LEADERBOARD_LIMIT = 200;
export const PACKAGE_CATEGORY_BATCH_LIMIT = 200;

export {
  normalizePackageOwnerHandle,
  inferPackageNameScope,
  getPackageScopeOwnerMismatch,
} from "./packageNames.js";

export const PackagePublishFamilySchema = type('"skill"|"code-plugin"|"bundle-plugin"|"template"');
export type PackagePublishFamily = (typeof PackagePublishFamilySchema)[inferred];

const PackageVersionIdentitySchema = type({
  "+": "reject",
  name: "string",
  version: "string",
});

export const ApiV1PackageCategoriesBatchRequestSchema = type({
  "+": "reject",
  packages: PackageVersionIdentitySchema.array(),
});
export type ApiV1PackageCategoriesBatchRequest =
  (typeof ApiV1PackageCategoriesBatchRequestSchema)[inferred];

export const ApiV1PackageCategoriesBatchResponseSchema = type({
  "+": "reject",
  packages: type({
    "+": "reject",
    name: "string",
    version: "string",
    categories: "string[]|null",
  }).array(),
});
export type ApiV1PackageCategoriesBatchResponse =
  (typeof ApiV1PackageCategoriesBatchResponseSchema)[inferred];

export const PackageVerificationSummarySchema = type({
  tier: PackageVerificationTierSchema,
  scope: PackageVerificationScopeSchema,
  summary: "string?",
  sourceRepo: "string?",
  sourceCommit: "string?",
  sourceTag: "string?",
  // Path of the package directory inside the source repo (e.g.
  // "examples/openclaw-plugin"). Forward slash separated, no leading or
  // trailing slash. Used when resolving relative README asset URLs against
  // raw.githubusercontent.com so that subdirectory packages render correctly.
  // Absent or "." means the package lives at the repo root.
  sourcePath: "string?",
  hasProvenance: "boolean?",
  trustedOpenClawPlugin: "boolean?",
  scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"?',
});
export type PackageVerificationSummary = (typeof PackageVerificationSummarySchema)[inferred];

export const PackageSkillSpectorAnalysisSchema = type({
  status: "string",
  "inspectionStatus?": '"completed"|"partial"',
  score: "number?",
  severity: "string?",
  recommendation: "string?",
  issueCount: "number",
  issues: PackageSkillSpectorIssueSchema.array(),
  scannerVersion: "string?",
  summary: "string?",
  error: "string?",
  checkedAt: "number",
});
export type PackageSkillSpectorAnalysis = (typeof PackageSkillSpectorAnalysisSchema)[inferred];

export {
  MAX_PACKAGE_MULTIPART_BYTES,
  MAX_PACKAGE_CLAWPACK_BYTES,
  estimatePackageMultipartUploadBytes,
  isPackageMultipartUploadTooLarge,
  getPackageMultipartSizeError,
  type PackageMultipartUploadField,
  type PackageMultipartUploadPart,
  type PackageMultipartUploadSizeInput,
} from "./packageUploadLimits.js";

const PackagePublishMetadataFields = {
  name: "string",
  displayName: "string?",
  ownerHandle: "string?",
  family: PackagePublishFamilySchema,
  version: "string",
  changelog: "string",
  expectedArtifactSha256: "string?",
  manualOverrideReason: "string?",
  channel: PackageChannelSchema.optional(),
  tags: "string[]?",
  categories: "string[]?",
  topics: "string[]?",
  source: PublishSourceSchema.optional(),
  bundle: BundlePublishMetadataSchema.optional(),
} as const;

export const PackagePublishMetadataSchema = type({
  "+": "reject",
  ...PackagePublishMetadataFields,
});
export type PackagePublishMetadata = (typeof PackagePublishMetadataSchema)[inferred];

export const ServerPackagePublishRequestSchema = type({
  "+": "reject",
  ...PackagePublishMetadataFields,
  artifact: PackagePublishArtifactSchema.optional(),
  files: CliPublishFileSchema.array(),
});
export type ServerPackagePublishRequest = (typeof ServerPackagePublishRequestSchema)[inferred];

const PackageListItemFields = {
  name: "string",
  displayName: "string",
  family: PackageFamilySchema,
  runtimeId: "string|null?",
  channel: PackageChannelSchema,
  isOfficial: "boolean",
  summary: "string|null?",
  icon: "string|null?",
  ownerHandle: "string|null?",
  ownerImage: "string|null?",
  ownerOfficial: "boolean?",
  createdAt: "number",
  updatedAt: "number",
  latestVersion: "string|null?",
  categories: "string[]?",
  topics: "string[]?",
  featuredAt: "number?",
  trending24h: type({
    downloads: "number",
    installs: "number",
    windowStart: "number",
    windowEnd: "number",
  }).optional(),
  verificationTier: PackageVerificationTierSchema.or("null").optional(),
  stats: PackageStatsSchema.optional(),
} as const;

export const PackageListItemSchema = type(PackageListItemFields);
export type PackageListItem = (typeof PackageListItemSchema)[inferred];

export const PluginOverviewItemSchema = type({
  "+": "reject",
  ...PackageListItemFields,
  featured: "boolean?",
  featuredRank: "number?",
  trending: "boolean?",
  trendingRank: "number?",
});
export type PluginOverviewItem = (typeof PluginOverviewItemSchema)[inferred];

export const PluginDiscoveryCategorySchema = type({
  "+": "reject",
  slug: "string",
  label: "string",
  description: "string",
  icon: "string",
  order: "number",
  pinnedPackages: "string[]?",
});

export const ApiV1PluginOverviewResponseSchema = type({
  "+": "reject",
  categories: PluginDiscoveryCategorySchema.array(),
  items: PluginOverviewItemSchema.array(),
});
export type ApiV1PluginOverviewResponse = (typeof ApiV1PluginOverviewResponseSchema)[inferred];

export const ApiV1PackageListResponseSchema = type({
  items: PackageListItemSchema.array(),
  nextCursor: "string|null",
  categories: PluginDiscoveryCategorySchema.array().optional(),
});
export type ApiV1PackageListResponse = (typeof ApiV1PackageListResponseSchema)[inferred];

export const ApiV1PackageSearchResponseSchema = type({
  results: type({
    score: "number",
    package: PackageListItemSchema,
  }).array(),
});
export type ApiV1PackageSearchResponse = (typeof ApiV1PackageSearchResponseSchema)[inferred];

export const ApiV1PackageResponseSchema = type({
  package: type({
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
    templateProfilePolicyVersion: "1?",
    runtimeId: "string|null?",
    channel: PackageChannelSchema,
    isOfficial: "boolean",
    summary: "string|null?",
    icon: "string|null?",
    ownerHandle: "string|null?",
    createdAt: "number",
    updatedAt: "number",
    latestVersion: "string|null?",
    categories: "string[]?",
    topics: "string[]?",
    tags: "unknown",
    compatibility: PackageCompatibilitySchema.or("null").optional(),
    pluginManifestSummary: PluginManifestSummarySchema.or("null").optional(),
    templateManifestSummary: TemplateManifestSummarySchema.or("null").optional(),
    verification: PackageVerificationSummarySchema.or("null").optional(),
    artifact: PackageArtifactSummarySchema.or("null").optional(),
    scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"?',
    stats: PackageStatsSchema.optional(),
  }).or("null"),
  owner: type({
    handle: "string|null",
    displayName: "string|null?",
    image: "string|null?",
    // Response readers also accept registries predating the publisher badge field.
    official: "boolean?",
  }).or("null"),
});
export type ApiV1PackageResponse = (typeof ApiV1PackageResponseSchema)[inferred];
export type ApiV1PackageVersionListResponse =
  (typeof ApiV1PackageVersionListResponseSchema)[inferred];

export const ApiV1PackageVersionResponseSchema = type({
  package: type({
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
  }).or("null"),
  version: type({
    version: "string",
    createdAt: "number",
    changelog: "string",
    icon: "string|null?",
    distTags: "string[]?",
    files: "unknown",
    compatibility: PackageCompatibilitySchema.or("null").optional(),
    pluginManifestSummary: PluginManifestSummarySchema.or("null").optional(),
    templateManifestSummary: TemplateManifestSummarySchema.or("null").optional(),
    verification: PackageVerificationSummarySchema.or("null").optional(),
    artifact: PackageArtifactSummarySchema.or("null").optional(),
    // Deprecated compatibility hash for exact /download ZIP bytes; use artifact.sha256 for installs.
    sha256hash: "string|null?",
    vtAnalysis: PackageVtAnalysisSchema.or("null").optional(),
    skillSpectorAnalysis: PackageSkillSpectorAnalysisSchema.or("null").optional(),
    endorAnalysis: PackageEndorAnalysisSchema.or("null").optional(),
    aigAnalysis: PackageAigAnalysisSchema.or("null").optional(),
    llmAnalysis: PackageLlmAnalysisSchema.or("null").optional(),
    staticScan: PackageStaticScanSchema.or("null").optional(),
  }).or("null"),
});
export type ApiV1PackageVersionResponse = (typeof ApiV1PackageVersionResponseSchema)[inferred];

export const ApiV1PackageVersionPublicationResponseSchema = type({
  name: "string",
  version: "string",
  state: '"published"|"absent"',
})
  .or({ name: "string", version: "string", state: '"pending"', stage: '"staging"' })
  .or({
    name: "string",
    version: "string",
    state: '"pending"',
    stage: '"checks"|"finalization"',
    attemptId: "string",
  })
  .or({
    name: "string",
    version: "string",
    state: '"failed"',
    "attemptId?": "string",
    recoverable: "boolean",
  })
  .onUndeclaredKey("reject");
export type ApiV1PackageVersionPublicationResponse =
  (typeof ApiV1PackageVersionPublicationResponseSchema)[inferred];

export const ApiV1PluginDetailResponseSchema = ApiV1PackageResponseSchema.and({
  versions: ApiV1PackageVersionListResponseSchema,
  version: ApiV1PackageVersionResponseSchema.get("version"),
  readme: "string|null",
  security: ApiV1PackageSecurityResponseSchema.or("null"),
});
export type ApiV1PluginDetailResponse = (typeof ApiV1PluginDetailResponseSchema)[inferred];
