import { type } from "arktype";
export const ACCOUNT_FEED_SCHEMA_VERSION = 1;
export const ACCOUNT_FEED_DEFAULT_LIMIT = 50;
export const ACCOUNT_FEED_MAX_LIMIT = 100;
export const AccountFeedEntryKindSchema = type('"skill"|"plugin"');
export const AccountFeedEntrySchema = type({
    "+": "reject",
    kind: AccountFeedEntryKindSchema,
    id: "string",
    name: "string",
    displayName: "string",
    summary: "string|null",
    url: "string",
    updatedAt: "number",
});
export const AccountFeedSchema = type({
    "+": "reject",
    schemaVersion: "number",
    feedId: "string",
    scope: '"account"|"publisher"',
    accountId: "string|null",
    publisherId: "string|null",
    handle: "string|null",
    displayName: "string",
    generatedAt: "string",
    sequence: "number",
    entries: AccountFeedEntrySchema.array(),
    nextCursor: "string|null",
});
export function accountFeedId(scope, stableId) {
    return `clawhub.${scope}.${stableId}`;
}
export function parseAccountFeed(value) {
    const feed = AccountFeedSchema.assert(value);
    if (feed.schemaVersion !== ACCOUNT_FEED_SCHEMA_VERSION) {
        throw new Error(`Unsupported account feed schema version: ${feed.schemaVersion}`);
    }
    const stableId = feed.scope === "account" ? feed.accountId : feed.publisherId;
    if (!stableId) {
        throw new Error(`${feed.scope} feed must include its stable identity`);
    }
    if (feed.feedId !== accountFeedId(feed.scope, stableId)) {
        throw new Error("Account feed id does not match its scope and stable identity");
    }
    if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
        throw new Error("Account feed sequence must be a non-negative integer");
    }
    if (!Number.isFinite(Date.parse(feed.generatedAt))) {
        throw new Error("Account feed generatedAt must be a valid ISO date");
    }
    for (const entry of feed.entries) {
        if (!entry.id || !entry.name || !entry.displayName) {
            throw new Error("Account feed entry identity fields must be non-empty");
        }
        if (!Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) {
            throw new Error("Account feed entry updatedAt must be a non-negative finite number");
        }
        if (entry.url.startsWith("/")) {
            if (entry.url.startsWith("//")) {
                throw new Error("Account feed entry URL must not be protocol-relative");
            }
            continue;
        }
        let url;
        try {
            url = new URL(entry.url);
        }
        catch {
            throw new Error("Account feed entry URL must be absolute HTTPS or origin-relative");
        }
        if (url.protocol !== "https:") {
            throw new Error("Account feed entry URL must be absolute HTTPS or origin-relative");
        }
    }
    return feed;
}
//# sourceMappingURL=accountFeed.js.map