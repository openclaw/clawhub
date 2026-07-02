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
    if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
        throw new Error("Account feed sequence must be a non-negative integer");
    }
    if (!Number.isFinite(Date.parse(feed.generatedAt))) {
        throw new Error("Account feed generatedAt must be a valid ISO date");
    }
    return feed;
}
//# sourceMappingURL=accountFeed.js.map
