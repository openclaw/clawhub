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
} from "./packageShared.js";
import { CliPublishFileSchema, PublishSourceSchema } from "./schemas.js";
import { TemplateManifestSummarySchema } from "./templates.js";

export * from "./packageShared.js";

export const PluginManifestSummarySchema = type({
  schemaVersion: "number",
  icon: "string?",
  compatibility: PackageCompatibilitySchema.optional(),
  manifestIdentity: type({
    name: "string?",
    description: "string?",
    version: "string?",
    family: "string?",
  }).optional(),
  configFields: type({
    name: "string",
    description: "string?",
    required: "boolean",
    sensitive: "boolean",
  }).array(),
  mcpServers: type({
    name: "string",
    url: "string?",
    "transport?": '"streamable-http"|"sse"|"stdio"',
    "auth?": '"oauth"|"api-key"|"none"',
    scope: "string?",
    setup: "string?",
    endpointRedacted: "boolean?",
  }).array(),
  bundledSkills: type({
    name: "string",
    description: "string?",
    rootPath: "string",
    skillMdPath: "string",
    sha256: "string",
    size: "number",
  }).array(),
});
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

// The public registry API is served through Vercel functions, which reject request
// bodies over 4.5 MB before ClawHub code runs. Inline multipart publishes stay under
// that cap; larger ClawPacks stage through the upload-url flow straight into storage.
const MAX_PACKAGE_MULTIPART_MB = 4;
export const MAX_PACKAGE_MULTIPART_BYTES = MAX_PACKAGE_MULTIPART_MB * 1024 * 1024;
export const MAX_PACKAGE_CLAWPACK_BYTES = 120 * 1024 * 1024;
const PACKAGE_MULTIPART_FIXED_OVERHEAD_BYTES = 4096;
const PACKAGE_MULTIPART_PART_OVERHEAD_BYTES = 1024;

export type PackageMultipartUploadField = "files" | "clawpack";
export type PackageMultipartUploadPart = {
  name: string;
  size: number;
  type?: string;
};
export type PackageMultipartUploadSizeInput = {
  payloadJson: string;
  fileFieldName: PackageMultipartUploadField;
  files: readonly PackageMultipartUploadPart[];
};

export function estimatePackageMultipartUploadBytes(
  input: PackageMultipartUploadSizeInput,
): number {
  return (
    PACKAGE_MULTIPART_FIXED_OVERHEAD_BYTES +
    estimateMultipartStringPartBytes("payload", input.payloadJson) +
    input.files.reduce(
      (sum, file) => sum + estimateMultipartFilePartBytes(input.fileFieldName, file),
      0,
    )
  );
}

export function isPackageMultipartUploadTooLarge(input: PackageMultipartUploadSizeInput): boolean {
  return estimatePackageMultipartUploadBytes(input) > MAX_PACKAGE_MULTIPART_BYTES;
}

export function getPackageMultipartSizeError(): string {
  return `Package upload exceeds ${MAX_PACKAGE_MULTIPART_MB}MB multipart upload limit`;
}

function estimateMultipartStringPartBytes(fieldName: string, value: string): number {
  return PACKAGE_MULTIPART_PART_OVERHEAD_BYTES + utf8ByteLength(fieldName) + utf8ByteLength(value);
}

function estimateMultipartFilePartBytes(
  fieldName: PackageMultipartUploadField,
  file: PackageMultipartUploadPart,
): number {
  return (
    file.size +
    PACKAGE_MULTIPART_PART_OVERHEAD_BYTES +
    utf8ByteLength(fieldName) +
    utf8ByteLength(file.name) +
    utf8ByteLength(file.type ?? "")
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

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
