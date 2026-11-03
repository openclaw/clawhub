import { type inferred } from "arktype";
import { type ClawdisRequires, type EnvVarDeclaration, type SkillInstallSpec } from "./schemaShared.js";
export * from "./schemaShared.js";
export declare const LockfileSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    version: 1;
    skills: {
        [x: string]: {
            version: string | null;
            installedAt: number;
            ownerHandle?: string | undefined;
            sourceRef?: string | undefined;
            pinned?: boolean | undefined;
            pinReason?: string | undefined;
        };
    };
}, {}>;
export type Lockfile = (typeof LockfileSchema)[inferred];
export declare const ApiV1SearchResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    results: {
        slug?: string | undefined;
        ownerHandle?: string | null | undefined;
        displayName?: string | undefined;
        summary?: string | null | undefined;
        version?: string | null | undefined;
        score: number;
        downloads?: number | undefined;
        updatedAt?: number | undefined;
        owner?: {
            handle?: string | null | undefined;
            displayName?: string | null | undefined;
            image?: string | null | undefined;
        } | null | undefined;
    }[];
}, {}>;
export declare const ApiV1SkillListResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    items: {
        ownerHandle: string;
        slug: string;
        displayName: string;
        summary?: string | null | undefined;
        description?: string | null | undefined;
        topics?: string[] | undefined;
        tags: unknown;
        stats: unknown;
        createdAt: number;
        updatedAt: number;
        latestVersion: {
            version: string;
            createdAt: number;
            changelog: string;
            license?: "MIT-0" | null | undefined;
        } | null;
        metadata?: {
            setup: {
                key: string;
                required: boolean;
            }[];
            os?: string[] | null | undefined;
            systems?: string[] | null | undefined;
        } | null | undefined;
    }[];
    nextCursor: string | null;
}, {}>;
export declare const ApiV1SkillResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    skill: {
        slug: string;
        displayName: string;
        summary?: string | null | undefined;
        description?: string | null | undefined;
        topics?: string[] | undefined;
        tags: unknown;
        stats: unknown;
        createdAt: number;
        updatedAt: number;
    } | null;
    latestVersion: {
        version: string;
        createdAt: number;
        changelog: string;
        license?: "MIT-0" | null | undefined;
    } | null;
    metadata?: {
        setup: {
            key: string;
            required: boolean;
        }[];
        os?: string[] | null | undefined;
        systems?: string[] | null | undefined;
    } | null | undefined;
    owner: {
        handle: string | null;
        displayName?: string | null | undefined;
        image?: string | null | undefined;
    } | null;
    moderation?: {
        isSuspicious: boolean;
        isMalwareBlocked: boolean;
        verdict?: "clean" | "malicious" | "suspicious" | undefined;
        reasonCodes?: string[] | undefined;
        updatedAt?: number | null | undefined;
        engineVersion?: string | null | undefined;
        summary?: string | null | undefined;
    } | null | undefined;
}, {}>;
export declare const ApiV1SkillScanBatchStatusResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    missing: number;
    terminal: number;
    done: boolean;
    failedJobIds: string[];
    queuedJobIds?: string[] | undefined;
}, {}>;
export type ApiV1SkillScanBatchStatusResponse = (typeof ApiV1SkillScanBatchStatusResponseSchema)[inferred];
export declare const SecurityStatusSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    status: "clean" | "error" | "malicious" | "pending" | "suspicious";
    hasWarnings: boolean;
    checkedAt: number | null;
    model: string | null;
}, {}>;
export declare const ApiV1SkillVersionResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    version: {
        version: string;
        createdAt: number;
        changelog: string;
        changelogSource?: "auto" | "user" | null | undefined;
        license?: "MIT-0" | null | undefined;
        files?: unknown;
        security?: {
            status: "clean" | "error" | "malicious" | "pending" | "suspicious";
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
export declare const DependencyDeclarationSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    name: string;
    type: "apt" | "brew" | "cargo" | "go" | "npm" | "other" | "pip";
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
        id?: string | undefined;
        kind: "brew" | "go" | "node" | "uv";
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
        type: "apt" | "brew" | "cargo" | "go" | "npm" | "other" | "pip";
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
