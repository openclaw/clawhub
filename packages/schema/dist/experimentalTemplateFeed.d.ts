import { type inferred } from "arktype";
export declare const EXPERIMENTAL_TEMPLATE_FEED_SCHEMA_VERSION = 1;
export declare const EXPERIMENTAL_TEMPLATE_FEED_ID = "clawhub-official-templates";
export declare const EXPERIMENTAL_TEMPLATE_FEED_DESCRIPTION = "Templates published by verified OpenClaw publishers on ClawHub.";
export declare const ExperimentalTemplateFeedInstallCandidateSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sourceRef: "public-clawhub";
    package: string;
    version: string;
    integrity: string;
}, {}>;
export declare const ExperimentalTemplateFeedEntrySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    type: "template";
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
    templateManifestSummary: import("./templates.js").TemplateManifestSummary;
    install: {
        candidates: {
            sourceRef: "public-clawhub";
            package: string;
            version: string;
            integrity: string;
        }[];
    };
}, {}>;
export type ExperimentalTemplateFeedEntry = (typeof ExperimentalTemplateFeedEntrySchema)[inferred];
export declare const ExperimentalTemplateFeedSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    id: string;
    generatedAt: string;
    sequence: number;
    expiresAt: string;
    description?: string | undefined;
    entries: {
        type: "template";
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
        templateManifestSummary: import("./templates.js").TemplateManifestSummary;
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
export type ExperimentalTemplateFeed = (typeof ExperimentalTemplateFeedSchema)[inferred];
export declare function parseExperimentalTemplateFeed(value: unknown): ExperimentalTemplateFeed;
export declare function serializeExperimentalTemplateFeed(feed: ExperimentalTemplateFeed): string;
