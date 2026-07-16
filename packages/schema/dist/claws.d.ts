import { type inferred } from "arktype";
export declare const CLAW_SCHEMA_VERSION: 1;
export declare const CLAW_SUMMARY_AGENT_NAME_MAX_CHARS = 128;
export declare const CLAW_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS = 1024;
export declare const CLAW_BOOTSTRAP_FILE_NAMES: readonly ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"];
export declare const ClawManifestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: 1;
    agent: {
        id: string;
        name?: string | undefined;
        description?: string | undefined;
        identity?: {
            name?: string | undefined;
            theme?: string | undefined;
            emoji?: string | undefined;
            avatar?: string | undefined;
        } | undefined;
        groupChat?: {
            mentionPatterns?: string[] | undefined;
        } | undefined;
        sandbox?: {
            mode?: "all" | "non-main" | "off" | undefined;
            scope?: "agent" | "session" | "shared" | undefined;
            workspaceAccess?: "none" | "ro" | "rw" | undefined;
        } | undefined;
        tools?: {
            profile?: string | undefined;
            allow?: string[] | undefined;
            alsoAllow?: string[] | undefined;
            deny?: string[] | undefined;
            fs?: {
                workspaceOnly?: boolean | undefined;
            } | undefined;
        } | undefined;
        memorySearch?: {
            enabled?: boolean | undefined;
            rememberAcrossConversations?: boolean | undefined;
            sources?: ("memory" | "sessions")[] | undefined;
        } | undefined;
        heartbeat?: {
            every?: string | undefined;
            activeHours?: {
                start?: string | undefined;
                end?: string | undefined;
                timezone?: string | undefined;
            } | undefined;
            lightContext?: boolean | undefined;
            isolatedSession?: boolean | undefined;
            skipWhenBusy?: boolean | undefined;
            timeoutSeconds?: number | undefined;
        } | undefined;
        humanDelay?: {
            mode?: "custom" | "natural" | "off" | undefined;
            minMs?: number | undefined;
            maxMs?: number | undefined;
        } | undefined;
    };
    workspace?: {
        bootstrapFiles?: {
            "AGENTS.md"?: {
                source: string;
            } | undefined;
            "SOUL.md"?: {
                source: string;
            } | undefined;
            "IDENTITY.md"?: {
                source: string;
            } | undefined;
            "TOOLS.md"?: {
                source: string;
            } | undefined;
            "HEARTBEAT.md"?: {
                source: string;
            } | undefined;
        } | undefined;
        files?: {
            source: string;
            path: string;
        }[] | undefined;
    } | undefined;
    packages?: {
        kind: "plugin" | "skill";
        source: "clawhub";
        ref: string;
        version: string;
    }[] | undefined;
    mcpServers?: {
        [x: string]: {
            command: string;
            transport?: "stdio" | undefined;
            args?: string[] | undefined;
            env?: {
                [x: string]: string;
            } | undefined;
            toolFilter?: {
                include?: string[] | undefined;
                exclude?: string[] | undefined;
            } | undefined;
            timeout?: number | undefined;
            connectTimeout?: number | undefined;
        } | {
            url: string;
            transport: "sse" | "streamable-http";
            auth?: "oauth" | undefined;
            toolFilter?: {
                include?: string[] | undefined;
                exclude?: string[] | undefined;
            } | undefined;
            timeout?: number | undefined;
            connectTimeout?: number | undefined;
        };
    } | undefined;
    cronJobs?: {
        id: string;
        name?: string | undefined;
        schedule: {
            cron: string;
            timezone: string;
        };
        session: "isolated" | "main";
        message: string;
        delivery?: {
            mode: "announce" | "none";
            channel?: "last" | undefined;
        } | undefined;
    }[] | undefined;
}, {}>;
export type ClawManifest = (typeof ClawManifestSchema)[inferred];
export declare const ClawManifestSummarySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: 1;
    agent: {
        id: string;
        name?: string | undefined;
        description?: string | undefined;
    };
    workspace: {
        bootstrapFiles: string[];
        fileCount: number;
    };
    packages: {
        skillCount: number;
        pluginCount: number;
    };
    mcpServerCount: number;
    cronJobCount: number;
}, {}>;
export type ClawManifestSummary = (typeof ClawManifestSummarySchema)[inferred];
export type ClawManifestValidationIssue = {
    path: string;
    message: string;
};
export declare function validateClawManifest(value: unknown): {
    ok: true;
    manifest: ClawManifest;
} | {
    ok: false;
    issues: ClawManifestValidationIssue[];
};
export declare function summarizeClawManifest(manifest: ClawManifest): ClawManifestSummary;
