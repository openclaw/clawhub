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
  assertAdmin: vi.fn(),
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
  requireUserFromAction: vi.fn(),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    publisherAbuse: {
      autoBanPublisherAbuseCandidatesPageInternal: Symbol(
        "autoBanPublisherAbuseCandidatesPageInternal",
      ),
      collectPublisherAbuseScoresPageInternal: Symbol("collectPublisherAbuseScoresPageInternal"),
      collectTemporalPublisherAbuseSkillCandidatesPageInternal: Symbol(
        "collectTemporalPublisherAbuseSkillCandidatesPageInternal",
      ),
      collectTemporalPublisherAbuseSkillCandidatesForRunPageInternal: Symbol(
        "collectTemporalPublisherAbuseSkillCandidatesForRunPageInternal",
      ),
      cleanupTemporalPublisherAbuseScanCandidatesPageInternal: Symbol(
        "cleanupTemporalPublisherAbuseScanCandidatesPageInternal",
      ),
      completePersistedTemporalPublisherAbuseScanInternal: Symbol(
        "completePersistedTemporalPublisherAbuseScanInternal",
      ),
      finalizePublisherAbuseScoresPageInternal: Symbol("finalizePublisherAbuseScoresPageInternal"),
      getOrStartPublisherAbuseScoreRunInternal: Symbol("getOrStartPublisherAbuseScoreRunInternal"),
      getPublisherAbuseScoreRunStateInternal: Symbol("getPublisherAbuseScoreRunStateInternal"),
      listTemporalPublisherAbuseScanCandidatesPageInternal: Symbol(
        "listTemporalPublisherAbuseScanCandidatesPageInternal",
      ),
      markPublisherAbuseScoreRunFailedInternal: Symbol("markPublisherAbuseScoreRunFailedInternal"),
      persistTemporalPublisherAbuseCandidatesInternal: Symbol(
        "persistTemporalPublisherAbuseCandidatesInternal",
      ),
      persistTemporalPublisherAbuseAggregateInternal: Symbol(
        "persistTemporalPublisherAbuseAggregateInternal",
      ),
      startTemporalPublisherAbusePersistedScanInternal: Symbol(
        "startTemporalPublisherAbusePersistedScanInternal",
      ),
      clearPublisherAbusePendingWarningInternal: Symbol(
        "clearPublisherAbusePendingWarningInternal",
      ),
      claimPublisherAbusePendingWarningInternal: Symbol(
        "claimPublisherAbusePendingWarningInternal",
      ),
      getPublisherAbuseAutobanEnabledInternal: Symbol("getPublisherAbuseAutobanEnabledInternal"),
      processPublisherAbuseAutobansInternal: Symbol("processPublisherAbuseAutobansInternal"),
      recordPublisherAbuseWarningSentInternal: Symbol("recordPublisherAbuseWarningSentInternal"),
      runPublisherAbuseScoreRunInternal: Symbol("runPublisherAbuseScoreRunInternal"),
      runTemporalPublisherAbuseScanInternal: Symbol("runTemporalPublisherAbuseScanInternal"),
    },
    users: {
      autobanPublisherAbuseOwnerInternal: Symbol("autobanPublisherAbuseOwnerInternal"),
      banUserInternal: Symbol("banUserInternal"),
    },
    emailsNode: {
      sendPublisherAbuseWarningInternal: Symbol("sendPublisherAbuseWarningInternal"),
    },
  },
}));

const publisherAbuse = await import("./publisherAbuse");
const { assertAdmin, assertModerator, requireUser, requireUserFromAction } =
  await import("./lib/access");

const TEST_MODEL_CONFIG = {
  modelVersion: "publisher-abuse-pressure.v2",
  skillPivot: 100,
  installsPerSkillPivot: 2,
  starsPerSkillPivot: 0.05,
  downloadsPerSkillPivot: 250,
  outputElasticity: 1.5,
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
      runId?: string;
      mode?: "current" | "backfill";
      dryRun?: boolean;
      candidateLimit?: number;
      batchSize?: number;
      maxPages?: number;
      todayDay?: number;
      lookbackDays?: number;
      trigger?: "cron" | "manual";
      actorUserId?: string;
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

const completePersistedTemporalHandler = (
  publisherAbuse.completePersistedTemporalPublisherAbuseScanInternal as unknown as Wrapped<
    {
      runId: string;
      benchmark: ReturnType<typeof temporalBenchmark>;
      scanComplete: boolean;
      flaggedPublishers: number;
      nominatedPublishers: number;
      highTemporalSkills: number;
      reviewCount: number;
      potentialBanCandidateCount: number;
    },
    { clearedNominations: number; scannedPublishers: number }
  >
)._handler;

const markScoreRunFailedHandler = (
  publisherAbuse.markPublisherAbuseScoreRunFailedInternal as unknown as Wrapped<
    { runId: string; errorMessage: string },
    { runId: string; status: string; phase: string }
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

const getPublisherAbuseAutobanSettingHandler = (
  publisherAbuse.getPublisherAbuseAutobanSetting as unknown as Wrapped<
    Record<string, never>,
    { enabled: boolean; updatedAt: number | null; updatedByUserId: string | null }
  >
)._handler;

const setPublisherAbuseAutobanEnabledHandler = (
  publisherAbuse.setPublisherAbuseAutobanEnabled as unknown as Wrapped<
    { enabled: boolean },
    { enabled: boolean; updatedAt: number; updatedByUserId: string }
  >
)._handler;

const recordPublisherAbuseWarningSentInternalHandler = (
  publisherAbuse.recordPublisherAbuseWarningSentInternal as unknown as Wrapped<
    {
      nominationId: string;
      ownerKey: string;
      runId: string;
      scoreId: string;
      warningPendingAt: number;
      warningSentAt: number;
      deadlineAt: number;
    },
    { ok: boolean; reason?: string }
  >
)._handler;

const clearPublisherAbusePendingWarningInternalHandler = (
  publisherAbuse.clearPublisherAbusePendingWarningInternal as unknown as Wrapped<
    {
      nominationId: string;
      runId: string;
      scoreId: string;
      warningPendingAt: number;
    },
    { ok: boolean; reason?: string }
  >
)._handler;

const claimPublisherAbusePendingWarningInternalHandler = (
  publisherAbuse.claimPublisherAbusePendingWarningInternal as unknown as Wrapped<
    {
      nominationId: string;
      runId: string;
      scoreId: string;
      warningPendingAt: number;
    },
    { ok: boolean; reason?: string }
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

const autoBanPublisherAbuseCandidatesPageHandler = (
  publisherAbuse.autoBanPublisherAbuseCandidatesPageInternal as unknown as Wrapped<
    { batchSize?: number; cursor?: string },
    {
      ok: true;
      processed: number;
      warned: number;
      banned: number;
      alreadyBanned: number;
      skipped: number;
      isDone: boolean;
      cursor?: string;
    }
  >
)._handler;

const processPublisherAbuseAutobansHandler = (
  publisherAbuse.processPublisherAbuseAutobansInternal as unknown as Wrapped<
    { batchSize?: number; maxPages?: number; cursor?: string },
    {
      ok: true;
      pages: number;
      processed: number;
      banned: number;
      alreadyBanned: number;
      skipped: number;
      isDone: boolean;
    }
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
    runId: string;
    ownerKey: string;
    ownerPublisherId: string;
    rank: number;
    zScore: number;
    label: "potential_ban_candidate" | "review" | "pass";
  }> = {},
) {
  return {
    _id: fields._id ?? "publisherAbuseScores:score",
    runId: fields.runId ?? "publisherAbuseScoreRuns:latest",
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

function makeCompletedPressureScoreRun() {
  return {
    _id: "publisherAbuseScoreRuns:latest",
    modelVersion: TEST_MODEL_CONFIG.modelVersion,
    modelConfig: TEST_MODEL_CONFIG,
    trigger: "cron",
    status: "completed",
    phase: "completed",
    scannedPublishers: 1,
    scoredPublishers: 1,
    finalizedScores: 1,
    nominatedPublishers: 1,
    passCount: 0,
    reviewCount: 0,
    potentialBanCandidateCount: 1,
    sumLogPressure: 0,
    sumSquaredLogPressure: 0,
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
    openedByRunId: string;
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
    openedByRunId: fields.openedByRunId ?? "publisherAbuseScoreRuns:latest",
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

function makeEmptyPublisherMembersQuery() {
  return {
    withIndex: (indexName: string) => {
      expect(indexName).toBe("by_publisher_and_role");
      return {
        take: async () => [],
      };
    },
  };
}

function makeAutoBanNominationQuery(
  nominations: unknown[],
  options: { isDone?: boolean; continueCursor?: string; expectedCursor?: string | null } = {},
) {
  return {
    withIndex: (
      indexName: string,
      build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      expect(indexName).toBe("by_status_and_label_and_last_scored_at");
      const constraints: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return q;
        },
      };
      build(q);
      expect(constraints).toEqual({
        status: "pending",
        label: "potential_ban_candidate",
      });
      return {
        order: () => ({
          paginate: async (pagination: { cursor: string | null; numItems: number }) => {
            expect(pagination.cursor).toBe(options.expectedCursor ?? null);
            return {
              page: nominations.slice(0, pagination.numItems),
              isDone: options.isDone ?? nominations.length <= pagination.numItems,
              continueCursor: options.continueCursor ?? "next-cursor",
            };
          },
        }),
      };
    },
  };
}

function makeLatestCompletedCurrentTemporalRunQuery(run: unknown) {
  return {
    withIndex: (
      indexName: string,
      build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      expect(indexName).toBe("by_model_status_phase_temporal_complete_started_at");
      const constraints: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return q;
        },
      };
      build(q);
      expect(constraints).toEqual({
        modelVersion: "publisher-abuse-temporal.v1",
        status: "completed",
        phase: "completed",
        temporalMode: "current",
        temporalScanComplete: true,
      });
      return {
        order: () => ({
          first: async () => run,
        }),
      };
    },
  };
}

function makePublisherAbuseAutobanSettingQuery(setting: unknown) {
  return {
    withIndex: (
      indexName: string,
      build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      expect(indexName).toBe("by_key");
      const constraints: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return q;
        },
      };
      build(q);
      expect(constraints).toEqual({ key: "publisherAbuseAutobanEnabled" });
      return {
        unique: async () => setting,
      };
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

  it("defaults publisher abuse autobans to enabled when no setting exists", async () => {
    const user = { _id: "users:moderator", role: "moderator" };
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user,
    } as never);
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(getPublisherAbuseAutobanSettingHandler(ctx, {})).resolves.toEqual({
      enabled: true,
      updatedAt: null,
      updatedByUserId: null,
    });

    expect(assertModerator).toHaveBeenCalledWith(user);
  });

  it("lets admins disable publisher abuse autobans with an audit log", async () => {
    const user = { _id: "users:admin", role: "admin" };
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user,
    } as never);
    const inserted: Array<{ table: string; value: unknown }> = [];
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
        insert: vi.fn(async (table: string, value: unknown) => {
          inserted.push({ table, value });
          return `${table}:new`;
        }),
        patch: vi.fn(),
      },
    };

    await expect(setPublisherAbuseAutobanEnabledHandler(ctx, { enabled: false })).resolves.toEqual({
      enabled: false,
      updatedAt: expect.any(Number),
      updatedByUserId: "users:admin",
    });

    expect(assertAdmin).toHaveBeenCalledWith(user);
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(inserted).toEqual([
      {
        table: "systemSettings",
        value: {
          key: "publisherAbuseAutobanEnabled",
          enabled: false,
          updatedAt: expect.any(Number),
          updatedByUserId: "users:admin",
        },
      },
      {
        table: "auditLogs",
        value: {
          actorUserId: "users:admin",
          action: "publisher_abuse.autoban_setting.set",
          targetType: "system",
          targetId: "publisherAbuseAutobanEnabled",
          metadata: {
            previousEnabled: true,
            nextEnabled: false,
          },
          createdAt: expect.any(Number),
        },
      },
    ]);
  });

  it("rejects publisher abuse autoban kill-switch writes from non-admins", async () => {
    const user = { _id: "users:moderator", role: "moderator" };
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user,
    } as never);
    vi.mocked(assertAdmin).mockImplementationOnce(() => {
      throw new Error("Forbidden");
    });
    const ctx = {
      db: {
        query: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
      },
    };

    await expect(setPublisherAbuseAutobanEnabledHandler(ctx, { enabled: false })).rejects.toThrow(
      "Forbidden",
    );

    expect(assertAdmin).toHaveBeenCalledWith(user);
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
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
    ).rejects.toThrow(/excluded publisher/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects direct ban actions when the publisher was relinked", async () => {
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
              ownerKey: "publisher:publishers:candidate",
              ownerPublisherId: "publishers:candidate",
              ownerUserId: "users:previous-owner",
              label: "potential_ban_candidate",
              status: "pending",
              latestScoreId: "publisherAbuseScores:score",
              updatedAt: 1,
            });
          }
          if (id === "publishers:candidate") {
            return {
              _id: "publishers:candidate",
              kind: "user",
              linkedUserId: "users:new-owner",
            };
          }
          if (id === "users:new-owner") return { _id: "users:new-owner", role: "user" };
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
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
    ).rejects.toThrow(/linked user changed/i);

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("bans the linked owner and resolves the nomination in one mutation", async () => {
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
    ).resolves.toEqual({ ok: true, status: "banned" });

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: "users:moderator",
      targetUserId: "users:owner",
      reason: "confirmed spam",
    });
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:nomination",
      expect.objectContaining({
        status: "banned",
        reviewedByUserId: "users:moderator",
        notes: "confirmed spam",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        eventType: "triage_status_changed",
        previousStatus: "pending",
        nextStatus: "banned",
        notes: "confirmed spam",
      }),
    );
  });

  it("does not resolve the nomination when linked owner ban fails", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async () => {
      throw new Error("Ban failed");
    });
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
        reason: "confirmed spam",
      }),
    ).rejects.toThrow("Ban failed");

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("warns pending potential-ban nominations before banning", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:candidate",
      ownerKey: "publisher:publishers:candidate",
      ownerPublisherId: "publishers:candidate",
      ownerUserId: "users:candidate",
      latestScoreId: "publisherAbuseScores:candidate",
      handleSnapshot: "candidate",
      label: "potential_ban_candidate",
      status: "pending",
      lastScoredAt: 20,
      updatedAt: 20,
    });
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:candidate") return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:candidate") return publisher;
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              handle: "candidate",
              email: "candidate@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      autoBanPublisherAbuseCandidatesPageHandler(ctx, { batchSize: 10 }),
    ).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        warningPendingAt: expect.any(Number),
        warningPendingScoreId: "publisherAbuseScores:candidate",
        warningPendingRunId: "publisherAbuseScoreRuns:latest",
      }),
    );
    expect(insert).not.toHaveBeenCalled();
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        userId: "users:candidate",
        to: "candidate@example.test",
        handle: "candidate",
        publisherHandle: "candidate",
        warningPendingAt: expect.any(Number),
        graceMs: 7 * 24 * 60 * 60 * 1000,
        score: expect.objectContaining({
          publishedSkills: 100,
          totalInstalls: 1,
          totalStars: 0,
          totalDownloads: 10,
          reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
        }),
      }),
    );
  });

  it("retries stale pending warning claims from earlier failed warning actions", async () => {
    const stalePendingAt = 1;
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: 20,
        updatedAt: 20,
      }),
      warningPendingAt: stalePendingAt,
      warningPendingScoreId: "publisherAbuseScores:candidate",
      warningPendingRunId: "publisherAbuseScoreRuns:latest",
    };
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const patchedWarningPendingAt: number[] = [];
    const patch = vi.fn(async (_id: string, value: { warningPendingAt?: number }) => {
      if (typeof value.warningPendingAt === "number") {
        patchedWarningPendingAt.push(value.warningPendingAt);
      }
      return null;
    });
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const scheduledWarningPendingAt: number[] = [];
    const scheduler = {
      runAfter: vi.fn(
        async (_delay: number, _target: unknown, value: { warningPendingAt?: number }) => {
          if (typeof value.warningPendingAt === "number") {
            scheduledWarningPendingAt.push(value.warningPendingAt);
          }
          return null;
        },
      ),
    };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:candidate") return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:candidate") return publisher;
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              handle: "candidate",
              email: "candidate@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      autoBanPublisherAbuseCandidatesPageHandler(ctx, { batchSize: 10 }),
    ).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        warningPendingAt: expect.any(Number),
        warningPendingScoreId: "publisherAbuseScores:candidate",
        warningPendingRunId: "publisherAbuseScoreRuns:latest",
      }),
    );
    expect(patchedWarningPendingAt).toEqual([expect.any(Number)]);
    expect(patchedWarningPendingAt.at(0)).not.toBe(stalePendingAt);
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:candidate",
        warningPendingAt: expect.any(Number),
      }),
    );
    expect(scheduledWarningPendingAt).toEqual([expect.any(Number)]);
    expect(scheduledWarningPendingAt.at(0)).not.toBe(stalePendingAt);
  });

  it("bans warned candidates after a later still-bad score passes the warning deadline", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:new",
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: 20,
        updatedAt: 20,
      }),
      warningSentAt: 1,
      warningExpiresAt: 2,
      warningScoreId: "publisherAbuseScores:old",
      warningRunId: "publisherAbuseScoreRuns:old",
    };
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:new",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
      createdAt: 3,
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const runMutation = vi.fn(async () => ({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 4,
      deletedSkillComments: 0,
      scheduledSkills: false,
    }));
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:new") return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:candidate") return publisher;
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              handle: "candidate",
              email: "candidate@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 1,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:candidate",
      nominationId: "publisherAbuseReviewNominations:candidate",
      scoreId: "publisherAbuseScores:new",
      reason:
        "publisher_abuse: potential ban candidate (publisher-abuse-pressure.v2): high_catalog_volume, low_installs_per_skill",
    });
  });

  it("does not ban ready candidates when the page sees autobans disabled", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:new",
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: 20,
        updatedAt: 20,
      }),
      warningSentAt: 1,
      warningExpiresAt: 2,
      warningScoreId: "publisherAbuseScores:old",
      warningRunId: "publisherAbuseScoreRuns:old",
    };
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:new") {
            return {
              ...makeScore({
                _id: "publisherAbuseScores:new",
                ownerKey: "publisher:publishers:candidate",
                ownerPublisherId: "publishers:candidate",
              }),
              ownerUserId: "users:candidate",
              reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
              createdAt: 3,
            };
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:candidate") {
            return {
              _id: "publishers:candidate",
              kind: "user",
              handle: "candidate",
              linkedUserId: "users:candidate",
            };
          }
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              handle: "candidate",
              email: "candidate@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: false,
              updatedAt: 100,
            });
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 0,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("records warning delivery only after the email action reports success", async () => {
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") {
            return {
              ...makeNomination({
                _id: "publisherAbuseReviewNominations:candidate",
                ownerKey: "publisher:publishers:candidate",
                latestScoreId: "publisherAbuseScores:candidate",
              }),
              warningPendingAt: 100,
              warningPendingScoreId: "publisherAbuseScores:candidate",
              warningPendingRunId: "publisherAbuseScoreRuns:latest",
            };
          }
          return null;
        }),
        patch,
        insert,
      },
    };

    await expect(
      recordPublisherAbuseWarningSentInternalHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 100,
        warningSentAt: 150,
        deadlineAt: 200,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith("publisherAbuseReviewNominations:candidate", {
      warningSentAt: 150,
      warningExpiresAt: 200,
      warningScoreId: "publisherAbuseScores:candidate",
      warningRunId: "publisherAbuseScoreRuns:latest",
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: expect.any(Number),
    });
    expect(insert).toHaveBeenCalledWith("publisherAbuseReviewEvents", {
      nominationId: "publisherAbuseReviewNominations:candidate",
      ownerKey: "publisher:publishers:candidate",
      runId: "publisherAbuseScoreRuns:latest",
      scoreId: "publisherAbuseScores:candidate",
      eventType: "autoban_warning_sent",
      notes: "Publisher abuse warning email sent before automatic enforcement.",
      createdAt: 150,
    });
  });

  it("clears pending warnings after email delivery failure so they can be retried", async () => {
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") {
            return {
              ...makeNomination({
                _id: "publisherAbuseReviewNominations:candidate",
                ownerKey: "publisher:publishers:candidate",
                latestScoreId: "publisherAbuseScores:candidate",
              }),
              warningPendingAt: 100,
              warningPendingScoreId: "publisherAbuseScores:candidate",
              warningPendingRunId: "publisherAbuseScoreRuns:latest",
            };
          }
          return null;
        }),
        patch,
      },
    };

    await expect(
      clearPublisherAbusePendingWarningInternalHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 100,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith("publisherAbuseReviewNominations:candidate", {
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: expect.any(Number),
    });
  });

  it("rejects stale pending warnings before the email action sends", async () => {
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") {
            return {
              ...makeNomination({
                _id: "publisherAbuseReviewNominations:candidate",
                ownerKey: "publisher:publishers:candidate",
                latestScoreId: "publisherAbuseScores:candidate",
                status: "reviewed_no_action",
              }),
              warningPendingAt: 100,
              warningPendingScoreId: "publisherAbuseScores:candidate",
              warningPendingRunId: "publisherAbuseScoreRuns:latest",
            };
          }
          return null;
        }),
        patch,
      },
    };

    await expect(
      claimPublisherAbusePendingWarningInternalHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(patch).toHaveBeenCalledWith("publisherAbuseReviewNominations:candidate", {
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: expect.any(Number),
    });
  });

  it("clears pending warnings before email delivery when autobans are disabled", async () => {
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") {
            return {
              ...makeNomination({
                _id: "publisherAbuseReviewNominations:candidate",
                ownerKey: "publisher:publishers:candidate",
                latestScoreId: "publisherAbuseScores:candidate",
                status: "pending",
                label: "potential_ban_candidate",
              }),
              warningPendingAt: 100,
              warningPendingScoreId: "publisherAbuseScores:candidate",
              warningPendingRunId: "publisherAbuseScoreRuns:latest",
            };
          }
          return null;
        }),
        patch,
        query: vi.fn((table: string) => {
          if (table !== "systemSettings") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: (
              _index: string,
              build: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              build({ eq: vi.fn() });
              return {
                unique: async () => ({
                  key: "publisherAbuseAutobanEnabled",
                  enabled: false,
                  updatedAt: 1,
                  updatedByUserId: "users:admin",
                }),
              };
            },
          };
        }),
      },
    };

    await expect(
      claimPublisherAbusePendingWarningInternalHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "autoban_disabled" });

    expect(patch).toHaveBeenCalledWith("publisherAbuseReviewNominations:candidate", {
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: expect.any(Number),
    });
  });

  it("clears pending warnings before email delivery when the publisher was relinked", async () => {
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") {
            return {
              ...makeNomination({
                _id: "publisherAbuseReviewNominations:candidate",
                ownerKey: "publisher:publishers:candidate",
                ownerPublisherId: "publishers:candidate",
                ownerUserId: "users:old-owner",
                latestScoreId: "publisherAbuseScores:candidate",
                status: "pending",
                label: "potential_ban_candidate",
              }),
              warningPendingAt: 100,
              warningPendingScoreId: "publisherAbuseScores:candidate",
              warningPendingRunId: "publisherAbuseScoreRuns:latest",
            };
          }
          if (id === "publishers:candidate") {
            return {
              _id: "publishers:candidate",
              kind: "user",
              linkedUserId: "users:new-owner",
            };
          }
          if (id === "users:old-owner") {
            return {
              _id: "users:old-owner",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        query: vi.fn((table: string) => {
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table !== "systemSettings") throw new Error(`unexpected table ${table}`);
          return makePublisherAbuseAutobanSettingQuery(null);
        }),
      },
    };

    await expect(
      claimPublisherAbusePendingWarningInternalHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(patch).toHaveBeenCalledWith("publisherAbuseReviewNominations:candidate", {
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: expect.any(Number),
    });
  });

  it("clears pending warnings before email delivery when the publisher became official", async () => {
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") {
            return {
              ...makeNomination({
                _id: "publisherAbuseReviewNominations:candidate",
                ownerKey: "publisher:publishers:candidate",
                ownerPublisherId: "publishers:candidate",
                ownerUserId: "users:candidate",
                latestScoreId: "publisherAbuseScores:candidate",
                status: "pending",
                label: "potential_ban_candidate",
              }),
              warningPendingAt: 100,
              warningPendingScoreId: "publisherAbuseScores:candidate",
              warningPendingRunId: "publisherAbuseScoreRuns:latest",
            };
          }
          if (id === "publishers:candidate") {
            return {
              _id: "publishers:candidate",
              kind: "user",
              linkedUserId: "users:candidate",
            };
          }
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        query: vi.fn((table: string) => {
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          if (table === "officialPublishers") {
            return {
              withIndex: (indexName: string) => {
                if (indexName !== "by_publisher") {
                  throw new Error(`unexpected official publisher index ${indexName}`);
                }
                return {
                  unique: async () => ({
                    _id: "officialPublishers:candidate",
                    publisherId: "publishers:candidate",
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
      claimPublisherAbusePendingWarningInternalHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(patch).toHaveBeenCalledWith("publisherAbuseReviewNominations:candidate", {
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      updatedAt: expect.any(Number),
    });
  });

  it("does not ban warned candidates when the newer score was created before the deadline", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:new-before-deadline",
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: 20,
        updatedAt: 20,
      }),
      warningSentAt: 1,
      warningExpiresAt: 10,
      warningScoreId: "publisherAbuseScores:old",
      warningRunId: "publisherAbuseScoreRuns:old",
    };
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:new-before-deadline",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      createdAt: 9,
    };
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn();
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:new-before-deadline") return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:candidate") {
            return {
              _id: "publishers:candidate",
              kind: "user",
              handle: "candidate",
              linkedUserId: "users:candidate",
            };
          }
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              handle: "candidate",
              email: "candidate@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not ban warned candidates until a newer score confirms the warning", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:same",
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: 20,
        updatedAt: 20,
      }),
      warningSentAt: 1,
      warningExpiresAt: 2,
      warningScoreId: "publisherAbuseScores:same",
      warningRunId: "publisherAbuseScoreRuns:latest",
    };
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:same",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn();
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:same") return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:candidate") return publisher;
          if (id === "users:candidate") {
            return {
              _id: "users:candidate",
              handle: "candidate",
              email: "candidate@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("moves candidates without email to manual review instead of warning or banning", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:no-email",
      ownerKey: "publisher:publishers:no-email",
      ownerPublisherId: "publishers:no-email",
      ownerUserId: "users:no-email",
      latestScoreId: "publisherAbuseScores:no-email",
      handleSnapshot: "no-email",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const publisher = {
      _id: "publishers:no-email",
      kind: "user",
      handle: "no-email",
      linkedUserId: "users:no-email",
    };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:no-email") {
            return makeScore({
              _id: "publisherAbuseScores:no-email",
              ownerKey: "publisher:publishers:no-email",
              ownerPublisherId: "publishers:no-email",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:no-email") return publisher;
          if (id === "users:no-email") {
            return { _id: "users:no-email", handle: "no-email", role: "user" };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:no-email",
      expect.objectContaining({
        status: "needs_policy_discussion",
        notes: "Autoban warning skipped: linked user has no email address; manual review required.",
      }),
    );
  });

  it("warns in-progress pressure-model score candidates", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:running",
      ownerKey: "publisher:publishers:running",
      ownerPublisherId: "publishers:running",
      ownerUserId: "users:running",
      latestScoreId: "publisherAbuseScores:running",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:running",
      ownerKey: "publisher:publishers:running",
      ownerPublisherId: "publishers:running",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:running") return score;
          if (id === "publisherAbuseScoreRuns:latest") {
            return {
              ...makeCompletedPressureScoreRun(),
              status: "running",
              phase: "finalizing",
            };
          }
          if (id === "publishers:running") {
            return {
              _id: "publishers:running",
              kind: "user",
              handle: "running",
              linkedUserId: "users:running",
            };
          }
          if (id === "users:running") {
            return {
              _id: "users:running",
              handle: "running",
              email: "running@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:running",
      expect.objectContaining({
        warningPendingScoreId: "publisherAbuseScores:running",
      }),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("continues across autoban pages when candidates remain", async () => {
    const runningNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:running",
      ownerKey: "publisher:publishers:running",
      ownerPublisherId: "publishers:running",
      ownerUserId: "users:running",
      latestScoreId: "publisherAbuseScores:running",
      lastScoredAt: 2,
    });
    const eligibleNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:eligible",
      ownerKey: "publisher:publishers:eligible",
      ownerPublisherId: "publishers:eligible",
      ownerUserId: "users:eligible",
      latestScoreId: "publisherAbuseScores:eligible",
      lastScoredAt: 1,
    });
    const runningScore = makeScore({
      _id: "publisherAbuseScores:running",
      ownerKey: "publisher:publishers:running",
      ownerPublisherId: "publishers:running",
    });
    const eligibleScore = makeScore({
      _id: "publisherAbuseScores:eligible",
      ownerKey: "publisher:publishers:eligible",
      ownerPublisherId: "publishers:eligible",
    });
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const query = vi.fn((table: string) => {
      if (table === "publisherAbuseReviewNominations") {
        return makeAutoBanNominationQuery([runningNomination], {
          isDone: false,
          continueCursor: "after-running",
        });
      }
      if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
      if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:running") return runningScore;
          if (id === "publisherAbuseScores:eligible") return eligibleScore;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:running") {
            return {
              _id: "publishers:running",
              kind: "user",
              handle: "running",
              linkedUserId: "users:running",
            };
          }
          if (id === "users:running") {
            return {
              _id: "users:running",
              handle: "running",
              email: "running@example.test",
              role: "user",
            };
          }
          if (id === "publishers:eligible") {
            return {
              _id: "publishers:eligible",
              kind: "user",
              handle: "eligible",
              linkedUserId: "users:eligible",
            };
          }
          if (id === "users:eligible") {
            return {
              _id: "users:eligible",
              handle: "eligible",
              email: "eligible@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        query,
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: false,
      cursor: "after-running",
    });

    query.mockImplementation((table: string) => {
      if (table === "publisherAbuseReviewNominations") {
        return makeAutoBanNominationQuery([eligibleNomination], {
          expectedCursor: "after-running",
        });
      }
      if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
      if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      autoBanPublisherAbuseCandidatesPageHandler(ctx, { cursor: "after-running" }),
    ).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).toHaveBeenCalledTimes(2);
  });

  it("moves backfill temporal autoban candidates out of the pending queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:backfill",
      ownerKey: "publisher:publishers:backfill",
      ownerPublisherId: "publishers:backfill",
      ownerUserId: "users:backfill",
      latestScoreId: "publisherAbuseScores:backfill",
      openedByRunId: "publisherAbuseScoreRuns:backfill",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:backfill",
      runId: "publisherAbuseScoreRuns:backfill",
      ownerKey: "publisher:publishers:backfill",
      ownerPublisherId: "publishers:backfill",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:backfill") return score;
          if (id === "publisherAbuseScoreRuns:backfill") {
            return {
              _id: "publisherAbuseScoreRuns:backfill",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
              temporalMode: "backfill",
            };
          }
          if (id === "publishers:backfill") {
            return {
              _id: "publishers:backfill",
              kind: "user",
              handle: "backfill",
              linkedUserId: "users:backfill",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:backfill",
      expect.objectContaining({
        status: "candidate_for_future_action",
        notes:
          "Autoban skipped: temporal nomination is not from a complete current enforcement run.",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:backfill",
        nextStatus: "candidate_for_future_action",
      }),
    );
  });

  it("keeps current temporal candidates pending while persisted finalization is running", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:finalizing-current",
      ownerKey: "publisher:publishers:finalizing-current",
      ownerPublisherId: "publishers:finalizing-current",
      ownerUserId: "users:finalizing-current",
      latestScoreId: "publisherAbuseScores:finalizing-current",
      openedByRunId: "publisherAbuseScoreRuns:finalizing-current",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:finalizing-current",
      runId: "publisherAbuseScoreRuns:finalizing-current",
      ownerKey: "publisher:publishers:finalizing-current",
      ownerPublisherId: "publishers:finalizing-current",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:finalizing-current") return score;
          if (id === "publisherAbuseScoreRuns:finalizing-current") {
            return {
              _id: "publisherAbuseScoreRuns:finalizing-current",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "running",
              phase: "finalizing",
              temporalMode: "current",
              temporalScanComplete: true,
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("moves unclassified temporal autoban candidates out of the pending queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:unclassified",
      ownerKey: "publisher:publishers:unclassified",
      ownerPublisherId: "publishers:unclassified",
      ownerUserId: "users:unclassified",
      latestScoreId: "publisherAbuseScores:unclassified",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:unclassified",
      runId: "publisherAbuseScoreRuns:unclassified",
      ownerKey: "publisher:publishers:unclassified",
      ownerPublisherId: "publishers:unclassified",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:unclassified") return score;
          if (id === "publisherAbuseScoreRuns:unclassified") {
            return {
              _id: "publisherAbuseScoreRuns:unclassified",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:unclassified",
      expect.objectContaining({
        status: "candidate_for_future_action",
        notes:
          "Autoban skipped: temporal nomination is not from a complete current enforcement run.",
      }),
    );
  });

  it("warns candidates refreshed by a current run after a backfill opening", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:refreshed",
      ownerKey: "publisher:publishers:refreshed",
      ownerPublisherId: "publishers:refreshed",
      ownerUserId: "users:refreshed",
      latestScoreId: "publisherAbuseScores:current",
      openedByRunId: "publisherAbuseScoreRuns:backfill",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:current",
      runId: "publisherAbuseScoreRuns:current",
      ownerKey: "publisher:publishers:refreshed",
      ownerPublisherId: "publishers:refreshed",
    });
    const publisher = {
      _id: "publishers:refreshed",
      kind: "user",
      handle: "refreshed",
      linkedUserId: "users:refreshed",
    };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:current") return score;
          if (id === "publisherAbuseScoreRuns:current") {
            return {
              _id: "publisherAbuseScoreRuns:current",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
              temporalMode: "current",
              temporalScanComplete: true,
            };
          }
          if (id === "publisherAbuseScoreRuns:backfill") {
            return {
              _id: "publisherAbuseScoreRuns:backfill",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
              temporalMode: "backfill",
            };
          }
          if (id === "publishers:refreshed") return publisher;
          if (id === "users:refreshed") {
            return {
              _id: "users:refreshed",
              handle: "refreshed",
              email: "refreshed@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "publisherAbuseScoreRuns") {
            return makeLatestCompletedCurrentTemporalRunQuery({
              _id: "publisherAbuseScoreRuns:current",
            });
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:refreshed",
      expect.objectContaining({
        warningPendingScoreId: "publisherAbuseScores:current",
      }),
    );
  });

  it("moves stale temporal candidates from older current runs out of the autoban queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:stale-current",
      ownerKey: "publisher:publishers:stale-current",
      ownerPublisherId: "publishers:stale-current",
      ownerUserId: "users:stale-current",
      latestScoreId: "publisherAbuseScores:old-current",
      openedByRunId: "publisherAbuseScoreRuns:old-current",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:old-current",
      runId: "publisherAbuseScoreRuns:old-current",
      ownerKey: "publisher:publishers:stale-current",
      ownerPublisherId: "publishers:stale-current",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:old-current") return score;
          if (id === "publisherAbuseScoreRuns:old-current") {
            return {
              _id: "publisherAbuseScoreRuns:old-current",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
              temporalMode: "current",
              temporalScanComplete: true,
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "publisherAbuseScoreRuns") {
            return makeLatestCompletedCurrentTemporalRunQuery({
              _id: "publisherAbuseScoreRuns:new-current",
            });
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:stale-current",
      expect.objectContaining({
        status: "candidate_for_future_action",
        notes:
          "Autoban skipped: temporal nomination is not from the latest complete current enforcement run.",
      }),
    );
  });

  it("moves partial current temporal autoban candidates out of the pending queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:partial-current",
      ownerKey: "publisher:publishers:partial-current",
      ownerPublisherId: "publishers:partial-current",
      ownerUserId: "users:partial-current",
      latestScoreId: "publisherAbuseScores:partial-current",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:partial-current",
      runId: "publisherAbuseScoreRuns:partial-current",
      ownerKey: "publisher:publishers:partial-current",
      ownerPublisherId: "publishers:partial-current",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:partial-current") return score;
          if (id === "publisherAbuseScoreRuns:partial-current") {
            return {
              _id: "publisherAbuseScoreRuns:partial-current",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
              temporalMode: "current",
              temporalScanComplete: false,
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:partial-current",
      expect.objectContaining({
        status: "candidate_for_future_action",
        notes:
          "Autoban skipped: temporal nomination is not from a complete current enforcement run.",
      }),
    );
  });

  it("moves official publisher autoban candidates out of the pending queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:official",
      ownerKey: "publisher:publishers:official",
      ownerPublisherId: "publishers:official",
      ownerUserId: "users:official",
      latestScoreId: "publisherAbuseScores:official",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const publisher = {
      _id: "publishers:official",
      kind: "org",
      handle: "official",
      linkedUserId: "users:official",
    };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:official") {
            return makeScore({
              _id: "publisherAbuseScores:official",
              ownerKey: "publisher:publishers:official",
              ownerPublisherId: "publishers:official",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:official") return publisher;
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") {
            return {
              withIndex: () => ({
                unique: async () => ({
                  _id: "officialPublishers:official",
                  publisherId: "publishers:official",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:official",
      expect.objectContaining({
        status: "reviewed_no_action",
        notes: "Autoban skipped: publisher is excluded from publisher abuse enforcement.",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:official",
        nextStatus: "reviewed_no_action",
      }),
    );
  });

  it("moves inactive publisher autoban candidates out of the pending queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:inactive",
      ownerKey: "publisher:publishers:inactive",
      ownerPublisherId: "publishers:inactive",
      ownerUserId: "users:inactive",
      latestScoreId: "publisherAbuseScores:inactive",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const scheduler = { runAfter: vi.fn(async () => null) };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:inactive") {
            return makeScore({
              _id: "publisherAbuseScores:inactive",
              ownerKey: "publisher:publishers:inactive",
              ownerPublisherId: "publishers:inactive",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:inactive") {
            return {
              _id: "publishers:inactive",
              kind: "user",
              handle: "inactive",
              linkedUserId: "users:inactive",
              deactivatedAt: 1_700_000_000_000,
            };
          }
          if (id === "users:inactive") {
            return {
              _id: "users:inactive",
              handle: "inactive",
              email: "inactive@example.test",
              role: "user",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:inactive",
      expect.objectContaining({
        status: "reviewed_no_action",
        notes: "Autoban skipped: publisher is inactive.",
      }),
    );
  });

  it("moves autoban candidates without linked users to policy discussion", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:unlinked",
      ownerKey: "publisher:publishers:unlinked",
      ownerPublisherId: "publishers:unlinked",
      ownerUserId: undefined,
      latestScoreId: "publisherAbuseScores:unlinked",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:unlinked") {
            return makeScore({
              _id: "publisherAbuseScores:unlinked",
              ownerKey: "publisher:publishers:unlinked",
              ownerPublisherId: "publishers:unlinked",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:unlinked") {
            return { _id: "publishers:unlinked", kind: "user", handle: "unlinked" };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:unlinked",
      expect.objectContaining({
        status: "needs_policy_discussion",
        notes: "Autoban skipped: nomination has no linked user account.",
      }),
    );
  });

  it("moves relinked publisher autoban candidates to policy discussion", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:relinked",
      ownerKey: "publisher:publishers:relinked",
      ownerPublisherId: "publishers:relinked",
      ownerUserId: "users:previous",
      latestScoreId: "publisherAbuseScores:relinked",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:relinked") {
            return makeScore({
              _id: "publisherAbuseScores:relinked",
              ownerKey: "publisher:publishers:relinked",
              ownerPublisherId: "publishers:relinked",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:relinked") {
            return {
              _id: "publishers:relinked",
              kind: "user",
              handle: "relinked",
              linkedUserId: "users:current",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:relinked",
      expect.objectContaining({
        status: "needs_policy_discussion",
        notes:
          "Autoban skipped: publisher is not linked to the nominated user account; manual review required.",
      }),
    );
  });

  it("moves legacy autoban candidates without publisher rows to policy discussion", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:legacy-user",
      ownerKey: "user:users:legacy-user",
      ownerPublisherId: undefined,
      ownerUserId: "users:legacy-user",
      latestScoreId: "publisherAbuseScores:legacy-user",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:legacy-user") {
            return makeScore({
              _id: "publisherAbuseScores:legacy-user",
              ownerKey: "user:users:legacy-user",
              ownerPublisherId: undefined,
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:legacy-user",
      expect.objectContaining({
        status: "needs_policy_discussion",
        notes: "Autoban skipped: nomination has no linked publisher row; manual review required.",
      }),
    );
  });

  it("moves protected-role autoban candidates out of the pending queue before enforcement", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:staff",
      ownerKey: "publisher:publishers:staff",
      ownerPublisherId: "publishers:staff",
      ownerUserId: "users:staff",
      latestScoreId: "publisherAbuseScores:staff",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn(async () => ({ ok: false, reason: "protected_role" }));
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:staff") {
            return makeScore({
              _id: "publisherAbuseScores:staff",
              ownerKey: "publisher:publishers:staff",
              ownerPublisherId: "publishers:staff",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:staff") {
            return {
              _id: "publishers:staff",
              kind: "user",
              handle: "staff",
              linkedUserId: "users:staff",
            };
          }
          if (id === "users:staff") {
            return {
              _id: "users:staff",
              handle: "staff",
              email: "staff@example.test",
              role: "moderator",
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 1,
      isDone: true,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:staff",
      expect.objectContaining({
        status: "reviewed_no_action",
        notes: "Autoban skipped: publisher is excluded from publisher abuse enforcement.",
      }),
    );
  });

  it("uses ban cleanup instead of warning already-banned linked users", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:banned",
      ownerKey: "publisher:publishers:banned",
      ownerPublisherId: "publishers:banned",
      ownerUserId: "users:banned",
      latestScoreId: "publisherAbuseScores:banned",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async () => ({ ok: true, alreadyBanned: true }));
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:banned") {
            return makeScore({
              _id: "publisherAbuseScores:banned",
              ownerKey: "publisher:publishers:banned",
              ownerPublisherId: "publishers:banned",
            });
          }
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === "publishers:banned") {
            return {
              _id: "publishers:banned",
              kind: "user",
              handle: "banned",
              linkedUserId: "users:banned",
            };
          }
          if (id === "users:banned") {
            return {
              _id: "users:banned",
              handle: "banned",
              email: "banned@example.test",
              role: "user",
              deletedAt: 123,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") return makePublisherAbuseAutobanSettingQuery(null);
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 0,
      alreadyBanned: 1,
      skipped: 0,
      isDone: true,
    });

    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:banned",
      nominationId: "publisherAbuseReviewNominations:banned",
      scoreId: "publisherAbuseScores:banned",
      reason: expect.stringContaining("publisher_abuse"),
    });
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
            expect(constraints.modelVersion).toBe("publisher-abuse-pressure.v2");
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
      if (table === "publisherMembers") return makeEmptyPublisherMembersQuery();
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

  it("excludes official and staff publishers from abuse scoring even when they match abuse-pressure criteria", async () => {
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
    const largeCommunityOrgPublisher = {
      ...officialOrgPublisher,
      _id: "publishers:large-community-bulk",
      handle: "large-community-bulk",
      displayName: "Large Community Bulk",
      linkedUserId: "users:large-community-bulk",
    };
    const tooManyManagerOrgPublisher = {
      ...officialOrgPublisher,
      _id: "publishers:too-many-managers",
      handle: "too-many-managers",
      displayName: "Too Many Managers",
      linkedUserId: "users:too-many-managers",
    };
    const staffPublisher = {
      ...officialOrgPublisher,
      _id: "publishers:staff-bulk",
      handle: "staff-bulk",
      displayName: "Staff Bulk",
      linkedUserId: "users:staff",
    };
    const officialLookupIds: string[] = [];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:run") {
            return {
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
            };
          }
          if (id === "users:staff") return { _id: "users:staff", role: "moderator" };
          if (id.startsWith("users:large-community-admin-")) {
            return { _id: id, role: "user" };
          }
          if (id.startsWith("users:too-many-manager-")) {
            return { _id: id, role: "user" };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: [
                    officialOrgPublisher,
                    staffPublisher,
                    communityOrgPublisher,
                    largeCommunityOrgPublisher,
                    tooManyManagerOrgPublisher,
                  ],
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
          if (table === "publisherMembers") {
            return {
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                expect(indexName).toBe("by_publisher_and_role");
                const constraints: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    constraints[field] = value;
                    return q;
                  },
                };
                build(q);
                return {
                  take: async () =>
                    constraints.publisherId === largeCommunityOrgPublisher._id &&
                    constraints.role === "admin"
                      ? [
                          ...Array.from({ length: 101 }, (_, index) => ({
                            _id: `publisherMembers:large-community-publisher-${index}`,
                            publisherId: largeCommunityOrgPublisher._id,
                            userId: `users:large-community-publisher-${index}`,
                            role: "publisher",
                          })),
                          {
                            _id: "publisherMembers:large-community-admin",
                            publisherId: largeCommunityOrgPublisher._id,
                            userId: "users:large-community-admin-0",
                            role: "admin",
                          },
                        ].filter((member) => member.role === constraints.role)
                      : constraints.publisherId === tooManyManagerOrgPublisher._id &&
                          constraints.role === "admin"
                        ? Array.from({ length: 101 }, (_, index) => ({
                            _id: `publisherMembers:too-many-manager-${index}`,
                            publisherId: tooManyManagerOrgPublisher._id,
                            userId: `users:too-many-manager-${index}`,
                            role: "admin",
                          }))
                        : [],
                };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: false, scanned: 5, phase: "finalizing" }),
    );

    expect(officialLookupIds).toEqual([
      officialOrgPublisher._id,
      staffPublisher._id,
      communityOrgPublisher._id,
      largeCommunityOrgPublisher._id,
      tooManyManagerOrgPublisher._id,
    ]);
    expect(insert).toHaveBeenCalledTimes(2);
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
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerPublisherId: largeCommunityOrgPublisher._id,
        handleSnapshot: largeCommunityOrgPublisher.handle,
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerPublisherId: officialOrgPublisher._id,
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerPublisherId: staffPublisher._id,
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerPublisherId: tooManyManagerOrgPublisher._id,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        scannedPublishers: 5,
        scoredPublishers: 2,
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
          if (table === "publisherMembers") return makeEmptyPublisherMembersQuery();
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

  it("schedules a publisher abuse autoban continuation when candidates remain", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async () => ({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 1,
      alreadyBanned: 0,
      skipped: 0,
      isDone: false,
    }));
    const ctx = {
      scheduler,
      runQuery: vi.fn<(_: unknown, args: Record<string, never>) => Promise<boolean>>(
        async () => true,
      ),
      runMutation,
    };

    await expect(
      processPublisherAbuseAutobansHandler(ctx, { batchSize: 1, maxPages: 2 }),
    ).resolves.toEqual({
      ok: true,
      pages: 2,
      processed: 2,
      warned: 0,
      banned: 2,
      alreadyBanned: 0,
      skipped: 0,
      isDone: false,
    });

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(scheduler.runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      batchSize: 1,
      maxPages: 2,
    });
  });

  it("does not process publisher abuse autobans when the kill switch is disabled", async () => {
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn<(_: unknown, args: Record<string, never>) => Promise<boolean>>(
        async () => false,
      ),
      runMutation: vi.fn(),
    };

    await expect(
      processPublisherAbuseAutobansHandler(ctx, { batchSize: 1, maxPages: 2 }),
    ).resolves.toEqual({
      ok: true,
      pages: 0,
      processed: 0,
      warned: 0,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(String(ctx.runQuery.mock.calls[0]?.[0])).toContain(
      "getPublisherAbuseAutobanEnabledInternal",
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores the moderator actor when a manual score run starts", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        runId: "publisherAbuseScoreRuns:run",
        phase: "completed",
        status: "completed",
      })
      .mockResolvedValueOnce({
        ok: true,
        processed: 0,
        warned: 0,
        banned: 0,
        alreadyBanned: 0,
        skipped: 0,
        isDone: true,
      });
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn<(_: unknown, args: Record<string, never>) => Promise<boolean>>(
        async () => true,
      ),
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
    expect(String(runMutation.mock.calls[1]?.[0])).toContain(
      "autoBanPublisherAbuseCandidatesPageInternal",
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
      if (String(target).includes("autoBanPublisherAbuseCandidatesPageInternal")) {
        return {
          ok: true,
          processed: 0,
          warned: 0,
          banned: 0,
          alreadyBanned: 0,
          skipped: 0,
          isDone: true,
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

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(String(runMutation.mock.calls[0]?.[0])).toContain(
      "finalizePublisherAbuseScoresPageInternal",
    );
    expect(String(runMutation.mock.calls[1]?.[0])).toContain(
      "autoBanPublisherAbuseCandidatesPageInternal",
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("drains publisher abuse autobans after partial finalizing pages create nominations", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async (target: symbol) => {
      if (String(target).includes("finalizePublisherAbuseScoresPageInternal")) {
        return {
          runId: "publisherAbuseScoreRuns:run",
          phase: "finalizing",
          status: "running",
          isDone: false,
          finalized: 1,
          nominations: 1,
        };
      }
      if (String(target).includes("autoBanPublisherAbuseCandidatesPageInternal")) {
        return {
          ok: true,
          processed: 1,
          warned: 0,
          banned: 1,
          alreadyBanned: 0,
          skipped: 0,
          isDone: true,
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
      isDone: false,
    });

    expect(String(runMutation.mock.calls[0]?.[0])).toContain(
      "finalizePublisherAbuseScoresPageInternal",
    );
    expect(String(runMutation.mock.calls[1]?.[0])).toContain(
      "autoBanPublisherAbuseCandidatesPageInternal",
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      runId: "publisherAbuseScoreRuns:run",
      batchSize: 100,
      maxPages: 1,
      trigger: "cron",
    });
  });

  it("does not mark a completed score run failed when the autoban sweep fails", async () => {
    const autobanError = new Error("autoban failed");
    const runMutation = vi.fn(async (target: symbol) => {
      if (String(target).includes("finalizePublisherAbuseScoresPageInternal")) {
        return {
          runId: "publisherAbuseScoreRuns:run",
          phase: "completed",
          status: "completed",
          isDone: true,
          finalized: 1,
          nominations: 1,
        };
      }
      if (String(target).includes("autoBanPublisherAbuseCandidatesPageInternal")) {
        throw autobanError;
      }
      if (String(target).includes("markPublisherAbuseScoreRunFailedInternal")) {
        throw new Error("completed scoring run should not be marked failed");
      }
      throw new Error(`unexpected mutation ${String(target)}`);
    });
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:run",
        phase: "finalizing",
        status: "running",
      })),
      runMutation,
    };

    await expect(
      runHandler(ctx, { runId: "publisherAbuseScoreRuns:run", batchSize: 100, maxPages: 1 }),
    ).rejects.toThrow("autoban failed");

    expect(
      runMutation.mock.calls.some((call) =>
        String(call[0]).includes("markPublisherAbuseScoreRunFailedInternal"),
      ),
    ).toBe(false);
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
    const indexBuilder = { eq: vi.fn(() => indexBuilder) };
    const ctx = {
      db: {
        insert: vi.fn(async () => "publisherAbuseScoreRuns:new"),
        query: vi.fn(() => ({
          withIndex: (indexName: string, applyIndex: (q: typeof indexBuilder) => unknown) => {
            expect(indexName).toBe("by_model_version_and_status_and_updated_at");
            applyIndex(indexBuilder);
            return {
              order: () => ({
                first: async () => ({
                  _id: "publisherAbuseScoreRuns:active",
                  status: "running",
                  phase: "collecting",
                }),
              }),
            };
          },
        })),
      },
    };

    await expect(getOrStartHandler(ctx, { trigger: "cron" })).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:active",
      status: "running",
      phase: "collecting",
    });

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(indexBuilder.eq).toHaveBeenCalledWith("modelVersion", "publisher-abuse-pressure.v2");
    expect(indexBuilder.eq).toHaveBeenCalledWith("status", "running");
  });

  it("does not reuse running temporal scans as active pressure score runs", async () => {
    const indexBuilder = { eq: vi.fn(() => indexBuilder) };
    const ctx = {
      db: {
        insert: vi.fn(async () => "publisherAbuseScoreRuns:new"),
        query: vi.fn(() => ({
          withIndex: (indexName: string, applyIndex: (q: typeof indexBuilder) => unknown) => {
            expect(indexName).toBe("by_model_version_and_status_and_updated_at");
            applyIndex(indexBuilder);
            return {
              order: () => ({
                first: async () => null,
              }),
            };
          },
        })),
      },
    };

    await expect(getOrStartHandler(ctx, { trigger: "cron" })).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:new",
      status: "running",
      phase: "collecting",
    });

    expect(indexBuilder.eq).toHaveBeenCalledWith("modelVersion", "publisher-abuse-pressure.v2");
    expect(indexBuilder.eq).toHaveBeenCalledWith("status", "running");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns",
      expect.objectContaining({
        modelVersion: "publisher-abuse-pressure.v2",
        status: "running",
        phase: "collecting",
      }),
    );
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
      scannedSkills: 1_000,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(ctx.runQuery).toHaveBeenCalledTimes(10);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("persists an empty current temporal scan so stale nominations can clear", async () => {
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn(async () => ({
        cursor: undefined,
        isDone: true,
        scannedSkills: 12,
        candidates: [],
      })),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({
          flaggedPublishers: 0,
          nominations: 0,
        })
        .mockResolvedValueOnce({
          ok: true,
          processed: 0,
          warned: 0,
          banned: 0,
          alreadyBanned: 0,
          skipped: 0,
          isDone: true,
        }),
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

    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        mode: "current",
        candidates: [],
        scanComplete: true,
      }),
    );
    expect(String(ctx.runMutation.mock.calls[1]?.[0])).toContain(
      "autoBanPublisherAbuseCandidatesPageInternal",
    );
  });

  it("does not autoban candidates from a partial current temporal scan", async () => {
    const candidate = temporalCandidate("skills:first", { slug: "first", displayName: "First" });
    candidate.temporalScore.nearConversion = true;
    candidate.temporalScore.installDownloadExcessZScore7 = 60;
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => ({
        cursor: "next-page",
        isDone: false,
        scannedSkills: 1,
        candidates: [candidate],
      })),
      runMutation: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:temporal",
        status: "running",
        phase: "collecting",
      })),
    };

    await expect(
      temporalRunHandler(ctx, {
        mode: "current",
        dryRun: false,
        candidateLimit: 100,
        batchSize: 1,
        maxPages: 1,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      mode: "current",
      scannedSkills: 1,
      highTemporalSkills: 1,
      flaggedPublishers: 1,
      nominations: 0,
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "current",
        cursor: "next-page",
        candidates: [candidate],
        scannedSkills: 1,
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      runId: "publisherAbuseScoreRuns:temporal",
      mode: "current",
      dryRun: false,
      candidateLimit: 100,
      batchSize: 1,
      maxPages: 1,
      todayDay: 100,
      lookbackDays: undefined,
      trigger: "cron",
      actorUserId: undefined,
    });
  });

  it("starts persisted current temporal scans after one bounded page", async () => {
    const candidates = [
      temporalCandidate("skills:first", { slug: "first", displayName: "First" }),
      temporalCandidate("skills:second", { slug: "second", displayName: "Second" }),
      temporalCandidate("skills:third", { slug: "third", displayName: "Third" }),
    ];
    for (const candidate of candidates) {
      candidate.temporalScore.nearConversion = true;
      candidate.temporalScore.installDownloadExcessZScore7 = 60;
    }
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async (_query: unknown, args: { cursor?: string }) => {
        const index = args.cursor ? Number(args.cursor.replace("page-", "")) : 0;
        return {
          cursor: `page-${index + 1}`,
          isDone: false,
          scannedSkills: 1,
          candidates: [candidates[index]],
        };
      }),
      runMutation: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:temporal",
        status: "running",
        phase: "collecting",
      })),
    };

    await expect(
      temporalRunHandler(ctx, {
        mode: "current",
        dryRun: false,
        candidateLimit: 3,
        batchSize: 1,
        maxPages: 3,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      mode: "current",
      scannedSkills: 1,
      highTemporalSkills: 1,
      flaggedPublishers: 1,
      nominations: 0,
    });

    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cursor: "page-1",
        candidates: [candidates[0]],
        scannedSkills: 1,
      }),
    );
  });

  it("continues persisted current temporal scans with only the run id", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:temporal",
        status: "running",
        phase: "collecting",
        scannedPublishers: 20,
        temporalScanComplete: false,
      })),
      runMutation: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:temporal",
        status: "running",
        phase: "collecting",
        isDone: false,
        scanned: 50,
        scannedPublishers: 70,
        temporalScanComplete: false,
      })),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
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
      scannedSkills: 50,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      runId: "publisherAbuseScoreRuns:temporal",
      batchSize: 50,
      remainingScanLimit: undefined,
      todayDay: 100,
      lookbackDays: undefined,
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      runId: "publisherAbuseScoreRuns:temporal",
      mode: "current",
      dryRun: false,
      candidateLimit: 100,
      batchSize: 50,
      maxPages: 1,
      todayDay: 100,
      lookbackDays: undefined,
      trigger: "cron",
      actorUserId: undefined,
    });
  });

  it("continues persisted current temporal scans past the candidate limit", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "collecting",
            scannedPublishers: 100,
            temporalScanComplete: false,
          };
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol, args: { remainingScanLimit?: number }) => {
        const name = String(target);
        if (name.includes("collectTemporalPublisherAbuseSkillCandidatesForRunPageInternal")) {
          expect(args).toEqual({
            runId: "publisherAbuseScoreRuns:temporal",
            batchSize: 50,
            remainingScanLimit: undefined,
            todayDay: 100,
            lookbackDays: undefined,
          });
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "collecting",
            isDone: false,
            scanned: 50,
            scannedPublishers: 150,
            temporalScanComplete: false,
          };
        }
        throw new Error(`unexpected mutation ${name}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
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
      scannedSkills: 50,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(
      ctx.runMutation.mock.calls.some(([target]) =>
        String(target).includes("autoBanPublisherAbuseCandidatesPageInternal"),
      ),
    ).toBe(false);
    expect(
      ctx.runMutation.mock.calls.some(([target]) =>
        String(target).includes("completePersistedTemporalPublisherAbuseScanInternal"),
      ),
    ).toBe(false);
    expect(scheduler.runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      runId: "publisherAbuseScoreRuns:temporal",
      mode: "current",
      dryRun: false,
      candidateLimit: 100,
      batchSize: 50,
      maxPages: 1,
      todayDay: 100,
      lookbackDays: undefined,
      trigger: "cron",
      actorUserId: undefined,
    });
  });

  it("finalizes persisted current temporal scans through publisher aggregate pages", async () => {
    const candidate = temporalCandidate("skills:first", { slug: "first", displayName: "First" });
    candidate.temporalScore.nearConversion = true;
    candidate.temporalScore.installDownloadExcessZScore7 = 60;
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "finalizing",
          };
        }
        if (name.includes("listTemporalPublisherAbuseScanCandidatesPageInternal")) {
          return {
            candidates: [candidate],
            isDone: true,
          };
        }
        if (name.includes("getPublisherAbuseAutobanEnabledInternal")) {
          return true;
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol, _args?: unknown) => {
        const name = String(target);
        if (name.includes("persistTemporalPublisherAbuseAggregateInternal")) {
          return { nominated: true, label: "potential_ban_candidate" };
        }
        if (name.includes("completePersistedTemporalPublisherAbuseScanInternal")) {
          return { clearedNominations: 0, scannedPublishers: 1 };
        }
        if (name.includes("cleanupTemporalPublisherAbuseScanCandidatesPageInternal")) {
          return { deleted: 1 };
        }
        if (name.includes("autoBanPublisherAbuseCandidatesPageInternal")) {
          return {
            ok: true,
            processed: 0,
            warned: 0,
            banned: 0,
            alreadyBanned: 0,
            skipped: 0,
            isDone: true,
          };
        }
        throw new Error(`unexpected mutation ${name}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
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
      highTemporalSkills: 1,
      flaggedPublishers: 1,
      nominations: 1,
    });

    const aggregateCall = ctx.runMutation.mock.calls.find(([target]) =>
      String(target).includes("persistTemporalPublisherAbuseAggregateInternal"),
    );
    expect(aggregateCall?.[1]).toEqual(
      expect.objectContaining({
        runId: "publisherAbuseScoreRuns:temporal",
        rank: 1,
        aggregate: expect.objectContaining({
          ownerKey: "publisher:publishers:pollyreach",
          highTemporalSkillCount: 1,
          evidence: [expect.objectContaining({ skillId: "skills:first", slug: "first" })],
        }),
      }),
    );
    expect(aggregateCall?.[1]).not.toHaveProperty("candidates");
    expect(
      ctx.runMutation.mock.calls.some(([target]) =>
        String(target).includes("persistTemporalPublisherAbuseCandidatesInternal"),
      ),
    ).toBe(false);
  });

  it("finalizes persisted current temporal scans beyond one stored candidate page", async () => {
    const candidates = Array.from({ length: 1001 }, (_, index) => {
      const candidate = temporalCandidate(`skills:overflow-${index}`, {
        slug: `overflow-${index}`,
        displayName: `Overflow ${index}`,
      });
      candidate.temporalScore.nearConversion = true;
      candidate.temporalScore.installDownloadExcessZScore7 = 60;
      return candidate;
    });
    const scheduler = { runAfter: vi.fn(async () => null) };
    let listPageCalls = 0;
    const ctx = {
      scheduler,
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "finalizing",
            temporalScanComplete: true,
            finalizedScores: 0,
          };
        }
        if (name.includes("listTemporalPublisherAbuseScanCandidatesPageInternal")) {
          listPageCalls += 1;
          return listPageCalls % 2 === 1
            ? { candidates: candidates.slice(0, 1000), isDone: false, cursor: "next" }
            : { candidates: candidates.slice(1000), isDone: true };
        }
        if (name.includes("getPublisherAbuseAutobanEnabledInternal")) {
          return true;
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol, args?: unknown) => {
        const name = String(target);
        if (name.includes("persistTemporalPublisherAbuseAggregateInternal")) {
          expect(args).toEqual(
            expect.objectContaining({
              aggregate: expect.objectContaining({
                highTemporalSkillCount: 1001,
                evidence: expect.arrayContaining([expect.objectContaining({ slug: "overflow-0" })]),
              }),
            }),
          );
          return { nominated: true, label: "potential_ban_candidate" };
        }
        if (name.includes("completePersistedTemporalPublisherAbuseScanInternal")) {
          return { clearedNominations: 0, scannedPublishers: 1001 };
        }
        if (name.includes("cleanupTemporalPublisherAbuseScanCandidatesPageInternal")) {
          return { deleted: 500 };
        }
        if (name.includes("autoBanPublisherAbuseCandidatesPageInternal")) {
          return {
            ok: true,
            processed: 0,
            warned: 0,
            banned: 0,
            alreadyBanned: 0,
            skipped: 0,
            isDone: true,
          };
        }
        throw new Error(`unexpected mutation ${name}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
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
      scannedSkills: 1001,
      highTemporalSkills: 1001,
      flaggedPublishers: 1,
      nominations: 1,
    });

    expect(listPageCalls).toBe(4);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("continues persisted current temporal finalization after one aggregate page", async () => {
    const firstCandidate = temporalCandidate("skills:first", {
      slug: "first",
      displayName: "First",
    });
    firstCandidate.temporalScore.nearConversion = true;
    firstCandidate.temporalScore.installDownloadExcessZScore7 = 60;
    const secondCandidate = {
      ...temporalCandidate("skills:second", {
        slug: "second",
        displayName: "Second",
      }),
      ownerKey: "publisher:publishers:second",
      ownerPublisherId: "publishers:second",
      ownerUserId: "users:second",
      handleSnapshot: "second",
    };
    secondCandidate.temporalScore.nearConversion = true;
    secondCandidate.temporalScore.installDownloadExcessZScore7 = 60;
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "finalizing",
            finalizedScores: 0,
          };
        }
        if (name.includes("listTemporalPublisherAbuseScanCandidatesPageInternal")) {
          return {
            candidates: [firstCandidate, secondCandidate],
            isDone: true,
          };
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol, _args?: unknown) => {
        const name = String(target);
        if (name.includes("persistTemporalPublisherAbuseAggregateInternal")) {
          return { nominated: true, label: "potential_ban_candidate" };
        }
        if (name.includes("completePersistedTemporalPublisherAbuseScanInternal")) {
          throw new Error("partial aggregate page should not complete the scan");
        }
        if (name.includes("cleanupTemporalPublisherAbuseScanCandidatesPageInternal")) {
          throw new Error("partial aggregate page should not clean up candidates");
        }
        if (name.includes("autoBanPublisherAbuseCandidatesPageInternal")) {
          throw new Error("partial aggregate page should not process autobans");
        }
        throw new Error(`unexpected mutation ${name}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
        mode: "current",
        dryRun: false,
        candidateLimit: 100,
        batchSize: 1,
        maxPages: 1,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      mode: "current",
      highTemporalSkills: 2,
      flaggedPublishers: 2,
      nominations: 1,
    });

    const aggregateCalls = ctx.runMutation.mock.calls.filter(([target]) =>
      String(target).includes("persistTemporalPublisherAbuseAggregateInternal"),
    );
    expect(aggregateCalls).toHaveLength(1);
    expect(scheduler.runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      runId: "publisherAbuseScoreRuns:temporal",
      mode: "current",
      dryRun: false,
      candidateLimit: 100,
      batchSize: 1,
      maxPages: 1,
      todayDay: 100,
      lookbackDays: undefined,
      trigger: "cron",
      actorUserId: undefined,
    });
  });

  it("marks persisted current temporal scans failed when finalization throws", async () => {
    const finalizationError = new Error("aggregate failed");
    const candidate = temporalCandidate("skills:first", { slug: "first", displayName: "First" });
    candidate.temporalScore.nearConversion = true;
    candidate.temporalScore.installDownloadExcessZScore7 = 60;
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "finalizing",
          };
        }
        if (name.includes("listTemporalPublisherAbuseScanCandidatesPageInternal")) {
          return {
            candidates: [candidate],
            isDone: true,
          };
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol, _args?: unknown) => {
        const name = String(target);
        if (name.includes("persistTemporalPublisherAbuseAggregateInternal")) {
          throw finalizationError;
        }
        if (name.includes("markPublisherAbuseScoreRunFailedInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "failed",
            phase: "finalizing",
          };
        }
        throw new Error(`unexpected mutation ${name}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
        mode: "current",
        dryRun: false,
        candidateLimit: 100,
        batchSize: 50,
        maxPages: 1,
        todayDay: 100,
      }),
    ).rejects.toThrow("aggregate failed");

    const failedCall = ctx.runMutation.mock.calls.find(([target]) =>
      String(target).includes("markPublisherAbuseScoreRunFailedInternal"),
    );
    expect(failedCall?.[1]).toEqual({
      runId: "publisherAbuseScoreRuns:temporal",
      errorMessage: "aggregate failed",
    });
    expect(
      ctx.runMutation.mock.calls.some(([target]) =>
        String(target).includes("completePersistedTemporalPublisherAbuseScanInternal"),
      ),
    ).toBe(false);
  });

  it("marks persisted current temporal scans failed when collection throws", async () => {
    const collectionError = new Error("collection failed");
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "running",
            phase: "collecting",
            scannedPublishers: 50,
          };
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol, _args?: unknown) => {
        const name = String(target);
        if (name.includes("collectTemporalPublisherAbuseSkillCandidatesForRunPageInternal")) {
          throw collectionError;
        }
        if (name.includes("markPublisherAbuseScoreRunFailedInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "failed",
            phase: "collecting",
          };
        }
        throw new Error(`unexpected mutation ${name}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
        mode: "current",
        dryRun: false,
        candidateLimit: 100,
        batchSize: 50,
        maxPages: 1,
        todayDay: 100,
      }),
    ).rejects.toThrow("collection failed");

    const failedCall = ctx.runMutation.mock.calls.find(([target]) =>
      String(target).includes("markPublisherAbuseScoreRunFailedInternal"),
    );
    expect(failedCall?.[1]).toEqual({
      runId: "publisherAbuseScoreRuns:temporal",
      errorMessage: "collection failed",
    });
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not finalize already completed persisted temporal scans again", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runQuery: vi.fn(async (target: symbol) => {
        const name = String(target);
        if (name.includes("getPublisherAbuseScoreRunStateInternal")) {
          return {
            runId: "publisherAbuseScoreRuns:temporal",
            status: "completed",
            phase: "completed",
          };
        }
        throw new Error(`unexpected query ${name}`);
      }),
      runMutation: vi.fn(async (target: symbol) => {
        throw new Error(`unexpected mutation ${String(target)}`);
      }),
    };

    await expect(
      temporalRunHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
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
      scannedSkills: 0,
      highTemporalSkills: 0,
      flaggedPublishers: 0,
      nominations: 0,
    });

    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
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
        get: vi.fn(async (id: string) => {
          if (id === "publishers:quiet") {
            return {
              _id: "publishers:quiet",
              kind: "user",
              handle: "quiet",
              linkedUserId: "users:quiet",
            };
          }
          if (id === "users:quiet") return { _id: "users:quiet", role: "user" };
          throw new Error(`unexpected get ${id}`);
        }),
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

    const result = await collectTemporalHandler(ctx, {
      mode: "backfill",
      batchSize: 100,
      lookbackDays: 730,
      todayDay: 1000,
    });

    expect(result).toMatchObject({
      cursor: undefined,
      isDone: true,
      scannedSkills: 1,
    });
    expect(result.candidates).toHaveLength(1);

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
          if (id === "users:joel") return { _id: "users:joel", role: "user" };
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
          if (table === "skillDailyStats") throw new Error("official publisher was scanned");
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

  it("skips staff-owned org publishers during temporal candidate collection", async () => {
    const indexBuilder = {
      eq: vi.fn(() => indexBuilder),
      gte: vi.fn(() => indexBuilder),
      lte: vi.fn(() => indexBuilder),
    };
    const staffOrgPublisher = {
      _id: "publishers:staff-labs",
      kind: "org",
      handle: "staff-labs",
      linkedUserId: undefined,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === staffOrgPublisher._id) return staffOrgPublisher;
          if (id === "users:staff-owner") {
            return { _id: "users:staff-owner", role: "moderator" };
          }
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
                          _id: "skills:staff-org-spike",
                          ownerPublisherId: staffOrgPublisher._id,
                          slug: "staff-org-spike",
                          displayName: "Staff Org Spike",
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
          if (table === "publisherMembers") {
            return {
              withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                expect(indexName).toBe("by_publisher_and_role");
                callback(indexBuilder);
                return {
                  take: async (numItems: number) => {
                    expect(numItems).toBe(101);
                    return [
                      {
                        _id: "publisherMembers:staff-owner",
                        publisherId: staffOrgPublisher._id,
                        userId: "users:staff-owner",
                        role: "owner",
                      },
                    ];
                  },
                };
              },
            };
          }
          if (table === "skillDailyStats") throw new Error("staff org publisher was scanned");
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
      "publisherAbuseScoreRuns",
      expect.objectContaining({
        temporalMode: "current",
        temporalScanComplete: false,
      }),
    );
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

  it("reopens deferred temporal candidates when a current run still flags them", async () => {
    const deferredNomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:deferred",
        ownerKey: "publisher:publishers:pollyreach",
        ownerPublisherId: "publishers:pollyreach",
        ownerUserId: "users:joel",
        latestScoreId: "publisherAbuseScores:backfill",
        label: "potential_ban_candidate",
        status: "candidate_for_future_action",
        openedByRunId: "publisherAbuseScoreRuns:backfill",
      }),
      modelVersion: "publisher-abuse-temporal.v1",
    };
    const insert = vi.fn(async (table: string) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:current";
      if (table === "publisherAbuseScores") return "publisherAbuseScores:current";
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:current";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:current") {
            return {
              _id: "publisherAbuseScoreRuns:current",
              modelVersion: "publisher-abuse-temporal.v1",
              temporalMode: "current",
              temporalScanComplete: true,
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
              withIndex: (indexName: string) => {
                if (indexName === "by_owner_key_and_model_version") {
                  return {
                    first: async () => deferredNomination,
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
      runId: "publisherAbuseScoreRuns:current",
      flaggedPublishers: 1,
      nominations: 1,
    });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:deferred",
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:current",
        label: "potential_ban_candidate",
        status: "pending",
        reviewedByUserId: undefined,
        reviewedAt: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:deferred",
        previousStatus: "candidate_for_future_action",
        nextStatus: "pending",
      }),
    );
  });

  it("clears autoban warning state when a temporal candidate owner changes", async () => {
    const warnedNomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:warned",
        ownerKey: "publisher:publishers:pollyreach",
        ownerPublisherId: "publishers:pollyreach",
        ownerUserId: "users:previous-owner",
        latestScoreId: "publisherAbuseScores:old",
        label: "potential_ban_candidate",
        status: "pending",
        openedByRunId: "publisherAbuseScoreRuns:old",
      }),
      modelVersion: "publisher-abuse-temporal.v1",
      warningSentAt: 100,
      warningExpiresAt: 200,
      warningScoreId: "publisherAbuseScores:old",
      warningRunId: "publisherAbuseScoreRuns:old",
      warningPendingAt: 90,
      warningPendingScoreId: "publisherAbuseScores:old",
      warningPendingRunId: "publisherAbuseScoreRuns:old",
    };
    const insert = vi.fn(async (table: string) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:current";
      if (table === "publisherAbuseScores") return "publisherAbuseScores:current";
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:current";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:current") {
            return {
              _id: "publisherAbuseScoreRuns:current",
              modelVersion: "publisher-abuse-temporal.v1",
              temporalMode: "current",
              temporalScanComplete: true,
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
              withIndex: (indexName: string) => {
                if (indexName === "by_owner_key_and_model_version") {
                  return {
                    first: async () => warnedNomination,
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
      runId: "publisherAbuseScoreRuns:current",
      flaggedPublishers: 1,
      nominations: 1,
    });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:warned",
      expect.objectContaining({
        ownerUserId: "users:joel",
        warningSentAt: undefined,
        warningExpiresAt: undefined,
        warningScoreId: undefined,
        warningRunId: undefined,
        warningPendingAt: undefined,
        warningPendingScoreId: undefined,
        warningPendingRunId: undefined,
      }),
    );
  });

  it("does not reopen staff-resolved temporal candidates without escalation", async () => {
    const resolvedNomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:resolved",
        ownerKey: "publisher:publishers:pollyreach",
        ownerPublisherId: "publishers:pollyreach",
        ownerUserId: "users:joel",
        latestScoreId: "publisherAbuseScores:old",
        label: "potential_ban_candidate",
        status: "false_positive",
        openedByRunId: "publisherAbuseScoreRuns:old",
        reviewedAt: 10,
      }),
      modelVersion: "publisher-abuse-temporal.v1",
      reviewedByUserId: "users:moderator",
    };
    const insert = vi.fn(async (table: string) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:current";
      if (table === "publisherAbuseScores") return "publisherAbuseScores:current";
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:current";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async (_id: string, _value: Record<string, unknown>) => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScoreRuns:current") {
            return {
              _id: "publisherAbuseScoreRuns:current",
              modelVersion: "publisher-abuse-temporal.v1",
              temporalMode: "current",
              temporalScanComplete: false,
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
              withIndex: (indexName: string) => {
                if (indexName === "by_owner_key_and_model_version") {
                  return {
                    first: async () => resolvedNomination,
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
        scanComplete: false,
        benchmark: temporalBenchmark(),
        candidates: [
          temporalCandidate("skills:first", { slug: "first", displayName: "First" }),
          temporalCandidate("skills:second", { slug: "second", displayName: "Second" }),
        ],
      }),
    ).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:current",
      flaggedPublishers: 1,
      nominations: 1,
    });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:resolved",
      expect.any(Object),
    );
    const resolvedPatch = patch.mock.calls.find(
      (call) => call[0] === "publisherAbuseReviewNominations:resolved",
    )?.[1];
    expect(resolvedPatch).not.toHaveProperty("status");
    expect(resolvedPatch).not.toHaveProperty("reviewedByUserId");
    expect(resolvedPatch).not.toHaveProperty("reviewedAt");
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:resolved",
        previousStatus: undefined,
        nextStatus: undefined,
      }),
    );
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

  it("clears stale temporal nominations from persisted scans when stored candidates are not flagged", async () => {
    const insert = vi.fn(async (table: string) => {
      if (table === "publisherAbuseScores") return "publisherAbuseScores:pass";
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:pass";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async () => null);
    const staleNomination = {
      _id: "publisherAbuseReviewNominations:stale-persisted",
      ownerKey: "publisher:publishers:stale-persisted",
      ownerPublisherId: "publishers:stale-persisted",
      ownerUserId: "users:stale-persisted",
      handleSnapshot: "stale-persisted-pub",
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
              phase: "finalizing",
              scannedPublishers: 20,
              scoredPublishers: 0,
              finalizedScores: 0,
              nominatedPublishers: 0,
              passCount: 0,
              reviewCount: 0,
              potentialBanCandidateCount: 0,
              sumLogPressure: 0,
              sumSquaredLogPressure: 0,
              temporalMode: "current",
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
                expect(indexName).toBe("by_run_and_owner_key");
                expect(constraints).toEqual({
                  runId: "publisherAbuseScoreRuns:temporal",
                  ownerKey: staleNomination.ownerKey,
                });
                return { take: async () => [] };
              },
            };
          }
          if (table === "publisherAbuseTemporalScanCandidates") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseTemporalScanCandidates:raw",
                  runId: "publisherAbuseScoreRuns:temporal",
                  ownerKey: staleNomination.ownerKey,
                }),
              }),
            };
          }
          throw new Error(`unexpected query ${table}`);
        }),
      },
    };

    await expect(
      completePersistedTemporalHandler(ctx, {
        runId: "publisherAbuseScoreRuns:temporal",
        benchmark: temporalBenchmark(),
        scanComplete: true,
        flaggedPublishers: 0,
        nominatedPublishers: 0,
        highTemporalSkills: 0,
        reviewCount: 0,
        potentialBanCandidateCount: 0,
      }),
    ).resolves.toEqual({
      clearedNominations: 1,
      scannedPublishers: 20,
      flaggedPublishers: 0,
      nominatedPublishers: 0,
      reviewCount: 0,
      potentialBanCandidateCount: 0,
    });

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerKey: staleNomination.ownerKey,
        label: "pass",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      staleNomination._id,
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:pass",
        label: "pass",
      }),
    );
  });

  it("downgrades pending temporal nominations created by a failed persisted run", async () => {
    const failedScore = {
      ...makeScore({
        _id: "publisherAbuseScores:failed",
        runId: "publisherAbuseScoreRuns:temporal",
        ownerKey: "publisher:publishers:failed",
      }),
      modelVersion: "publisher-abuse-temporal.v1",
    };
    const failedNomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:failed",
        ownerKey: failedScore.ownerKey,
        latestScoreId: failedScore._id,
        label: "potential_ban_candidate",
      }),
      modelVersion: "publisher-abuse-temporal.v1",
      warningSentAt: 10,
      warningExpiresAt: 20,
      warningScoreId: failedScore._id,
      warningRunId: "publisherAbuseScoreRuns:temporal",
    };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async () => "publisherAbuseReviewEvents:event");
    const deleteCandidate = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "publisherAbuseScoreRuns:temporal") {
          return {
            _id: "publisherAbuseScoreRuns:temporal",
            modelVersion: "publisher-abuse-temporal.v1",
            status: "running",
            phase: "finalizing",
          };
        }
        throw new Error(`unexpected get ${id}`);
      }),
      patch,
      insert,
      delete: deleteCandidate,
      query: vi.fn((table: string) => {
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
              expect(indexName).toBe("by_run_and_label_and_rank");
              expect(constraints.runId).toBe("publisherAbuseScoreRuns:temporal");
              return {
                paginate: async () => ({
                  page: constraints.label === "potential_ban_candidate" ? [failedScore] : [],
                  isDone: true,
                  continueCursor: "",
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
              expect(indexName).toBe("by_owner_key_and_model_version");
              expect(constraints).toEqual({
                ownerKey: failedScore.ownerKey,
                modelVersion: "publisher-abuse-temporal.v1",
              });
              return { first: async () => failedNomination };
            },
          };
        }
        if (table === "publisherAbuseTemporalScanCandidates") {
          return {
            withIndex: (indexName: string) => {
              expect(indexName).toBe("by_run");
              return {
                take: async () => [
                  {
                    _id: "publisherAbuseTemporalScanCandidates:failed",
                    runId: "publisherAbuseScoreRuns:temporal",
                  },
                ],
              };
            },
          };
        }
        throw new Error(`unexpected query ${table}`);
      }),
    };

    await expect(
      markScoreRunFailedHandler(
        { db, scheduler },
        {
          runId: "publisherAbuseScoreRuns:temporal",
          errorMessage: "complete failed",
        },
      ),
    ).resolves.toEqual({
      runId: "publisherAbuseScoreRuns:temporal",
      status: "failed",
      phase: "finalizing",
    });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:temporal",
      expect.objectContaining({
        status: "failed",
        errorMessage: "complete failed",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      failedNomination._id,
      expect.objectContaining({
        status: "candidate_for_future_action",
        warningSentAt: undefined,
        warningExpiresAt: undefined,
        warningScoreId: undefined,
        warningRunId: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: failedNomination._id,
        eventType: "triage_status_changed",
        previousStatus: "pending",
        nextStatus: "candidate_for_future_action",
      }),
    );
    expect(deleteCandidate).toHaveBeenCalledWith("publisherAbuseTemporalScanCandidates:failed");
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      runId: "publisherAbuseScoreRuns:temporal",
      errorMessage: "complete failed",
      cleanupLabel: "review",
    });
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
