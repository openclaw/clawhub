import { type inferred } from "arktype";
export declare const CatalogFeedStateSchema: import("arktype/internal/variants/string.ts").StringType<"available" | "recommended" | "disabled" | "blocked" | "deprecated", {}>;
export type CatalogFeedState = (typeof CatalogFeedStateSchema)[inferred];
export declare const CatalogFeedPublisherTrustSchema: import("arktype/internal/variants/string.ts").StringType<"official" | "community", {}>;
export type CatalogFeedPublisherTrust = (typeof CatalogFeedPublisherTrustSchema)[inferred];
export declare const CatalogFeedInstallCandidateSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sourceRef: string;
    package: string;
    version: string;
    integrity: string;
}, {}>;
export type CatalogFeedInstallCandidate = (typeof CatalogFeedInstallCandidateSchema)[inferred];
export declare const CatalogFeedEntrySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    type: "plugin";
    id: string;
    title: string;
    version: string;
    state: "available" | "recommended" | "disabled" | "blocked" | "deprecated";
    publisher: {
        id: string;
        trust: "official" | "community";
    };
    install: {
        candidates: {
            sourceRef: string;
            package: string;
            version: string;
            integrity: string;
        }[];
    };
}, {}>;
export type CatalogFeedEntry = (typeof CatalogFeedEntrySchema)[inferred];
export declare const CatalogFeedSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    id: string;
    generatedAt: string;
    sequence: number;
    expiresAt: string;
    entries: {
        type: "plugin";
        id: string;
        title: string;
        version: string;
        state: "available" | "recommended" | "disabled" | "blocked" | "deprecated";
        publisher: {
            id: string;
            trust: "official" | "community";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
            }[];
        };
    }[];
    description?: string | undefined;
}, {}>;
export type CatalogFeed = (typeof CatalogFeedSchema)[inferred];
export declare const CATALOG_FEED_SCHEMA_VERSION = 1;
export declare const CATALOG_FEED_ID = "clawhub-official";
export declare const CATALOG_FEED_SOURCE_REF = "public-clawhub";
export declare function parseCatalogFeed(value: unknown): CatalogFeed;
export declare function serializeCatalogFeed(feed: CatalogFeed): string;
