import { type inferred } from "arktype";
import { type CatalogFeedEntry } from "./catalogFeed.js";
export declare const CATALOG_FEED_SHARD_ROOT_PAYLOAD_TYPE = "openclaw.official-external-plugin-catalog-shard-root.v1";
export declare const CATALOG_SKILLS_FEED_SHARD_ROOT_PAYLOAD_TYPE = "openclaw.official-skills-catalog-shard-root.v1";
export declare const CATALOG_FEED_SHARD_MAX_BYTES: number;
export declare const CATALOG_FEED_SHARD_MAX_ENTRIES = 10000;
export declare const CATALOG_FEED_SHARD_ROOT_MAX_SHARDS = 1024;
export declare const CATALOG_FEED_SHARD_ROOT_MAX_ENTRIES = 1000000;
export declare const CATALOG_FEED_SHARD_SET_MAX_BYTES: number;
export declare const CatalogFeedShardDescriptorSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    index: number;
    url: string;
    sha256: string;
    byteLength: number;
    entryCount: number;
}, {}>;
export type CatalogFeedShardDescriptor = (typeof CatalogFeedShardDescriptorSchema)[inferred];
export declare const CatalogFeedShardRootSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    sequence: number;
    generatedAt: string;
    expiresAt: string;
    metadata: {
        description: string | null;
    };
    entryCount: number;
    shards: {
        index: number;
        url: string;
        sha256: string;
        byteLength: number;
        entryCount: number;
    }[];
}, {}>;
export type CatalogFeedShardRoot = (typeof CatalogFeedShardRootSchema)[inferred];
export declare const CatalogFeedShardSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    feedId: string;
    sequence: number;
    index: number;
    entries: ({
        id: string;
        title: string;
        description?: string | undefined;
        icon?: string | undefined;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        featuredAt?: number | undefined;
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
        description?: string | undefined;
        icon?: string | undefined;
        version: string;
        state: "available" | "blocked" | "deprecated" | "disabled" | "recommended";
        featured?: boolean | undefined;
        featuredAt?: number | undefined;
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
}, {}>;
export type CatalogFeedShard = (typeof CatalogFeedShardSchema)[inferred];
export declare function parseCatalogFeedShardRoot(value: unknown): CatalogFeedShardRoot;
export declare function parseCatalogFeedShard(value: unknown): CatalogFeedShard;
export declare function serializeCatalogFeedShard(shard: CatalogFeedShard): string;
export declare function serializeCatalogFeedShardRoot(root: CatalogFeedShardRoot): string;
export declare function validateCatalogFeedShardSet(rootValue: unknown, shardPayloads: readonly string[]): Promise<{
    root: CatalogFeedShardRoot;
    shards: CatalogFeedShard[];
    entries: CatalogFeedEntry[];
}>;
