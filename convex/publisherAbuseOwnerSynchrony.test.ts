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
  getPublisherAbuseOwnerSynchronyPublisherInternalHandler,
  readPublisherAbuseOwnerCandidatesPageInternalHandler,
  readPublisherAbuseOwnerKeysPageInternalHandler,
  readPublisherAbuseOwnerSkillCountPageInternalHandler,
  scanPublisherAbuseOwnerSynchronyPage,
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

function ownerSignal(index: number, ownerPublisherId: Id<"publishers">) {
  const dailyDownloads = Array.from({ length: 60 }, (_, day) =>
    Math.round((day + 1) * (1 + (index % 10) * 0.001)),
  );
  return {
    skillId: `skills:${index}` as Id<"skills">,
    ownerPublisherId,
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
}

function storedCandidate(
  index: number,
  runId: Id<"publisherAbuseScoreRuns">,
  ownerPublisherId: Id<"publishers">,
) {
  const skill = ownerSignal(index, ownerPublisherId);
  return {
    _id: `publisherAbuseTemporalScanCandidates:${index}`,
    runId,
    synchronyEligible: true,
    ownerKey: "publisher:publishers:portfolio",
    ownerPublisherId,
    skillId: skill.skillId,
    slug: skill.skillSlug,
    displayName: skill.skillDisplayName,
    synchronyDailyDownloads: skill.dailyDownloads,
    temporalScore: {
      recent7Downloads: skill.recent7Downloads,
      recent7Installs: skill.recent7Installs,
      recent30Downloads: skill.recent30Downloads,
      recent30Installs: skill.recent30Installs,
    },
    totalDownloads: skill.allTimeDownloads,
    totalInstalls: skill.allTimeInstalls,
  };
}

describe("publisher abuse owner synchrony signal", () => {
  it("leaves a legacy publisher count for the bounded action fallback", async () => {
    const publisherId = "publishers:legacy" as Id<"publishers">;
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: publisherId,
          handle: "legacy",
          linkedUserId: "users:legacy",
        })),
      },
    };

    await expect(
      getPublisherAbuseOwnerSynchronyPublisherInternalHandler(ctx as never, {
        ownerPublisherId: publisherId,
      }),
    ).resolves.toMatchObject({ publishedSkills: undefined });
  });

  it("counts public legacy skills in bounded pages", async () => {
    const publisherId = "publishers:legacy" as Id<"publishers">;
    const eq = vi.fn();
    const rangeBuilder = { eq };
    eq.mockReturnValue(rangeBuilder);
    const paginate = vi.fn(async () => ({
      page: [
        { _id: "skills:public", softDeletedAt: undefined },
        { _id: "skills:hidden", softDeletedAt: undefined, moderationStatus: "hidden" },
      ],
      continueCursor: "next-page",
      isDone: false,
    }));
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn((_name: string, range: (query: { eq: typeof eq }) => unknown) => {
            range({ eq });
            return { paginate };
          }),
        })),
      },
    };

    await expect(
      readPublisherAbuseOwnerSkillCountPageInternalHandler(ctx as never, {
        ownerPublisherId: publisherId,
      }),
    ).resolves.toEqual({ publicSkillCount: 1, cursor: "next-page", isDone: false });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 100 });
  });

  it("discovers owners through the current-run synchrony candidate index", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const current = storedCandidate(0, runId, "publishers:portfolio" as Id<"publishers">);
    const eq = vi.fn();
    const rangeBuilder = { eq };
    eq.mockReturnValue(rangeBuilder);
    const withIndex = vi.fn((_name: string, range: (query: { eq: typeof eq }) => unknown) => {
      range({ eq });
      return {
        first: async () => current,
        paginate: async () => ({
          page: [current],
          isDone: true,
          continueCursor: "unused",
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
      cursor: current.ownerKey,
      isDone: false,
    });
    expect(withIndex).toHaveBeenCalledWith(
      "by_run_id_and_synchrony_eligible_and_owner_key",
      expect.any(Function),
    );
    expect(eq).toHaveBeenCalledWith("runId", runId);
    expect(eq).toHaveBeenCalledWith("synchronyEligible", true);
  });

  it("jumps from one owner to the next without scanning the first owner's remaining rows", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const firstOwnerId = "publishers:portfolio-a" as Id<"publishers">;
    const secondOwnerId = "publishers:portfolio-b" as Id<"publishers">;
    const firstOwnerKey = "publisher:publishers:portfolio-a";
    const secondOwnerKey = "publisher:publishers:portfolio-b";
    const candidates = [
      ...Array.from({ length: 8_000 }, (_, index) => ({
        ...storedCandidate(index, runId, firstOwnerId),
        ownerKey: firstOwnerKey,
      })),
      { ...storedCandidate(8_000, runId, secondOwnerId), ownerKey: secondOwnerKey },
    ];
    const eq = vi.fn();
    const gt = vi.fn();
    const withIndex = vi.fn(
      (_name: string, range: (query: { eq: typeof eq; gt: typeof gt }) => unknown) => {
        let afterOwnerKey: string | undefined;
        const rangeBuilder = {
          eq: eq.mockImplementation(() => rangeBuilder),
          gt: gt.mockImplementation((_field: string, value: string) => {
            afterOwnerKey = value;
            return rangeBuilder;
          }),
        };
        range(rangeBuilder);
        return {
          first: async () =>
            candidates.find((row) => afterOwnerKey === undefined || row.ownerKey > afterOwnerKey) ??
            null,
        };
      },
    );
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex,
        })),
      },
    };

    const first = await readPublisherAbuseOwnerKeysPageInternalHandler(ctx as never, { runId });
    const second = await readPublisherAbuseOwnerKeysPageInternalHandler(ctx as never, {
      runId,
      cursor: first.cursor,
    });
    const third = await readPublisherAbuseOwnerKeysPageInternalHandler(ctx as never, {
      runId,
      cursor: second.cursor,
    });

    expect([first, second, third].flatMap((page) => page.ownerKeys)).toEqual([
      firstOwnerKey,
      secondOwnerKey,
    ]);
    expect(first.isDone).toBe(false);
    expect(second.isDone).toBe(false);
    expect(third).toEqual({ ownerKeys: [], cursor: undefined, isDone: true });
    expect(withIndex).toHaveBeenCalledTimes(3);
    expect(gt).toHaveBeenCalledTimes(2);
  });

  it("keeps owner candidate reads paged inside the current run index range", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const current = storedCandidate(0, runId, "publishers:portfolio" as Id<"publishers">);
    const paginate = vi.fn(async () => ({
      page: [current],
      isDone: false,
      continueCursor: "next-page",
    }));
    const eq = vi.fn();
    const rangeBuilder = { eq };
    eq.mockReturnValue(rangeBuilder);
    const withIndex = vi.fn((_name: string, range: (query: { eq: typeof eq }) => unknown) => {
      range({ eq });
      return { paginate };
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex,
        })),
      },
    };

    await expect(
      readPublisherAbuseOwnerCandidatesPageInternalHandler(ctx as never, {
        runId,
        ownerKey: current.ownerKey,
      }),
    ).resolves.toEqual({
      candidates: [
        {
          skillId: current.skillId,
          ownerPublisherId: current.ownerPublisherId,
          skillSlug: current.slug,
          skillDisplayName: current.displayName,
          dailyDownloads: current.synchronyDailyDownloads,
          recent7Downloads: current.temporalScore.recent7Downloads,
          recent7Installs: current.temporalScore.recent7Installs,
          recent30Downloads: current.temporalScore.recent30Downloads,
          recent30Installs: current.temporalScore.recent30Installs,
          allTimeDownloads: current.totalDownloads,
          allTimeInstalls: current.totalInstalls,
        },
      ],
      cursor: "next-page",
      isDone: false,
    });
    expect(withIndex).toHaveBeenCalledWith(
      "by_run_id_and_synchrony_eligible_and_owner_key",
      expect.any(Function),
    );
    expect(eq).toHaveBeenCalledWith("runId", runId);
    expect(eq).toHaveBeenCalledWith("synchronyEligible", true);
    expect(eq).toHaveBeenCalledWith("ownerKey", current.ownerKey);
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 50 });
  });

  it("processes a qualifying current-run portfolio beyond 50 skills and 100 rows", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerPublisherId = "publishers:portfolio" as Id<"publishers">;
    const signals = Array.from({ length: 101 }, (_, index) => ownerSignal(index, ownerPublisherId));
    const signalPages = [
      { candidates: signals.slice(0, 50), cursor: "page-2", isDone: false },
      { candidates: signals.slice(50, 100), cursor: "page-3", isDone: false },
      { candidates: signals.slice(100), cursor: undefined, isDone: true },
    ];
    let signalPageIndex = 0;
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) return signalPages[signalPageIndex++];
      return {
        publisherId: ownerPublisherId,
        linkedUserId: "users:portfolio" as Id<"users">,
        handle: "portfolio-owner",
        publishedSkills: 101,
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
    expect(runQuery).toHaveBeenCalledTimes(4);
  });

  it("pages a legacy publisher count beyond 500 skills without stopping the scan", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerPublisherId = "publishers:legacy" as Id<"publishers">;
    const signals = Array.from({ length: 101 }, (_, index) => ownerSignal(index, ownerPublisherId));
    const signalPages = [
      { candidates: signals.slice(0, 50), cursor: "signals-2", isDone: false },
      { candidates: signals.slice(50, 100), cursor: "signals-3", isDone: false },
      { candidates: signals.slice(100), cursor: undefined, isDone: true },
    ];
    let signalPageIndex = 0;
    let publisherRead = false;
    let skillCountPages = 0;
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) return signalPages[signalPageIndex++];
      if (!publisherRead) {
        publisherRead = true;
        return {
          publisherId: ownerPublisherId,
          linkedUserId: "users:legacy" as Id<"users">,
          handle: "legacy-owner",
          publishedSkills: undefined,
        };
      }
      skillCountPages += 1;
      return {
        publicSkillCount: 100,
        cursor: skillCountPages === 6 ? undefined : `count-${skillCountPages + 1}`,
        isDone: skillCountPages === 6,
      };
    });

    const result = await getPublisherAbuseOwnerSynchronyCandidateInternalHandler(
      { runQuery } as never,
      {
        runId,
        ownerKey: "publisher:publishers:legacy",
        todayDay: 20_683,
      },
    );

    expect(result?.portfolioEvidence.publisherSkillCount).toBe(600);
    expect(result?.portfolioEvidence.catalogCoverage).toBeCloseTo(101 / 600);
    expect(skillCountPages).toBe(6);
  });

  it("skips a legacy publisher after a bounded hidden-skill scan", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerPublisherId = "publishers:legacy-hidden" as Id<"publishers">;
    const signals = Array.from({ length: 3 }, (_, index) => ownerSignal(index, ownerPublisherId));
    let publisherRead = false;
    let skillCountPages = 0;
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) {
        return { candidates: signals, cursor: undefined, isDone: true };
      }
      if (!publisherRead) {
        publisherRead = true;
        return {
          publisherId: ownerPublisherId,
          handle: "legacy-hidden-owner",
          publishedSkills: undefined,
        };
      }
      skillCountPages += 1;
      return {
        publicSkillCount: 0,
        cursor: `count-${skillCountPages + 1}`,
        isDone: false,
      };
    });

    await expect(
      getPublisherAbuseOwnerSynchronyCandidateInternalHandler({ runQuery } as never, {
        runId,
        ownerKey: "publisher:publishers:legacy-hidden",
        todayDay: 20_683,
      }),
    ).resolves.toBeNull();
    expect(skillCountPages).toBe(80);
  });

  it("processes 8,000 embedded signal curves in bounded pages", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerPublisherId = "publishers:portfolio" as Id<"publishers">;
    const signals = Array.from({ length: 8_000 }, (_, index) =>
      ownerSignal(index, ownerPublisherId),
    );
    let signalPageReads = 0;
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) {
        const pageIndex = typeof args.cursor === "string" ? Number(args.cursor) : 0;
        const start = pageIndex * 50;
        const nextPageIndex = pageIndex + 1;
        const isDone = start + 50 >= signals.length;
        signalPageReads += 1;
        return {
          candidates: signals.slice(start, start + 50),
          cursor: isDone ? undefined : String(nextPageIndex),
          isDone,
        };
      }
      return {
        publisherId: ownerPublisherId,
        linkedUserId: "users:portfolio" as Id<"users">,
        handle: "portfolio-owner",
        publishedSkills: 8_000,
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

    expect(result?.portfolioEvidence.skillCount).toBe(8_000);
    expect(signalPageReads).toBe(160);
    expect(runQuery).toHaveBeenCalledTimes(161);
  });

  it("skips an oversized owner without failing the full scan", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerPublisherId = "publishers:oversized" as Id<"publishers">;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) {
        const pageIndex = typeof args.cursor === "string" ? Number(args.cursor) : 0;
        const start = pageIndex * 50;
        const remaining = 8_001 - start;
        const pageSize = Math.min(50, remaining);
        const isDone = remaining <= 50;
        return {
          candidates: Array.from({ length: pageSize }, (_, index) =>
            ownerSignal(start + index, ownerPublisherId),
          ),
          cursor: isDone ? undefined : String(pageIndex + 1),
          isDone,
        };
      }
      return {
        publisherId: ownerPublisherId,
        linkedUserId: "users:oversized" as Id<"users">,
        handle: "oversized-owner",
        publishedSkills: 8_001,
      };
    });

    await expect(
      getPublisherAbuseOwnerSynchronyCandidateInternalHandler({ runQuery } as never, {
        runId,
        ownerKey: "publisher:publishers:oversized",
        todayDay: 20_683,
      }),
    ).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith(
      "[publisher-temporal-abuse-scan] skipped oversized synchrony publisher",
      {
        event: "publisher_temporal_abuse_synchrony_owner_skipped",
        runId,
        ownerKey: "publisher:publishers:oversized",
        candidateLimit: 8_000,
      },
    );
    warning.mockRestore();
  });

  it("evaluates a 101-signal publisher once across two scheduled actions", async () => {
    const runId = "publisherAbuseScoreRuns:current" as Id<"publisherAbuseScoreRuns">;
    const ownerKey = "publisher:publishers:portfolio";
    const ownerPublisherId = "publishers:portfolio" as Id<"publishers">;
    const signals = Array.from({ length: 101 }, (_, index) => ownerSignal(index, ownerPublisherId));
    const signalPages = [
      { candidates: signals.slice(0, 50), cursor: "signal-page-2", isDone: false },
      { candidates: signals.slice(50, 100), cursor: "signal-page-3", isDone: false },
      { candidates: signals.slice(100), cursor: undefined, isDone: true },
    ];
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if ("ownerKey" in args) {
        if (args.cursor === "signal-page-2") return signalPages[1];
        if (args.cursor === "signal-page-3") return signalPages[2];
        return signalPages[0];
      }
      if ("ownerPublisherId" in args) {
        return {
          publisherId: ownerPublisherId,
          linkedUserId: "users:portfolio" as Id<"users">,
          handle: "portfolio-owner",
          publishedSkills: 101,
        };
      }
      if (args.cursor === ownerKey) return { ownerKeys: [], cursor: undefined, isDone: true };
      return { ownerKeys: [ownerKey], cursor: ownerKey, isDone: false };
    });
    const runMutation = vi.fn(async () => ({ created: true, changed: true }));
    const ctx = { runQuery, runMutation };

    const first = await scanPublisherAbuseOwnerSynchronyPage(ctx as never, {
      runId,
      todayDay: 20_683,
    });
    const second = await scanPublisherAbuseOwnerSynchronyPage(ctx as never, {
      runId,
      cursor: first.cursor,
      todayDay: 20_683,
    });
    expect([first.matchedOwners, second.matchedOwners]).toEqual([1, 0]);
    expect(second.isDone).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls.filter(([, args]) => "ownerKey" in args)).toHaveLength(3);
    expect(runQuery.mock.calls.filter(([, args]) => "skillId" in args)).toHaveLength(0);
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
        get: vi.fn(async () => ({ status: "running" })),
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

  it("does not write synchrony evidence after its scan is canceled", async () => {
    const query = vi.fn();
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({ status: "failed" })),
        query,
        insert,
        patch,
      },
    };

    await expect(
      upsertPublisherAbuseOwnerSynchronySignalInternalHandler(ctx as unknown as MutationCtx, {
        runId: "publisherAbuseScoreRuns:canceled" as Id<"publisherAbuseScoreRuns">,
        candidate: candidate(),
        now: 1_700_000_000_000,
      }),
    ).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
