import { type inferred } from "arktype";
export declare const PackageFamilySchema: import("arktype/internal/variants/string.ts").StringType<"skill" | "code-plugin" | "bundle-plugin", {}>;
export type PackageFamily = (typeof PackageFamilySchema)[inferred];
export declare const PackageChannelSchema: import("arktype/internal/variants/string.ts").StringType<"official" | "community" | "private", {}>;
export type PackageChannel = (typeof PackageChannelSchema)[inferred];
export declare const PackageVerificationTierSchema: import("arktype/internal/variants/string.ts").StringType<"structural" | "source-linked" | "provenance-verified" | "rebuild-verified", {}>;
export type PackageVerificationTier = (typeof PackageVerificationTierSchema)[inferred];
export declare const PackageVerificationScopeSchema: import("arktype/internal/variants/string.ts").StringType<"artifact-only" | "dependency-graph-aware", {}>;
export type PackageVerificationScope = (typeof PackageVerificationScopeSchema)[inferred];
export declare const PackageCompatibilitySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    pluginApiRange?: string | undefined;
    builtWithOpenClawVersion?: string | undefined;
    pluginSdkVersion?: string | undefined;
    minGatewayVersion?: string | undefined;
}, {}>;
export type PackageCompatibility = (typeof PackageCompatibilitySchema)[inferred];
export declare const PackageCapabilitySummarySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    executesCode: boolean;
    runtimeId?: string | undefined;
    pluginKind?: string | undefined;
    channels?: string[] | undefined;
    providers?: string[] | undefined;
    hooks?: string[] | undefined;
    bundledSkills?: string[] | undefined;
    setupEntry?: boolean | undefined;
    configSchema?: boolean | undefined;
    configUiHints?: boolean | undefined;
    materializesDependencies?: boolean | undefined;
    toolNames?: string[] | undefined;
    commandNames?: string[] | undefined;
    serviceNames?: string[] | undefined;
    capabilityTags?: string[] | undefined;
    httpRouteCount?: number | undefined;
    bundleFormat?: string | undefined;
    hostTargets?: string[] | undefined;
}, {}>;
export type PackageCapabilitySummary = (typeof PackageCapabilitySummarySchema)[inferred];
export declare const PackageVerificationSummarySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    tier: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
    scope: "artifact-only" | "dependency-graph-aware";
    summary?: string | undefined;
    sourceRepo?: string | undefined;
    sourceCommit?: string | undefined;
    sourceTag?: string | undefined;
    hasProvenance?: boolean | undefined;
    scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run" | undefined;
}, {}>;
export type PackageVerificationSummary = (typeof PackageVerificationSummarySchema)[inferred];
export declare const PackageStatsSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
}, {}>;
export type PackageStats = (typeof PackageStatsSchema)[inferred];
export declare const PackageVtAnalysisSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    status: string;
    checkedAt: number;
    verdict?: string | undefined;
    analysis?: string | undefined;
    source?: string | undefined;
}, {}>;
export type PackageVtAnalysis = (typeof PackageVtAnalysisSchema)[inferred];
export declare const PackageLlmAnalysisDimensionSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    label: string;
    rating: string;
    detail: string;
}, {}>;
export type PackageLlmAnalysisDimension = (typeof PackageLlmAnalysisDimensionSchema)[inferred];
export declare const PackageLlmAnalysisSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    status: string;
    checkedAt: number;
    verdict?: string | undefined;
    confidence?: string | undefined;
    summary?: string | undefined;
    dimensions?: {
        name: string;
        label: string;
        rating: string;
        detail: string;
    }[] | undefined;
    guidance?: string | undefined;
    findings?: string | undefined;
    model?: string | undefined;
}, {}>;
export type PackageLlmAnalysis = (typeof PackageLlmAnalysisSchema)[inferred];
export declare const PackageStaticFindingSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    code: string;
    severity: string;
    file: string;
    line: number;
    message: string;
    evidence: string;
}, {}>;
export type PackageStaticFinding = (typeof PackageStaticFindingSchema)[inferred];
export declare const PackageStaticScanSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    status: string;
    reasonCodes: string[];
    findings: {
        code: string;
        severity: string;
        file: string;
        line: number;
        message: string;
        evidence: string;
    }[];
    summary: string;
    engineVersion: string;
    checkedAt: number;
}, {}>;
export type PackageStaticScan = (typeof PackageStaticScanSchema)[inferred];
export declare const BundlePublishMetadataSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    id?: string | undefined;
    format?: string | undefined;
    hostTargets?: string[] | undefined;
}, {}>;
export type BundlePublishMetadata = (typeof BundlePublishMetadataSchema)[inferred];
export declare const PackageTrustedPublisherSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    provider: "github-actions";
    repository: string;
    repositoryId: string;
    repositoryOwner: string;
    repositoryOwnerId: string;
    workflowFilename: string;
    environment?: string | undefined;
}, {}>;
export type PackageTrustedPublisher = (typeof PackageTrustedPublisherSchema)[inferred];
export declare const PackagePublishRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    version: string;
    changelog: string;
    files: {
        path: string;
        size: number;
        storageId: string;
        sha256: string;
        contentType?: string | undefined;
    }[];
    displayName?: string | undefined;
    ownerHandle?: string | undefined;
    manualOverrideReason?: string | undefined;
    channel?: "official" | "community" | "private" | undefined;
    tags?: string[] | undefined;
    source?: {
        kind: "github";
        url: string;
        repo: string;
        ref: string;
        commit: string;
        path: string;
        importedAt: number;
    } | undefined;
    bundle?: {
        id?: string | undefined;
        format?: string | undefined;
        hostTargets?: string[] | undefined;
    } | undefined;
}, {}>;
export type PackagePublishRequest = (typeof PackagePublishRequestSchema)[inferred];
export declare const PackageListItemSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    channel: "official" | "community" | "private";
    isOfficial: boolean;
    createdAt: number;
    updatedAt: number;
    runtimeId?: string | null | undefined;
    summary?: string | null | undefined;
    ownerHandle?: string | null | undefined;
    latestVersion?: string | null | undefined;
    capabilityTags?: string[] | undefined;
    executesCode?: boolean | undefined;
    verificationTier?: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified" | null | undefined;
}, {}>;
export type PackageListItem = (typeof PackageListItemSchema)[inferred];
export declare const ApiV1PackageListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        name: string;
        displayName: string;
        family: "skill" | "code-plugin" | "bundle-plugin";
        channel: "official" | "community" | "private";
        isOfficial: boolean;
        createdAt: number;
        updatedAt: number;
        runtimeId?: string | null | undefined;
        summary?: string | null | undefined;
        ownerHandle?: string | null | undefined;
        latestVersion?: string | null | undefined;
        capabilityTags?: string[] | undefined;
        executesCode?: boolean | undefined;
        verificationTier?: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified" | null | undefined;
    }[];
    nextCursor: string | null;
}, {}>;
export type ApiV1PackageListResponse = (typeof ApiV1PackageListResponseSchema)[inferred];
export declare const ApiV1PackageSearchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    results: {
        score: number;
        package: {
            name: string;
            displayName: string;
            family: "skill" | "code-plugin" | "bundle-plugin";
            channel: "official" | "community" | "private";
            isOfficial: boolean;
            createdAt: number;
            updatedAt: number;
            runtimeId?: string | null | undefined;
            summary?: string | null | undefined;
            ownerHandle?: string | null | undefined;
            latestVersion?: string | null | undefined;
            capabilityTags?: string[] | undefined;
            executesCode?: boolean | undefined;
            verificationTier?: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified" | null | undefined;
        };
    }[];
}, {}>;
export type ApiV1PackageSearchResponse = (typeof ApiV1PackageSearchResponseSchema)[inferred];
export declare const ApiV1PackageResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    package: {
        name: string;
        displayName: string;
        family: "skill" | "code-plugin" | "bundle-plugin";
        channel: "official" | "community" | "private";
        isOfficial: boolean;
        createdAt: number;
        updatedAt: number;
        tags: unknown;
        runtimeId?: string | null | undefined;
        summary?: string | null | undefined;
        ownerHandle?: string | null | undefined;
        latestVersion?: string | null | undefined;
        compatibility?: {
            pluginApiRange?: string | undefined;
            builtWithOpenClawVersion?: string | undefined;
            pluginSdkVersion?: string | undefined;
            minGatewayVersion?: string | undefined;
        } | null | undefined;
        capabilities?: {
            executesCode: boolean;
            runtimeId?: string | undefined;
            pluginKind?: string | undefined;
            channels?: string[] | undefined;
            providers?: string[] | undefined;
            hooks?: string[] | undefined;
            bundledSkills?: string[] | undefined;
            setupEntry?: boolean | undefined;
            configSchema?: boolean | undefined;
            configUiHints?: boolean | undefined;
            materializesDependencies?: boolean | undefined;
            toolNames?: string[] | undefined;
            commandNames?: string[] | undefined;
            serviceNames?: string[] | undefined;
            capabilityTags?: string[] | undefined;
            httpRouteCount?: number | undefined;
            bundleFormat?: string | undefined;
            hostTargets?: string[] | undefined;
        } | null | undefined;
        verification?: {
            tier: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
            scope: "artifact-only" | "dependency-graph-aware";
            summary?: string | undefined;
            sourceRepo?: string | undefined;
            sourceCommit?: string | undefined;
            sourceTag?: string | undefined;
            hasProvenance?: boolean | undefined;
            scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run" | undefined;
        } | null | undefined;
        stats?: {
            downloads: number;
            installs: number;
            stars: number;
            versions: number;
        } | undefined;
    } | null;
    owner: {
        handle: string | null;
        displayName?: string | null | undefined;
        image?: string | null | undefined;
    } | null;
}, {}>;
export type ApiV1PackageResponse = (typeof ApiV1PackageResponseSchema)[inferred];
export declare const ApiV1PackageVersionListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        version: string;
        createdAt: number;
        changelog: string;
        distTags?: string[] | undefined;
    }[];
    nextCursor: string | null;
}, {}>;
export type ApiV1PackageVersionListResponse = (typeof ApiV1PackageVersionListResponseSchema)[inferred];
export declare const ApiV1PackageVersionResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    package: {
        name: string;
        displayName: string;
        family: "skill" | "code-plugin" | "bundle-plugin";
    } | null;
    version: {
        version: string;
        createdAt: number;
        changelog: string;
        files: unknown;
        distTags?: string[] | undefined;
        compatibility?: {
            pluginApiRange?: string | undefined;
            builtWithOpenClawVersion?: string | undefined;
            pluginSdkVersion?: string | undefined;
            minGatewayVersion?: string | undefined;
        } | null | undefined;
        capabilities?: {
            executesCode: boolean;
            runtimeId?: string | undefined;
            pluginKind?: string | undefined;
            channels?: string[] | undefined;
            providers?: string[] | undefined;
            hooks?: string[] | undefined;
            bundledSkills?: string[] | undefined;
            setupEntry?: boolean | undefined;
            configSchema?: boolean | undefined;
            configUiHints?: boolean | undefined;
            materializesDependencies?: boolean | undefined;
            toolNames?: string[] | undefined;
            commandNames?: string[] | undefined;
            serviceNames?: string[] | undefined;
            capabilityTags?: string[] | undefined;
            httpRouteCount?: number | undefined;
            bundleFormat?: string | undefined;
            hostTargets?: string[] | undefined;
        } | null | undefined;
        verification?: {
            tier: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
            scope: "artifact-only" | "dependency-graph-aware";
            summary?: string | undefined;
            sourceRepo?: string | undefined;
            sourceCommit?: string | undefined;
            sourceTag?: string | undefined;
            hasProvenance?: boolean | undefined;
            scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run" | undefined;
        } | null | undefined;
        sha256hash?: string | undefined;
        vtAnalysis?: {
            status: string;
            checkedAt: number;
            verdict?: string | undefined;
            analysis?: string | undefined;
            source?: string | undefined;
        } | null | undefined;
        llmAnalysis?: {
            status: string;
            checkedAt: number;
            verdict?: string | undefined;
            confidence?: string | undefined;
            summary?: string | undefined;
            dimensions?: {
                name: string;
                label: string;
                rating: string;
                detail: string;
            }[] | undefined;
            guidance?: string | undefined;
            findings?: string | undefined;
            model?: string | undefined;
        } | null | undefined;
        staticScan?: {
            status: string;
            reasonCodes: string[];
            findings: {
                code: string;
                severity: string;
                file: string;
                line: number;
                message: string;
                evidence: string;
            }[];
            summary: string;
            engineVersion: string;
            checkedAt: number;
        } | null | undefined;
    } | null;
}, {}>;
export type ApiV1PackageVersionResponse = (typeof ApiV1PackageVersionResponseSchema)[inferred];
export declare const ApiV1PackagePublishResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    packageId: string;
    releaseId: string;
}, {}>;
export type ApiV1PackagePublishResponse = (typeof ApiV1PackagePublishResponseSchema)[inferred];
export declare const PackageTrustedPublisherUpsertRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    repository: string;
    workflowFilename: string;
    environment?: string | undefined;
}, {}>;
export type PackageTrustedPublisherUpsertRequest = (typeof PackageTrustedPublisherUpsertRequestSchema)[inferred];
export declare const ApiV1PackageTrustedPublisherResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    trustedPublisher: {
        provider: "github-actions";
        repository: string;
        repositoryId: string;
        repositoryOwner: string;
        repositoryOwnerId: string;
        workflowFilename: string;
        environment?: string | undefined;
    } | null;
}, {}>;
export type ApiV1PackageTrustedPublisherResponse = (typeof ApiV1PackageTrustedPublisherResponseSchema)[inferred];
export declare const PublishTokenMintRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    packageName: string;
    version: string;
    githubOidcToken: string;
}, {}>;
export type PublishTokenMintRequest = (typeof PublishTokenMintRequestSchema)[inferred];
export declare const ApiV1PublishTokenMintResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    token: string;
    expiresAt: number;
}, {}>;
export type ApiV1PublishTokenMintResponse = (typeof ApiV1PublishTokenMintResponseSchema)[inferred];
