import { type inferred } from "arktype";
export declare const GlobalConfigSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    registry: string;
    token?: string | undefined;
}, {}>;
export type GlobalConfig = (typeof GlobalConfigSchema)[inferred];
export declare const WellKnownConfigSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    apiBase: string;
    authBase?: string | undefined;
    minCliVersion?: string | undefined;
} | {
    registry: string;
    authBase?: string | undefined;
    minCliVersion?: string | undefined;
}, {}>;
export type WellKnownConfig = (typeof WellKnownConfigSchema)[inferred];
export declare const LockfileSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    version: 1;
    skills: {
        [x: string]: {
            version: string | null;
            installedAt: number;
        };
    };
}, {}>;
export type Lockfile = (typeof LockfileSchema)[inferred];
export declare const ApiCliWhoamiResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    user: {
        handle: string | null;
    };
}, {}>;
export declare const ApiSearchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    results: {
        score: number;
        slug?: string | undefined;
        displayName?: string | undefined;
        version?: string | null | undefined;
    }[];
}, {}>;
export declare const ApiSkillMetaResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    latestVersion?: {
        version: string;
    } | undefined;
    skill?: unknown;
}, {}>;
export declare const ApiCliUploadUrlResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    uploadUrl: string;
}, {}>;
export declare const ApiUploadFileResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    storageId: string;
}, {}>;
export declare const CliPublishFileSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    path: string;
    size: number;
    storageId: string;
    sha256: string;
    contentType?: string | undefined;
}, {}>;
export type CliPublishFile = (typeof CliPublishFileSchema)[inferred];
export declare const PublishSourceSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    kind: "github";
    url: string;
    repo: string;
    ref: string;
    commit: string;
    path: string;
    importedAt: number;
}, {}>;
export declare const CliPublishRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    slug: string;
    displayName: string;
    version: string;
    changelog: string;
    files: {
        path: string;
        size: number;
        storageId: string;
        sha256: string;
        contentType?: string | undefined;
    }[];
    acceptLicenseTerms?: boolean | undefined;
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
    forkOf?: {
        slug: string;
        version?: string | undefined;
    } | undefined;
}, {}>;
export type CliPublishRequest = (typeof CliPublishRequestSchema)[inferred];
export declare const ApiCliPublishResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    skillId: string;
    versionId: string;
}, {}>;
export declare const CliSkillDeleteRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    slug: string;
}, {}>;
export type CliSkillDeleteRequest = (typeof CliSkillDeleteRequestSchema)[inferred];
export declare const ApiCliSkillDeleteResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
}, {}>;
export declare const ApiSkillResolveResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    match: {
        version: string;
    } | null;
    latestVersion: {
        version: string;
    } | null;
}, {}>;
export declare const CliTelemetrySyncRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    roots: {
        rootId: string;
        label: string;
        skills: {
            slug: string;
            version?: string | null | undefined;
        }[];
    }[];
}, {}>;
export type CliTelemetrySyncRequest = (typeof CliTelemetrySyncRequestSchema)[inferred];
export declare const ApiCliTelemetrySyncResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
}, {}>;
export declare const ApiV1WhoamiResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    user: {
        handle: string | null;
        displayName?: string | null | undefined;
        image?: string | null | undefined;
    };
}, {}>;
export declare const ApiV1UserSearchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        userId: string;
        handle: string | null;
        displayName?: string | null | undefined;
        name?: string | null | undefined;
        role?: "user" | "admin" | "moderator" | null | undefined;
    }[];
    total: number;
}, {}>;
export declare const ApiV1SearchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    results: {
        score: number;
        slug?: string | undefined;
        displayName?: string | undefined;
        summary?: string | null | undefined;
        version?: string | null | undefined;
        updatedAt?: number | undefined;
    }[];
}, {}>;
export declare const ApiV1SkillListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        slug: string;
        displayName: string;
        tags: unknown;
        stats: unknown;
        createdAt: number;
        updatedAt: number;
        summary?: string | null | undefined;
        latestVersion?: {
            version: string;
            createdAt: number;
            changelog: string;
            license?: "MIT-0" | null | undefined;
        } | undefined;
    }[];
    nextCursor: string | null;
}, {}>;
export declare const ApiV1SkillResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    skill: {
        slug: string;
        displayName: string;
        tags: unknown;
        stats: unknown;
        createdAt: number;
        updatedAt: number;
        summary?: string | null | undefined;
    } | null;
    latestVersion: {
        version: string;
        createdAt: number;
        changelog: string;
        license?: "MIT-0" | null | undefined;
    } | null;
    owner: {
        handle: string | null;
        displayName?: string | null | undefined;
        image?: string | null | undefined;
    } | null;
    moderation?: {
        isSuspicious: boolean;
        isMalwareBlocked: boolean;
        verdict?: "clean" | "suspicious" | "malicious" | undefined;
        reasonCodes?: string[] | undefined;
        updatedAt?: number | null | undefined;
        engineVersion?: string | null | undefined;
        summary?: string | null | undefined;
    } | null | undefined;
}, {}>;
export declare const ApiV1SkillModerationResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    moderation: {
        isSuspicious: boolean;
        isMalwareBlocked: boolean;
        verdict: "clean" | "suspicious" | "malicious";
        reasonCodes: string[];
        evidence: {
            code: string;
            severity: "info" | "warn" | "critical";
            file: string;
            line: number;
            message: string;
            evidence: string;
        }[];
        updatedAt?: number | null | undefined;
        engineVersion?: string | null | undefined;
        summary?: string | null | undefined;
        legacyReason?: string | null | undefined;
    } | null;
}, {}>;
export declare const ApiV1SkillVersionListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        version: string;
        createdAt: number;
        changelog: string;
        changelogSource?: "user" | "auto" | null | undefined;
    }[];
    nextCursor: string | null;
}, {}>;
export declare const SecurityStatusSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    status: "clean" | "suspicious" | "malicious" | "pending" | "error";
    hasWarnings: boolean;
    checkedAt: number | null;
    model: string | null;
}, {}>;
export declare const ApiV1SkillVersionResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    version: {
        version: string;
        createdAt: number;
        changelog: string;
        changelogSource?: "user" | "auto" | null | undefined;
        license?: "MIT-0" | null | undefined;
        files?: unknown;
        security?: {
            status: "clean" | "suspicious" | "malicious" | "pending" | "error";
            hasWarnings: boolean;
            checkedAt: number | null;
            model: string | null;
        } | undefined;
    } | null;
    skill: {
        slug: string;
        displayName: string;
    } | null;
}, {}>;
export declare const ApiV1SkillResolveResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    match: {
        version: string;
    } | null;
    latestVersion: {
        version: string;
    } | null;
}, {}>;
export declare const ApiV1PublishResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    skillId: string;
    versionId: string;
}, {}>;
export declare const ApiV1DeleteResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
}, {}>;
export declare const ApiV1SkillRenameResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    slug: string;
    previousSlug: string;
}, {}>;
export declare const ApiV1SkillMergeResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    sourceSlug: string;
    targetSlug: string;
}, {}>;
export declare const ApiV1TransferRequestResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    transferId: string;
    toUserHandle: string;
    expiresAt: number;
}, {}>;
export declare const ApiV1TransferDecisionResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    skillSlug?: string | undefined;
}, {}>;
export declare const ApiV1TransferListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    transfers: {
        _id: string;
        skill: {
            _id: string;
            slug: string;
            displayName: string;
        };
        requestedAt: number;
        expiresAt: number;
        fromUser?: {
            _id: string;
            handle: string | null;
            displayName: string | null;
        } | undefined;
        toUser?: {
            _id: string;
            handle: string | null;
            displayName: string | null;
        } | undefined;
        message?: string | undefined;
    }[];
}, {}>;
export declare const ApiV1SetRoleResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    role: "user" | "admin" | "moderator";
}, {}>;
export declare const ApiV1StarResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    starred: boolean;
    alreadyStarred: boolean;
}, {}>;
export declare const ApiV1UnstarResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    unstarred: boolean;
    alreadyUnstarred: boolean;
}, {}>;
export declare const SkillInstallSpecSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    kind: "brew" | "node" | "go" | "uv";
    id?: string | undefined;
    label?: string | undefined;
    bins?: string[] | undefined;
    formula?: string | undefined;
    tap?: string | undefined;
    package?: string | undefined;
    module?: string | undefined;
}, {}>;
export type SkillInstallSpec = (typeof SkillInstallSpecSchema)[inferred];
export declare const NixPluginSpecSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    plugin: string;
    systems?: string[] | undefined;
}, {}>;
export type NixPluginSpec = (typeof NixPluginSpecSchema)[inferred];
export declare const ClawdbotConfigSpecSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    requiredEnv?: string[] | undefined;
    stateDirs?: string[] | undefined;
    example?: string | undefined;
}, {}>;
export type ClawdbotConfigSpec = (typeof ClawdbotConfigSpecSchema)[inferred];
export declare const ClawdisRequiresSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    bins?: string[] | undefined;
    anyBins?: string[] | undefined;
    env?: string[] | undefined;
    config?: string[] | undefined;
}, {}>;
export type ClawdisRequires = (typeof ClawdisRequiresSchema)[inferred];
export declare const EnvVarDeclarationSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    required?: boolean | undefined;
    description?: string | undefined;
}, {}>;
export type EnvVarDeclaration = (typeof EnvVarDeclarationSchema)[inferred];
export declare const DependencyDeclarationSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    type: "brew" | "go" | "pip" | "npm" | "cargo" | "apt" | "other";
    version?: string | undefined;
    url?: string | undefined;
    repository?: string | undefined;
}, {}>;
export type DependencyDeclaration = (typeof DependencyDeclarationSchema)[inferred];
export declare const SkillLinksSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    homepage?: string | undefined;
    repository?: string | undefined;
    documentation?: string | undefined;
    changelog?: string | undefined;
}, {}>;
export type SkillLinks = (typeof SkillLinksSchema)[inferred];
export declare const ClawdisSkillMetadataSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    always?: boolean | undefined;
    skillKey?: string | undefined;
    primaryEnv?: string | undefined;
    emoji?: string | undefined;
    homepage?: string | undefined;
    os?: string[] | undefined;
    cliHelp?: string | undefined;
    requires?: {
        bins?: string[] | undefined;
        anyBins?: string[] | undefined;
        env?: string[] | undefined;
        config?: string[] | undefined;
    } | undefined;
    install?: {
        kind: "brew" | "node" | "go" | "uv";
        id?: string | undefined;
        label?: string | undefined;
        bins?: string[] | undefined;
        formula?: string | undefined;
        tap?: string | undefined;
        package?: string | undefined;
        module?: string | undefined;
    }[] | undefined;
    nix?: {
        plugin: string;
        systems?: string[] | undefined;
    } | undefined;
    config?: {
        requiredEnv?: string[] | undefined;
        stateDirs?: string[] | undefined;
        example?: string | undefined;
    } | undefined;
    envVars?: {
        name: string;
        required?: boolean | undefined;
        description?: string | undefined;
    }[] | undefined;
    dependencies?: {
        name: string;
        type: "brew" | "go" | "pip" | "npm" | "cargo" | "apt" | "other";
        version?: string | undefined;
        url?: string | undefined;
        repository?: string | undefined;
    }[] | undefined;
    author?: string | undefined;
    links?: {
        homepage?: string | undefined;
        repository?: string | undefined;
        documentation?: string | undefined;
        changelog?: string | undefined;
    } | undefined;
}, {}>;
export type ClawdisSkillMetadata = {
    always?: boolean;
    skillKey?: string;
    primaryEnv?: string;
    emoji?: string;
    homepage?: string;
    os?: string[];
    cliHelp?: string;
    requires?: ClawdisRequires;
    install?: SkillInstallSpec[];
    nix?: NixPluginSpec;
    config?: ClawdbotConfigSpec;
    envVars?: EnvVarDeclaration[];
    dependencies?: DependencyDeclaration[];
    author?: string;
    links?: SkillLinks;
};
