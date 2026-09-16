/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("publisher abuse signal workflow retirement", () => {
  it("accepts both retained review history and new read-only signals", async () => {
    const t = convexTest(schema, modules);
    const stored = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", {
        handle: "legacy-signal-owner",
        role: "user",
      });
      const actorUserId = await ctx.db.insert("users", {
        handle: "legacy-signal-reviewer",
        role: "admin",
      });
      const publisherId = await ctx.db.insert("publishers", {
        kind: "user",
        handle: "legacy-signal-owner",
        displayName: "Legacy Signal Owner",
        linkedUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "legacy-signal-skill",
        displayName: "Legacy Signal Skill",
        ownerUserId,
        ownerPublisherId: publisherId,
        tags: {},
        badges: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 100, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const commonSignal = {
        ownerKey: `publisher:${publisherId}`,
        ownerPublisherId: publisherId,
        ownerUserId,
        handleSnapshot: "legacy-signal-owner",
        skillId,
        skillSlug: "legacy-signal-skill",
        skillDisplayName: "Legacy Signal Skill",
        firstSeenAt: 10,
        lastSeenAt: 20,
        seenCount: 2,
        recent7Downloads: 70,
        recent7Installs: 1,
        recent7InstallDownloadRatio: 1 / 70,
        recent30Downloads: 100,
        recent30Installs: 1,
        recent30InstallDownloadRatio: 0.01,
        allTimeDownloads: 100,
        allTimeInstalls: 1,
        allTimeInstallDownloadRatio: 0.01,
      };
      const legacySignalId = await ctx.db.insert("publisherAbuseSignals", {
        ...commonSignal,
        signalType: "sustained_downloads_flat_installs",
        reviewStatus: "dismissed",
        reviewedByUserId: actorUserId,
        reviewedAt: 21,
        reviewNote: "Known campaign",
        needsNotification: false,
      });
      const reviewEventId = await ctx.db.insert("publisherAbuseSignalReviewEvents", {
        signalId: legacySignalId,
        ownerKey: commonSignal.ownerKey,
        actorUserId,
        eventType: "dismissed",
        previousStatus: "open",
        nextStatus: "dismissed",
        note: "Known campaign",
        createdAt: 21,
      });
      const newSignalId = await ctx.db.insert("publisherAbuseSignals", {
        ...commonSignal,
        signalType: "download_spike_flat_installs",
      });

      return {
        legacySignal: await ctx.db.get(legacySignalId),
        newSignal: await ctx.db.get(newSignalId),
        reviewEvent: await ctx.db.get(reviewEventId),
      };
    });

    expect(stored.legacySignal).toMatchObject({
      reviewStatus: "dismissed",
      reviewNote: "Known campaign",
    });
    expect(stored.newSignal).toMatchObject({
      signalType: "download_spike_flat_installs",
    });
    expect(stored.newSignal).not.toHaveProperty("reviewStatus");
    expect(stored.reviewEvent).toMatchObject({
      signalId: stored.legacySignal?._id,
      eventType: "dismissed",
    });
  });
});
