import { type } from "arktype";
import { CliPublishFileSchema, PublishSourceSchema } from "./schemas.js";
export const PackageFamilySchema = type('"skill"|"code-plugin"|"bundle-plugin"');
export const PackageChannelSchema = type('"official"|"community"|"private"');
export const PackageVerificationTierSchema = type('"structural"|"source-linked"|"provenance-verified"|"rebuild-verified"');
export const PackageVerificationScopeSchema = type('"artifact-only"|"dependency-graph-aware"');
export const PackageCompatibilitySchema = type({
    pluginApiRange: "string?",
    builtWithOpenClawVersion: "string?",
    pluginSdkVersion: "string?",
    minGatewayVersion: "string?",
});
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
export const PackageVtAnalysisSchema = type({
    status: "string",
    verdict: "string?",
    analysis: "string?",
    source: "string?",
    checkedAt: "number",
});
export const PackageLlmAnalysisDimensionSchema = type({
    name: "string",
    label: "string",
    rating: "string",
    detail: "string",
});
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
export const PackageStaticFindingSchema = type({
    code: "string",
    severity: "string",
    file: "string",
    line: "number",
    message: "string",
    evidence: "string",
});
export const PackageStaticScanSchema = type({
    status: "string",
    reasonCodes: "string[]",
    findings: PackageStaticFindingSchema.array(),
    summary: "string",
    engineVersion: "string",
    checkedAt: "number",
});
export const BundlePublishMetadataSchema = type({
    id: "string?",
    format: "string?",
    hostTargets: "string[]?",
});
export const PackageTrustedPublisherSchema = type({
    provider: '"github-actions"',
    repository: "string",
    repositoryId: "string",
    repositoryOwner: "string",
    repositoryOwnerId: "string",
    workflowFilename: "string",
    environment: "string?",
});
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
export const PackageTrustedPublisherUpsertRequestSchema = type({
    repository: "string",
    workflowFilename: "string",
    environment: "string?",
});
export const ApiV1PackageTrustedPublisherResponseSchema = type({
    trustedPublisher: PackageTrustedPublisherSchema.or("null"),
});
export const PublishTokenMintRequestSchema = type({
    packageName: "string",
    version: "string",
    githubOidcToken: "string",
});
export const ApiV1PublishTokenMintResponseSchema = type({
    token: "string",
    expiresAt: "number",
});
//# sourceMappingURL=packages.js.map