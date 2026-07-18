import { type } from "arktype";
import { describe, expect, it } from "vitest";
import {
  FeedItemWatchListSchema,
  FeedItemWatchRequestSchema,
  FeedNotificationInboxListSchema,
} from "./feedNotifications";

describe("feed notification schemas", () => {
  it("accepts strict watch and inbox contracts", () => {
    expect(
      FeedItemWatchRequestSchema({
        feedId: "clawhub-official",
        representation: "catalog",
        itemKind: "plugin",
        itemId: "@openclaw/demo",
      }) instanceof type.errors,
    ).toBe(false);
    expect(
      FeedItemWatchListSchema({
        ok: true,
        items: [
          {
            watchId: "feedItemWatches:1",
            feedId: "clawhub-official",
            representation: "catalog",
            itemKind: "plugin",
            itemId: "@openclaw/demo",
            source: "explicit",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      }) instanceof type.errors,
    ).toBe(false);
    expect(
      FeedNotificationInboxListSchema({
        ok: true,
        items: [
          {
            notificationId: "feedNotificationInbox:1",
            eventId: "event:1",
            feedId: "clawhub-official",
            representation: "catalog",
            itemKind: "plugin",
            itemId: "@openclaw/demo",
            sequence: 42,
            reason: "updated",
            signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
            createdAt: 1,
            updatedAt: 1,
            expiresAt: 2,
          },
        ],
        nextCursor: null,
      }) instanceof type.errors,
    ).toBe(false);
  });

  it("rejects unknown fields and unsupported reasons", () => {
    expect(
      FeedItemWatchRequestSchema({
        feedId: "clawhub-official",
        representation: "catalog",
        itemKind: "plugin",
        itemId: "@openclaw/demo",
        trusted: true,
      }) instanceof type.errors,
    ).toBe(true);
    expect(
      FeedItemWatchRequestSchema({
        feedId: "clawhub-official-skills",
        representation: "catalog",
        itemKind: "plugin",
        itemId: "@openclaw/demo",
      }) instanceof type.errors,
    ).toBe(true);
    expect(
      FeedItemWatchRequestSchema({
        feedId: "publisher:alice",
        representation: "publisher",
        itemKind: "skill",
        itemId: "@alice/demo",
      }) instanceof type.errors,
    ).toBe(true);
    expect(
      FeedNotificationInboxListSchema({
        ok: true,
        items: [
          {
            notificationId: "feedNotificationInbox:1",
            eventId: "event:1",
            feedId: "clawhub-official",
            representation: "catalog",
            itemKind: "plugin",
            itemId: "@openclaw/demo",
            sequence: 42,
            reason: "installed",
            signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
            createdAt: 1,
            updatedAt: 1,
            expiresAt: 2,
          },
        ],
        nextCursor: null,
      }) instanceof type.errors,
    ).toBe(true);
  });
});
