import type { CatalogFeedEntry, CatalogFeedInstallCandidate } from "./catalogFeed.js";
export declare const OPENCLAW_REGISTRY_EXPORT_SCHEMA_VERSION = 1;
export type OpenClawRegistryExportReflectedState = "pending" | "reviewed" | "rejected" | "scan_pending" | "scan_passed" | "scan_failed" | "registry_included" | "registry_removed";
export type OpenClawRegistryExportInput = {
    feedId: string;
    feedSequence: number;
    feedPayloadDigest?: string | null;
    entry: CatalogFeedEntry;
    candidate?: CatalogFeedInstallCandidate;
    exportedAt: string;
    exportActorId?: string | null;
};
export type OpenClawRegistryExport = {
    schemaVersion: typeof OPENCLAW_REGISTRY_EXPORT_SCHEMA_VERSION;
    exportId: string;
    idempotencyKey: string;
    exportedAt: string;
    exportActorId: string | null;
    clawhub: {
        feed: {
            id: string;
            sequence: number;
            payloadDigest: string | null;
            entryId: string;
            entryState: CatalogFeedEntry["state"];
        };
        publisher: {
            id: string;
            official: boolean;
        };
        candidate: {
            kind: CatalogFeedEntry["type"];
            id: string;
            title: string;
            package: string;
            version: string;
            sourceRef: string;
            artifactDigest: string;
            sourceType: "clawhub" | "github" | "other";
            github: CatalogFeedInstallCandidate["github"] | null;
        };
        scanState: null;
        reviewState: null;
    };
    openclaw: {
        reviewState: OpenClawRegistryExportReflectedState | null;
        scanState: OpenClawRegistryExportReflectedState | null;
        registryState: OpenClawRegistryExportReflectedState | null;
        reviewId: string | null;
    };
};
export declare function buildOpenClawRegistryExport(input: OpenClawRegistryExportInput): OpenClawRegistryExport;
