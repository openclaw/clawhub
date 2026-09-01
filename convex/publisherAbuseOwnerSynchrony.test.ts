/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

vi.mock("./functions", () => ({
  internalAction: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  internalMutation: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  internalQuery: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
}));

const {
  getPublisherAbuseOwnerSynchronyCandidateInternalHandler,
  readPublisherAbuseOwnerKeysPageInternalHandler,
  readPublisherAbuseOwnerSignalsPageInternalHandler,
  upsertPublisherAbuseOwnerSynchronySignalInternalHandler,
} = await import("./publisherAbuseOwnerSynchrony");

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

function existingSignal(now: number) {
  const value = candidate();
  return {
    _id: "publisherAbuseSignals:portfolio",
    ...value,
    ownerUserId: value.ownerUserId ?? null,
    skillId: value.representativeSkillId,
    skillSlug: value.representativeSkillSlug,
    skillDisplayName: value.representativeSkillDisplayName,
    signalType: "owner_synchronized_download_trends" as const,
    firstSeenAt: now - 20_000,
    lastSeenAt: now - 10_000,
    seenCount: 2,
  };
}

describe("publisher abuse owner synchrony signal", () => {
  it("discovers owners through the current-run signal index", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const current = {
      ...existingSignal(1_700_000_000_000),
      latestRunId: runId,
      signalType: "download_spike_flat_installs" as const,
    };
    const eq = vi.fn(() => "run-range");
    const withIndex = vi.fn((_name: string, range: (query: { eq: typeof eq }) => unknown) => {
      range({ eq });
      return {
        order: () => ({
          paginate: async () => ({
            page: [current],
            isDone: true,
            continueCursor: "unused",
          }),
        }),
      };
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex,
        })),
      },
    };

    await expect(
      readPublisherAbuseOwnerKeysPageInternalHandler(ctx as never, { runId }),
    ).resolves.toEqual({
      ownerKeys: [current.ownerKey],
      cursor: undefined,
      isDone: true,
    });
    expect(withIndex).toHaveBeenCalledWith(
      "by_latest_run_id_and_last_seen_at",
      expect.any(Function),
    );
    expect(eq).toHaveBeenCalledWith("latestRunId", runId);
  });

  it("keeps owner signal reads paged and excludes stale anomaly signals", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const staleRunId = "publisherAbuseScoreRuns:previous" as Id<"publisherAbuseScoreRuns">;
    const current = {
      ...existingSignal(1_700_000_000_000),
      latestRunId: runId,
      signalType: "download_spike_flat_installs" as const,
    };
    const stale = { ...current, latestRunId: staleRunId };
    const paginate = vi.fn(async () => ({
      page: [stale, current],
      isDone: false,
      continueCursor: "next-page",
    }));
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: () => ({
            order: () => ({ paginate }),
          }),
        })),
      },
    };

    await expect(
      readPublisherAbuseOwnerSignalsPageInternalHandler(ctx as never, {
        runId,
        ownerKey: current.ownerKey,
      }),
    ).resolves.toEqual({
      signals: [{ skillId: current.skillId, ownerPublisherId: current.ownerPublisherId }],
      cursor: "next-page",
      isDone: false,
    });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 50 });
  });

  it("processes a qualifying current-run portfolio beyond 50 skills and 100 rows", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerPublisherId = "publishers:portfolio" as Id<"publishers">;
    const signals = Array.from({ length: 101 }, (_, index) => ({
      skillId: `skills:${index}` as Id<"skills">,
      ownerPublisherId,
    }));
    const signalPages = [
      { signals: signals.slice(0, 50), cursor: "page-2", isDone: false },
      { signals: signals.slice(50, 100), cursor: "page-3", isDone: false },
      { signals: signals.slice(100), cursor: undefined, isDone: true },
    ];
    let signalPageIndex = 0;
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) return signalPages[signalPageIndex++];
      if (!("skillId" in args)) {
        return {
          publisherId: ownerPublisherId,
          linkedUserId: "users:portfolio" as Id<"users">,
          handle: "portfolio-owner",
          publishedSkills: 101,
        };
      }
      const skillId = args.skillId as Id<"skills">;
      const index = Number(skillId.split(":").at(-1));
      const dailyDownloads = Array.from({ length: 60 }, (_, day) =>
        Math.round((day + 1) * (1 + index * 0.001)),
      );
      return {
        skillId,
        skillSlug: `skill-${index}`,
        skillDisplayName: `Skill ${index}`,
        dailyDownloads,
        recent7Downloads: dailyDownloads.slice(-7).reduce((sum, value) => sum + value, 0),
        recent7Installs: 0,
        recent30Downloads: dailyDownloads.slice(-30).reduce((sum, value) => sum + value, 0),
        recent30Installs: 0,
        allTimeDownloads: 10_000 + index,
        allTimeInstalls: 0,
      };
    });

    const result = await getPublisherAbuseOwnerSynchronyCandidateInternalHandler(
      { runQuery } as never,
      {
        runId,
        ownerKey: "publisher:publishers:portfolio",
        todayDay: 20_683,
      },
    );

    expect(result?.portfolioEvidence.skillCount).toBe(101);
    expect(result?.portfolioEvidence.catalogCoverage).toBe(1);
    expect(signalPageIndex).toBe(3);
    expect(runQuery).toHaveBeenCalledTimes(105);
  });

  it("creates one publisher-level signal with portfolio evidence", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: () => ({ first: async () => null }),
        })),
        insert: vi.fn(async (_table: string, value: Record<string, unknown>) => {
          inserted.push(value);
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
      }),
    ).resolves.toMatchObject({
      signalId: "publisherAbuseSignals:portfolio",
      created: true,
      changed: true,
    });

    expect(inserted).toEqual([
      expect.objectContaining({
        signalType: "owner_synchronized_download_trends",
        ownerKey: "publisher:publishers:portfolio",
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
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("refreshes existing portfolio evidence in place", async () => {
    const now = 1_700_000_000_000;
    const existing = existingSignal(now);
    const updatedCandidate = {
      ...candidate(),
      recent7Downloads: 42_000,
      allTimeDownloads: 325_000,
    };
    const patch = vi.fn(async (_id: string, _value: Record<string, unknown>) => null);
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
        candidate: updatedCandidate,
        now,
      }),
    ).resolves.toMatchObject({ created: false, changed: false });

    expect(patch).toHaveBeenCalledWith(
      existing._id,
      expect.objectContaining({
        recent7Downloads: 42_000,
        allTimeDownloads: 325_000,
        lastSeenAt: now,
        seenCount: 3,
      }),
    );
  });

  it("records a synchrony observation only once when a run page is replayed", async () => {
    const now = 1_700_000_000_000;
    const runId = "publisherAbuseScoreRuns:signals" as Id<"publisherAbuseScoreRuns">;
    const existing = {
      ...existingSignal(now),
      latestRunId: "publisherAbuseScoreRuns:previous" as Id<"publisherAbuseScoreRuns">,
    };
    const patch = vi.fn(async (_id: string, value: Record<string, unknown>) => {
      Object.assign(existing, value);
    });
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
        runId,
        candidate: candidate(),
        now,
      }),
    ).resolves.toMatchObject({ alreadyRecorded: false });
    await expect(
      upsertPublisherAbuseOwnerSynchronySignalInternalHandler(ctx as unknown as MutationCtx, {
        runId,
        candidate: candidate(),
        now: now + 1_000,
      }),
    ).resolves.toMatchObject({ alreadyRecorded: true });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(existing).toMatchObject({
      latestRunId: runId,
      lastSeenAt: now,
      seenCount: 3,
    });
  });
});
