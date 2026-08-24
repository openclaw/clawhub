/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

vi.mock("./functions", () => ({
  internalAction: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  internalMutation: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  internalQuery: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
}));

const { upsertPublisherAbuseOwnerSynchronySignalInternalHandler } =
  await import("./publisherAbuseOwnerSynchrony");

function candidate() {
  return {
    ownerKey: "publisher:publishers:portfolio",
    ownerPublisherId: "publishers:portfolio" as Id<"publishers">,
    ownerUserId: "users:portfolio" as Id<"users">,
    handleSnapshot: "portfolio-owner",
    representativeSkillId: "skills:anchor" as Id<"skills">,
    representativeSkillSlug: "anchor",
    representativeSkillDisplayName: "Anchor",
    recent7Downloads: 35_000,
    recent7Installs: 0,
    recent30Downloads: 120_000,
    recent30Installs: 1,
    allTimeDownloads: 300_000,
    allTimeInstalls: 2,
    portfolioEvidence: {
      skillCount: 23,
      publisherSkillCount: 122,
      allPublisherSkills: false,
      skillSlugs: ["anchor", "second", "third", "fourth", "fifth"],
      correlationFloor: 0.986,
      correlationMedian: 0.998,
      peak7DownloadsMin: 314,
      peak7DownloadsMax: 328,
      catalogCoverage: 23 / 122,
      windowStartDay: 20_624,
      windowEndDay: 20_683,
    },
  };
}

function snoozedSignal(now: number) {
  const value = candidate();
  return {
    _id: "publisherAbuseSignals:portfolio",
    ...value,
    ownerUserId: value.ownerUserId ?? null,
    skillId: value.representativeSkillId,
    skillSlug: value.representativeSkillSlug,
    skillDisplayName: value.representativeSkillDisplayName,
    signalType: "owner_synchronized_download_trends" as const,
    reviewStatus: "snoozed" as const,
    snoozedUntil: now - 1,
    evidenceAcknowledgedAt: now - 10_000,
    evidenceBaselineDownloads: value.allTimeDownloads,
    evidenceBaselineInstalls: value.allTimeInstalls,
    notificationBaselineDownloads: value.allTimeDownloads,
    notificationBaselineInstalls: value.allTimeInstalls,
    firstSeenAt: now - 20_000,
    lastSeenAt: now - 10_000,
    seenCount: 2,
    lastChangedAt: now - 10_000,
    needsNotification: false,
  };
}

describe("publisher abuse owner synchrony signal", () => {
  it("creates one publisher-level signal and queues one tokenized explanation", async () => {
    const insertedSignals: Array<Record<string, unknown>> = [];
    const insertedCommunications: Array<Record<string, unknown>> = [];
    const auditLogs: Array<Record<string, unknown>> = [];
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: () => ({ first: async () => null }),
        })),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          if (table === "publisherAbuseSignals") insertedSignals.push(value);
          if (table === "publisherAbuseSignalCommunications") {
            insertedCommunications.push(value);
          }
          if (table === "auditLogs") auditLogs.push(value);
          return "publisherAbuseSignals:portfolio";
        }),
        patch: vi.fn(async () => null),
      },
      scheduler,
    };

    await expect(
      upsertPublisherAbuseOwnerSynchronySignalInternalHandler(ctx as unknown as MutationCtx, {
        candidate: candidate(),
        now: 1_700_000_000_000,
        requestOwnerExplanation: true,
      }),
    ).resolves.toMatchObject({
      signalId: "publisherAbuseSignals:portfolio",
      created: true,
      changed: true,
      ownerExplanationRequested: true,
    });

    expect(insertedSignals).toEqual([
      expect.objectContaining({
        signalType: "owner_synchronized_download_trends",
        ownerKey: "publisher:publishers:portfolio",
        reviewStatus: "open",
        reasonCodes: [
          "multiple_skills_have_anomalous_downloads",
          "skills_share_synchronized_download_trends",
        ],
        portfolioEvidence: expect.objectContaining({
          skillCount: 23,
          publisherSkillCount: 122,
          allPublisherSkills: false,
          catalogCoverage: 23 / 122,
          correlationFloor: 0.986,
        }),
      }),
    ]);
    expect(insertedCommunications).toEqual([
      expect.objectContaining({
        signalId: "publisherAbuseSignals:portfolio",
        request: {
          requestedAt: 1_700_000_000_000,
          state: "queued",
          attemptCount: 0,
        },
      }),
    ]);
    expect(auditLogs).toEqual([
      expect.objectContaining({ action: "publisher_abuse.signal.owner_contact_queued" }),
    ]);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      signalId: "publisherAbuseSignals:portfolio",
    });
  });

  it("keeps expired snoozes closed when no fresh evidence crosses the repeat threshold", async () => {
    const now = 1_700_000_000_000;
    const existing = snoozedSignal(now);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: () => ({ first: async () => existing }),
        })),
        patch,
      },
    };

    await expect(
      upsertPublisherAbuseOwnerSynchronySignalInternalHandler(ctx as unknown as MutationCtx, {
        candidate: candidate(),
        now,
      }),
    ).resolves.toMatchObject({ created: false, changed: false });

    expect(patch).toHaveBeenCalledWith(
      existing._id,
      expect.objectContaining({
        reviewStatus: "snoozed",
        snoozedUntil: existing.snoozedUntil,
        freshDownloadsSinceSnooze: 0,
        freshInstallsSinceSnooze: 0,
        needsNotification: false,
      }),
    );
  });

  it("reopens an expired snooze when fresh synchronized traffic crosses the repeat threshold", async () => {
    const now = 1_700_000_000_000;
    const existing = snoozedSignal(now);
    const repeatedCandidate = {
      ...candidate(),
      allTimeDownloads: existing.evidenceBaselineDownloads + 1_500,
      allTimeInstalls: existing.evidenceBaselineInstalls + 3,
    };
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: () => ({ first: async () => existing }),
        })),
        patch,
      },
    };

    await expect(
      upsertPublisherAbuseOwnerSynchronySignalInternalHandler(ctx as unknown as MutationCtx, {
        candidate: repeatedCandidate,
        now,
      }),
    ).resolves.toMatchObject({ created: false, changed: true });

    expect(patch).toHaveBeenCalledWith(
      existing._id,
      expect.objectContaining({
        reviewStatus: "open",
        snoozedUntil: undefined,
        freshDownloadsSinceSnooze: 1_500,
        freshInstallsSinceSnooze: 3,
        recurrenceCount: 1,
        needsNotification: false,
        notificationBaselineDownloads: repeatedCandidate.allTimeDownloads,
        notificationBaselineInstalls: repeatedCandidate.allTimeInstalls,
      }),
    );
  });

  it("marks stronger synchrony evidence changed without routine Hermit noise", async () => {
    const now = 1_700_000_000_000;
    const existing = {
      ...snoozedSignal(now),
      reviewStatus: "open" as const,
      snoozedUntil: undefined,
    };
    const repeatedCandidate = {
      ...candidate(),
      allTimeDownloads: existing.notificationBaselineDownloads + 1_500,
      allTimeInstalls: existing.notificationBaselineInstalls + 3,
    };
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: () => ({ first: async () => existing }),
        })),
        patch,
      },
    };

    await expect(
      upsertPublisherAbuseOwnerSynchronySignalInternalHandler(ctx as unknown as MutationCtx, {
        candidate: repeatedCandidate,
        now,
      }),
    ).resolves.toMatchObject({ created: false, changed: true });

    expect(patch).toHaveBeenCalledWith(
      existing._id,
      expect.objectContaining({
        needsNotification: false,
        lastChangedAt: now,
        notificationBaselineDownloads: repeatedCandidate.allTimeDownloads,
        notificationBaselineInstalls: repeatedCandidate.allTimeInstalls,
      }),
    );
  });
});
