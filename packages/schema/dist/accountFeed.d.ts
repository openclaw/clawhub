import { type inferred } from "arktype";
export declare const PUBLISHER_FEED_SCHEMA_VERSION = 1;
export declare const PUBLISHER_FEED_DEFAULT_LIMIT = 50;
export declare const PUBLISHER_FEED_MAX_LIMIT = 100;
export declare const PUBLISHER_FEED_QUERY_MAX_LIMIT = 200;
export declare const PUBLISHER_FEED_CHANGE_MAX_LIMIT = 500;
export declare const PUBLISHER_FEED_SNAPSHOT_MAX_ENTRIES = 400;
export declare const PublisherFeedEntryKindSchema: import("arktype/internal/variants/string.ts").StringType<"plugin" | "skill", {}>;
export type PublisherFeedEntryKind = (typeof PublisherFeedEntryKindSchema)[inferred];
export declare const PublisherFeedEntrySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    kind: "plugin" | "skill";
    id: string;
    name: string;
    displayName: string;
    summary: string | null;
    url: string;
    updatedAt: number;
}, {}>;
export type PublisherFeedEntry = (typeof PublisherFeedEntrySchema)[inferred];
export declare const PublisherFeedSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    publisherId: string;
    handle: string | null;
    displayName: string;
    generatedAt: string;
    sequence: number;
    entries: {
        kind: "plugin" | "skill";
        id: string;
        name: string;
        displayName: string;
        summary: string | null;
        url: string;
        updatedAt: number;
    }[];
    nextCursor: string | null;
}, {}>;
export type PublisherFeed = (typeof PublisherFeedSchema)[inferred];
export declare const PublisherFeedSnapshotSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    publisherId: string;
    handle: string | null;
    displayName: string;
    generatedAt: string;
    expiresAt: string;
    sequence: number;
    entries: {
        kind: "plugin" | "skill";
        id: string;
        name: string;
        displayName: string;
        summary: string | null;
        url: string;
        updatedAt: number;
    }[];
}, {}>;
export type PublisherFeedSnapshot = (typeof PublisherFeedSnapshotSchema)[inferred];
export declare const PublisherFeedQuerySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    text?: string | undefined;
    kinds?: ("plugin" | "skill")[] | undefined;
}, {}>;
export type PublisherFeedQuery = (typeof PublisherFeedQuerySchema)[inferred];
export declare const PublisherFeedMetadataSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    publisherId: string;
    handle: string | null;
    displayName: string;
}, {}>;
export type PublisherFeedMetadata = (typeof PublisherFeedMetadataSchema)[inferred];
export declare const PublisherFeedUpsertChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "upsert";
    entry: {
        kind: "plugin" | "skill";
        id: string;
        name: string;
        displayName: string;
        summary: string | null;
        url: string;
        updatedAt: number;
    };
}, {}>;
export declare const PublisherFeedRemoveChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "remove";
    entryId: string;
    entryKind: "plugin" | "skill";
}, {}>;
export declare const PublisherFeedMetadataChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "metadata";
    metadata: {
        publisherId: string;
        handle: string | null;
        displayName: string;
    };
}, {}>;
export declare const PublisherFeedChangeSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    sequence: number;
    operation: "upsert";
    entry: {
        kind: "plugin" | "skill";
        id: string;
        name: string;
        displayName: string;
        summary: string | null;
        url: string;
        updatedAt: number;
    };
} | {
    sequence: number;
    operation: "remove";
    entryId: string;
    entryKind: "plugin" | "skill";
} | {
    sequence: number;
    operation: "metadata";
    metadata: {
        publisherId: string;
        handle: string | null;
        displayName: string;
    };
}, {}>;
export type PublisherFeedChange = (typeof PublisherFeedChangeSchema)[inferred];
export declare const PublisherFeedQueryPageSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    sequence: number;
    generatedAt: string;
    expiresAt: string;
    query: {
        text?: string | undefined;
        kinds?: ("plugin" | "skill")[] | undefined;
    };
    requestCursor: string | null;
    pageIndex: number;
    startIndex: number;
    resultCount: number;
    entries: {
        kind: "plugin" | "skill";
        id: string;
        name: string;
        displayName: string;
        summary: string | null;
        url: string;
        updatedAt: number;
    }[];
    nextCursor: string | null;
}, {}>;
export type PublisherFeedQueryPage = (typeof PublisherFeedQueryPageSchema)[inferred];
export declare const PublisherFeedChangePageSchema: import("arktype/internal/variants/object.ts").ObjectType<{
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
            kind: "plugin" | "skill";
            id: string;
            name: string;
            displayName: string;
            summary: string | null;
            url: string;
            updatedAt: number;
        };
    } | {
        sequence: number;
        operation: "remove";
        entryId: string;
        entryKind: "plugin" | "skill";
    } | {
        sequence: number;
        operation: "metadata";
        metadata: {
            publisherId: string;
            handle: string | null;
            displayName: string;
        };
    })[];
    nextCursor: string | null;
}, {}>;
export type PublisherFeedChangePage = (typeof PublisherFeedChangePageSchema)[inferred];
export declare const PublisherFeedResetRequiredSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    fromSequence: number;
    currentSequence: number;
    generatedAt: string;
    expiresAt: string;
    resetRequired: true;
    snapshotUrl: string;
}, {}>;
export type PublisherFeedResetRequired = (typeof PublisherFeedResetRequiredSchema)[inferred];
export declare function publisherFeedId(publisherId: string): string;
export declare function normalizePublisherFeedQuery(value: unknown): PublisherFeedQuery;
export declare function parsePublisherFeed(value: unknown): PublisherFeed;
export declare function parsePublisherFeedSnapshot(value: unknown): PublisherFeedSnapshot;
