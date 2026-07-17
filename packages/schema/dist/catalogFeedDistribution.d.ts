import { type inferred } from "arktype";
export declare const CATALOG_FEED_QUERY_PAYLOAD_TYPE = "openclaw.official-external-plugin-catalog-query-results.v1";
export declare const CATALOG_FEED_CHANGES_PAYLOAD_TYPE = "openclaw.official-external-plugin-catalog-changes.v1";
export declare const CATALOG_FEED_QUERY_MAX_ENTRIES = 200;
export declare const CATALOG_FEED_CHANGES_MAX_RECORDS = 500;
export declare const CATALOG_FEED_DESCRIPTION_MAX_BYTES = 1024;
export declare const CatalogFeedQuerySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    text?: string | undefined;
    types?: ("plugin" | "skill")[] | undefined;
    states?: ("available" | "blocked" | "deprecated" | "disabled" | "recommended")[] | undefined;
    publisherIds?: string[] | undefined;
}, {}>;
export type CatalogFeedQuery = (typeof CatalogFeedQuerySchema)[inferred];
export declare const CatalogFeedMetadataSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    description: string | null;
}, {}>;
export type CatalogFeedMetadata = (typeof CatalogFeedMetadataSchema)[inferred];
export declare const CatalogFeedUpsertChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "upsert";
    entry: {
        id: string;
        title: string;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
                github?: {
                    repo: string;
                    path: string;
                    commit: string;
                    contentHash: string;
                } | undefined;
            }[];
        };
        type: "plugin";
    } | {
        id: string;
        title: string;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
                github?: {
                    repo: string;
                    path: string;
                    commit: string;
                    contentHash: string;
                } | undefined;
            }[];
        };
        type: "skill";
    };
}, {}>;
export declare const CatalogFeedRemoveChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "remove";
    entryId: string;
    entryType: "plugin" | "skill";
}, {}>;
export declare const CatalogFeedMetadataChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "metadata";
    metadata: {
        description: string | null;
    };
}, {}>;
export declare const CatalogFeedChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "upsert";
    entry: {
        id: string;
        title: string;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
                github?: {
                    repo: string;
                    path: string;
                    commit: string;
                    contentHash: string;
                } | undefined;
            }[];
        };
        type: "plugin";
    } | {
        id: string;
        title: string;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
                github?: {
                    repo: string;
                    path: string;
                    commit: string;
                    contentHash: string;
                } | undefined;
            }[];
        };
        type: "skill";
    };
} | {
    sequence: number;
    operation: "remove";
    entryId: string;
    entryType: "plugin" | "skill";
} | {
    sequence: number;
    operation: "metadata";
    metadata: {
        description: string | null;
    };
}, {}>;
export type CatalogFeedChange = (typeof CatalogFeedChangeSchema)[inferred];
export declare const CatalogFeedQueryPageSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    sequence: number;
    generatedAt: string;
    expiresAt: string;
    query: {
        text?: string | undefined;
        types?: ("plugin" | "skill")[] | undefined;
        states?: ("available" | "blocked" | "deprecated" | "disabled" | "recommended")[] | undefined;
        publisherIds?: string[] | undefined;
    };
    requestCursor: string | null;
    pageIndex: number;
    startIndex: number;
    resultCount: number;
    entries: ({
        id: string;
        title: string;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
                github?: {
                    repo: string;
                    path: string;
                    commit: string;
                    contentHash: string;
                } | undefined;
            }[];
        };
        type: "plugin";
    } | {
        id: string;
        title: string;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        publisher: {
            id: string;
            trust: "community" | "official";
        };
        install: {
            candidates: {
                sourceRef: string;
                package: string;
                version: string;
                integrity: string;
                github?: {
                    repo: string;
                    path: string;
                    commit: string;
                    contentHash: string;
                } | undefined;
            }[];
        };
        type: "skill";
    })[];
    nextCursor: string | null;
}, {}>;
export type CatalogFeedQueryPage = (typeof CatalogFeedQueryPageSchema)[inferred];
export declare const CatalogFeedChangePageSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    fromSequence: number;
    toSequence: number;
    generatedAt: string;
    expiresAt: string;
    requestCursor: string | null;
    pageIndex: number;
    startIndex: number;
    changeCount: number;
    changes: ({
        sequence: number;
        operation: "upsert";
        entry: {
            id: string;
            title: string;
            version: string;
            state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
            featured?: boolean | undefined;
            publisher: {
                id: string;
                trust: "community" | "official";
            };
            install: {
                candidates: {
                    sourceRef: string;
                    package: string;
                    version: string;
                    integrity: string;
                    github?: {
                        repo: string;
                        path: string;
                        commit: string;
                        contentHash: string;
                    } | undefined;
                }[];
            };
            type: "plugin";
        } | {
            id: string;
            title: string;
            version: string;
            state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
            featured?: boolean | undefined;
            publisher: {
                id: string;
                trust: "community" | "official";
            };
            install: {
                candidates: {
                    sourceRef: string;
                    package: string;
                    version: string;
                    integrity: string;
                    github?: {
                        repo: string;
                        path: string;
                        commit: string;
                        contentHash: string;
                    } | undefined;
                }[];
            };
            type: "skill";
        };
    } | {
        sequence: number;
        operation: "remove";
        entryId: string;
        entryType: "plugin" | "skill";
    } | {
        sequence: number;
        operation: "metadata";
        metadata: {
            description: string | null;
        };
    })[];
    nextCursor: string | null;
}, {}>;
export type CatalogFeedChangePage = (typeof CatalogFeedChangePageSchema)[inferred];
export declare const CatalogFeedResetRequiredSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    fromSequence: number;
    currentSequence: number;
    generatedAt: string;
    expiresAt: string;
    resetRequired: true;
    snapshotUrl: string;
}, {}>;
export type CatalogFeedResetRequired = (typeof CatalogFeedResetRequiredSchema)[inferred];
export declare function normalizeCatalogFeedQuery(value: unknown): CatalogFeedQuery;
export declare function parseCatalogFeedQueryPage(value: unknown): CatalogFeedQueryPage;
export declare function parseCatalogFeedQueryPages(values: readonly unknown[]): CatalogFeedQueryPage[];
export declare function parseCatalogFeedChangePage(value: unknown): CatalogFeedChangePage;
export declare function parseCatalogFeedChangePages(values: readonly unknown[]): CatalogFeedChangePage[];
export declare function parseCatalogFeedResetRequired(value: unknown): CatalogFeedResetRequired;
