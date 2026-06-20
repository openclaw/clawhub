/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  action: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./lib/access", () => ({
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
  requireUserFromAction: vi.fn(),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    publisherAbuse: {
      collectPublisherAbuseScoresPageInternal: Symbol("collectPublisherAbuseScoresPageInternal"),
      collectTemporalPublisherAbuseSkillCandidatesPageInternal: Symbol(
        "collectTemporalPublisherAbuseSkillCandidatesPageInternal",
      ),
      finalizePublisherAbuseScoresPageInternal: Symbol("finalizePublisherAbuseScoresPageInternal"),
      getOrStartPublisherAbuseScoreRunInternal: Symbol("getOrStartPublisherAbuseScoreRunInternal"),
      getPublisherAbuseScoreRunStateInternal: Symbol("getPublisherAbuseScoreRunStateInternal"),
      markPublisherAbuseScoreRunFailedInternal: Symbol("markPublisherAbuseScoreRunFailedInternal"),
      persistTemporalPublisherAbuseCandidatesInternal: Symbol(
        "persistTemporalPublisherAbuseCandidatesInternal",
      ),
      runPublisherAbuseScoreRunInternal: Symbol("runPublisherAbuseScoreRunInternal"),
    },
    users: {
      banUserInternal: Symbol("banUserInternal"),
    },
  },
}));

const publisherAbuse = await import("./publisherAbuse");
const { assertModerator, requireUser, requireUserFromAction } = await import("./lib/access");

const TEST_MODEL_CONFIG = {
  modelVersion: "publisher-abuse-pressure.v2",
  skillPivot: 100,
  installsPerSkillPivot: 2,
  starsPerSkillPivot: 0.05,
  downloadsPerSkillPivot: 250,
  outputElasticity: 1.5,
  engagementElasticity: 0.25,
  installTrustElasticity: 0.8,
  starTrustElasticity: 1,
  downloadDemandElasticity: 0.2,
  minInstallsPerSkill: 0.05,
  minStarsPerSkill: 0.02,
  minDownloadsPerSkill: 1,
  reviewZThreshold: 1.5,
  potentialBanCandidateZThreshold: 2.5,
};

type Handler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;
type Wrapped<TArgs, TResult> = { _handler: Handler<TArgs, TResult> };

const collectHandler = (
  publisherAbuse.collectPublisherAbuseScoresPageInternal as unknown as Wrapped<
    { runId: string; batchSize?: number },
    { isDone: boolean; scanned: number; phase: string }
  >
)._handler;

const finalizeHandler = (
  publisherAbuse.finalizePublisherAbuseScoresPageInternal as unknown as Wrapped<
    { runId: string; batchSize?: number },
    { isDone: boolean; finalized: number; nominations: number }
  >
)._handler;

const runHandler = (
  publisherAbuse.runPublisherAbuseScoreRunInternal as unknown as Wrapped<
    {
      runId?: string;
      batchSize?: number;
      maxPages?: number;
      trigger?: "cron" | "manual";
      actorUserId?: string;
    },
    { ok: true; runId: string; pages: number; isDone: boolean }
  >
)._handler;

const startScoreRunHandler = (
  publisherAbuse.startPublisherAbuseScoreRun as unknown as Wrapped<
    Record<string, never>,
    { ok: true; runId: string; pages: number; isDone: boolean }
  >
)._handler;

const temporalRunHandler = (
  publisherAbuse.runTemporalPublisherAbuseScanInternal as unknown as Wrapped<
    {
      mode?: "current" | "backfill";
      dryRun?: boolean;
      candidateLimit?: number;
      batchSize?: number;
      maxPages?: number;
      todayDay?: number;
      lookbackDays?: number;
      trigger?: "cron" | "manual";
    },
    {
      ok: true;
      dryRun: boolean;
      mode: "current" | "backfill";
      scannedSkills: number;
      highTemporalSkills: number;
      flaggedPublishers: number;
      nominations: number;
    }
  >
)._handler;

const collectTemporalHandler = (
  publisherAbuse.collectTemporalPublisherAbuseSkillCandidatesPageInternal as unknown as Wrapped<
    {
      mode: "current" | "backfill";
      cursor?: string;
      batchSize?: number;
      todayDay?: number;
      lookbackDays?: number;
    },
    {
      cursor?: string;
      isDone: boolean;
      scannedSkills: number;
      candidates: unknown[];
    }
  >
)._handler;

const persistTemporalHandler = (
  publisherAbuse.persistTemporalPublisherAbuseCandidatesInternal as unknown as Wrapped<
    {
      mode: "current" | "backfill";
      trigger: "cron" | "manual";
      scanComplete: boolean;
      benchmark: ReturnType<typeof temporalBenchmark>;
      candidates: Array<{
        ownerKey: string;
        ownerPublisherId?: string;
        ownerUserId?: string;
        handleSnapshot: string;
        skillId: string;
        slug: string;
        displayName: string;
        totalDownloads: number;
        totalInstalls: number;
        temporalScore: {
          spike: boolean;
          sustained: boolean;
          nearConversion: boolean;
          pressure: number;
          recent7Downloads: number;
          recent7Installs: number;
          previous30Downloads: number;
          baseline7Downloads: number;
          spikeMultiplier: number;
          recent30Downloads: number;
          recent30Installs: number;
          downloadInstallRatio30: number;
          installDownloadRatio7: number;
          installDownloadRatio30: number;
          installDownloadExcessZScore7: number;
          installDownloadExcessZScore30: number;
          spikeWindowStartDay?: number;
          spikeWindowEndDay?: number;
          sustainedWindowStartDay?: number;
          sustainedWindowEndDay?: number;
          reasonCodes: string[];
        };
      }>;
    },
    { runId: string; nominations: number; flaggedPublishers: number }
  >
)._handler;

const getOrStartHandler = (
  publisherAbuse.getOrStartPublisherAbuseScoreRunInternal as unknown as Wrapped<
    { trigger: "cron" | "manual"; actorUserId?: string; forceNew?: boolean },
    { runId: string; status: string; phase: string }
  >
)._handler;

const listDashboardHandler = (
  publisherAbuse.listReviewDashboard as unknown as Wrapped<
    { limit?: number },
    {
      pendingPotentialBanCandidateItems: unknown[];
      pendingReviewItems: unknown[];
      recentResolvedItems: Array<{ nomination: { _id: string } }>;
    }
  >
)._handler;

const getReviewNominationDetailHandler = (
  publisherAbuse.getReviewNominationDetail as unknown as Wrapped<
    { nominationId: string },
    {
      item: { openedByRun: { _id: string; scoredPublishers: number } | null };
      latestScoreRun: { _id: string; scoredPublishers: number } | null;
    } | null
  >
)._handler;

const banPublisherAbuseOwnerHandler = (
  publisherAbuse.banPublisherAbuseOwner as unknown as Wrapped<
    {
      nominationId: string;
      expectedLatestScoreId: string;
      expectedUpdatedAt: number;
      reason?: string;
    },
    { ok: true; status: "banned" }
  >
)._handler;

type PublisherAbuseTestTriageStatus =
  | "pending"
  | "banned"
  | "reviewed_no_action"
  | "false_positive"
  | "needs_policy_discussion"
  | "candidate_for_future_action";

function makeScore(
  fields: Partial<{
    _id: string;
    ownerKey: string;
    ownerPublisherId: string;
    rank: number;
    zScore: number;
    label: "potential_ban_candidate" | "review" | "pass";
  }> = {},
) {
  return {
    _id: fields._id ?? "publisherAbuseScores:score",
    runId: "publisherAbuseScoreRuns:latest",
    ownerKey: fields.ownerKey ?? "user:owner",
    ownerPublisherId: fields.ownerPublisherId,
    ownerUserId: undefined,
    handleSnapshot: (fields.ownerKey ?? "user:owner").replace("user:", ""),
    modelVersion: "publisher-abuse-pressure.v2",
    label: fields.label ?? "potential_ban_candidate",
    rank: fields.rank ?? 1,
    pressure: 100,
    logPressure: 2,
    zScore: fields.zScore ?? 3,
    publishedSkills: 100,
    totalInstalls: 1,
    totalStars: 0,
    totalDownloads: 10,
    installsPerSkill: 0.01,
    starsPerSkill: 0,
    downloadsPerSkill: 0.1,
    reasonCodes: ["high_catalog_volume"],
    createdAt: 1,
  };
}

function makeNomination(
  fields: Partial<{
    _id: string;
    ownerKey: string;
    ownerPublisherId: string;
    ownerUserId: string;
    latestScoreId: string;
    handleSnapshot: string;
    label: "potential_ban_candidate" | "review" | "pass";
    status: PublisherAbuseTestTriageStatus;
    lastScoredAt: number;
    reviewedAt: number;
    updatedAt: number;
  }> = {},
) {
  return {
    _id: fields._id ?? "publisherAbuseReviewNominations:nomination",
    ownerKey: fields.ownerKey ?? "user:owner",
    ownerPublisherId: fields.ownerPublisherId,
    ownerUserId: fields.ownerUserId,
    handleSnapshot: fields.handleSnapshot ?? "owner",
    latestScoreId: fields.latestScoreId ?? "publisherAbuseScores:score",
    modelVersion: "publisher-abuse-pressure.v2",
    label: fields.label ?? "potential_ban_candidate",
    status: fields.status ?? "pending",
    openedAt: 1,
    openedByRunId: "publisherAbuseScoreRuns:latest",
    lastScoredAt: fields.lastScoredAt ?? 1,
    reviewedAt: fields.reviewedAt,
    updatedAt: fields.updatedAt ?? 1,
  };
}

function makeEmptyOfficialPublishersQuery() {
  return {
    withIndex: (indexName: string) => {
      if (indexName === "by_created") {
        return {
          paginate: async () => ({ page: [], isDone: true, continueCursor: "" }),
        };
      }
      if (indexName === "by_publisher") {
        return {
          unique: async () => null,
        };
      }
      throw new Error(`unexpected official publisher index ${indexName}`);
    },
  };
}

describe("publisher abuse dry-run persistence", () => {
  it("guards staff-only review entrypoints with moderator access", async () => {
    const user = { _id: "users:viewer", role: "user" };
    vi.mocked(assertModerator).mockImplementation(() => {
      throw new Error("Forbidden");
    });

    try {
      vi.mocked(requireUser).mockResolvedValue({
        userId: "users:viewer",
        user,
      } as never);

      const dbGet = vi.fn();
      const dbQuery = vi.fn();
      const runMutation = vi.fn();

      await expect(listDashboardHandler({ db: {} }, {})).rejects.toThrow("Forbidden");
      await expect(
        getReviewNominationDetailHandler(
          { db: { get: dbGet, query: dbQuery } },
          { nominationId: "publisherAbuseReviewNominations:nomination" },
        ),
      ).rejects.toThrow("Forbidden");
      await expect(
        banPublisherAbuseOwnerHandler(
          { db: { get: dbGet }, runMutation },
          {
            nominationId: "publisherAbuseReviewNominations:nomination",
            expectedLatestScoreId: "publisherAbuseScores:score",
            expectedUpdatedAt: 1,
            reason: "confirmed spam",
          },
        ),
      ).rejects.toThrow("Forbidden");
      expect(dbGet).not.toHaveBeenCalled();
      expect(dbQuery).not.toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalled();

      vi.mocked(requireUserFromAction).mockResolvedValue({
        userId: "users:viewer",
        user,
      } as never);
      const runAction = vi.fn();

      await expect(startScoreRunHandler({ runAction }, {})).rejects.toThrow("Forbidden");
      expect(runAction).not.toHaveBeenCalled();
    } finally {
      vi.mocked(assertModerator).mockReset();
    }
  });

  it("reuses an active publisher abuse score run by default", async () => {
    vi.mocked(requireUserFromAction).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runAction = vi.fn<
      (
        fn: unknown,
        args: { trigger: "manual"; actorUserId: string; forceNew?: boolean },
      ) => Promise<{ ok: true; runId: string; pages: number; isDone: boolean }>
    >(async (_fn, args) => {
      expect(args).not.toHaveProperty("forceNew");
      return {
        ok: true,
        runId: "publisherAbuseScoreRuns:active",
        pages: 0,
        isDone: false,
      };
    });
    const ctx = { runAction };

    await expect(startScoreRunHandler(ctx, {})).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:active",
      pages: 0,
      isDone: false,
    });

    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: "manual",
        actorUserId: "users:moderator",
      }),
    );
  });

  it("returns the latest score run for nomination detail rank totals", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = {
      _id: "publisherAbuseReviewNominations:nomination",
      ownerKey: "user:owner",
      ownerPublisherId: undefined,
      ownerUserId: undefined,
      handleSnapshot: "owner",
      latestScoreId: "publisherAbuseScores:latest",
      modelVersion: "publisher-abuse-pressure.v2",
      label: "potential_ban_candidate",
      status: "pending",
      openedAt: 1,
      openedByRunId: "publisherAbuseScoreRuns:opened",
      lastScoredAt: 2,
      updatedAt: 2,
    };
    const score = {
      _id: "publisherAbuseScores:latest",
      runId: "publisherAbuseScoreRuns:latest",
      ownerKey: "user:owner",
      ownerPublisherId: undefined,
      ownerUserId: undefined,
      handleSnapshot: "owner",
      modelVersion: "publisher-abuse-pressure.v2",
      label: "potential_ban_candidate",
      rank: 7,
      pressure: 100,
      logPressure: 2,
      zScore: 3,
      publishedSkills: 100,
      totalInstalls: 1,
      totalStars: 0,
      totalDownloads: 10,
      installsPerSkill: 0.01,
      starsPerSkill: 0,
      downloadsPerSkill: 0.1,
      reasonCodes: ["high_catalog_volume"],
      createdAt: 2,
    };
    const runBase = {
      modelVersion: "publisher-abuse-pressure.v2",
      trigger: "manual",
      status: "completed",
      phase: "completed",
      startedAt: 1,
      updatedAt: 2,
      scannedPublishers: 100,
      finalizedScores: 100,
      nominatedPublishers: 1,
      passCount: 0,
      reviewCount: 0,
      potentialBanCandidateCount: 1,
    };
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseScores" || table === "publisherAbuseReviewEvents") {
        return {
          withIndex: () => ({
            order: () => ({
              take: async () => [],
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:nomination") return nomination;
          if (id === "publisherAbuseScores:latest") return score;
          if (id === "publisherAbuseScoreRuns:opened") {
            return { _id: id, ...runBase, scoredPublishers: 10 };
          }
          if (id === "publisherAbuseScoreRuns:latest") {
            return { _id: id, ...runBase, scoredPublishers: 99 };
          }
          return null;
        }),
        query,
      },
    };

    await expect(
      getReviewNominationDetailHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:nomination",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        item: expect.objectContaining({
          openedByRun: expect.objectContaining({
            _id: "publisherAbuseScoreRuns:opened",
            scoredPublishers: 10,
          }),
        }),
        latestScoreRun: expect.objectContaining({
          _id: "publisherAbuseScoreRuns:latest",
          scoredPublishers: 99,
        }),
      }),
    );
  });

  it("rejects direct ban actions for review-only calibration nominations", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async () => ({ ok: true }));
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:nomination") {
            return makeNomination({
              _id: "publisherAbuseReviewNominations:nomination",
              label: "review",
              ownerUserId: "users:owner",
              status: "pending",
              latestScoreId: "publisherAbuseScores:score",
              updatedAt: 1,
            });
          }
          return null;
        }),
        insert,
        patch,
      },
    };

    await expect(
      banPublisherAbuseOwnerHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:nomination",
        expectedLatestScoreId: "publisherAbuseScores:score",
        expectedUpdatedAt: 1,
        reason: "confirmed spam",
      }),
    ).rejects.toThrow(/calibration/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects direct ban actions for non-pending potential ban nominations", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async () => ({ ok: true }));
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:nomination") {
            return makeNomination({
              _id: "publisherAbuseReviewNominations:nomination",
              label: "potential_ban_candidate",
              ownerUserId: "users:owner",
              status: "needs_policy_discussion",
              latestScoreId: "publisherAbuseScores:score",
              updatedAt: 1,
            });
          }
          return null;
        }),
        insert,
        patch,
      },
    };

    await expect(
      banPublisherAbuseOwnerHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:nomination",
        expectedLatestScoreId: "publisherAbuseScores:score",
        expectedUpdatedAt: 1,
        reason: "confirmed spam",
      }),
    ).rejects.toThrow(/pending/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects direct ban actions for official publisher nominations", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async () => ({ ok: true }));
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const officialPublisher = {
      _id: "publishers:openclaw",
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      linkedUserId: "users:owner",
      deactivatedAt: 123,
    };
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:nomination") {
            return makeNomination({
              _id: "publisherAbuseReviewNominations:nomination",
              ownerKey: "publisher:publishers:openclaw",
              ownerPublisherId: officialPublisher._id,
              ownerUserId: "users:owner",
              label: "potential_ban_candidate",
              status: "pending",
              latestScoreId: "publisherAbuseScores:score",
              updatedAt: 1,
            });
          }
          if (id === officialPublisher._id) return officialPublisher;
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "officialPublishers") {
            return {
              withIndex: () => ({
                unique: async () => ({
                  _id: "officialPublishers:openclaw",
                  publisherId: officialPublisher._id,
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      banPublisherAbuseOwnerHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:nomination",
        expectedLatestScoreId: "publisherAbuseScores:score",
        expectedUpdatedAt: 1,
        reason: "confirmed spam",
      }),
    ).rejects.toThrow(/official publisher/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects publisher abuse ban enforcement while nominations are flag-only", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async () => ({ ok: true }));
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:nomination") {
            return {
              _id: "publisherAbuseReviewNominations:nomination",
              ownerKey: "user:owner",
              ownerUserId: "users:owner",
              latestScoreId: "publisherAbuseScores:score",
              label: "potential_ban_candidate",
              status: "pending",
              updatedAt: 1,
            };
          }
          return null;
        }),
        insert,
        patch,
      },
    };

    await expect(
      banPublisherAbuseOwnerHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:nomination",
        expectedLatestScoreId: "publisherAbuseScores:score",
        expectedUpdatedAt: 1,
        reason: " confirmed spam ",
      }),
    ).rejects.toThrow(/publisher abuse bans are disabled/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects stale abuse ban actions before banning the linked owner", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async () => ({ ok: true }));
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:nomination") {
            return {
              _id: "publisherAbuseReviewNominations:nomination",
              ownerKey: "user:owner",
              ownerUserId: "users:owner",
              latestScoreId: "publisherAbuseScores:new-score",
              status: "pending",
              updatedAt: 2,
            };
          }
          return null;
        }),
        insert,
        patch,
      },
    };

    await expect(
      banPublisherAbuseOwnerHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:nomination",
        expectedLatestScoreId: "publisherAbuseScores:old-score",
        expectedUpdatedAt: 1,
        reason: "confirmed spam",
      }),
    ).rejects.toThrow(/changed; refresh and try again/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("streams pending dashboard queues by latest score rank until a visible item is found", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const latestRun = {
      _id: "publisherAbuseScoreRuns:latest",
      modelVersion: "publisher-abuse-pressure.v2",
      trigger: "manual",
      status: "completed",
      phase: "completed",
      startedAt: 1,
      updatedAt: 2,
      scannedPublishers: 100,
      scoredPublishers: 100,
      finalizedScores: 100,
      nominatedPublishers: 2,
      passCount: 0,
      reviewCount: 0,
      potentialBanCandidateCount: 2,
    };
    const skippedScores = Array.from({ length: 9 }, (_, index) =>
      makeScore({
        _id: `publisherAbuseScores:stale-${index}`,
        ownerKey: `user:stale-${index}`,
        rank: index + 1,
      }),
    );
    const visibleScore = makeScore({
      _id: "publisherAbuseScores:visible",
      ownerKey: "user:visible",
      rank: 10,
      zScore: 4.2,
    });
    const scoreIndexCalls: Array<{ indexName: string; constraints: Record<string, unknown> }> = [];
    let scoreTakeLimit = 0;
    const nominations = new Map([
      [
        "user:visible",
        makeNomination({
          _id: "publisherAbuseReviewNominations:visible",
          ownerKey: "user:visible",
          latestScoreId: "publisherAbuseScores:visible",
          handleSnapshot: "visible-risk-row",
          lastScoredAt: 10,
        }),
      ],
    ]);
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseScoreRuns") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            expect(indexName).toBe("by_model_version_and_started_at");
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            expect(constraints.modelVersion).toBe("publisher-abuse-pressure.v4");
            return {
              order: () => ({
                first: async () => latestRun,
              }),
            };
          },
        };
      }
      if (table === "publisherAbuseScores") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            scoreIndexCalls.push({ indexName, constraints });
            const rows =
              constraints.label === "potential_ban_candidate"
                ? [...skippedScores, visibleScore]
                : [];
            return {
              order: () => ({
                take: async (limit: number) => {
                  scoreTakeLimit = limit;
                  return rows.slice(0, limit);
                },
              }),
            };
          },
        };
      }
      if (table === "publisherAbuseReviewNominations") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            if (indexName === "by_owner_key_and_model_version") {
              return {
                first: async () => nominations.get(String(constraints.ownerKey)) ?? null,
              };
            }
            if (indexName === "by_status_and_reviewed_at") {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
            }
            if (indexName === "by_status_and_label_and_last_scored_at") {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
            }
            throw new Error(`unexpected nomination index ${indexName}`);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:visible") return visibleScore;
          if (id === "publisherAbuseScoreRuns:latest") return latestRun;
          return null;
        }),
        query,
      },
    };

    await expect(listDashboardHandler(ctx, { limit: 1 })).resolves.toEqual(
      expect.objectContaining({
        pendingPotentialBanCandidateItems: [
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: "publisherAbuseReviewNominations:visible",
              handleSnapshot: "visible-risk-row",
            }),
          }),
        ],
      }),
    );
    expect(scoreIndexCalls).toContainEqual({
      indexName: "by_run_and_label_and_rank",
      constraints: {
        runId: "publisherAbuseScoreRuns:latest",
        label: "potential_ban_candidate",
      },
    });
    expect(scoreTakeLimit).toBe(32);
  });

  it("hides stale official publisher nominations from dashboard lists and nomination detail", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const latestRun = {
      _id: "publisherAbuseScoreRuns:latest",
      modelVersion: "publisher-abuse-pressure.v2",
      trigger: "manual",
      status: "completed",
      phase: "completed",
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
      scannedPublishers: 200,
      scoredPublishers: 198,
      finalizedScores: 198,
      nominatedPublishers: 2,
      passCount: 196,
      reviewCount: 0,
      potentialBanCandidateCount: 2,
    };
    const officialPublisher = {
      _id: "publishers:official-risk",
      kind: "org",
      handle: "official-risk",
      displayName: "Official Risk",
      linkedUserId: "users:official-risk",
    };
    const communityPublisher = {
      _id: "publishers:community-risk",
      kind: "org",
      handle: "community-risk",
      displayName: "Community Risk",
      linkedUserId: "users:community-risk",
    };
    const officialScore = makeScore({
      _id: "publisherAbuseScores:official-risk",
      ownerKey: "publisher:publishers:official-risk",
      ownerPublisherId: officialPublisher._id,
      rank: 1,
      zScore: 5,
    });
    const communityScore = makeScore({
      _id: "publisherAbuseScores:community-risk",
      ownerKey: "publisher:publishers:community-risk",
      ownerPublisherId: communityPublisher._id,
      rank: 2,
      zScore: 4.5,
    });
    const officialNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:official-risk",
      ownerKey: officialScore.ownerKey,
      ownerPublisherId: officialPublisher._id,
      ownerUserId: "users:official-risk",
      latestScoreId: officialScore._id,
      handleSnapshot: officialPublisher.handle,
      lastScoredAt: 20,
    });
    const communityNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:community-risk",
      ownerKey: communityScore.ownerKey,
      ownerPublisherId: communityPublisher._id,
      ownerUserId: "users:community-risk",
      latestScoreId: communityScore._id,
      handleSnapshot: communityPublisher.handle,
      lastScoredAt: 19,
    });
    const officialResolvedNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:official-resolved",
      ownerKey: officialScore.ownerKey,
      ownerPublisherId: officialPublisher._id,
      ownerUserId: "users:official-risk",
      latestScoreId: officialScore._id,
      handleSnapshot: officialPublisher.handle,
      status: "reviewed_no_action",
      reviewedAt: 30,
    });
    const communityResolvedNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:community-resolved",
      ownerKey: communityScore.ownerKey,
      ownerPublisherId: communityPublisher._id,
      ownerUserId: "users:community-risk",
      latestScoreId: communityScore._id,
      handleSnapshot: communityPublisher.handle,
      status: "reviewed_no_action",
      reviewedAt: 29,
    });
    const nominations = new Map([
      [officialScore.ownerKey, officialNomination],
      [communityScore.ownerKey, communityNomination],
    ]);
    const docs = new Map<string, unknown>([
      [latestRun._id, latestRun],
      [officialScore._id, officialScore],
      [communityScore._id, communityScore],
      [officialNomination._id, officialNomination],
      [communityNomination._id, communityNomination],
      [officialResolvedNomination._id, officialResolvedNomination],
      [communityResolvedNomination._id, communityResolvedNomination],
      [officialPublisher._id, officialPublisher],
      [communityPublisher._id, communityPublisher],
      ["users:official-risk", { _id: "users:official-risk", handle: "official-risk" }],
      ["users:community-risk", { _id: "users:community-risk", handle: "community-risk" }],
    ]);
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseScoreRuns") {
        return {
          withIndex: () => ({
            order: () => ({
              first: async () => latestRun,
            }),
          }),
        };
      }
      if (table === "publisherAbuseScores") {
        return {
          withIndex: () => ({
            order: () => ({
              take: async () => [officialScore, communityScore],
            }),
          }),
        };
      }
      if (table === "publisherAbuseReviewNominations") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            if (indexName === "by_owner_key_and_model_version") {
              return {
                first: async () => nominations.get(String(constraints.ownerKey)) ?? null,
              };
            }
            if (indexName === "by_status_and_label_and_last_scored_at") {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
            }
            if (indexName === "by_status_and_reviewed_at") {
              return {
                order: () => ({
                  take: async () =>
                    constraints.status === "reviewed_no_action"
                      ? [officialResolvedNomination, communityResolvedNomination]
                      : [],
                }),
              };
            }
            throw new Error(`unexpected nomination index ${indexName}`);
          },
        };
      }
      if (table === "officialPublishers") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            expect(indexName).toBe("by_publisher");
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            return {
              unique: async () =>
                constraints.publisherId === officialPublisher._id
                  ? {
                      _id: "officialPublishers:official-risk",
                      publisherId: officialPublisher._id,
                    }
                  : null,
            };
          },
        };
      }
      if (table === "publisherAbuseReviewEvents") {
        return {
          withIndex: () => ({
            order: () => ({
              take: async () => [],
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => docs.get(id) ?? null),
        query,
      },
    };

    await expect(listDashboardHandler(ctx, { limit: 5 })).resolves.toEqual(
      expect.objectContaining({
        pendingPotentialBanCandidateItems: [
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: communityNomination._id,
              handleSnapshot: communityPublisher.handle,
            }),
          }),
        ],
        pendingReviewItems: [],
        recentResolvedItems: [
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: communityResolvedNomination._id,
              handleSnapshot: communityPublisher.handle,
            }),
          }),
        ],
      }),
    );
    await expect(
      getReviewNominationDetailHandler(ctx, { nominationId: officialNomination._id }),
    ).resolves.toBeNull();
    await expect(
      getReviewNominationDetailHandler(ctx, { nominationId: communityNomination._id }),
    ).resolves.toEqual(
      expect.objectContaining({
        item: expect.objectContaining({
          nomination: expect.objectContaining({ _id: communityNomination._id }),
        }),
      }),
    );
  });

  it("uses nomination order while the latest score run is failed", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const failedRun = {
      _id: "publisherAbuseScoreRuns:failed",
      modelVersion: "publisher-abuse-pressure.v2",
      trigger: "manual",
      status: "failed",
      phase: "finalizing",
      startedAt: 10,
      updatedAt: 20,
      scannedPublishers: 100,
      scoredPublishers: 100,
      finalizedScores: 50,
      nominatedPublishers: 1,
      passCount: 0,
      reviewCount: 1,
      potentialBanCandidateCount: 0,
    };
    const failedRunScore = makeScore({
      _id: "publisherAbuseScores:failed-run-score",
      ownerKey: "user:failed-run",
      label: "review",
      rank: 1,
      zScore: 2.1,
    });
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:failed-run",
      ownerKey: "user:failed-run",
      latestScoreId: "publisherAbuseScores:failed-run-score",
      label: "review",
      handleSnapshot: "failed-run-pending",
      lastScoredAt: 20,
    });
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseScoreRuns") {
        return {
          withIndex: () => ({
            order: () => ({
              first: async () => failedRun,
            }),
          }),
        };
      }
      if (table === "publisherAbuseScores") {
        throw new Error("failed latest runs should use nomination order, not score-rank order");
      }
      if (table === "publisherAbuseReviewNominations") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            if (indexName === "by_status_and_label_and_last_scored_at") {
              return {
                order: () => ({
                  take: async () =>
                    constraints.label === "review" && constraints.status === "pending"
                      ? [nomination]
                      : [],
                }),
              };
            }
            if (indexName === "by_status_and_reviewed_at") {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
            }
            throw new Error(`unexpected nomination index ${indexName}`);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:failed-run-score") return failedRunScore;
          if (id === "publisherAbuseScoreRuns:failed") return failedRun;
          return null;
        }),
        query,
      },
    };

    await expect(listDashboardHandler(ctx, { limit: 1 })).resolves.toEqual(
      expect.objectContaining({
        pendingReviewItems: [
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: "publisherAbuseReviewNominations:failed-run",
              latestScoreId: "publisherAbuseScores:failed-run-score",
            }),
          }),
        ],
      }),
    );
  });

  it("uses bounded takes for dashboard queues when hidden nominations dominate a bucket", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const takeCalls: Array<{
      label: string;
      numItems: number;
    }> = [];
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseReviewNominations") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            if (indexName === "by_status_and_reviewed_at") {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
            }
            return {
              order: () => ({
                paginate: async () => {
                  throw new Error("dashboard queue must not use built-in pagination");
                },
                take: async (numItems: number) => {
                  const label = String(constraints.label);
                  takeCalls.push({ label, numItems });
                  if (label !== "potential_ban_candidate") {
                    return [];
                  }
                  return Array.from({ length: numItems }, (_, index) => ({
                    _id: `publisherAbuseReviewNominations:hidden-${index}`,
                    ownerKey: `user:hidden-${index}`,
                    ownerPublisherId: undefined,
                    ownerUserId: `users:hidden-${index}`,
                    handleSnapshot: `hidden-${index}`,
                    latestScoreId: `publisherAbuseScores:hidden-${index}`,
                    modelVersion: "publisher-abuse-pressure.v2",
                    label: "potential_ban_candidate",
                    status: "pending",
                    openedAt: 1,
                    openedByRunId: "publisherAbuseScoreRuns:run",
                    lastScoredAt: 10_000 - index,
                    updatedAt: 1,
                  }));
                },
              }),
            };
          },
        };
      }
      if (table === "publisherAbuseScoreRuns") {
        return {
          withIndex: () => ({
            order: () => ({
              first: async () => null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id.startsWith("publisherAbuseScores:")) {
            return {
              _id: id,
              runId: "publisherAbuseScoreRuns:run",
              ownerKey: id.replace("publisherAbuseScores:", "user:"),
              ownerPublisherId: undefined,
              ownerUserId: id.replace("publisherAbuseScores:", "users:"),
              handleSnapshot: id.replace("publisherAbuseScores:", ""),
              modelVersion: "publisher-abuse-pressure.v2",
              label: "potential_ban_candidate",
              rank: 1,
              pressure: 100,
              logPressure: 2,
              zScore: 3,
              publishedSkills: 100,
              totalInstalls: 1,
              totalStars: 0,
              totalDownloads: 10,
              installsPerSkill: 0.01,
              starsPerSkill: 0,
              downloadsPerSkill: 0.1,
              reasonCodes: ["high_catalog_volume"],
              createdAt: 1,
            };
          }
          if (id.startsWith("users:hidden-")) {
            return { _id: id, handle: id, role: "user", deletedAt: 2 };
          }
          if (id === "publisherAbuseScoreRuns:run") {
            return {
              _id: id,
              modelVersion: "publisher-abuse-pressure.v2",
              trigger: "manual",
              status: "completed",
              phase: "completed",
              startedAt: 1,
              updatedAt: 1,
              scannedPublishers: 0,
              scoredPublishers: 0,
              finalizedScores: 0,
              nominatedPublishers: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
            };
          }
          return null;
        }),
        query,
      },
    };

    await expect(listDashboardHandler(ctx, { limit: 2 })).resolves.toEqual(
      expect.objectContaining({
        pendingPotentialBanCandidateItems: [],
        pendingReviewItems: [],
      }),
    );

    expect(takeCalls).toContainEqual({ label: "potential_ban_candidate", numItems: 6 });
    expect(takeCalls).toContainEqual({ label: "review", numItems: 6 });
  });

  it("queries recent resolved nominations by review time", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const resolvedNomination = {
      _id: "publisherAbuseReviewNominations:fresh-resolution",
      ownerKey: "user:fresh-resolution",
      ownerPublisherId: undefined,
      ownerUserId: undefined,
      handleSnapshot: "fresh-resolution",
      latestScoreId: "publisherAbuseScores:fresh-resolution",
      modelVersion: "publisher-abuse-pressure.v2",
      label: "review",
      status: "reviewed_no_action",
      openedAt: 1,
      openedByRunId: "publisherAbuseScoreRuns:run",
      lastScoredAt: 1,
      reviewedAt: 5_000,
      updatedAt: 5_000,
    };
    const rescoredOldResolution = {
      _id: "publisherAbuseReviewNominations:old-resolution",
      ownerKey: "user:old-resolution",
      ownerPublisherId: undefined,
      ownerUserId: undefined,
      handleSnapshot: "old-resolution",
      latestScoreId: "publisherAbuseScores:old-resolution",
      modelVersion: "publisher-abuse-pressure.v2",
      label: "review",
      status: "reviewed_no_action",
      openedAt: 1,
      openedByRunId: "publisherAbuseScoreRuns:run",
      lastScoredAt: 10_000,
      reviewedAt: 100,
      updatedAt: 10_000,
    };
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseReviewNominations") {
        return {
          withIndex: (
            indexName: string,
            build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            build(q);
            if (indexName === "by_status_and_label_and_last_scored_at") {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
            }
            if (indexName === "by_status_and_reviewed_at") {
              return {
                order: () => ({
                  take: async (limit: number) => {
                    expect(limit).toBe(90);
                    return constraints.status === "reviewed_no_action"
                      ? [rescoredOldResolution, resolvedNomination]
                      : [];
                  },
                }),
              };
            }
            throw new Error(`unexpected nomination index ${indexName}`);
          },
        };
      }
      if (table === "publisherAbuseScoreRuns") {
        return {
          withIndex: () => ({
            order: () => ({
              first: async () => null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:fresh-resolution") {
            return {
              _id: id,
              runId: "publisherAbuseScoreRuns:run",
              ownerKey: "user:fresh-resolution",
              ownerPublisherId: undefined,
              ownerUserId: undefined,
              handleSnapshot: "fresh-resolution",
              modelVersion: "publisher-abuse-pressure.v2",
              label: "review",
              rank: 1,
              pressure: 100,
              logPressure: 2,
              zScore: 2,
              publishedSkills: 100,
              totalInstalls: 1,
              totalStars: 0,
              totalDownloads: 10,
              installsPerSkill: 0.01,
              starsPerSkill: 0,
              downloadsPerSkill: 0.1,
              reasonCodes: ["high_catalog_volume"],
              createdAt: 1,
            };
          }
          if (id === "publisherAbuseScores:old-resolution") {
            return {
              _id: id,
              runId: "publisherAbuseScoreRuns:run",
              ownerKey: "user:old-resolution",
              ownerPublisherId: undefined,
              ownerUserId: undefined,
              handleSnapshot: "old-resolution",
              modelVersion: "publisher-abuse-pressure.v2",
              label: "review",
              rank: 2,
              pressure: 90,
              logPressure: 1.9,
              zScore: 1.9,
              publishedSkills: 90,
              totalInstalls: 1,
              totalStars: 0,
              totalDownloads: 9,
              installsPerSkill: 0.01,
              starsPerSkill: 0,
              downloadsPerSkill: 0.1,
              reasonCodes: ["high_catalog_volume"],
              createdAt: 1,
            };
          }
          if (id === "publisherAbuseScoreRuns:run") {
            return {
              _id: id,
              modelVersion: "publisher-abuse-pressure.v2",
              trigger: "manual",
              status: "completed",
              phase: "completed",
              startedAt: 1,
              updatedAt: 1,
              scannedPublishers: 0,
              scoredPublishers: 0,
              finalizedScores: 0,
              nominatedPublishers: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
            };
          }
          return null;
        }),
        query,
      },
    };

    await expect(listDashboardHandler(ctx, { limit: 2 })).resolves.toEqual(
      expect.objectContaining({
        recentResolvedItems: [
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: "publisherAbuseReviewNominations:fresh-resolution",
            }),
          }),
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: "publisherAbuseReviewNominations:old-resolution",
            }),
          }),
        ],
      }),
    );
  });

  it("collects score rows without patching enforcement tables", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:gora050",
                      handle: "gora050",
                      linkedUserId: "users:gora050",
                      publishedSkills: 1200,
                      publishedPackages: 0,
                      totalInstalls: 8,
                      totalStars: 0,
                      totalDownloads: 120,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "packages") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: false, scanned: 1, phase: "finalizing" }),
    );

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerKey: "publisher:publishers:gora050",
        handleSnapshot: "gora050",
      }),
    );
    expect(insert).not.toHaveBeenCalledWith("users", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("publishers", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("skills", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("skillSearchDigest", expect.anything());
    expect(patch).not.toHaveBeenCalledWith(
      expect.stringMatching(/^(users|publishers|skills|skillSearchDigest):/),
      expect.anything(),
    );
  });

  it("excludes official publishers from abuse scoring even when they match abuse-pressure criteria", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const officialOrgPublisher = {
      _id: "publishers:openclaw",
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      linkedUserId: "users:openclaw",
      publishedSkills: 1_200,
      publishedPackages: 0,
      totalInstalls: 4,
      totalStars: 0,
      totalDownloads: 80,
    };
    const communityOrgPublisher = {
      ...officialOrgPublisher,
      _id: "publishers:community-bulk",
      handle: "community-bulk",
      displayName: "Community Bulk",
      linkedUserId: "users:community-bulk",
    };
    const officialLookupIds: string[] = [];
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [officialOrgPublisher, communityOrgPublisher],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "officialPublishers") {
            return {
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                expect(indexName).toBe("by_publisher");
                const constraints: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    constraints[field] = value;
                    return q;
                  },
                };
                build(q);
                officialLookupIds.push(String(constraints.publisherId));
                return {
                  unique: async () =>
                    constraints.publisherId === officialOrgPublisher._id
                      ? {
                          _id: "officialPublishers:openclaw",
                          publisherId: officialOrgPublisher._id,
                        }
                      : null,
                };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: false, scanned: 2, phase: "finalizing" }),
    );

    expect(officialLookupIds).toEqual([officialOrgPublisher._id, communityOrgPublisher._id]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerPublisherId: communityOrgPublisher._id,
        handleSnapshot: communityOrgPublisher.handle,
        publishedSkills: officialOrgPublisher.publishedSkills,
        totalInstalls: officialOrgPublisher.totalInstalls,
        totalStars: officialOrgPublisher.totalStars,
        totalDownloads: officialOrgPublisher.totalDownloads,
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerPublisherId: officialOrgPublisher._id,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: 2,
        scoredPublishers: 1,
      }),
    );
  });

  it("uses the run's stored model config while collecting score rows", async () => {
    const storedModelConfig = {
      ...TEST_MODEL_CONFIG,
      modelVersion: "publisher-abuse-pressure.experimental",
      skillPivot: 1000,
    };
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: storedModelConfig.modelVersion,
          modelConfig: storedModelConfig,
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:mid-volume",
                      handle: "mid-volume",
                      linkedUserId: "users:mid-volume",
                      publishedSkills: 120,
                      publishedPackages: 0,
                      totalInstalls: 12,
                      totalStars: 1,
                      totalDownloads: 120,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "packages") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        modelVersion: storedModelConfig.modelVersion,
        reasonCodes: expect.not.arrayContaining(["high_catalog_volume"]),
      }),
    );
  });

  it("uses skill-only engagement when publisher stats include package totals", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:mixed",
                      handle: "mixed",
                      linkedUserId: "users:mixed",
                      publishedSkills: 40,
                      totalInstalls: 10_000,
                      totalStars: 500,
                      totalDownloads: 500_000,
                      skillTotalInstalls: 24,
                      skillTotalStars: 3,
                      skillTotalDownloads: 240,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(ctx.db.query).not.toHaveBeenCalledWith("skills");
    expect(ctx.db.query).not.toHaveBeenCalledWith("packages");
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        publishedSkills: 40,
        totalInstalls: 24,
        totalStars: 3,
        totalDownloads: 240,
      }),
    );
  });

  it("derives missing skill-only engagement for mixed publishers from active skills", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "manual",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:not-backfilled",
                      handle: "not-backfilled",
                      linkedUserId: "users:not-backfilled",
                      publishedSkills: 40,
                      publishedPackages: 2,
                      totalInstalls: 10_000,
                      totalStars: 500,
                      totalDownloads: 500_000,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                expect(indexName).toBe("by_owner_publisher_active_updated");
                return {
                  take: vi.fn(async (numItems: number) => {
                    expect(numItems).toBe(501);
                    return [
                      {
                        _id: "skills:one",
                        ownerPublisherId: "publishers:not-backfilled",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 7,
                        statsStars: 1,
                        statsDownloads: 70,
                        stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 7 },
                      },
                      {
                        _id: "skills:two",
                        ownerPublisherId: "publishers:not-backfilled",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 11,
                        statsStars: 2,
                        statsDownloads: 110,
                        stats: {
                          downloads: 110,
                          stars: 2,
                          installsCurrent: 1,
                          installsAllTime: 11,
                        },
                      },
                    ];
                  }),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(ctx.db.query).not.toHaveBeenCalledWith("packages");
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      expect.stringMatching(/^publishers:/),
      expect.anything(),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        publishedSkills: 40,
        totalInstalls: 18,
        totalStars: 3,
        totalDownloads: 180,
      }),
    );
  });

  it("skips manual fallback scoring when active skill derivation exceeds the bounded page", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "manual",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:too-many-active-skills",
                      handle: "too-many-active-skills",
                      linkedUserId: "users:too-many-active-skills",
                      publishedSkills: 1_200,
                      publishedPackages: 2,
                      totalInstalls: 10_000,
                      totalStars: 500,
                      totalDownloads: 500_000,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                expect(indexName).toBe("by_owner_publisher_active_updated");
                return {
                  take: vi.fn(async (numItems: number) => {
                    expect(numItems).toBe(501);
                    return Array.from({ length: 501 }, (_, index) => ({
                      _id: `skills:bulk-${index}`,
                      ownerPublisherId: "publishers:too-many-active-skills",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 1,
                      statsStars: 0,
                      statsDownloads: 1,
                      stats: { downloads: 1, stars: 0, installsCurrent: 0, installsAllTime: 1 },
                    }));
                  }),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(insert).not.toHaveBeenCalledWith("publisherAbuseScores", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: 1,
        scoredPublishers: 0,
      }),
    );
  });

  it("bounds manual active-skill fallback derivation across a collection page", async () => {
    const fallbackPublisherCount = 21;
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const skillTake = vi.fn(async () => [
      {
        _id: "skills:one",
        ownerPublisherId: "publishers:fallback",
        softDeletedAt: undefined,
        statsInstallsAllTime: 1,
        statsStars: 0,
        statsDownloads: 1,
        stats: { downloads: 1, stars: 0, installsCurrent: 0, installsAllTime: 1 },
      },
    ]);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "manual",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: Array.from({ length: fallbackPublisherCount }, (_, index) => ({
                    _id: `publishers:fallback-${index}`,
                    handle: `fallback-${index}`,
                    linkedUserId: `users:fallback-${index}`,
                    publishedSkills: 10,
                    publishedPackages: 1,
                    totalInstalls: 100,
                    totalStars: 10,
                    totalDownloads: 1_000,
                  })),
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn(() => ({
                take: skillTake,
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(skillTake).toHaveBeenCalledTimes(20);
    expect(insert).toHaveBeenCalledTimes(20);
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: fallbackPublisherCount,
        scoredPublishers: 20,
      }),
    );
  });

  it("uses bounded cron fallback scoring when mixed publisher skill-only stats are missing", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const skillTake = vi.fn(async () => [
      {
        _id: "skills:one",
        ownerPublisherId: "publishers:mixed-cron",
        softDeletedAt: undefined,
        statsInstallsAllTime: 7,
        statsStars: 1,
        statsDownloads: 70,
        stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 7 },
      },
      {
        _id: "skills:two",
        ownerPublisherId: "publishers:mixed-cron",
        softDeletedAt: undefined,
        statsInstallsAllTime: 11,
        statsStars: 2,
        statsDownloads: 110,
        stats: { downloads: 110, stars: 2, installsCurrent: 1, installsAllTime: 11 },
      },
    ]);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "cron",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:mixed-cron",
                      handle: "mixed-cron",
                      linkedUserId: "users:mixed-cron",
                      publishedSkills: 40,
                      publishedPackages: 2,
                      totalInstalls: 10_000,
                      totalStars: 500,
                      totalDownloads: 500_000,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                expect(indexName).toBe("by_owner_publisher_active_updated");
                return {
                  take: vi.fn(async (numItems: number) => {
                    expect(numItems).toBe(501);
                    return await skillTake();
                  }),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(skillTake).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        publishedSkills: 40,
        totalInstalls: 18,
        totalStars: 3,
        totalDownloads: 180,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: 1,
        scoredPublishers: 1,
      }),
    );
  });

  it("does not spend fallback scans on known zero-skill publishers", async () => {
    const zeroSkillPublishers = 20;
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const skillTake = vi.fn(async () => [
      {
        _id: "skills:mixed",
        ownerPublisherId: "publishers:mixed-needs-fallback",
        softDeletedAt: undefined,
        statsInstallsAllTime: 13,
        statsStars: 3,
        statsDownloads: 130,
        stats: { downloads: 130, stars: 3, installsCurrent: 1, installsAllTime: 13 },
      },
    ]);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "cron",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    ...Array.from({ length: zeroSkillPublishers }, (_, index) => ({
                      _id: `publishers:plugin-only-${index}`,
                      handle: `plugin-only-${index}`,
                      linkedUserId: `users:plugin-only-${index}`,
                      publishedSkills: 0,
                      publishedPackages: 1,
                      totalInstalls: 100,
                      totalStars: 10,
                      totalDownloads: 1_000,
                    })),
                    {
                      _id: "publishers:mixed-needs-fallback",
                      handle: "mixed-needs-fallback",
                      linkedUserId: "users:mixed-needs-fallback",
                      publishedSkills: 8,
                      publishedPackages: 1,
                      totalInstalls: 1_000,
                      totalStars: 100,
                      totalDownloads: 10_000,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async (numItems: number) => {
                  expect(numItems).toBe(501);
                  return await skillTake();
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(skillTake).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        handleSnapshot: "mixed-needs-fallback",
        publishedSkills: 8,
        totalInstalls: 13,
        totalStars: 3,
        totalDownloads: 130,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: zeroSkillPublishers + 1,
        scoredPublishers: 1,
      }),
    );
  });

  it("skips cron scoring when the base published skill count is missing", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "cron",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:legacy-base",
                      handle: "legacy-base",
                      linkedUserId: "users:legacy-base",
                      publishedPackages: 0,
                      totalInstalls: 100,
                      totalStars: 10,
                      totalDownloads: 1_000,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(ctx.db.query).not.toHaveBeenCalledWith("skills");
    expect(insert).not.toHaveBeenCalledWith("publisherAbuseScores", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: 1,
        scoredPublishers: 0,
      }),
    );
  });

  it("derives skill engagement when package count is zero but engagement totals are missing", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "cron",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:missing-engagement",
                      handle: "missing-engagement",
                      linkedUserId: "users:missing-engagement",
                      publishedSkills: 40,
                      publishedPackages: 0,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                expect(indexName).toBe("by_owner_publisher_active_updated");
                return {
                  take: vi.fn(async (numItems: number) => {
                    expect(numItems).toBe(501);
                    return [
                      {
                        _id: "skills:one",
                        ownerPublisherId: "publishers:missing-engagement",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 7,
                        statsStars: 1,
                        statsDownloads: 70,
                        stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 7 },
                      },
                      {
                        _id: "skills:two",
                        ownerPublisherId: "publishers:missing-engagement",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 11,
                        statsStars: 2,
                        statsDownloads: 110,
                        stats: {
                          downloads: 110,
                          stars: 2,
                          installsCurrent: 1,
                          installsAllTime: 11,
                        },
                      },
                    ];
                  }),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(ctx.db.query).toHaveBeenCalledWith("skills");
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        publishedSkills: 40,
        totalInstalls: 18,
        totalStars: 3,
        totalDownloads: 180,
      }),
    );
  });

  it("treats a missing package count as unknown when skill-only engagement is missing", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          trigger: "manual",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:package-count-missing",
                      handle: "package-count-missing",
                      linkedUserId: "users:package-count-missing",
                      publishedSkills: 40,
                      totalInstalls: 10_000,
                      totalStars: 500,
                      totalDownloads: 500_000,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                expect(indexName).toBe("by_owner_publisher_active_updated");
                return {
                  take: vi.fn(async (numItems: number) => {
                    expect(numItems).toBe(501);
                    return [
                      {
                        _id: "skills:one",
                        ownerPublisherId: "publishers:package-count-missing",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 7,
                        statsStars: 1,
                        statsDownloads: 70,
                        stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 7 },
                      },
                      {
                        _id: "skills:two",
                        ownerPublisherId: "publishers:package-count-missing",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 11,
                        statsStars: 2,
                        statsDownloads: 110,
                        stats: {
                          downloads: 110,
                          stars: 2,
                          installsCurrent: 1,
                          installsAllTime: 11,
                        },
                      },
                    ];
                  }),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(ctx.db.query).toHaveBeenCalledWith("skills");
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        publishedSkills: 40,
        totalInstalls: 18,
        totalStars: 3,
        totalDownloads: 180,
      }),
    );
  });

  it("derives missing published skill count from active skills", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:legacy-stats",
                      handle: "legacy-stats",
                      linkedUserId: "users:legacy-stats",
                      publishedPackages: 0,
                      totalInstalls: 999,
                      totalStars: 99,
                      totalDownloads: 9999,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                expect(indexName).toBe("by_owner_publisher_active_updated");
                return {
                  take: vi.fn(async (numItems: number) => {
                    expect(numItems).toBe(501);
                    return [
                      {
                        _id: "skills:first",
                        ownerPublisherId: "publishers:legacy-stats",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 3,
                        statsStars: 1,
                        statsDownloads: 30,
                        stats: { downloads: 30, stars: 1, installsCurrent: 1, installsAllTime: 3 },
                      },
                      {
                        _id: "skills:second",
                        ownerPublisherId: "publishers:legacy-stats",
                        softDeletedAt: undefined,
                        statsInstallsAllTime: 5,
                        statsStars: 2,
                        statsDownloads: 50,
                        stats: { downloads: 50, stars: 2, installsCurrent: 1, installsAllTime: 5 },
                      },
                    ];
                  }),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        publishedSkills: 2,
        totalInstalls: 8,
        totalStars: 3,
        totalDownloads: 80,
      }),
    );
  });

  it("excludes zero-skill publishers from cohort statistics", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    {
                      _id: "publishers:empty",
                      handle: "empty",
                      linkedUserId: "users:empty",
                      publishedSkills: 0,
                      publishedPackages: 0,
                      totalInstalls: 0,
                      totalStars: 0,
                      totalDownloads: 0,
                    },
                    {
                      _id: "publishers:active",
                      handle: "active",
                      linkedUserId: "users:active",
                      publishedSkills: 1,
                      publishedPackages: 0,
                      totalInstalls: 0,
                      totalStars: 0,
                      totalDownloads: 0,
                    },
                  ],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          if (table === "packages") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [],
                  isDone: true,
                  continueCursor: "",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: 2,
        scoredPublishers: 1,
      }),
    );
  });

  it("updates an existing nomination for the same publisher and model version", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v2",
          modelConfig: TEST_MODEL_CONFIG,
          scoredPublishers: 1,
          finalizedScores: 0,
          passCount: 0,
          reviewCount: 0,
          potentialBanCandidateCount: 0,
          nominatedPublishers: 0,
          sumLogPressure: 3,
          sumSquaredLogPressure: 9,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:score",
                        ownerKey: "publisher:publishers:gora050",
                        ownerPublisherId: "publishers:gora050",
                        ownerUserId: "users:gora050",
                        handleSnapshot: "gora050",
                        modelVersion: "publisher-abuse-pressure.v2",
                        pressure: 1000,
                        logPressure: 6,
                        publishedSkills: 1200,
                        totalInstalls: 8,
                        totalStars: 0,
                        totalDownloads: 120,
                        installsPerSkill: 0.006,
                        starsPerSkill: 0,
                        downloadsPerSkill: 0.1,
                        reasonCodes: ["high_catalog_volume"],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseReviewNominations:existing",
                  status: "pending",
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 1 }),
    );

    expect(insert).not.toHaveBeenCalledWith("publisherAbuseReviewNominations", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:existing",
      expect.objectContaining({ latestScoreId: "publisherAbuseScores:score" }),
    );
  });

  it("keeps below-pivot high z-score publishers out of spam abuse review", async () => {
    const modelConfig = {
      ...TEST_MODEL_CONFIG,
      modelVersion: "publisher-abuse-pressure.v4",
      skillPivot: 200,
    };
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: modelConfig.modelVersion,
          modelConfig,
          scoredPublishers: 1,
          finalizedScores: 0,
          passCount: 0,
          reviewCount: 0,
          potentialBanCandidateCount: 0,
          nominatedPublishers: 0,
          sumLogPressure: 3,
          sumSquaredLogPressure: 9,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:spacesq-shape",
                        ownerKey: "publisher:publishers:spacesq-shape",
                        ownerPublisherId: "publishers:spacesq-shape",
                        ownerUserId: "users:spacesq-shape",
                        handleSnapshot: "spacesq-shape",
                        modelVersion: modelConfig.modelVersion,
                        pressure: 1000,
                        logPressure: 6,
                        publishedSkills: 62,
                        totalInstalls: 0,
                        totalStars: 0,
                        totalDownloads: 29_906,
                        installsPerSkill: 0,
                        starsPerSkill: 0,
                        downloadsPerSkill: 482.35,
                        reasonCodes: ["low_installs_per_skill", "low_stars_per_skill"],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => null,
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 0 }),
    );

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScores:spacesq-shape",
      expect.objectContaining({ label: "pass", zScore: 0 }),
    );
    expect(insert).not.toHaveBeenCalledWith("publisherAbuseReviewNominations", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        passCount: 1,
        reviewCount: 0,
        potentialBanCandidateCount: 0,
      }),
    );
  });

  it("does not create nominations for official publisher score rows left by an older run", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const officialPublisher = {
      _id: "publishers:openclaw",
      kind: "org",
      handle: "openclaw",
      linkedUserId: "users:openclaw",
    };
    const communityPublisher = {
      _id: "publishers:community",
      kind: "org",
      handle: "community",
      linkedUserId: "users:community",
    };
    const officialScore = {
      _id: "publisherAbuseScores:official",
      ownerKey: "publisher:publishers:openclaw",
      ownerPublisherId: officialPublisher._id,
      ownerUserId: "users:openclaw",
      handleSnapshot: "openclaw",
      modelVersion: "publisher-abuse-pressure.v2",
      pressure: 1000,
      logPressure: 6,
      publishedSkills: 1200,
      totalInstalls: 8,
      totalStars: 0,
      totalDownloads: 120,
      installsPerSkill: 0.006,
      starsPerSkill: 0,
      downloadsPerSkill: 0.1,
      reasonCodes: ["high_catalog_volume"],
    };
    const communityScore = {
      _id: "publisherAbuseScores:community",
      ownerKey: "publisher:publishers:community",
      ownerPublisherId: communityPublisher._id,
      ownerUserId: "users:community",
      handleSnapshot: "community",
      modelVersion: "publisher-abuse-pressure.v2",
      pressure: 100,
      logPressure: 2,
      publishedSkills: 120,
      totalInstalls: 20,
      totalStars: 1,
      totalDownloads: 500,
      installsPerSkill: 0.16,
      starsPerSkill: 0.008,
      downloadsPerSkill: 4.16,
      reasonCodes: ["high_catalog_volume"],
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:run") {
            return {
              _id: "publisherAbuseScoreRuns:run",
              status: "running",
              phase: "finalizing",
              modelVersion: "publisher-abuse-pressure.v2",
              modelConfig: TEST_MODEL_CONFIG,
              scoredPublishers: 2,
              finalizedScores: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
              nominatedPublishers: 0,
              sumLogPressure: officialScore.logPressure + communityScore.logPressure,
              sumSquaredLogPressure:
                officialScore.logPressure ** 2 + communityScore.logPressure ** 2,
            };
          }
          if (id === officialPublisher._id) return officialPublisher;
          if (id === communityPublisher._id) return communityPublisher;
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: (indexName: string) => {
                if (indexName === "by_run_and_pressure") {
                  return {
                    order: () => ({
                      paginate: async () => ({
                        page: [officialScore, communityScore],
                        isDone: true,
                        continueCursor: "",
                      }),
                    }),
                  };
                }
                if (indexName === "by_run_and_owner_key") {
                  return {
                    first: async () => officialScore,
                  };
                }
                throw new Error(`unexpected score index ${indexName}`);
              },
            };
          }
          if (table === "officialPublishers") {
            return {
              withIndex: (
                indexName: string,
                build?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                if (indexName === "by_created") {
                  return {
                    paginate: async () => ({
                      page: [
                        {
                          _id: "officialPublishers:openclaw",
                          publisherId: officialPublisher._id,
                        },
                      ],
                      isDone: true,
                      continueCursor: "",
                    }),
                  };
                }
                if (indexName === "by_publisher") {
                  const constraints: Record<string, unknown> = {};
                  const q = {
                    eq(field: string, value: unknown) {
                      constraints[field] = value;
                      return q;
                    },
                  };
                  build?.(q);
                  return {
                    unique: async () =>
                      constraints.publisherId === officialPublisher._id
                        ? {
                            _id: "officialPublishers:openclaw",
                            publisherId: officialPublisher._id,
                          }
                        : null,
                  };
                }
                throw new Error(`unexpected official publisher index ${indexName}`);
              },
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => null,
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 2, nominations: 0 }),
    );

    expect(insert).not.toHaveBeenCalledWith("publisherAbuseReviewNominations", expect.anything());
    expect(patch).not.toHaveBeenCalledWith(
      "publisherAbuseScores:official",
      expect.objectContaining({ label: "potential_ban_candidate" }),
    );
    expect(patch).toHaveBeenCalledWith(
      communityScore._id,
      expect.objectContaining({ label: "pass", rank: 1, zScore: -1 }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        meanLogPressure: 4,
        stdDevLogPressure: 2,
        passCount: 1,
      }),
    );
  });

  it("reopens a needs-discussion nomination when a later score escalates", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v2",
          modelConfig: TEST_MODEL_CONFIG,
          scoredPublishers: 1,
          finalizedScores: 0,
          passCount: 0,
          reviewCount: 0,
          potentialBanCandidateCount: 0,
          nominatedPublishers: 0,
          sumLogPressure: 3,
          sumSquaredLogPressure: 9,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:repeat",
                        ownerKey: "publisher:publishers:repeat",
                        ownerPublisherId: "publishers:repeat",
                        ownerUserId: "users:repeat",
                        handleSnapshot: "repeat",
                        modelVersion: "publisher-abuse-pressure.v2",
                        pressure: 1000,
                        logPressure: 6,
                        publishedSkills: 1200,
                        totalInstalls: 8,
                        totalStars: 0,
                        totalDownloads: 120,
                        installsPerSkill: 0.006,
                        starsPerSkill: 0,
                        downloadsPerSkill: 0.1,
                        reasonCodes: ["high_catalog_volume"],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseReviewNominations:existing",
                  ownerKey: "publisher:publishers:repeat",
                  label: "review",
                  status: "needs_policy_discussion",
                  reviewedByUserId: "users:admin",
                  reviewedAt: 100,
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 1 }),
    );

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:existing",
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:repeat",
        label: "potential_ban_candidate",
        status: "pending",
        reviewedByUserId: undefined,
        reviewedAt: undefined,
      }),
    );
  });

  it("reopens a banned nomination when the linked owner is active again", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:run") {
            return {
              _id: "publisherAbuseScoreRuns:run",
              status: "running",
              phase: "finalizing",
              modelVersion: "publisher-abuse-pressure.v2",
              modelConfig: TEST_MODEL_CONFIG,
              scoredPublishers: 1,
              finalizedScores: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
              nominatedPublishers: 0,
              sumLogPressure: 3,
              sumSquaredLogPressure: 9,
            };
          }
          if (id === "users:repeat") {
            return { _id: "users:repeat", role: "user" };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:repeat",
                        ownerKey: "publisher:publishers:repeat",
                        ownerPublisherId: "publishers:repeat",
                        ownerUserId: "users:repeat",
                        handleSnapshot: "repeat",
                        modelVersion: "publisher-abuse-pressure.v2",
                        pressure: 1000,
                        logPressure: 6,
                        publishedSkills: 1200,
                        totalInstalls: 8,
                        totalStars: 0,
                        totalDownloads: 120,
                        installsPerSkill: 0.006,
                        starsPerSkill: 0,
                        downloadsPerSkill: 0.1,
                        reasonCodes: ["high_catalog_volume"],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseReviewNominations:existing",
                  ownerKey: "publisher:publishers:repeat",
                  ownerUserId: "users:repeat",
                  label: "potential_ban_candidate",
                  status: "banned",
                  reviewedByUserId: "users:admin",
                  reviewedAt: 100,
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 1 }),
    );

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:existing",
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:repeat",
        label: "potential_ban_candidate",
        status: "pending",
        reviewedByUserId: undefined,
        reviewedAt: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        eventType: "nomination_score_updated",
        previousStatus: "banned",
        nextStatus: "pending",
      }),
    );
  });

  it("preserves reviewed nominations when the actionable label does not change", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v2",
          modelConfig: TEST_MODEL_CONFIG,
          scoredPublishers: 1,
          finalizedScores: 0,
          passCount: 0,
          reviewCount: 0,
          potentialBanCandidateCount: 0,
          nominatedPublishers: 0,
          sumLogPressure: 3,
          sumSquaredLogPressure: 9,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:repeat-review",
                        ownerKey: "publisher:publishers:repeat-review",
                        ownerPublisherId: "publishers:repeat-review",
                        ownerUserId: "users:repeat-review",
                        handleSnapshot: "repeat-review",
                        modelVersion: "publisher-abuse-pressure.v2",
                        pressure: 100,
                        logPressure: 4.6,
                        publishedSkills: 120,
                        totalInstalls: 12,
                        totalStars: 1,
                        totalDownloads: 120,
                        installsPerSkill: 0.1,
                        starsPerSkill: 0.008,
                        downloadsPerSkill: 1,
                        reasonCodes: ["high_catalog_volume"],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseReviewNominations:existing",
                  ownerKey: "publisher:publishers:repeat-review",
                  label: "review",
                  status: "false_positive",
                  reviewedByUserId: "users:admin",
                  reviewedAt: 100,
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 1 }),
    );

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:existing",
      expect.not.objectContaining({
        status: "pending",
        reviewedByUserId: undefined,
        reviewedAt: undefined,
      }),
    );
  });

  it("refreshes an existing nomination when a later score passes", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v2",
          modelConfig: TEST_MODEL_CONFIG,
          scoredPublishers: 1,
          finalizedScores: 0,
          passCount: 0,
          reviewCount: 0,
          potentialBanCandidateCount: 0,
          nominatedPublishers: 0,
          sumLogPressure: 3,
          sumSquaredLogPressure: 9,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:pass-score",
                        ownerKey: "publisher:publishers:recovered",
                        ownerPublisherId: "publishers:recovered",
                        ownerUserId: "users:recovered",
                        handleSnapshot: "recovered",
                        modelVersion: "publisher-abuse-pressure.v2",
                        pressure: 20,
                        logPressure: 3,
                        publishedSkills: 40,
                        totalInstalls: 120,
                        totalStars: 8,
                        totalDownloads: 2_000,
                        installsPerSkill: 3,
                        starsPerSkill: 0.2,
                        downloadsPerSkill: 50,
                        reasonCodes: [],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseReviewNominations:existing",
                  ownerKey: "publisher:publishers:recovered",
                  label: "review",
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 0 }),
    );

    expect(insert).not.toHaveBeenCalledWith("publisherAbuseReviewNominations", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:existing",
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:pass-score",
        label: "pass",
        handleSnapshot: "recovered",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:existing",
        previousLabel: "review",
        nextLabel: "pass",
      }),
    );
  });

  it("schedules a continuation after the action page budget is exhausted", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({
          runId: "publisherAbuseScoreRuns:run",
          phase: "collecting",
          status: "running",
        })
        .mockResolvedValueOnce({
          runId: "publisherAbuseScoreRuns:run",
          phase: "collecting",
          isDone: false,
          scanned: 100,
        }),
    };

    await expect(runHandler(ctx, { batchSize: 100, maxPages: 1 })).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 1,
      isDone: false,
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      60_000,
      expect.anything(),
      expect.objectContaining({ runId: "publisherAbuseScoreRuns:run" }),
    );
  });

  it("stores the moderator actor when a manual score run starts", async () => {
    const runMutation = vi.fn().mockResolvedValueOnce({
      runId: "publisherAbuseScoreRuns:run",
      phase: "completed",
      status: "completed",
    });
    const ctx = {
      runMutation,
    };

    await expect(
      runHandler(ctx, {
        batchSize: 100,
        maxPages: 1,
        trigger: "manual",
        actorUserId: "users:moderator",
      }),
    ).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 0,
      isDone: true,
    });

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: "manual",
        actorUserId: "users:moderator",
      }),
    );
  });

  it("resumes a finalizing run without restarting collection", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async (target: symbol) => {
      if (String(target).includes("finalizePublisherAbuseScoresPageInternal")) {
        return {
          runId: "publisherAbuseScoreRuns:run",
          phase: "completed",
          status: "completed",
          isDone: true,
          finalized: 1,
          nominations: 0,
        };
      }
      throw new Error(`unexpected mutation ${String(target)}`);
    });
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:run",
        phase: "finalizing",
        status: "running",
      })),
      runMutation,
    };

    await expect(
      runHandler(ctx, { runId: "publisherAbuseScoreRuns:run", batchSize: 100, maxPages: 1 }),
    ).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 1,
      isDone: true,
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(String(runMutation.mock.calls[0]?.[0])).toContain(
      "finalizePublisherAbuseScoresPageInternal",
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("marks the score run failed when a page mutation fails", async () => {
    const pageError = new Error("page failed");
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        runId: "publisherAbuseScoreRuns:run",
        phase: "collecting",
        status: "running",
      })
      .mockRejectedValueOnce(pageError)
      .mockResolvedValueOnce({
        runId: "publisherAbuseScoreRuns:run",
        phase: "collecting",
        status: "failed",
      });
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runMutation,
    };

    await expect(runHandler(ctx, { batchSize: 100, maxPages: 1, trigger: "cron" })).rejects.toThrow(
      "page failed",
    );

    expect(String(runMutation.mock.calls[2]?.[0])).toContain(
      "markPublisherAbuseScoreRunFailedInternal",
    );
    expect(runMutation.mock.calls[2]?.[1]).toEqual({
      runId: "publisherAbuseScoreRuns:run",
      errorMessage: "page failed",
    });
  });

  it("does not continue page processing for a failed score run", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: TEST_MODEL_CONFIG.modelVersion,
          modelConfig: TEST_MODEL_CONFIG,
          status: "failed",
          phase: "collecting",
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
      },
    };

    await expect(collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).rejects.toThrow(
      "Publisher abuse score run is failed",
    );

    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("does not schedule continuation when resuming a failed score run", async () => {
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:run",
        phase: "collecting",
        status: "failed",
      })),
      runMutation: vi.fn(),
    };

    await expect(
      runHandler(ctx, { runId: "publisherAbuseScoreRuns:run", batchSize: 100, maxPages: 1 }),
    ).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 0,
      isDone: true,
    });

    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("reuses an active run when cron starts while another run is active", async () => {
    const ctx = {
      db: {
        insert: vi.fn(async () => "publisherAbuseScoreRuns:new"),
        query: vi.fn(() => ({
          withIndex: () => ({
            order: () => ({
              first: async () => ({
                _id: "publisherAbuseScoreRuns:active",
                status: "running",
                phase: "collecting",
              }),
            }),
          }),
        })),
      },
    };

    await expect(getOrStartHandler(ctx, { trigger: "cron" })).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:active",
      status: "running",
      phase: "collecting",
    });

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("dry-runs the temporal backfill without persisting nominations", async () => {
    const candidate = temporalCandidate("skills:polymarket-trade", {
      slug: "polymarket-trade",
      displayName: "Polymarket Trade",
    });
    const ctx = {
      runQuery: vi.fn(async () => ({
        cursor: undefined,
        isDone: true,
        scannedSkills: 1,
        candidates: [candidate],
      })),
      runMutation: vi.fn(),
    };

    await expect(
      temporalRunHandler(ctx, {
        mode: "backfill",
        dryRun: true,
        candidateLimit: 1,
        batchSize: 1,
        maxPages: 1,
        todayDay: 100,
      }),
    ).resolves.toEqual({
      ok: true,
      dryRun: true,
      mode: "backfill",
      scannedSkills: 1,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
      candidates: [],
      benchmark: {
        sampleSize: 1,
        downloads30dAverage: 2_000,
        downloads30dMedian: 2_000,
        downloads30dP95: 2_000,
        downloads30dP99: 2_000,
        spikeMultiplier7dP95: 20,
        spikeMultiplier7dP99: 20,
      },
    });

    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("caps temporal scan candidate limits below Convex array limits", async () => {
    const ctx = {
      runQuery: vi.fn(async (_query: unknown, args: { batchSize: number }) => ({
        cursor: "next",
        isDone: false,
        scannedSkills: args.batchSize,
        candidates: [],
      })),
      runMutation: vi.fn(),
    };

    await expect(
      temporalRunHandler(ctx, {
        mode: "current",
        dryRun: true,
        candidateLimit: 10_000,
        batchSize: 100,
        maxPages: 100,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      mode: "current",
      scannedSkills: 8_000,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(ctx.runQuery).toHaveBeenCalledTimes(80);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("persists an empty current temporal scan so stale nominations can clear", async () => {
    const ctx = {
      runQuery: vi.fn(async () => ({
        cursor: undefined,
        isDone: true,
        scannedSkills: 12,
        candidates: [],
      })),
      runMutation: vi.fn(async () => ({
        flaggedPublishers: 0,
        nominations: 0,
      })),
    };

    await expect(
      temporalRunHandler(ctx, {
        mode: "current",
        dryRun: false,
        candidateLimit: 100,
        batchSize: 50,
        maxPages: 1,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      mode: "current",
      scannedSkills: 12,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "current",
        candidates: [],
        scanComplete: true,
      }),
    );
  });

  it("caps backfill temporal page size by lookback read budget", async () => {
    const indexBuilder = {
      eq: vi.fn(() => indexBuilder),
      gte: vi.fn(() => indexBuilder),
      lte: vi.fn(() => indexBuilder),
    };
    const paginate = vi.fn(async () => ({
      page: [
        {
          _id: "skills:quiet-old",
          ownerPublisherId: "publishers:quiet",
          slug: "quiet-old",
          displayName: "Quiet Old",
          softDeletedAt: undefined,
          statsDownloads: 10,
          statsInstallsAllTime: 0,
          stats: {
            downloads: 10,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
          },
        },
      ],
      isDone: true,
      continueCursor: "",
    }));
    const takeDailyStats = vi.fn(async () => []);
    const ctx = {
      db: {
        get: vi.fn(),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_active_stats_downloads");
                callback(indexBuilder);
                return {
                  order: () => ({ paginate }),
                };
              },
            };
          }
          if (table === "skillDailyStats") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_skill_day");
                callback(indexBuilder);
                return { take: takeDailyStats };
              },
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      collectTemporalHandler(ctx, {
        mode: "backfill",
        batchSize: 100,
        lookbackDays: 730,
        todayDay: 1000,
      }),
    ).resolves.toEqual({
      cursor: undefined,
      isDone: true,
      scannedSkills: 1,
      candidates: [],
    });

    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(takeDailyStats).toHaveBeenCalledWith(730);
    expect(ctx.db.get).toHaveBeenCalledWith("publishers:quiet");
  });

  it("keeps near-conversion-only temporal candidates", async () => {
    const indexBuilder = {
      eq: vi.fn(() => indexBuilder),
      gte: vi.fn(() => indexBuilder),
      lte: vi.fn(() => indexBuilder),
    };
    const publisher = {
      _id: "publishers:pollyreach",
      kind: "user",
      handle: "pollyreach",
      linkedUserId: "users:joel",
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === publisher._id) return publisher;
          throw new Error(`unexpected get ${id}`);
        }),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_active_stats_downloads");
                callback(indexBuilder);
                return {
                  order: () => ({
                    paginate: async () => ({
                      page: [
                        {
                          _id: "skills:tracked-installs",
                          ownerPublisherId: publisher._id,
                          slug: "tracked-installs",
                          displayName: "Tracked Installs",
                          softDeletedAt: undefined,
                          statsDownloads: 1_400,
                          statsInstallsAllTime: 1_190,
                          stats: {
                            downloads: 1_400,
                            stars: 0,
                            installsCurrent: 1_190,
                            installsAllTime: 1_190,
                          },
                        },
                      ],
                      isDone: true,
                      continueCursor: "",
                    }),
                  }),
                };
              },
            };
          }
          if (table === "skillDailyStats") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_skill_day");
                callback(indexBuilder);
                return {
                  take: async () =>
                    Array.from({ length: 7 }, (_, index) => ({
                      skillId: "skills:tracked-installs",
                      day: 94 + index,
                      downloads: 200,
                      installs: 170,
                      updatedAt: 1,
                    })),
                };
              },
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      collectTemporalHandler(ctx, {
        mode: "current",
        batchSize: 1,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      cursor: undefined,
      isDone: true,
      scannedSkills: 1,
      candidates: [
        {
          slug: "tracked-installs",
          temporalScore: {
            spike: false,
            sustained: false,
            nearConversion: true,
            reasonCodes: ["temporal_installs_track_downloads"],
          },
        },
      ],
    });
  });

  it("skips official personal publishers during temporal candidate collection", async () => {
    const indexBuilder = {
      eq: vi.fn(() => indexBuilder),
      gte: vi.fn(() => indexBuilder),
      lte: vi.fn(() => indexBuilder),
    };
    const officialPublisher = {
      _id: "publishers:steipete",
      kind: "user",
      handle: "steipete",
      linkedUserId: "users:steipete",
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === officialPublisher._id) return officialPublisher;
          throw new Error(`unexpected get ${id}`);
        }),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_active_stats_downloads");
                callback(indexBuilder);
                return {
                  order: () => ({
                    paginate: async () => ({
                      page: [
                        {
                          _id: "skills:official-spike",
                          ownerPublisherId: officialPublisher._id,
                          slug: "official-spike",
                          displayName: "Official Spike",
                          softDeletedAt: undefined,
                          statsDownloads: 10_000,
                          statsInstallsAllTime: 0,
                          stats: {
                            downloads: 10_000,
                            stars: 0,
                            installsCurrent: 0,
                            installsAllTime: 0,
                          },
                        },
                      ],
                      isDone: true,
                      continueCursor: "",
                    }),
                  }),
                };
              },
            };
          }
          if (table === "skillDailyStats") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_skill_day");
                callback(indexBuilder);
                return {
                  take: async () =>
                    Array.from({ length: 7 }, (_, index) => ({
                      skillId: "skills:official-spike",
                      day: 94 + index,
                      downloads: 200,
                      installs: 0,
                      updatedAt: 1,
                    })),
                };
              },
            };
          }
          if (table === "officialPublishers") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_publisher");
                callback(indexBuilder);
                return {
                  unique: async () => ({
                    _id: "officialPublishers:steipete",
                    publisherId: officialPublisher._id,
                  }),
                };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      collectTemporalHandler(ctx, {
        mode: "current",
        batchSize: 1,
        todayDay: 100,
      }),
    ).resolves.toEqual({
      cursor: undefined,
      isDone: true,
      scannedSkills: 1,
      candidates: [],
    });
  });

  it("persists temporal abuse candidates into the existing publisher review queue", async () => {
    const insert = vi.fn(async (table: string, _value?: unknown) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:temporal";
      if (table === "publisherAbuseScores") return "publisherAbuseScores:temporal";
      if (table === "publisherAbuseReviewNominations") {
        return "publisherAbuseReviewNominations:temporal";
      }
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:temporal";
      throw new Error(`unexpected insert ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:temporal") {
            return {
              _id: "publisherAbuseScoreRuns:temporal",
              modelVersion: "publisher-abuse-temporal.v1",
              modelConfig: TEST_MODEL_CONFIG,
              trigger: "cron",
              status: "running",
              phase: "collecting",
              scannedPublishers: 0,
              scoredPublishers: 0,
              finalizedScores: 0,
              nominatedPublishers: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
              sumLogPressure: 0,
              sumSquaredLogPressure: 0,
            };
          }
          throw new Error(`unexpected get ${id}`);
        }),
        insert,
        patch: vi.fn(async () => null),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: (indexName: string) => {
                if (indexName === "by_owner_key_and_model_version") {
                  return {
                    first: async () => null,
                  };
                }
                if (indexName === "by_status_and_model_version_and_label_and_last_scored_at") {
                  return {
                    order: () => ({
                      take: async () => [],
                    }),
                  };
                }
                throw new Error(`unexpected nomination index ${indexName}`);
              },
            };
          }
          throw new Error(`unexpected query ${table}`);
        }),
      },
    };

    await expect(
      persistTemporalHandler(ctx, {
        mode: "current",
        trigger: "cron",
        scanComplete: true,
        benchmark: temporalBenchmark(),
        candidates: [
          temporalCandidate("skills:first", { slug: "first", displayName: "First" }),
          temporalCandidate("skills:second", { slug: "second", displayName: "Second" }),
        ],
      }),
    ).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:temporal",
      flaggedPublishers: 1,
      nominations: 1,
    });

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerKey: "publisher:publishers:pollyreach",
        label: "potential_ban_candidate",
        zScore: expect.any(Number),
        temporalHighSkillCount: 2,
        temporalSpikeSkillCount: 2,
        temporalSustainedSkillCount: 0,
        temporalBenchmark: temporalBenchmark(),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations",
      expect.objectContaining({
        ownerKey: "publisher:publishers:pollyreach",
        label: "potential_ban_candidate",
        latestScoreId: "publisherAbuseScores:temporal",
      }),
    );
    const scoreInsertPayload = insert.mock.calls.find(
      ([table]) => table === "publisherAbuseScores",
    )?.[1] as { zScore: number } | undefined;
    expect(scoreInsertPayload).toEqual(expect.objectContaining({ zScore: expect.any(Number) }));
    expect(scoreInsertPayload?.zScore).toBeGreaterThanOrEqual(2.5);
  });

  it("does not clear stale temporal nominations when the current scan is partial", async () => {
    const insert = vi.fn(async (table: string) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:temporal";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:temporal") {
            return {
              _id: "publisherAbuseScoreRuns:temporal",
              modelVersion: "publisher-abuse-temporal.v1",
              modelConfig: TEST_MODEL_CONFIG,
              trigger: "cron",
              status: "running",
              phase: "collecting",
              scannedPublishers: 0,
              scoredPublishers: 0,
              finalizedScores: 0,
              nominatedPublishers: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
              sumLogPressure: 0,
              sumSquaredLogPressure: 0,
            };
          }
          throw new Error(`unexpected get ${id}`);
        }),
        insert,
        patch,
        query: vi.fn(() => {
          throw new Error("stale nominations must not be queried for a partial scan");
        }),
      },
    };

    await expect(
      persistTemporalHandler(ctx, {
        mode: "current",
        trigger: "cron",
        scanComplete: false,
        benchmark: temporalBenchmark(),
        candidates: [],
      }),
    ).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:temporal",
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:temporal",
      expect.objectContaining({
        passCount: 0,
        scoredPublishers: 0,
        finalizedScores: 0,
      }),
    );
  });

  it("writes pass scores for stale temporal nominations when current signals clear", async () => {
    const insert = vi.fn(async (table: string) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:temporal";
      if (table === "publisherAbuseScores") return "publisherAbuseScores:pass";
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:pass";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async () => null);
    const staleNomination = {
      _id: "publisherAbuseReviewNominations:stale",
      ownerKey: "publisher:publishers:stale",
      ownerPublisherId: "publishers:stale",
      ownerUserId: "users:stale",
      handleSnapshot: "stale-pub",
      latestScoreId: "publisherAbuseScores:old",
      modelVersion: "publisher-abuse-temporal.v1",
      label: "review",
      status: "pending",
      openedAt: 1,
      openedByRunId: "publisherAbuseScoreRuns:old",
      lastScoredAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:temporal") {
            return {
              _id: "publisherAbuseScoreRuns:temporal",
              modelVersion: "publisher-abuse-temporal.v1",
              modelConfig: TEST_MODEL_CONFIG,
              trigger: "cron",
              status: "running",
              phase: "collecting",
              scannedPublishers: 0,
              scoredPublishers: 0,
              finalizedScores: 0,
              nominatedPublishers: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
              sumLogPressure: 0,
              sumSquaredLogPressure: 0,
            };
          }
          throw new Error(`unexpected get ${id}`);
        }),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                const constraints: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    constraints[field] = value;
                    return q;
                  },
                };
                build(q);
                if (indexName === "by_status_and_model_version_and_label_and_last_scored_at") {
                  return {
                    order: () => ({
                      take: async () => (constraints.label === "review" ? [staleNomination] : []),
                    }),
                  };
                }
                if (indexName === "by_owner_key_and_model_version") {
                  return {
                    first: async () => staleNomination,
                  };
                }
                throw new Error(`unexpected nomination index ${indexName}`);
              },
            };
          }
          throw new Error(`unexpected query ${table}`);
        }),
      },
    };

    await expect(
      persistTemporalHandler(ctx, {
        mode: "current",
        trigger: "cron",
        scanComplete: true,
        benchmark: temporalBenchmark(),
        candidates: [],
      }),
    ).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:temporal",
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerKey: staleNomination.ownerKey,
        label: "pass",
        temporalHighSkillCount: 0,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      staleNomination._id,
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:pass",
        label: "pass",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:temporal",
      expect.objectContaining({
        passCount: 1,
        scoredPublishers: 1,
        finalizedScores: 1,
      }),
    );
  });
});

function temporalCandidate(skillId: string, skill: { slug: string; displayName: string }) {
  return {
    ownerKey: "publisher:publishers:pollyreach",
    ownerPublisherId: "publishers:pollyreach",
    ownerUserId: "users:joel",
    handleSnapshot: "pollyreach",
    skillId,
    slug: skill.slug,
    displayName: skill.displayName,
    totalDownloads: 10_000,
    totalInstalls: 0,
    temporalScore: {
      spike: true,
      sustained: false,
      nearConversion: false,
      pressure: 20,
      recent7Downloads: 2_000,
      recent7Installs: 0,
      previous30Downloads: 100,
      baseline7Downloads: 100,
      spikeMultiplier: 20,
      recent30Downloads: 2_000,
      recent30Installs: 0,
      downloadInstallRatio30: 2_000,
      installDownloadRatio7: 0,
      installDownloadRatio30: 0,
      installDownloadExcessZScore7: 0,
      installDownloadExcessZScore30: 0,
      spikeWindowStartDay: 94,
      spikeWindowEndDay: 100,
      reasonCodes: ["temporal_download_spike_flat_installs"],
    },
  };
}

function temporalBenchmark() {
  return {
    sampleSize: 100,
    downloads30dAverage: 900,
    downloads30dMedian: 120,
    downloads30dP95: 1_000,
    downloads30dP99: 5_000,
    spikeMultiplier7dP95: 5,
    spikeMultiplier7dP99: 25,
  };
}
