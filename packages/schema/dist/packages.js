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
export const PackageStatsSchema = type({
    downloads: "number",
    installs: "number",
    stars: "number",
    versions: "number",
});
export const PackageArtifactKindSchema = type('"legacy-zip"|"npm-pack"');
export const PackageReleaseModerationStateSchema = type('"approved"|"quarantined"|"revoked"');
export const PackageReportStatusSchema = type('"open"|"triaged"|"dismissed"');
export const PackageReportListStatusSchema = PackageReportStatusSchema.or('"all"');
export const PackageAppealStatusSchema = type('"open"|"accepted"|"rejected"');
export const PackageAppealListStatusSchema = PackageAppealStatusSchema.or('"all"');
export const PackageOfficialMigrationPhaseSchema = type('"planned"|"published"|"clawpack-ready"|"legacy-zip-only"|"metadata-ready"|"blocked"|"ready-for-openclaw"');
export const PackageOfficialMigrationListPhaseSchema = PackageOfficialMigrationPhaseSchema.or('"all"');
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
    artifact: PackagePublishArtifactSchema.optional(),
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
        artifact: PackageArtifactSummarySchema.or("null").optional(),
        stats: PackageStatsSchema.optional(),
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
        artifact: PackageArtifactSummarySchema.or("null").optional(),
        sha256hash: "string|null?",
        vtAnalysis: PackageVtAnalysisSchema.or("null").optional(),
        llmAnalysis: PackageLlmAnalysisSchema.or("null").optional(),
        staticScan: PackageStaticScanSchema.or("null").optional(),
    }).or("null"),
});
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
export const PackageReleaseModerationRequestSchema = type({
    state: PackageReleaseModerationStateSchema,
    reason: "string",
});
export const PackageReportRequestSchema = type({
    reason: "string",
    version: "string?",
});
export const ApiV1PackageReportResponseSchema = type({
    ok: "true",
    reported: "boolean",
    alreadyReported: "boolean",
    packageId: "string",
    releaseId: "string|null",
    reportCount: "number",
});
export const PackageReportTriageRequestSchema = type({
    status: PackageReportStatusSchema,
    note: "string?",
});
export const PackageAppealRequestSchema = type({
    version: "string",
    message: "string",
});
export const ApiV1PackageAppealResponseSchema = type({
    ok: "true",
    submitted: "boolean",
    alreadyOpen: "boolean",
    appealId: "string",
    packageId: "string",
    releaseId: "string",
    status: PackageAppealStatusSchema,
});
export const PackageAppealResolveRequestSchema = type({
    status: PackageAppealStatusSchema,
    note: "string?",
});
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
export const ApiV1PackageAppealResolveResponseSchema = type({
    ok: "true",
    appealId: "string",
    packageId: "string",
    releaseId: "string",
    status: PackageAppealStatusSchema,
});
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
export const ApiV1PackageReportTriageResponseSchema = type({
    ok: "true",
    reportId: "string",
    packageId: "string",
    status: PackageReportStatusSchema,
    reportCount: "number",
});
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
export const PackageArtifactBackfillRequestSchema = type({
    cursor: "string|null?",
    batchSize: "number?",
    dryRun: "boolean?",
});
export const ApiV1PackageArtifactBackfillResponseSchema = type({
    ok: "true",
    scanned: "number",
    updated: "number",
    nextCursor: "string|null",
    done: "boolean",
    dryRun: "boolean",
});
export const PackageReadinessCheckSchema = type({
    id: "string",
    label: "string",
    status: '"pass"|"warn"|"fail"',
    message: "string",
});
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
export const ApiV1PackageOfficialMigrationListResponseSchema = type({
    items: PackageOfficialMigrationItemSchema.array(),
    nextCursor: "string|null",
    done: "boolean",
});
export const ApiV1PackageOfficialMigrationResponseSchema = type({
    ok: "true",
    migration: PackageOfficialMigrationItemSchema,
});
export const PackageModerationQueueStatusSchema = type('"open"|"blocked"|"manual"|"all"');
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
export const ApiV1PackageReleaseModerationResponseSchema = type({
    ok: "true",
    packageId: "string",
    releaseId: "string",
    state: PackageReleaseModerationStateSchema,
    scanStatus: '"clean"|"malicious"',
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