import { type inferred, type } from "arktype";
import {
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
  PluginManifestSummarySchema as RegistryPluginManifestSummarySchema,
} from "./packageShared.js";
import { CliPublishFileSchema, PublishSourceSchema } from "./schemas.js";
import { TemplateManifestSummarySchema } from "./templates.js";

export * from "./packageShared.js";
export * from "./packageUploadLimits.js";

export const PluginManifestSummarySchema = RegistryPluginManifestSummarySchema.omit(
  "contracts",
  "providers",
  "channels",
  "categories",
);
export type PluginManifestSummary = (typeof PluginManifestSummarySchema)[inferred];

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
  scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"?',
});
export type PackageVerificationSummary = (typeof PackageVerificationSummarySchema)[inferred];

export const PackageSkillSpectorAnalysisSchema = type({
  status: "string",
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

const PackagePublishMetadataFields = {
  name: "string",
  displayName: "string?",
  ownerHandle: "string?",
  family: PackageFamilySchema,
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

export const PackageListItemSchema = type({
  name: "string",
  displayName: "string",
  family: PackageFamilySchema,
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
  verificationTier: PackageVerificationTierSchema.or("null").optional(),
  stats: PackageStatsSchema.optional(),
});
export type PackageListItem = (typeof PackageListItemSchema)[inferred];

export const ApiV1PackageListResponseSchema = type({
  items: PackageListItemSchema.array(),
  nextCursor: "string|null",
});

export const ApiV1PackageSearchResponseSchema = type({
  results: type({
    score: "number",
    package: PackageListItemSchema,
  }).array(),
});

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
