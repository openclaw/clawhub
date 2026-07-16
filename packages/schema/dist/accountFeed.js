import { type } from "arktype";
export const PUBLISHER_FEED_SCHEMA_VERSION = 1;
export const PUBLISHER_FEED_DEFAULT_LIMIT = 50;
export const PUBLISHER_FEED_MAX_LIMIT = 100;
export const PublisherFeedEntryKindSchema = type('"skill"|"plugin"');
export const PublisherFeedEntrySchema = type({
    "+": "reject",
    kind: PublisherFeedEntryKindSchema,
    id: "string",
    name: "string",
    displayName: "string",
    summary: "string|null",
    url: "string",
    updatedAt: "number",
});
export const PublisherFeedSchema = type({
    "+": "reject",
    schemaVersion: "number",
    feedId: "string",
    publisherId: "string",
    handle: "string|null",
    displayName: "string",
    generatedAt: "string",
    sequence: "number",
    entries: PublisherFeedEntrySchema.array(),
    nextCursor: "string|null",
});
export function publisherFeedId(publisherId) {
    return `clawhub.publisher.${publisherId}`;
}
function containsAsciiControlCharacter(value) {
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x1f || codeUnit === 0x7f)
            return true;
    }
    return false;
}
export function parsePublisherFeed(value) {
    const feed = PublisherFeedSchema.assert(value);
    if (feed.schemaVersion !== PUBLISHER_FEED_SCHEMA_VERSION) {
        throw new Error(`Unsupported publisher feed schema version: ${feed.schemaVersion}`);
    }
    if (!feed.publisherId || feed.feedId !== publisherFeedId(feed.publisherId)) {
        throw new Error("Publisher feed id does not match its stable publisher identity");
    }
    if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
        throw new Error("Publisher feed sequence must be a non-negative integer");
    }
    if (!Number.isFinite(Date.parse(feed.generatedAt))) {
        throw new Error("Publisher feed generatedAt must be a valid ISO date");
    }
    for (const entry of feed.entries) {
        if (!entry.id || !entry.name || !entry.displayName) {
            throw new Error("Publisher feed entry identity fields must be non-empty");
        }
        if (!Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) {
            throw new Error("Publisher feed entry updatedAt must be a non-negative finite number");
        }
        if (entry.url.startsWith("/")) {
            if (entry.url.startsWith("//") ||
                entry.url.includes("\\") ||
                containsAsciiControlCharacter(entry.url)) {
                throw new Error("Publisher feed entry URL must be a safe origin-relative reference");
            }
            continue;
        }
        let url;
        try {
            url = new URL(entry.url);
        }
        catch {
            throw new Error("Publisher feed entry URL must be absolute HTTPS or origin-relative");
        }
        if (url.protocol !== "https:") {
            throw new Error("Publisher feed entry URL must be absolute HTTPS or origin-relative");
        }
    }
    return feed;
}
//# sourceMappingURL=accountFeed.js.map