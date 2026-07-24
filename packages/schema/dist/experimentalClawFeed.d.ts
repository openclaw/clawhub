import { type inferred } from "arktype";
export declare const EXPERIMENTAL_CLAW_FEED_SCHEMA_VERSION = 1;
export declare const EXPERIMENTAL_CLAW_FEED_ID = "clawhub-official-claws";
export declare const EXPERIMENTAL_CLAW_FEED_DESCRIPTION = "Claws published by verified OpenClaw publishers on ClawHub.";
export declare const ExperimentalClawFeedInstallCandidateSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sourceRef: "public-clawhub";
    package: string;
    version: string;
    integrity: string;
}, {}>;
export declare const ExperimentalClawFeedEntrySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    type: "claw";
    id: string;
    title: string;
    description?: string | undefined;
    icon?: string | undefined;
    version: string;
    state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
    publisher: {
        id: string;
        trust: "community" | "official";
    };
    clawManifestSummary: {
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
    };
    install: {
        candidates: {
            sourceRef: "public-clawhub";
            package: string;
            version: string;
            integrity: string;
        }[];
    };
}, {}>;
export type ExperimentalClawFeedEntry = (typeof ExperimentalClawFeedEntrySchema)[inferred];
export declare const ExperimentalClawFeedSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    id: string;
    generatedAt: string;
    sequence: number;
    expiresAt: string;
    description?: string | undefined;
    entries: {
        type: "claw";
        id: string;
        title: string;
        description?: string | undefined;
        icon?: string | undefined;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        clawManifestSummary: {
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
        };
        install: {
            candidates: {
                sourceRef: "public-clawhub";
                package: string;
                version: string;
                integrity: string;
            }[];
        };
    }[];
}, {}>;
export type ExperimentalClawFeed = (typeof ExperimentalClawFeedSchema)[inferred];
export declare function parseExperimentalClawFeed(value: unknown): ExperimentalClawFeed;
export declare function serializeExperimentalClawFeed(feed: ExperimentalClawFeed): string;
