import { type } from "arktype";
export const FeedRepresentationSchema = type('"catalog"|"publisher"');
export const FeedItemKindSchema = type('"plugin"|"skill"');
export const FeedItemWatchSourceSchema = type('"explicit"|"installed-sync"');
export const FeedItemWatchRequestSchema = type({
    "+": "reject",
    feedId: '"clawhub-official"',
    representation: '"catalog"',
    itemKind: '"plugin"',
    itemId: "string",
}).or({
    "+": "reject",
    feedId: '"clawhub-official-skills"',
    representation: '"catalog"',
    itemKind: '"skill"',
    itemId: "string",
});
export const FeedItemWatchSchema = type({
    "+": "reject",
    watchId: "string",
    feedId: "string",
    representation: FeedRepresentationSchema,
    itemKind: FeedItemKindSchema,
    itemId: "string",
    source: FeedItemWatchSourceSchema,
    createdAt: "number",
    updatedAt: "number",
});
export const FeedNotificationReasonSchema = type('"updated"|"removed"|"blocked"|"security-state-changed"');
export const FeedNotificationInboxItemSchema = type({
    "+": "reject",
    notificationId: "string",
    eventId: "string",
    feedId: "string",
    representation: FeedRepresentationSchema,
    itemKind: FeedItemKindSchema,
    itemId: "string",
    sequence: "number",
    reason: FeedNotificationReasonSchema,
    signedStateUrl: "string",
    "readAt?": "number",
    "dismissedAt?": "number",
    createdAt: "number",
    updatedAt: "number",
    expiresAt: "number",
});
export const FeedItemWatchListSchema = type({
    "+": "reject",
    ok: "true",
    items: FeedItemWatchSchema.array(),
    nextCursor: "string|null",
});
export const FeedNotificationInboxListSchema = type({
    "+": "reject",
    ok: "true",
    items: FeedNotificationInboxItemSchema.array(),
    nextCursor: "string|null",
});
//# sourceMappingURL=feedNotifications.js.map