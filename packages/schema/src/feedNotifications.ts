import { type inferred, type } from "arktype";

export const FeedRepresentationSchema = type('"catalog"|"publisher"');
export type FeedRepresentation = (typeof FeedRepresentationSchema)[inferred];

export const FeedItemKindSchema = type('"plugin"|"skill"');
export type FeedItemKind = (typeof FeedItemKindSchema)[inferred];

export const FeedItemWatchSourceSchema = type('"explicit"|"installed-sync"');
export type FeedItemWatchSource = (typeof FeedItemWatchSourceSchema)[inferred];

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
export type FeedItemWatchRequest = (typeof FeedItemWatchRequestSchema)[inferred];

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
export type FeedItemWatch = (typeof FeedItemWatchSchema)[inferred];

export const FeedNotificationReasonSchema = type(
  '"updated"|"removed"|"blocked"|"security-state-changed"',
);
export type FeedNotificationReason = (typeof FeedNotificationReasonSchema)[inferred];

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
export type FeedNotificationInboxItem = (typeof FeedNotificationInboxItemSchema)[inferred];

export const FeedItemWatchListSchema = type({
  "+": "reject",
  ok: "true",
  items: FeedItemWatchSchema.array(),
  nextCursor: "string|null",
});
export type FeedItemWatchList = (typeof FeedItemWatchListSchema)[inferred];

export const FeedNotificationInboxListSchema = type({
  "+": "reject",
  ok: "true",
  items: FeedNotificationInboxItemSchema.array(),
  nextCursor: "string|null",
});
export type FeedNotificationInboxList = (typeof FeedNotificationInboxListSchema)[inferred];
