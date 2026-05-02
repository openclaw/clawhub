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

export const PackageStatsSchema = type({
  downloads: "number",
  installs: "number",
  stars: "number",
  versions: "number",
});
export type PackageStats = (typeof PackageStatsSchema)[inferred];

export const PackageArtifactKindSchema = type('"legacy-zip"|"npm-pack"');
export type PackageArtifactKind = (typeof PackageArtifactKindSchema)[inferred];

export const PackageReleaseModerationStateSchema = type('"approved"|"quarantined"|"revoked"');
export type PackageReleaseModerationState = (typeof PackageReleaseModerationStateSchema)[inferred];

export const PackageReportStatusSchema = type('"open"|"triaged"|"dismissed"');
export type PackageReportStatus = (typeof PackageReportStatusSchema)[inferred];

export const PackageReportListStatusSchema = PackageReportStatusSchema.or('"all"');
export type PackageReportListStatus = (typeof PackageReportListStatusSchema)[inferred];

export const PackageAppealStatusSchema = type('"open"|"accepted"|"rejected"');
export type PackageAppealStatus = (typeof PackageAppealStatusSchema)[inferred];

export const PackageAppealListStatusSchema = PackageAppealStatusSchema.or('"all"');
export type PackageAppealListStatus = (typeof PackageAppealListStatusSchema)[inferred];

export const PackageOfficialMigrationPhaseSchema = type(
  '"planned"|"published"|"clawpack-ready"|"legacy-zip-only"|"metadata-ready"|"blocked"|"ready-for-openclaw"',
);
export type PackageOfficialMigrationPhase = (typeof PackageOfficialMigrationPhaseSchema)[inferred];

export const PackageOfficialMigrationListPhaseSchema =
  PackageOfficialMigrationPhaseSchema.or('"all"');
export type PackageOfficialMigrationListPhase =
  (typeof PackageOfficialMigrationListPhaseSchema)[inferred];

export const PackageArtifactSummarySchema = type({
  kind: PackageArtifactKindSchema,
  sha256: "string?",
  size: "number?",
  format: "string?",
  npmIntegrity: "string?",
  npmShasum: "string?",
  npmTarballName: "string?",
  npmUnpackedSize: "number?",
  npmFileCount: "number?",
});
export type PackageArtifactSummary = (typeof PackageArtifactSummarySchema)[inferred];

export const PackagePublishArtifactSchema = type({
  kind: '"npm-pack"',
  storageId: "string",
  sha256: "string",
  size: "number",
  format: '"tgz"',
  npmIntegrity: "string",
  npmShasum: "string",
  npmTarballName: "string",
  npmUnpackedSize: "number",
  npmFileCount: "number",
});
export type PackagePublishArtifact = (typeof PackagePublishArtifactSchema)[inferred];

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
export type PackageLlmAnalysisDimension = (typeof PackageLlmAnalysisDimensionSchema)[inferred];

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
  artifact: PackagePublishArtifactSchema.optional(),
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
    artifact: PackageArtifactSummarySchema.or("null").optional(),
    stats: PackageStatsSchema.optional(),
  }).or("null"),
  owner: type({
    handle: "string|null",
    displayName: "string|null?",
    image: "string|null?",
  }).or("null"),
});
export type ApiV1PackageResponse = (typeof ApiV1PackageResponseSchema)[inferred];

export const ApiV1PackageVersionListResponseSchema = type({
  items: type({
    version: "string",
    createdAt: "number",
    changelog: "string",
    distTags: "string[]?",
  }).array(),
  nextCursor: "string|null",
});
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
    distTags: "string[]?",
    files: "unknown",
    compatibility: PackageCompatibilitySchema.or("null").optional(),
    capabilities: PackageCapabilitySummarySchema.or("null").optional(),
    verification: PackageVerificationSummarySchema.or("null").optional(),
    artifact: PackageArtifactSummarySchema.or("null").optional(),
    sha256hash: "string?",
    vtAnalysis: PackageVtAnalysisSchema.or("null").optional(),
    llmAnalysis: PackageLlmAnalysisSchema.or("null").optional(),
    staticScan: PackageStaticScanSchema.or("null").optional(),
  }).or("null"),
});
export type ApiV1PackageVersionResponse = (typeof ApiV1PackageVersionResponseSchema)[inferred];

export const ApiV1PackageArtifactResponseSchema = type({
  package: type({
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
  }),
  version: "string",
  artifact: type({
    kind: PackageArtifactKindSchema,
    sha256: "string?",
    size: "number?",
    format: "string?",
    npmIntegrity: "string?",
    npmShasum: "string?",
    npmTarballName: "string?",
    npmUnpackedSize: "number?",
    npmFileCount: "number?",
    downloadUrl: "string",
    tarballUrl: "string?",
    legacyDownloadUrl: "string?",
  }),
});
export type ApiV1PackageArtifactResponse = (typeof ApiV1PackageArtifactResponseSchema)[inferred];

export const PackageReleaseModerationRequestSchema = type({
  state: PackageReleaseModerationStateSchema,
  reason: "string",
});
export type PackageReleaseModerationRequest =
  (typeof PackageReleaseModerationRequestSchema)[inferred];

export const PackageReportRequestSchema = type({
  reason: "string",
  version: "string?",
});
export type PackageReportRequest = (typeof PackageReportRequestSchema)[inferred];

export const ApiV1PackageReportResponseSchema = type({
  ok: "true",
  reported: "boolean",
  alreadyReported: "boolean",
  packageId: "string",
  releaseId: "string|null",
  reportCount: "number",
});
export type ApiV1PackageReportResponse = (typeof ApiV1PackageReportResponseSchema)[inferred];

export const PackageReportTriageRequestSchema = type({
  status: PackageReportStatusSchema,
  note: "string?",
});
export type PackageReportTriageRequest = (typeof PackageReportTriageRequestSchema)[inferred];

export const PackageAppealRequestSchema = type({
  version: "string",
  message: "string",
});
export type PackageAppealRequest = (typeof PackageAppealRequestSchema)[inferred];

export const ApiV1PackageAppealResponseSchema = type({
  ok: "true",
  submitted: "boolean",
  alreadyOpen: "boolean",
  appealId: "string",
  packageId: "string",
  releaseId: "string",
  status: PackageAppealStatusSchema,
});
export type ApiV1PackageAppealResponse = (typeof ApiV1PackageAppealResponseSchema)[inferred];

export const PackageAppealResolveRequestSchema = type({
  status: PackageAppealStatusSchema,
  note: "string?",
});
export type PackageAppealResolveRequest = (typeof PackageAppealResolveRequestSchema)[inferred];

export const ApiV1PackageAppealListResponseSchema = type({
  items: type({
    appealId: "string",
    packageId: "string",
    releaseId: "string",
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
    version: "string",
    message: "string",
    status: PackageAppealStatusSchema,
    createdAt: "number",
    submitter: type({
      userId: "string",
      handle: "string|null?",
      displayName: "string|null?",
    }),
    resolvedAt: "number|null?",
    resolvedBy: "string|null?",
    resolutionNote: "string|null?",
  }).array(),
  nextCursor: "string|null",
  done: "boolean",
});
export type ApiV1PackageAppealListResponse =
  (typeof ApiV1PackageAppealListResponseSchema)[inferred];

export const ApiV1PackageAppealResolveResponseSchema = type({
  ok: "true",
  appealId: "string",
  packageId: "string",
  releaseId: "string",
  status: PackageAppealStatusSchema,
});
export type ApiV1PackageAppealResolveResponse =
  (typeof ApiV1PackageAppealResolveResponseSchema)[inferred];

export const ApiV1PackageReportListResponseSchema = type({
  items: type({
    reportId: "string",
    packageId: "string",
    releaseId: "string|null?",
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
    version: "string|null?",
    reason: "string|null?",
    status: PackageReportStatusSchema,
    createdAt: "number",
    reporter: type({
      userId: "string",
      handle: "string|null?",
      displayName: "string|null?",
    }),
    triagedAt: "number|null?",
    triagedBy: "string|null?",
    triageNote: "string|null?",
  }).array(),
  nextCursor: "string|null",
  done: "boolean",
});
export type ApiV1PackageReportListResponse =
  (typeof ApiV1PackageReportListResponseSchema)[inferred];

export const ApiV1PackageReportTriageResponseSchema = type({
  ok: "true",
  reportId: "string",
  packageId: "string",
  status: PackageReportStatusSchema,
  reportCount: "number",
});
export type ApiV1PackageReportTriageResponse =
  (typeof ApiV1PackageReportTriageResponseSchema)[inferred];

export const ApiV1PackageModerationStatusResponseSchema = type({
  package: type({
    packageId: "string",
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
    channel: PackageChannelSchema,
    isOfficial: "boolean",
    reportCount: "number",
    lastReportedAt: "number|null?",
    scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"?',
  }),
  latestRelease: type({
    releaseId: "string",
    version: "string",
    artifactKind: PackageArtifactKindSchema.or("null").optional(),
    scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"',
    moderationState: PackageReleaseModerationStateSchema.or("null").optional(),
    moderationReason: "string|null?",
    blockedFromDownload: "boolean",
    reasons: "string[]",
    createdAt: "number",
  }).or("null"),
});
export type ApiV1PackageModerationStatusResponse =
  (typeof ApiV1PackageModerationStatusResponseSchema)[inferred];

export const PackageArtifactBackfillRequestSchema = type({
  cursor: "string|null?",
  batchSize: "number?",
  dryRun: "boolean?",
});
export type PackageArtifactBackfillRequest =
  (typeof PackageArtifactBackfillRequestSchema)[inferred];

export const ApiV1PackageArtifactBackfillResponseSchema = type({
  ok: "true",
  scanned: "number",
  updated: "number",
  nextCursor: "string|null",
  done: "boolean",
  dryRun: "boolean",
});
export type ApiV1PackageArtifactBackfillResponse =
  (typeof ApiV1PackageArtifactBackfillResponseSchema)[inferred];

export const PackageReadinessCheckSchema = type({
  id: "string",
  label: "string",
  status: '"pass"|"warn"|"fail"',
  message: "string",
});
export type PackageReadinessCheck = (typeof PackageReadinessCheckSchema)[inferred];

export const ApiV1PackageReadinessResponseSchema = type({
  package: type({
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
    isOfficial: "boolean",
    latestVersion: "string|null?",
  }),
  ready: "boolean",
  checks: PackageReadinessCheckSchema.array(),
  blockers: "string[]",
});
export type ApiV1PackageReadinessResponse = (typeof ApiV1PackageReadinessResponseSchema)[inferred];

export const PackageOfficialMigrationUpsertRequestSchema = type({
  bundledPluginId: "string",
  packageName: "string",
  owner: "string?",
  sourceRepo: "string?",
  sourcePath: "string?",
  sourceCommit: "string?",
  phase: PackageOfficialMigrationPhaseSchema.optional(),
  blockers: "string[]?",
  hostTargetsComplete: "boolean?",
  scanClean: "boolean?",
  moderationApproved: "boolean?",
  runtimeBundlesReady: "boolean?",
  notes: "string?",
});
export type PackageOfficialMigrationUpsertRequest =
  (typeof PackageOfficialMigrationUpsertRequestSchema)[inferred];

export const PackageOfficialMigrationItemSchema = type({
  migrationId: "string",
  bundledPluginId: "string",
  packageName: "string",
  packageId: "string|null?",
  owner: "string|null?",
  sourceRepo: "string|null?",
  sourcePath: "string|null?",
  sourceCommit: "string|null?",
  phase: PackageOfficialMigrationPhaseSchema,
  blockers: "string[]",
  hostTargetsComplete: "boolean",
  scanClean: "boolean",
  moderationApproved: "boolean",
  runtimeBundlesReady: "boolean",
  notes: "string|null?",
  createdAt: "number",
  updatedAt: "number",
});
export type PackageOfficialMigrationItem = (typeof PackageOfficialMigrationItemSchema)[inferred];

export const ApiV1PackageOfficialMigrationListResponseSchema = type({
  items: PackageOfficialMigrationItemSchema.array(),
  nextCursor: "string|null",
  done: "boolean",
});
export type ApiV1PackageOfficialMigrationListResponse =
  (typeof ApiV1PackageOfficialMigrationListResponseSchema)[inferred];

export const ApiV1PackageOfficialMigrationResponseSchema = type({
  ok: "true",
  migration: PackageOfficialMigrationItemSchema,
});
export type ApiV1PackageOfficialMigrationResponse =
  (typeof ApiV1PackageOfficialMigrationResponseSchema)[inferred];

export const PackageModerationQueueStatusSchema = type('"open"|"blocked"|"manual"|"all"');
export type PackageModerationQueueStatus = (typeof PackageModerationQueueStatusSchema)[inferred];

export const ApiV1PackageModerationQueueResponseSchema = type({
  items: type({
    packageId: "string",
    releaseId: "string",
    name: "string",
    displayName: "string",
    family: PackageFamilySchema,
    channel: PackageChannelSchema,
    isOfficial: "boolean",
    version: "string",
    createdAt: "number",
    artifactKind: PackageArtifactKindSchema.or("null").optional(),
    scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"',
    moderationState: PackageReleaseModerationStateSchema.or("null").optional(),
    moderationReason: "string|null?",
    sourceRepo: "string|null?",
    sourceCommit: "string|null?",
    reportCount: "number",
    lastReportedAt: "number|null?",
    reasons: "string[]",
  }).array(),
  nextCursor: "string|null",
  done: "boolean",
});
export type ApiV1PackageModerationQueueResponse =
  (typeof ApiV1PackageModerationQueueResponseSchema)[inferred];

export const ApiV1PackageReleaseModerationResponseSchema = type({
  ok: "true",
  packageId: "string",
  releaseId: "string",
  state: PackageReleaseModerationStateSchema,
  scanStatus: '"clean"|"malicious"',
});
export type ApiV1PackageReleaseModerationResponse =
  (typeof ApiV1PackageReleaseModerationResponseSchema)[inferred];

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
export type ApiV1PublishTokenMintResponse = (typeof ApiV1PublishTokenMintResponseSchema)[inferred];
