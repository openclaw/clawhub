import { type } from "arktype";
export const CatalogFeedStateSchema = type('"available"|"recommended"|"disabled"|"blocked"|"deprecated"');
export const CatalogFeedPublisherTrustSchema = type('"official"|"community"');
export const CatalogFeedInstallCandidateSchema = type({
    "+": "reject",
    sourceRef: "string",
    package: "string",
    version: "string",
    integrity: "string",
});
export const CatalogFeedEntrySchema = type({
    "+": "reject",
    type: '"plugin"',
    id: "string",
    title: "string",
    version: "string",
    state: CatalogFeedStateSchema,
    publisher: {
        "+": "reject",
        id: "string",
        trust: CatalogFeedPublisherTrustSchema,
    },
    install: {
        "+": "reject",
        candidates: CatalogFeedInstallCandidateSchema.array(),
    },
});
export const CatalogFeedSchema = type({
    "+": "reject",
    schemaVersion: "number",
    id: "string",
    generatedAt: "string",
    sequence: "number",
    expiresAt: "string",
    description: "string?",
    entries: CatalogFeedEntrySchema.array(),
});
export const CATALOG_FEED_SCHEMA_VERSION = 1;
export const CATALOG_FEED_ID = "clawhub-official";
export const CATALOG_FEED_SOURCE_REF = "public-clawhub";
export function parseCatalogFeed(value) {
    const feed = CatalogFeedSchema.assert(value);
    if (feed.schemaVersion !== CATALOG_FEED_SCHEMA_VERSION) {
        throw new Error(`Unsupported catalog feed schema version: ${feed.schemaVersion}`);
    }
    if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
        throw new Error("Catalog feed sequence must be a non-negative integer");
    }
    if (!Number.isFinite(Date.parse(feed.generatedAt)) ||
        !Number.isFinite(Date.parse(feed.expiresAt))) {
        throw new Error("Catalog feed timestamps must be valid ISO dates");
    }
    if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt)) {
        throw new Error("Catalog feed expiresAt must be after generatedAt");
    }
    return feed;
}
export function serializeCatalogFeed(feed) {
    const parsed = parseCatalogFeed(feed);
    const entries = [...parsed.entries].sort((left, right) => left.id.localeCompare(right.id));
    return JSON.stringify({ ...parsed, entries });
}
//# sourceMappingURL=catalogFeed.js.map