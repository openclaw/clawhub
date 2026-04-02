import { type inferred, type } from "arktype";
import { CliPublishFileSchema, PublishSourceSchema } from "./schemas.js";

export const PackageFamilySchema = type('"skill"|"code-plugin"|"bundle-plugin"');
export type PackageFamily = (typeof PackageFamilySchema)[inferred];

export const PackageChannelSchema = type('"official"|"community"|"private"');
export type PackageChannel = (typeof PackageChannelSchema)[inferred];

export const PackageVerificationTierSchema = type(
  '"structural"|"source-linked"|"provenance-verified"|"rebuild-verified"',
);
export type PackageVerificationTier = (typeof PackageVerificationTierSchema)[inferred];

export const PackageVerificationScopeSchema = type('"artifact-only"|"dependency-graph-aware"');
export type PackageVerificationScope = (typeof PackageVerificationScopeSchema)[inferred];

export const PackageCompatibilitySchema = type({
  pluginApiRange: "string?",
  builtWithOpenClawVersion: "string?",
  pluginSdkVersion: "string?",
  minGatewayVersion: "string?",
});
export type PackageCompatibility = (typeof PackageCompatibilitySchema)[inferred];

export const PackageCapabilitySummarySchema = type({
  executesCode: "boolean",
  runtimeId: "string?",
  pluginKind: "string?",
  channels: "string[]?",
  providers: "string[]?",
  hooks: "string[]?",
  bundledSkills: "string[]?",
  setupEntry: "boolean?",
  configSchema: "boolean?",
  configUiHints: "boolean?",
  materializesDependencies: "boolean?",
  toolNames: "string[]?",
  commandNames: "string[]?",
  serviceNames: "string[]?",
  capabilityTags: "string[]?",
  httpRouteCount: "number?",
  bundleFormat: "string?",
  hostTargets: "string[]?",
});
export type PackageCapabilitySummary = (typeof PackageCapabilitySummarySchema)[inferred];

export const PackageVerificationSummarySchema = type({
  tier: PackageVerificationTierSchema,
  scope: PackageVerificationScopeSchema,
  summary: "string?",
  sourceRepo: "string?",
  sourceCommit: "string?",
  sourceTag: "string?",
  hasProvenance: "boolean?",
  scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"?',
});
export type PackageVerificationSummary = (typeof PackageVerificationSummarySchema)[inferred];

export const PackageVtAnalysisSchema = type({
  status: "string",
  verdict: "string?",
  analysis: "string?",
  source: "string?",
  checkedAt: "number",
});
export type PackageVtAnalysis = (typeof PackageVtAnalysisSchema)[inferred];

export const PackageLlmAnalysisDimensionSchema = type({
  name: "string",
  label: "string",
  rating: "string",
  detail: "string",
});
export type PackageLlmAnalysisDimension =
  (typeof PackageLlmAnalysisDimensionSchema)[inferred];

export const PackageLlmAnalysisSchema = type({
  status: "string",
  verdict: "string?",
  confidence: "string?",
  summary: "string?",
  dimensions: PackageLlmAnalysisDimensionSchema.array().optional(),
  guidance: "string?",
  findings: "string?",
  model: "string?",
  checkedAt: "number",
});
export type PackageLlmAnalysis = (typeof PackageLlmAnalysisSchema)[inferred];

export const PackageStaticFindingSchema = type({
  code: "string",
  severity: "string",
  file: "string",
  line: "number",
  message: "string",
  evidence: "string",
});
export type PackageStaticFinding = (typeof PackageStaticFindingSchema)[inferred];

export const PackageStaticScanSchema = type({
  status: "string",
  reasonCodes: "string[]",
  findings: PackageStaticFindingSchema.array(),
  summary: "string",
  engineVersion: "string",
  checkedAt: "number",
});
export type PackageStaticScan = (typeof PackageStaticScanSchema)[inferred];

export const BundlePublishMetadataSchema = type({
  id: "string?",
  format: "string?",
  hostTargets: "string[]?",
});
export type BundlePublishMetadata = (typeof BundlePublishMetadataSchema)[inferred];

export const PackageTrustedPublisherSchema = type({
  provider: '"github-actions"',
  repository: "string",
  repositoryId: "string",
  repositoryOwner: "string",
  repositoryOwnerId: "string",
  workflowFilename: "string",
  environment: "string?",
});
export type PackageTrustedPublisher = (typeof PackageTrustedPublisherSchema)[inferred];

export const PackagePublishRequestSchema = type({
  name: "string",
  displayName: "string?",
  ownerHandle: "string?",
  family: PackageFamilySchema,
  version: "string",
  changelog: "string",
  manualOverrideReason: "string?",
  channel: PackageChannelSchema.optional(),
  tags: "string[]?",
  source: PublishSourceSchema.optional(),
  bundle: BundlePublishMetadataSchema.optional(),
  files: CliPublishFileSchema.array(),
});
export type PackagePublishRequest = (typeof PackagePublishRequestSchema)[inferred];

export const PackageListItemSchema = type({
  name: "string",
  displayName: "string",
  family: PackageFamilySchema,
  runtimeId: "string|null?",
  channel: PackageChannelSchema,
  isOfficial: "boolean",
  summary: "string|null?",
  ownerHandle: "string|null?",
  createdAt: "number",
  updatedAt: "number",
  latestVersion: "string|null?",
  capabilityTags: "string[]?",
  executesCode: "boolean?",
  verificationTier: PackageVerificationTierSchema.or("null").optional(),
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
    runtimeId: "string|null?",
    channel: PackageChannelSchema,
    isOfficial: "boolean",
    summary: "string|null?",
    ownerHandle: "string|null?",
    createdAt: "number",
    updatedAt: "number",
    latestVersion: "string|null?",
    tags: "unknown",
    compatibility: PackageCompatibilitySchema.or("null").optional(),
    capabilities: PackageCapabilitySummarySchema.or("null").optional(),
    verification: PackageVerificationSummarySchema.or("null").optional(),
  }).or("null"),
  owner: type({
    handle: "string|null",
    displayName: "string|null?",
    image: "string|null?",
  }).or("null"),
});

export const ApiV1PackageVersionListResponseSchema = type({
  items: type({
    version: "string",
    createdAt: "number",
    changelog: "string",
    distTags: "string[]?",
  }).array(),
  nextCursor: "string|null",
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
    capabilities: PackageCapabilitySummarySchema.or("null").optional(),
    verification: PackageVerificationSummarySchema.or("null").optional(),
    sha256hash: "string?",
    vtAnalysis: PackageVtAnalysisSchema.or("null").optional(),
    llmAnalysis: PackageLlmAnalysisSchema.or("null").optional(),
    staticScan: PackageStaticScanSchema.or("null").optional(),
  }).or("null"),
});

export const ApiV1PackagePublishResponseSchema = type({
  ok: "true",
  packageId: "string",
  releaseId: "string",
});
export type ApiV1PackagePublishResponse = (typeof ApiV1PackagePublishResponseSchema)[inferred];

export const PackageTrustedPublisherUpsertRequestSchema = type({
  repository: "string",
  workflowFilename: "string",
  environment: "string?",
});
export type PackageTrustedPublisherUpsertRequest =
  (typeof PackageTrustedPublisherUpsertRequestSchema)[inferred];

export const ApiV1PackageTrustedPublisherResponseSchema = type({
  trustedPublisher: PackageTrustedPublisherSchema.or("null"),
});
export type ApiV1PackageTrustedPublisherResponse =
  (typeof ApiV1PackageTrustedPublisherResponseSchema)[inferred];

export const PublishTokenMintRequestSchema = type({
  packageName: "string",
  version: "string",
  githubOidcToken: "string",
});
export type PublishTokenMintRequest = (typeof PublishTokenMintRequestSchema)[inferred];

export const ApiV1PublishTokenMintResponseSchema = type({
  token: "string",
  expiresAt: "number",
});
export type ApiV1PublishTokenMintResponse =
  (typeof ApiV1PublishTokenMintResponseSchema)[inferred];
