import { type inferred } from 'arktype';
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
    } | null;
    owner: {
        handle: string | null;
        displayName?: string | null | undefined;
        image?: string | null | undefined;
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
export declare const ApiV1SkillVersionResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    version: {
        version: string;
        createdAt: number;
        changelog: string;
        changelogSource?: "user" | "auto" | null | undefined;
        files?: unknown;
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
}, {}>;
export type ClawdisSkillMetadata = (typeof ClawdisSkillMetadataSchema)[inferred];
