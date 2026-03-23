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

export const BundlePublishMetadataSchema = type({
  id: "string?",
  format: "string?",
  hostTargets: "string[]?",
});
export type BundlePublishMetadata = (typeof BundlePublishMetadataSchema)[inferred];

export const PackagePublishRequestSchema = type({
  name: "string",
  displayName: "string?",
  ownerHandle: "string?",
  family: PackageFamilySchema,
  version: "string",
  changelog: "string",
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
  }).or("null"),
});

export const ApiV1PackagePublishResponseSchema = type({
  ok: "true",
  packageId: "string",
  releaseId: "string",
});
