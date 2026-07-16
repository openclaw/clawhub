import { type inferred } from "arktype";
export declare const PUBLISHER_FEED_SCHEMA_VERSION = 1;
export declare const PUBLISHER_FEED_DEFAULT_LIMIT = 50;
export declare const PUBLISHER_FEED_MAX_LIMIT = 100;
export declare const PublisherFeedEntryKindSchema: import("arktype/internal/variants/string.ts").StringType<"skill" | "plugin", {}>;
export type PublisherFeedEntryKind = (typeof PublisherFeedEntryKindSchema)[inferred];
export declare const PublisherFeedEntrySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    kind: "skill" | "plugin";
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
        kind: "skill" | "plugin";
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
export declare function publisherFeedId(publisherId: string): string;
export declare function parsePublisherFeed(value: unknown): PublisherFeed;
