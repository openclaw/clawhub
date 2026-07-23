import { type } from "arktype";
import { DocsLinks } from "./docsLinks.js";
import { CliPublishFileSchema, PublishSourceSchema } from "./schemas.js";
export const PACKAGE_TRENDING_LEADERBOARD_LIMIT = 200;
export function normalizePackageOwnerHandle(handle) {
    const normalized = handle?.trim().replace(/^@+/, "").toLowerCase();
    return normalized || undefined;
}
export function inferPackageNameScope(name) {
    return /^@([^/]+)\//.exec(name.trim().toLowerCase())?.[1];
}
export function getPackageScopeOwnerMismatch(name, ownerHandle) {
    const scope = inferPackageNameScope(name);
    const selectedOwner = normalizePackageOwnerHandle(ownerHandle);
    if (!scope || !selectedOwner || scope === selectedOwner)
        return null;
    const packageSlug = name.split("/").pop()?.trim() || "plugin-name";
    return {
        scope,
        selectedOwner,
        suggestedName: `@${selectedOwner}/${packageSlug}`,
        message: `Package scope "@${scope}" must match selected owner "@${selectedOwner}". Publish as "@${scope}" or rename this package to "@${selectedOwner}/${packageSlug}". More info: ${DocsLinks.clawhub.packageScopeFaq}`,
    };
}
export const PackageFamilySchema = type('"skill"|"code-plugin"|"bundle-plugin"|"claw"');
export const PackagePublishFamilySchema = type('"skill"|"code-plugin"|"bundle-plugin"|"claw"');
export const PackageChannelSchema = type('"official"|"community"|"private"');
export const PackageVerificationTierSchema = type('"structural"|"source-linked"|"provenance-verified"|"rebuild-verified"');
export const PackageVerificationScopeSchema = type('"artifact-only"|"dependency-graph-aware"');
export const PackageCompatibilitySchema = type({
    pluginApiRange: "string?",
    builtWithOpenClawVersion: "string?",
    pluginSdkVersion: "string?",
    minGatewayVersion: "string?",
});
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
export const PackageStatsSchema = type({
    downloads: "number",
    installs: "number",
    stars: "number",
    versions: "number",
});
export const PackageArtifactKindSchema = type('"legacy-zip"|"npm-pack"');
export const PackageReleaseModerationStateSchema = type('"approved"|"quarantined"|"revoked"');
export const PackageReportStatusSchema = type('"open"|"confirmed"|"dismissed"');
export const PackageReportFinalActionSchema = type('"none"|"quarantine"|"revoke"');
export const PackageReportListStatusSchema = PackageReportStatusSchema.or('"all"');
export const PackageAppealStatusSchema = type('"open"|"accepted"|"rejected"');
export const PackageAppealFinalActionSchema = type('"none"|"approve"');
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
    source: '"clawhub"?',
    artifactKind: PackageArtifactKindSchema.optional(),
    artifactSha256: "string?",
    packageName: "string?",
    version: "string?",
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
export const PackageSkillSpectorIssueSchema = type({
    issueId: "string",
    category: "string?",
    pattern: "string?",
    severity: "string",
    confidence: "number?",
    file: "string?",
    startLine: "number?",
    endLine: "number?",
    explanation: "string",
    remediation: "string?",
    finding: "string?",
    codeSnippet: "string?",
});
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
    agenticRiskFindings: "unknown[]?",
    riskSummary: "unknown?",
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
export const MAX_PACKAGE_MULTIPART_BYTES = 18 * 1024 * 1024;
export const MAX_PACKAGE_CLAWPACK_BYTES = 120 * 1024 * 1024;
const PACKAGE_MULTIPART_FIXED_OVERHEAD_BYTES = 4096;
const PACKAGE_MULTIPART_PART_OVERHEAD_BYTES = 1024;
export function estimatePackageMultipartUploadBytes(input) {
    return (PACKAGE_MULTIPART_FIXED_OVERHEAD_BYTES +
        estimateMultipartStringPartBytes("payload", input.payloadJson) +
        input.files.reduce((sum, file) => sum + estimateMultipartFilePartBytes(input.fileFieldName, file), 0));
}
export function isPackageMultipartUploadTooLarge(input) {
    return estimatePackageMultipartUploadBytes(input) > MAX_PACKAGE_MULTIPART_BYTES;
}
export function getPackageMultipartSizeError() {
    return "Package upload exceeds 18MB multipart upload limit";
}
function estimateMultipartStringPartBytes(fieldName, value) {
    return PACKAGE_MULTIPART_PART_OVERHEAD_BYTES + utf8ByteLength(fieldName) + utf8ByteLength(value);
}
function estimateMultipartFilePartBytes(fieldName, file) {
    return (file.size +
        PACKAGE_MULTIPART_PART_OVERHEAD_BYTES +
        utf8ByteLength(fieldName) +
        utf8ByteLength(file.name) +
        utf8ByteLength(file.type ?? ""));
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index);
        if (codePoint === undefined)
            continue;
        if (codePoint > 0xffff)
            index += 1;
        if (codePoint <= 0x7f) {
            bytes += 1;
        }
        else if (codePoint <= 0x7ff) {
            bytes += 2;
        }
        else if (codePoint <= 0xffff) {
            bytes += 3;
        }
        else {
            bytes += 4;
        }
    }
    return bytes;
}
const PackagePublishMetadataFields = {
    name: "string",
    displayName: "string?",
    ownerHandle: "string?",
    family: PackagePublishFamilySchema,
    version: "string",
    changelog: "string",
    manualOverrideReason: "string?",
    channel: PackageChannelSchema.optional(),
    tags: "string[]?",
    categories: "string[]?",
    topics: "string[]?",
    source: PublishSourceSchema.optional(),
    bundle: BundlePublishMetadataSchema.optional(),
};
export const PackagePublishMetadataSchema = type({
    "+": "reject",
    ...PackagePublishMetadataFields,
});
export const ServerPackagePublishRequestSchema = type({
    "+": "reject",
    ...PackagePublishMetadataFields,
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
    icon: "string|null?",
    ownerHandle: "string|null?",
    createdAt: "number",
    updatedAt: "number",
    latestVersion: "string|null?",
    categories: "string[]?",
    topics: "string[]?",
    featuredAt: "number?",
    verificationTier: PackageVerificationTierSchema.or("null").optional(),
    stats: PackageStatsSchema.optional(),
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
        verification: PackageVerificationSummarySchema.or("null").optional(),
        artifact: PackageArtifactSummarySchema.or("null").optional(),
        scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"?',
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
        pluginManifestSummary: PluginManifestSummarySchema.or("null").optional(),
        verification: PackageVerificationSummarySchema.or("null").optional(),
        artifact: PackageArtifactSummarySchema.or("null").optional(),
        // Deprecated compatibility hash for exact /download ZIP bytes; use artifact.sha256 for installs.
        sha256hash: "string|null?",
        vtAnalysis: PackageVtAnalysisSchema.or("null").optional(),
        skillSpectorAnalysis: PackageSkillSpectorAnalysisSchema.or("null").optional(),
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
        source: '"clawhub"?',
        artifactKind: PackageArtifactKindSchema.optional(),
        artifactSha256: "string?",
        packageName: "string?",
        version: "string?",
    }),
});
export const ApiV1PackageSecurityResponseSchema = type({
    package: type({
        name: "string",
        displayName: "string",
        family: PackageFamilySchema,
    }),
    release: type({
        releaseId: "string",
        version: "string",
        artifactKind: PackageArtifactKindSchema.or("null").optional(),
        artifactSha256: "string?",
        npmIntegrity: "string?",
        npmShasum: "string?",
        npmTarballName: "string?",
        createdAt: "number",
    }),
    trust: type({
        scanStatus: '"clean"|"suspicious"|"malicious"|"pending"|"not-run"',
        moderationState: PackageReleaseModerationStateSchema.or("null").optional(),
        blockedFromDownload: "boolean",
        reasons: "string[]",
        pending: "boolean",
        stale: "boolean",
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
    finalAction: PackageReportFinalActionSchema.optional(),
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
    finalAction: PackageAppealFinalActionSchema.optional(),
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
        actionTaken: PackageAppealFinalActionSchema.or("null").optional(),
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
    actionTaken: PackageAppealFinalActionSchema.optional(),
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
        actionTaken: PackageReportFinalActionSchema.or("null").optional(),
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
    actionTaken: PackageReportFinalActionSchema.optional(),
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
export const PackageTransferRequestSchema = type({
    toOwner: "string",
    reason: "string?",
});
export const ApiV1PackageTransferResponseSchema = type({
    ok: "true",
    packageId: "string",
    name: "string",
    ownerUserId: "string",
    ownerPublisherId: "string?",
    channel: PackageChannelSchema,
    isOfficial: "boolean",
});
export const PackageRepairNameRequestSchema = type({
    nextName: "string",
    retireTarget: "boolean?",
    owner: "string?",
    reason: "string",
    dryRun: "boolean?",
});
export const PackageRepairNamePackageSchema = type({
    packageId: "string",
    name: "string",
    runtimeId: "string|null?",
    ownerUserId: "string",
    ownerPublisherId: "string|null?",
    channel: PackageChannelSchema,
    softDeletedAt: "number|null?",
});
export const PackageRepairNameOperationSchema = type({
    action: '"retire-target"|"rename-source"|"transfer-owner"',
    packageId: "string?",
    from: "string?",
    to: "string?",
    owner: "string?",
});
export const ApiV1PackageRepairNameResponseSchema = type({
    ok: "true",
    dryRun: "boolean",
    source: PackageRepairNamePackageSchema,
    target: PackageRepairNamePackageSchema.or("null"),
    retiredName: "string|null?",
    operations: PackageRepairNameOperationSchema.array(),
});
export const PackageRepairRuntimeIdRequestSchema = type({
    nextRuntimeId: "string",
    reason: "string",
    dryRun: "boolean?",
});
export const PackageRepairRuntimeIdOperationSchema = type({
    action: '"repair-runtime-id"',
    packageId: "string?",
    from: "string|null?",
    to: "string?",
});
export const ApiV1PackageRepairRuntimeIdResponseSchema = type({
    ok: "true",
    dryRun: "boolean",
    source: PackageRepairNamePackageSchema,
    operations: PackageRepairRuntimeIdOperationSchema.array(),
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
    publicationStatus: '"pending"|"published"?',
    attemptId: "string?",
    inspectorFindings: type({
        findingKind: '"warning"|"error"',
        code: "string",
        severity: "string?",
        level: "string?",
        issueClass: "string?",
        message: "string",
        authorRemediation: type({
            summary: "string",
            docsUrl: "string?",
        }).optional(),
        inspectorVersion: "string?",
        targetOpenClawVersion: "string?",
    })
        .array()
        .optional(),
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