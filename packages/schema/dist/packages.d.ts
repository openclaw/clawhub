import { type inferred } from "arktype";
import { ApiV1PackageVersionListResponseSchema } from "./packageShared.js";
export * from "./packageShared.js";
export declare const PACKAGE_TRENDING_LEADERBOARD_LIMIT = 200;
export declare const PACKAGE_CATEGORY_BATCH_LIMIT = 200;
export { normalizePackageOwnerHandle, inferPackageNameScope, getPackageScopeOwnerMismatch, } from "./packageNames.js";
export declare const PackagePublishFamilySchema: import("arktype/internal/variants/string.ts").StringType<"bundle-plugin" | "code-plugin" | "skill" | "template", {}>;
export type PackagePublishFamily = (typeof PackagePublishFamilySchema)[inferred];
export declare const ApiV1PackageCategoriesBatchRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    packages: {
        name: string;
        version: string;
    }[];
}, {}>;
export type ApiV1PackageCategoriesBatchRequest = (typeof ApiV1PackageCategoriesBatchRequestSchema)[inferred];
export declare const ApiV1PackageCategoriesBatchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    packages: {
        name: string;
        version: string;
        categories: string[] | null;
    }[];
}, {}>;
export type ApiV1PackageCategoriesBatchResponse = (typeof ApiV1PackageCategoriesBatchResponseSchema)[inferred];
export declare const PackageVerificationSummarySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    tier: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural";
    scope: "artifact-only" | "dependency-graph-aware";
    summary?: string | undefined;
    sourceRepo?: string | undefined;
    sourceCommit?: string | undefined;
    sourceTag?: string | undefined;
    sourcePath?: string | undefined;
    hasProvenance?: boolean | undefined;
    trustedOpenClawPlugin?: boolean | undefined;
    scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
}, {}>;
export type PackageVerificationSummary = (typeof PackageVerificationSummarySchema)[inferred];
export declare const PackageSkillSpectorAnalysisSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    status: string;
    inspectionStatus?: "completed" | "partial" | undefined;
    score?: number | undefined;
    severity?: string | undefined;
    recommendation?: string | undefined;
    issueCount: number;
    issues: {
        issueId: string;
        category?: string | undefined;
        pattern?: string | undefined;
        severity: string;
        confidence?: number | undefined;
        file?: string | undefined;
        startLine?: number | undefined;
        endLine?: number | undefined;
        explanation: string;
        remediation?: string | undefined;
        finding?: string | undefined;
        codeSnippet?: string | undefined;
    }[];
    scannerVersion?: string | undefined;
    summary?: string | undefined;
    error?: string | undefined;
    checkedAt: number;
}, {}>;
export type PackageSkillSpectorAnalysis = (typeof PackageSkillSpectorAnalysisSchema)[inferred];
export { MAX_PACKAGE_MULTIPART_BYTES, MAX_PACKAGE_CLAWPACK_BYTES, estimatePackageMultipartUploadBytes, isPackageMultipartUploadTooLarge, getPackageMultipartSizeError, type PackageMultipartUploadField, type PackageMultipartUploadPart, type PackageMultipartUploadSizeInput, } from "./packageUploadLimits.js";
export declare const PackagePublishMetadataSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    displayName?: string | undefined;
    ownerHandle?: string | undefined;
    family: "bundle-plugin" | "code-plugin" | "skill" | "template";
    version: string;
    changelog: string;
    expectedArtifactSha256?: string | undefined;
    manualOverrideReason?: string | undefined;
    channel?: "community" | "official" | "private" | undefined;
    tags?: string[] | undefined;
    categories?: string[] | undefined;
    topics?: string[] | undefined;
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
export type PackagePublishMetadata = (typeof PackagePublishMetadataSchema)[inferred];
export declare const ServerPackagePublishRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    displayName?: string | undefined;
    ownerHandle?: string | undefined;
    family: "bundle-plugin" | "code-plugin" | "skill" | "template";
    version: string;
    changelog: string;
    expectedArtifactSha256?: string | undefined;
    manualOverrideReason?: string | undefined;
    channel?: "community" | "official" | "private" | undefined;
    tags?: string[] | undefined;
    categories?: string[] | undefined;
    topics?: string[] | undefined;
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
    artifact?: {
        kind: "npm-pack";
        storageId: string;
        sha256: string;
        size: number;
        format: "tgz";
        npmIntegrity: string;
        npmShasum: string;
        npmTarballName: string;
        npmUnpackedSize: number;
        npmFileCount: number;
    } | undefined;
    files: {
        path: string;
        size: number;
        storageId: string;
        sha256: string;
        contentType?: string | undefined;
        uploadTicket?: string | undefined;
    }[];
}, {}>;
export type ServerPackagePublishRequest = (typeof ServerPackagePublishRequestSchema)[inferred];
export declare const PackageListItemSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    displayName: string;
    family: "bundle-plugin" | "code-plugin" | "skill" | "template";
    runtimeId?: string | null | undefined;
    channel: "community" | "official" | "private";
    isOfficial: boolean;
    summary?: string | null | undefined;
    icon?: string | null | undefined;
    ownerHandle?: string | null | undefined;
    ownerImage?: string | null | undefined;
    ownerOfficial?: boolean | undefined;
    createdAt: number;
    updatedAt: number;
    latestVersion?: string | null | undefined;
    categories?: string[] | undefined;
    topics?: string[] | undefined;
    featuredAt?: number | undefined;
    trending24h?: {
        downloads: number;
        installs: number;
        windowStart: number;
        windowEnd: number;
    } | undefined;
    verificationTier?: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural" | null | undefined;
    stats?: {
        downloads: number;
        installs: number;
        stars: number;
        versions: number;
    } | undefined;
}, {}>;
export type PackageListItem = (typeof PackageListItemSchema)[inferred];
export declare const PluginOverviewItemSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    displayName: string;
    family: "bundle-plugin" | "code-plugin" | "skill" | "template";
    runtimeId?: string | null | undefined;
    channel: "community" | "official" | "private";
    isOfficial: boolean;
    summary?: string | null | undefined;
    icon?: string | null | undefined;
    ownerHandle?: string | null | undefined;
    ownerImage?: string | null | undefined;
    ownerOfficial?: boolean | undefined;
    createdAt: number;
    updatedAt: number;
    latestVersion?: string | null | undefined;
    categories?: string[] | undefined;
    topics?: string[] | undefined;
    featuredAt?: number | undefined;
    trending24h?: {
        downloads: number;
        installs: number;
        windowStart: number;
        windowEnd: number;
    } | undefined;
    verificationTier?: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural" | null | undefined;
    stats?: {
        downloads: number;
        installs: number;
        stars: number;
        versions: number;
    } | undefined;
    featured?: boolean | undefined;
    featuredRank?: number | undefined;
    trending?: boolean | undefined;
    trendingRank?: number | undefined;
}, {}>;
export type PluginOverviewItem = (typeof PluginOverviewItemSchema)[inferred];
export declare const PluginDiscoveryCategorySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    slug: string;
    label: string;
    description: string;
    icon: string;
    order: number;
    pinnedPackages?: string[] | undefined;
}, {}>;
export declare const ApiV1PluginOverviewResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    categories: {
        slug: string;
        label: string;
        description: string;
        icon: string;
        order: number;
        pinnedPackages?: string[] | undefined;
    }[];
    items: {
        name: string;
        displayName: string;
        family: "bundle-plugin" | "code-plugin" | "skill" | "template";
        runtimeId?: string | null | undefined;
        channel: "community" | "official" | "private";
        isOfficial: boolean;
        summary?: string | null | undefined;
        icon?: string | null | undefined;
        ownerHandle?: string | null | undefined;
        ownerImage?: string | null | undefined;
        ownerOfficial?: boolean | undefined;
        createdAt: number;
        updatedAt: number;
        latestVersion?: string | null | undefined;
        categories?: string[] | undefined;
        topics?: string[] | undefined;
        featuredAt?: number | undefined;
        trending24h?: {
            downloads: number;
            installs: number;
            windowStart: number;
            windowEnd: number;
        } | undefined;
        verificationTier?: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural" | null | undefined;
        stats?: {
            downloads: number;
            installs: number;
            stars: number;
            versions: number;
        } | undefined;
        featured?: boolean | undefined;
        featuredRank?: number | undefined;
        trending?: boolean | undefined;
        trendingRank?: number | undefined;
    }[];
}, {}>;
export type ApiV1PluginOverviewResponse = (typeof ApiV1PluginOverviewResponseSchema)[inferred];
export declare const ApiV1PackageListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        name: string;
        displayName: string;
        family: "bundle-plugin" | "code-plugin" | "skill" | "template";
        runtimeId?: string | null | undefined;
        channel: "community" | "official" | "private";
        isOfficial: boolean;
        summary?: string | null | undefined;
        icon?: string | null | undefined;
        ownerHandle?: string | null | undefined;
        ownerImage?: string | null | undefined;
        ownerOfficial?: boolean | undefined;
        createdAt: number;
        updatedAt: number;
        latestVersion?: string | null | undefined;
        categories?: string[] | undefined;
        topics?: string[] | undefined;
        featuredAt?: number | undefined;
        trending24h?: {
            downloads: number;
            installs: number;
            windowStart: number;
            windowEnd: number;
        } | undefined;
        verificationTier?: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural" | null | undefined;
        stats?: {
            downloads: number;
            installs: number;
            stars: number;
            versions: number;
        } | undefined;
    }[];
    nextCursor: string | null;
    categories?: {
        slug: string;
        label: string;
        description: string;
        icon: string;
        order: number;
        pinnedPackages?: string[] | undefined;
    }[] | undefined;
}, {}>;
export type ApiV1PackageListResponse = (typeof ApiV1PackageListResponseSchema)[inferred];
export declare const ApiV1PackageSearchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    results: {
        score: number;
        package: {
            name: string;
            displayName: string;
            family: "bundle-plugin" | "code-plugin" | "skill" | "template";
            runtimeId?: string | null | undefined;
            channel: "community" | "official" | "private";
            isOfficial: boolean;
            summary?: string | null | undefined;
            icon?: string | null | undefined;
            ownerHandle?: string | null | undefined;
            ownerImage?: string | null | undefined;
            ownerOfficial?: boolean | undefined;
            createdAt: number;
            updatedAt: number;
            latestVersion?: string | null | undefined;
            categories?: string[] | undefined;
            topics?: string[] | undefined;
            featuredAt?: number | undefined;
            trending24h?: {
                downloads: number;
                installs: number;
                windowStart: number;
                windowEnd: number;
            } | undefined;
            verificationTier?: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural" | null | undefined;
            stats?: {
                downloads: number;
                installs: number;
                stars: number;
                versions: number;
            } | undefined;
        };
    }[];
}, {}>;
export type ApiV1PackageSearchResponse = (typeof ApiV1PackageSearchResponseSchema)[inferred];
export declare const ApiV1PackageResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    package: {
        name: string;
        displayName: string;
        family: "bundle-plugin" | "code-plugin" | "skill" | "template";
        templateProfilePolicyVersion?: 1 | undefined;
        runtimeId?: string | null | undefined;
        channel: "community" | "official" | "private";
        isOfficial: boolean;
        summary?: string | null | undefined;
        icon?: string | null | undefined;
        ownerHandle?: string | null | undefined;
        createdAt: number;
        updatedAt: number;
        latestVersion?: string | null | undefined;
        categories?: string[] | undefined;
        topics?: string[] | undefined;
        tags: unknown;
        compatibility?: {
            pluginApiRange?: string | undefined;
            builtWithOpenClawVersion?: string | undefined;
            pluginSdkVersion?: string | undefined;
            minGatewayVersion?: string | undefined;
        } | null | undefined;
        pluginManifestSummary?: {
            schemaVersion: number;
            contracts?: {
                [x: string]: string[];
            } | undefined;
            providers?: string[] | undefined;
            channels?: string[] | undefined;
            categories?: string[] | undefined;
            icon?: string | undefined;
            compatibility?: {
                pluginApiRange?: string | undefined;
                builtWithOpenClawVersion?: string | undefined;
                pluginSdkVersion?: string | undefined;
                minGatewayVersion?: string | undefined;
            } | undefined;
            manifestIdentity?: {
                name?: string | undefined;
                description?: string | undefined;
                version?: string | undefined;
                family?: string | undefined;
            } | undefined;
            configFields: {
                name: string;
                description?: string | undefined;
                required: boolean;
                sensitive: boolean;
            }[];
            mcpServers: {
                name: string;
                url?: string | undefined;
                transport?: "sse" | "stdio" | "streamable-http" | undefined;
                auth?: "api-key" | "none" | "oauth" | undefined;
                scope?: string | undefined;
                setup?: string | undefined;
                endpointRedacted?: boolean | undefined;
            }[];
            bundledSkills: {
                name: string;
                description?: string | undefined;
                rootPath: string;
                skillMdPath: string;
                sha256: string;
                size: number;
            }[];
        } | null | undefined;
        templateManifestSummary?: import("./templates.js").TemplateManifestSummary | null | undefined;
        verification?: {
            tier: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural";
            scope: "artifact-only" | "dependency-graph-aware";
            summary?: string | undefined;
            sourceRepo?: string | undefined;
            sourceCommit?: string | undefined;
            sourceTag?: string | undefined;
            sourcePath?: string | undefined;
            hasProvenance?: boolean | undefined;
            trustedOpenClawPlugin?: boolean | undefined;
            scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
        } | null | undefined;
        artifact?: {
            kind: "legacy-zip" | "npm-pack";
            sha256?: string | undefined;
            size?: number | undefined;
            format?: string | undefined;
            npmIntegrity?: string | undefined;
            npmShasum?: string | undefined;
            npmTarballName?: string | undefined;
            npmUnpackedSize?: number | undefined;
            npmFileCount?: number | undefined;
            source?: "clawhub" | undefined;
            artifactKind?: "legacy-zip" | "npm-pack" | undefined;
            artifactSha256?: string | undefined;
            packageName?: string | undefined;
            version?: string | undefined;
        } | null | undefined;
        scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
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
        official?: boolean | undefined;
    } | null;
}, {}>;
export type ApiV1PackageResponse = (typeof ApiV1PackageResponseSchema)[inferred];
export type ApiV1PackageVersionListResponse = (typeof ApiV1PackageVersionListResponseSchema)[inferred];
export declare const ApiV1PackageVersionResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    package: {
        name: string;
        displayName: string;
        family: "bundle-plugin" | "code-plugin" | "skill" | "template";
    } | null;
    version: {
        version: string;
        createdAt: number;
        changelog: string;
        icon?: string | null | undefined;
        distTags?: string[] | undefined;
        files: unknown;
        compatibility?: {
            pluginApiRange?: string | undefined;
            builtWithOpenClawVersion?: string | undefined;
            pluginSdkVersion?: string | undefined;
            minGatewayVersion?: string | undefined;
        } | null | undefined;
        pluginManifestSummary?: {
            schemaVersion: number;
            contracts?: {
                [x: string]: string[];
            } | undefined;
            providers?: string[] | undefined;
            channels?: string[] | undefined;
            categories?: string[] | undefined;
            icon?: string | undefined;
            compatibility?: {
                pluginApiRange?: string | undefined;
                builtWithOpenClawVersion?: string | undefined;
                pluginSdkVersion?: string | undefined;
                minGatewayVersion?: string | undefined;
            } | undefined;
            manifestIdentity?: {
                name?: string | undefined;
                description?: string | undefined;
                version?: string | undefined;
                family?: string | undefined;
            } | undefined;
            configFields: {
                name: string;
                description?: string | undefined;
                required: boolean;
                sensitive: boolean;
            }[];
            mcpServers: {
                name: string;
                url?: string | undefined;
                transport?: "sse" | "stdio" | "streamable-http" | undefined;
                auth?: "api-key" | "none" | "oauth" | undefined;
                scope?: string | undefined;
                setup?: string | undefined;
                endpointRedacted?: boolean | undefined;
            }[];
            bundledSkills: {
                name: string;
                description?: string | undefined;
                rootPath: string;
                skillMdPath: string;
                sha256: string;
                size: number;
            }[];
        } | null | undefined;
        templateManifestSummary?: import("./templates.js").TemplateManifestSummary | null | undefined;
        verification?: {
            tier: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural";
            scope: "artifact-only" | "dependency-graph-aware";
            summary?: string | undefined;
            sourceRepo?: string | undefined;
            sourceCommit?: string | undefined;
            sourceTag?: string | undefined;
            sourcePath?: string | undefined;
            hasProvenance?: boolean | undefined;
            trustedOpenClawPlugin?: boolean | undefined;
            scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
        } | null | undefined;
        artifact?: {
            kind: "legacy-zip" | "npm-pack";
            sha256?: string | undefined;
            size?: number | undefined;
            format?: string | undefined;
            npmIntegrity?: string | undefined;
            npmShasum?: string | undefined;
            npmTarballName?: string | undefined;
            npmUnpackedSize?: number | undefined;
            npmFileCount?: number | undefined;
            source?: "clawhub" | undefined;
            artifactKind?: "legacy-zip" | "npm-pack" | undefined;
            artifactSha256?: string | undefined;
            packageName?: string | undefined;
            version?: string | undefined;
        } | null | undefined;
        sha256hash?: string | null | undefined;
        vtAnalysis?: {
            status: string;
            verdict?: string | undefined;
            analysis?: string | undefined;
            source?: string | undefined;
            checkedAt: number;
        } | null | undefined;
        skillSpectorAnalysis?: {
            status: string;
            inspectionStatus?: "completed" | "partial" | undefined;
            score?: number | undefined;
            severity?: string | undefined;
            recommendation?: string | undefined;
            issueCount: number;
            issues: {
                issueId: string;
                category?: string | undefined;
                pattern?: string | undefined;
                severity: string;
                confidence?: number | undefined;
                file?: string | undefined;
                startLine?: number | undefined;
                endLine?: number | undefined;
                explanation: string;
                remediation?: string | undefined;
                finding?: string | undefined;
                codeSnippet?: string | undefined;
            }[];
            scannerVersion?: string | undefined;
            summary?: string | undefined;
            error?: string | undefined;
            checkedAt: number;
        } | null | undefined;
        endorAnalysis?: {
            status: "completed";
            checkedAt: number;
            reachableFunctionCount: number;
            findings: {
                severity: string;
                summary: string;
            }[];
        } | {
            status: "failed" | "skipped";
            checkedAt: number;
            reason: string;
        } | null | undefined;
        aigAnalysis?: {
            status: string;
            issueCount: number;
            findings: {
                ruleId: string;
                level: string;
                message: string;
                title?: string | undefined;
                description?: string | undefined;
                file?: string | undefined;
                startLine?: number | undefined;
                endLine?: number | undefined;
                remediation?: string | undefined;
            }[];
            scannerVersion?: string | undefined;
            summary?: string | undefined;
            error?: string | undefined;
            checkedAt: number;
        } | null | undefined;
        llmAnalysis?: {
            status: string;
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
            agenticRiskFindings?: unknown[] | undefined;
            riskSummary?: unknown;
            model?: string | undefined;
            checkedAt: number;
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
export declare const ApiV1PackageVersionPublicationResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    version: string;
    state: "absent" | "published";
} | {
    name: string;
    version: string;
    state: "pending";
    stage: "staging";
} | {
    name: string;
    version: string;
    state: "pending";
    stage: "checks" | "finalization";
    attemptId: string;
} | {
    name: string;
    version: string;
    state: "failed";
    attemptId?: string | undefined;
    recoverable: boolean;
}, {}>;
export type ApiV1PackageVersionPublicationResponse = (typeof ApiV1PackageVersionPublicationResponseSchema)[inferred];
export declare const ApiV1PluginDetailResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    package: {
        name: string;
        displayName: string;
        family: "bundle-plugin" | "code-plugin" | "skill" | "template";
        templateProfilePolicyVersion?: 1 | undefined;
        runtimeId?: string | null | undefined;
        channel: "community" | "official" | "private";
        isOfficial: boolean;
        summary?: string | null | undefined;
        icon?: string | null | undefined;
        ownerHandle?: string | null | undefined;
        createdAt: number;
        updatedAt: number;
        latestVersion?: string | null | undefined;
        categories?: string[] | undefined;
        topics?: string[] | undefined;
        tags: unknown;
        compatibility?: {
            pluginApiRange?: string | undefined;
            builtWithOpenClawVersion?: string | undefined;
            pluginSdkVersion?: string | undefined;
            minGatewayVersion?: string | undefined;
        } | null | undefined;
        pluginManifestSummary?: {
            schemaVersion: number;
            contracts?: {
                [x: string]: string[];
            } | undefined;
            providers?: string[] | undefined;
            channels?: string[] | undefined;
            categories?: string[] | undefined;
            icon?: string | undefined;
            compatibility?: {
                pluginApiRange?: string | undefined;
                builtWithOpenClawVersion?: string | undefined;
                pluginSdkVersion?: string | undefined;
                minGatewayVersion?: string | undefined;
            } | undefined;
            manifestIdentity?: {
                name?: string | undefined;
                description?: string | undefined;
                version?: string | undefined;
                family?: string | undefined;
            } | undefined;
            configFields: {
                name: string;
                description?: string | undefined;
                required: boolean;
                sensitive: boolean;
            }[];
            mcpServers: {
                name: string;
                url?: string | undefined;
                transport?: "sse" | "stdio" | "streamable-http" | undefined;
                auth?: "api-key" | "none" | "oauth" | undefined;
                scope?: string | undefined;
                setup?: string | undefined;
                endpointRedacted?: boolean | undefined;
            }[];
            bundledSkills: {
                name: string;
                description?: string | undefined;
                rootPath: string;
                skillMdPath: string;
                sha256: string;
                size: number;
            }[];
        } | null | undefined;
        templateManifestSummary?: import("./templates.js").TemplateManifestSummary | null | undefined;
        verification?: {
            tier: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural";
            scope: "artifact-only" | "dependency-graph-aware";
            summary?: string | undefined;
            sourceRepo?: string | undefined;
            sourceCommit?: string | undefined;
            sourceTag?: string | undefined;
            sourcePath?: string | undefined;
            hasProvenance?: boolean | undefined;
            trustedOpenClawPlugin?: boolean | undefined;
            scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
        } | null | undefined;
        artifact?: {
            kind: "legacy-zip" | "npm-pack";
            sha256?: string | undefined;
            size?: number | undefined;
            format?: string | undefined;
            npmIntegrity?: string | undefined;
            npmShasum?: string | undefined;
            npmTarballName?: string | undefined;
            npmUnpackedSize?: number | undefined;
            npmFileCount?: number | undefined;
            source?: "clawhub" | undefined;
            artifactKind?: "legacy-zip" | "npm-pack" | undefined;
            artifactSha256?: string | undefined;
            packageName?: string | undefined;
            version?: string | undefined;
        } | null | undefined;
        scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
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
        official?: boolean | undefined;
    } | null;
    versions: {
        items: {
            version: string;
            createdAt: number;
            changelog: string;
            distTags?: string[] | undefined;
        }[];
        nextCursor: string | null;
    };
    version: {
        version: string;
        createdAt: number;
        changelog: string;
        icon?: string | null | undefined;
        distTags?: string[] | undefined;
        files: unknown;
        compatibility?: {
            pluginApiRange?: string | undefined;
            builtWithOpenClawVersion?: string | undefined;
            pluginSdkVersion?: string | undefined;
            minGatewayVersion?: string | undefined;
        } | null | undefined;
        pluginManifestSummary?: {
            schemaVersion: number;
            contracts?: {
                [x: string]: string[];
            } | undefined;
            providers?: string[] | undefined;
            channels?: string[] | undefined;
            categories?: string[] | undefined;
            icon?: string | undefined;
            compatibility?: {
                pluginApiRange?: string | undefined;
                builtWithOpenClawVersion?: string | undefined;
                pluginSdkVersion?: string | undefined;
                minGatewayVersion?: string | undefined;
            } | undefined;
            manifestIdentity?: {
                name?: string | undefined;
                description?: string | undefined;
                version?: string | undefined;
                family?: string | undefined;
            } | undefined;
            configFields: {
                name: string;
                description?: string | undefined;
                required: boolean;
                sensitive: boolean;
            }[];
            mcpServers: {
                name: string;
                url?: string | undefined;
                transport?: "sse" | "stdio" | "streamable-http" | undefined;
                auth?: "api-key" | "none" | "oauth" | undefined;
                scope?: string | undefined;
                setup?: string | undefined;
                endpointRedacted?: boolean | undefined;
            }[];
            bundledSkills: {
                name: string;
                description?: string | undefined;
                rootPath: string;
                skillMdPath: string;
                sha256: string;
                size: number;
            }[];
        } | null | undefined;
        templateManifestSummary?: import("./templates.js").TemplateManifestSummary | null | undefined;
        verification?: {
            tier: "provenance-verified" | "rebuild-verified" | "source-linked" | "structural";
            scope: "artifact-only" | "dependency-graph-aware";
            summary?: string | undefined;
            sourceRepo?: string | undefined;
            sourceCommit?: string | undefined;
            sourceTag?: string | undefined;
            sourcePath?: string | undefined;
            hasProvenance?: boolean | undefined;
            trustedOpenClawPlugin?: boolean | undefined;
            scanStatus?: "clean" | "malicious" | "not-run" | "pending" | "suspicious" | undefined;
        } | null | undefined;
        artifact?: {
            kind: "legacy-zip" | "npm-pack";
            sha256?: string | undefined;
            size?: number | undefined;
            format?: string | undefined;
            npmIntegrity?: string | undefined;
            npmShasum?: string | undefined;
            npmTarballName?: string | undefined;
            npmUnpackedSize?: number | undefined;
            npmFileCount?: number | undefined;
            source?: "clawhub" | undefined;
            artifactKind?: "legacy-zip" | "npm-pack" | undefined;
            artifactSha256?: string | undefined;
            packageName?: string | undefined;
            version?: string | undefined;
        } | null | undefined;
        sha256hash?: string | null | undefined;
        vtAnalysis?: {
            status: string;
            verdict?: string | undefined;
            analysis?: string | undefined;
            source?: string | undefined;
            checkedAt: number;
        } | null | undefined;
        skillSpectorAnalysis?: {
            status: string;
            inspectionStatus?: "completed" | "partial" | undefined;
            score?: number | undefined;
            severity?: string | undefined;
            recommendation?: string | undefined;
            issueCount: number;
            issues: {
                issueId: string;
                category?: string | undefined;
                pattern?: string | undefined;
                severity: string;
                confidence?: number | undefined;
                file?: string | undefined;
                startLine?: number | undefined;
                endLine?: number | undefined;
                explanation: string;
                remediation?: string | undefined;
                finding?: string | undefined;
                codeSnippet?: string | undefined;
            }[];
            scannerVersion?: string | undefined;
            summary?: string | undefined;
            error?: string | undefined;
            checkedAt: number;
        } | null | undefined;
        endorAnalysis?: {
            status: "completed";
            checkedAt: number;
            reachableFunctionCount: number;
            findings: {
                severity: string;
                summary: string;
            }[];
        } | {
            status: "failed" | "skipped";
            checkedAt: number;
            reason: string;
        } | null | undefined;
        aigAnalysis?: {
            status: string;
            issueCount: number;
            findings: {
                ruleId: string;
                level: string;
                message: string;
                title?: string | undefined;
                description?: string | undefined;
                file?: string | undefined;
                startLine?: number | undefined;
                endLine?: number | undefined;
                remediation?: string | undefined;
            }[];
            scannerVersion?: string | undefined;
            summary?: string | undefined;
            error?: string | undefined;
            checkedAt: number;
        } | null | undefined;
        llmAnalysis?: {
            status: string;
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
            agenticRiskFindings?: unknown[] | undefined;
            riskSummary?: unknown;
            model?: string | undefined;
            checkedAt: number;
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
    readme: string | null;
    security: {
        overview: string;
        verdict?: string | undefined;
        securityAuditUrl: string;
        package: {
            name: string;
            displayName: string;
            family: "bundle-plugin" | "code-plugin" | "skill" | "template";
        };
        release: {
            releaseId: string;
            version: string;
            artifactKind?: "legacy-zip" | "npm-pack" | null | undefined;
            artifactSha256?: string | undefined;
            npmIntegrity?: string | undefined;
            npmShasum?: string | undefined;
            npmTarballName?: string | undefined;
            createdAt: number;
            endorAnalysis?: {
                status: "completed";
                checkedAt: number;
                reachableFunctionCount: number;
                findings: {
                    severity: string;
                    summary: string;
                }[];
            } | {
                status: "failed" | "skipped";
                checkedAt: number;
                reason: string;
            } | null | undefined;
        };
        trust: {
            scanStatus: "clean" | "malicious" | "not-run" | "pending" | "suspicious";
            moderationState?: "approved" | "quarantined" | "revoked" | null | undefined;
            blockedFromDownload: boolean;
            reasons: string[];
            pending: boolean;
            stale: boolean;
        };
    } | null;
}, {}>;
export type ApiV1PluginDetailResponse = (typeof ApiV1PluginDetailResponseSchema)[inferred];
