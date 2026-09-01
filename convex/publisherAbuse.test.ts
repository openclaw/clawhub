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
      finalizePublisherAbuseScoresPageInternal: Symbol("finalizePublisherAbuseScoresPageInternal"),
      getOrStartPublisherAbuseScoreRunInternal: Symbol("getOrStartPublisherAbuseScoreRunInternal"),
      getPublisherAbuseScoreRunStateInternal: Symbol("getPublisherAbuseScoreRunStateInternal"),
      markPublisherAbuseScoreRunFailedInternal: Symbol("markPublisherAbuseScoreRunFailedInternal"),
      clearPublisherAbusePendingWarningInternal: Symbol(
        "clearPublisherAbusePendingWarningInternal",
      ),
      claimPublisherAbusePendingWarningInternal: Symbol(
        "claimPublisherAbusePendingWarningInternal",
      ),
      getPublisherAbuseAutobanEnabledInternal: Symbol("getPublisherAbuseAutobanEnabledInternal"),
      processPublisherAbuseAutobansInternal: Symbol("processPublisherAbuseAutobansInternal"),
      recordPublisherAbuseScoreRunTransientErrorInternal: Symbol(
        "recordPublisherAbuseScoreRunTransientErrorInternal",
      ),
      recordPublisherAbuseWarningSentInternal: Symbol("recordPublisherAbuseWarningSentInternal"),
      runPublisherAbuseScoreRunInternal: Symbol("runPublisherAbuseScoreRunInternal"),
      runTemporalPublisherAbuseScanInternal: Symbol("runTemporalPublisherAbuseScanInternal"),
    },
    users: {
      autobanPublisherAbuseOwnerInternal: Symbol("autobanPublisherAbuseOwnerInternal"),
      banUserInternal: Symbol("banUserInternal"),
    },
    emailsNode: {
      sendPublisherAbuseTrafficExplanationInternal: Symbol(
        "sendPublisherAbuseTrafficExplanationInternal",
      ),
      sendPublisherAbuseWarningInternal: Symbol("sendPublisherAbuseWarningInternal"),
    },
  },
}));

const publisherAbuse = await import("./publisherAbuse");
const { assertAdmin, assertModerator, requireUser, requireUserFromAction } =
  await import("./lib/access");

const TEST_MODEL_CONFIG = {
  modelVersion: "publisher-abuse-pressure.v4",
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
      retryAttempt?: number;
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
      candidateLimit?: number;
      batchSize?: number;
      maxPages?: number;
      todayDay?: number;
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
      cursor?: string;
      batchSize?: number;
      todayDay?: number;
    },
    {
      cursor?: string;
      isDone: boolean;
      scannedSkills: number;
      candidates: unknown[];
    }
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
      signalCount: number;
      signalCountHasMore: boolean;
    }
  >
)._handler;

const listReviewItemsPageHandler = (
  publisherAbuse.listReviewItemsPage as unknown as Wrapped<
    {
      tab: "potential_ban_candidate" | "review" | "all_pending" | "resolved";
      paginationOpts: { numItems: number; cursor: string | null };
    },
    {
      page: unknown[];
      isDone: boolean;
      continueCursor: string;
    }
  >
)._handler;

const listSignalsPageHandler = (
  publisherAbuse.listSignalsPage as unknown as Wrapped<
    {
      signalType?:
        | "high_install_download_ratio"
        | "sustained_downloads_flat_installs"
        | "download_spike_flat_installs"
        | "sustained_abnormal_download_days"
        | "owner_synchronized_download_trends";
      reviewStatus?: "open" | "snoozed" | "dismissed";
      paginationOpts: {
        numItems: number;
        cursor: string | null;
        endCursor?: string | null;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        id?: number;
      };
    },
    {
      page: unknown[];
      isDone: boolean;
      continueCursor: string;
      splitCursor?: string;
      pageStatus?: string;
    }
  >
)._handler;

const getSignalActivityTrendHandler = (
  publisherAbuse.getSignalActivityTrend as unknown as Wrapped<
    { signalId: string; endDay: number },
    {
      downloads: { total: number; points: Array<{ day: number; value: number }> };
      installs: { total: number; points: Array<{ day: number; value: number }> };
    } | null
  >
)._handler;

const archiveTemporalPublisherAbuseSignalsHandler =
  publisherAbuse.archiveTemporalPublisherAbuseSignals;

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

const markPublisherAbuseNominationReviewedHandler = (
  publisherAbuse.markPublisherAbuseNominationReviewed as unknown as Wrapped<
    {
      nominationId: string;
      expectedLatestScoreId: string;
      expectedUpdatedAt: number;
      note?: string;
    },
    { ok: true; status: "reviewed_no_action" }
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

const recordPublisherAbuseWarningSentHandler = (
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

const claimPublisherAbusePendingWarningHandler = (
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
    modelVersion: string;
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
    modelVersion: fields.modelVersion ?? TEST_MODEL_CONFIG.modelVersion,
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
    modelVersion: string;
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
    modelVersion: fields.modelVersion ?? TEST_MODEL_CONFIG.modelVersion,
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

function makePublisherAbuseSignalCountQuery(signals: unknown[]) {
  return {
    withIndex: (indexName: string) => {
      expect(indexName).toBe("by_last_seen_at");
      return {
        order: (direction: "asc" | "desc") => {
          expect(direction).toBe("desc");
          return {
            take: async (limit: number) => signals.slice(0, limit),
          };
        },
      };
    },
  };
}

function makePublisherAbuseNominationCountQuery(nominations: unknown[] = []) {
  return {
    withIndex: (
      indexName: string,
      build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      expect(["by_status_and_label_and_last_scored_at", "by_status_and_reviewed_at"]).toContain(
        indexName,
      );
      const constraints: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return q;
        },
      };
      build(q);
      expect(constraints.status).toBeDefined();
      return {
        order: (direction: "asc" | "desc") => {
          expect(direction).toBe("desc");
          return {
            take: async (limit: number) =>
              nominations
                .filter((nomination) => {
                  if (!nomination || typeof nomination !== "object") return false;
                  const fields = nomination as Record<string, unknown>;
                  return Object.entries(constraints).every(
                    ([field, value]) => fields[field] === value,
                  );
                })
                .slice(0, limit),
          };
        },
      };
    },
  };
}

function makeEmptyPublisherAbuseScoreRunsQuery() {
  return {
    withIndex: (
      indexName: string,
      build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      expect([
        "by_model_version_and_started_at",
        "by_temporal_pipeline_kind_and_started_at",
        "by_model_version_and_temporal_pipeline_kind_and_phase_started_at",
      ]).toContain(indexName);
      const constraints: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return q;
        },
      };
      build(q);
      if (indexName === "by_model_version_and_started_at") {
        expect(constraints.modelVersion).toBeTypeOf("string");
      } else if (indexName === "by_model_version_and_temporal_pipeline_kind_and_phase_started_at") {
        expect(constraints.modelVersion).toBeTypeOf("string");
        expect(constraints.temporalPipelineKind).toBeUndefined();
        expect(constraints.temporalPipelinePhase).toBeTypeOf("string");
      } else {
        expect(constraints).toEqual({ temporalPipelineKind: "signals" });
      }
      return {
        order: (direction: "asc" | "desc") => {
          expect(direction).toBe("desc");
          return {
            first: async () => null,
          };
        },
      };
    },
  };
}

function hasNoUndefinedValues(value: unknown): boolean {
  if (value === undefined) return false;
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(hasNoUndefinedValues);
  return Object.values(value).every(hasNoUndefinedValues);
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

function makePublisherAbuseAutobanSettingQuery(setting: unknown) {
  const settings = Array.isArray(setting) ? setting : setting ? [setting] : [];
  return {
    withIndex: (
      indexName: string,
      build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      expect(indexName).toBe("by_key_and_updated_at");
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
        order: (direction: "asc" | "desc") => {
          expect(direction).toBe("desc");
          return {
            take: async (limit: number) =>
              [...settings]
                .sort(
                  (left, right) =>
                    ((right as { updatedAt?: number }).updatedAt ?? 0) -
                    ((left as { updatedAt?: number }).updatedAt ?? 0),
                )
                .slice(0, limit),
          };
        },
      };
    },
  };
}

describe("publisher abuse dry-run persistence", () => {
  it("keeps read-only dashboard entrypoints empty for non-staff while guarding writes", async () => {
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

      await expect(
        listDashboardHandler({ db: { get: dbGet, query: dbQuery } }, {}),
      ).resolves.toEqual({
        latestRun: null,
        latestSignalRun: null,
        pendingItems: [],
        pendingPotentialBanCandidateItems: [],
        pendingReviewItems: [],
        recentResolvedItems: [],
        pendingPotentialBanCandidateCount: 0,
        pendingReviewCount: 0,
        pendingCount: 0,
        recentResolvedCount: 0,
        pendingPotentialBanCandidateCountHasMore: false,
        pendingReviewCountHasMore: false,
        pendingCountHasMore: false,
        recentResolvedCountHasMore: false,
        signalCount: 0,
        signalCountHasMore: false,
      });
      await expect(
        getPublisherAbuseAutobanSettingHandler({ db: { query: dbQuery } }, {}),
      ).resolves.toEqual({
        enabled: false,
        updatedAt: null,
        updatedByUserId: null,
      });
      await expect(
        getReviewNominationDetailHandler(
          { db: { get: dbGet, query: dbQuery } },
          { nominationId: "publisherAbuseReviewNominations:nomination" },
        ),
      ).resolves.toBeNull();
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

  it("does not crash read-only publisher abuse dashboard queries while auth is missing", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized"));
    const db = {
      get: vi.fn(),
      query: vi.fn(),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual({
      latestRun: null,
      latestSignalRun: null,
      pendingItems: [],
      pendingPotentialBanCandidateItems: [],
      pendingReviewItems: [],
      recentResolvedItems: [],
      pendingPotentialBanCandidateCount: 0,
      pendingReviewCount: 0,
      pendingCount: 0,
      recentResolvedCount: 0,
      pendingPotentialBanCandidateCountHasMore: false,
      pendingReviewCountHasMore: false,
      pendingCountHasMore: false,
      recentResolvedCountHasMore: false,
      signalCount: 0,
      signalCountHasMore: false,
    });
    await expect(getPublisherAbuseAutobanSettingHandler({ db }, {})).resolves.toEqual({
      enabled: false,
      updatedAt: null,
      updatedByUserId: null,
    });
    await expect(
      getReviewNominationDetailHandler(
        { db },
        { nominationId: "publisherAbuseReviewNominations:nomination" },
      ),
    ).resolves.toBeNull();
    await expect(
      listSignalsPageHandler(
        { db },
        {
          signalType: "high_install_download_ratio",
          paginationOpts: { numItems: 10, cursor: null },
        },
      ),
    ).resolves.toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });

    expect(assertModerator).not.toHaveBeenCalled();
    expect(db.get).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns bounded 30-day download and install trends for a signal", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const rows = [
      { day: 98, downloads: 120, installs: 9 },
      { day: 100, downloads: 180, installs: 12 },
    ];
    const take = vi.fn(async () => rows);
    const indexBuilder = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };
    const db = {
      get: vi.fn(async (id: string) =>
        id === "publisherAbuseSignals:ratio" ? { _id: id, skillId: "skills:ratio" } : null,
      ),
      query: vi.fn((table: string) => {
        expect(table).toBe("skillDailyStats");
        return {
          withIndex: (indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
            expect(indexName).toBe("by_skill_day");
            callback(indexBuilder);
            return { take };
          },
        };
      }),
    };

    const result = await getSignalActivityTrendHandler(
      { db },
      { signalId: "publisherAbuseSignals:ratio", endDay: 100 },
    );

    expect(result?.downloads.total).toBe(300);
    expect(result?.installs.total).toBe(21);
    expect(result?.downloads.points).toHaveLength(30);
    expect(result?.installs.points).toHaveLength(30);
    expect(result?.downloads.points.at(-1)).toEqual({ day: 100, value: 180 });
    expect(result?.installs.points.at(-1)).toEqual({ day: 100, value: 12 });
    expect(take).toHaveBeenCalledWith(30);
    expect(indexBuilder.eq).toHaveBeenCalledWith("skillId", "skills:ratio");
    expect(indexBuilder.gte).toHaveBeenCalledWith("day", 71);
    expect(indexBuilder.lte).toHaveBeenCalledWith("day", 100);
  });

  it("returns a bounded publisher abuse signal count on the dashboard", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const signals = Array.from({ length: 26 }, (_, index) => ({
      _id: `publisherAbuseSignals:${index}`,
    }));
    const db = {
      get: vi.fn(async () => null),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") return makeEmptyPublisherAbuseScoreRunsQuery();
        if (table === "publisherAbuseReviewNominations") {
          return makePublisherAbuseNominationCountQuery();
        }
        if (table === "publisherAbuseSignals") return makePublisherAbuseSignalCountQuery(signals);
        if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual({
      latestRun: null,
      latestSignalRun: null,
      pendingItems: [],
      pendingPotentialBanCandidateItems: [],
      pendingReviewItems: [],
      recentResolvedItems: [],
      pendingPotentialBanCandidateCount: 0,
      pendingReviewCount: 0,
      pendingCount: 0,
      recentResolvedCount: 0,
      pendingPotentialBanCandidateCountHasMore: false,
      pendingReviewCountHasMore: false,
      pendingCountHasMore: false,
      recentResolvedCountHasMore: false,
      signalCount: 25,
      signalCountHasMore: true,
    });

    expect(db.query).toHaveBeenCalledWith("publisherAbuseSignals");
  });

  it("returns pending publisher abuse nomination counts on the dashboard", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nominations = [
      makeNomination({
        _id: "publisherAbuseReviewNominations:ban",
        latestScoreId: "publisherAbuseScores:ban",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      makeNomination({
        _id: "publisherAbuseReviewNominations:review",
        latestScoreId: "publisherAbuseScores:review",
        label: "review",
        status: "pending",
      }),
    ];
    const db = {
      get: vi.fn(async (id: string) => {
        if (id.startsWith("publisherAbuseScores:")) {
          throw new Error("dashboard count should not hydrate score rows");
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") return makeEmptyPublisherAbuseScoreRunsQuery();
        if (table === "publisherAbuseReviewNominations") {
          return makePublisherAbuseNominationCountQuery(nominations);
        }
        if (table === "publisherAbuseSignals") return makePublisherAbuseSignalCountQuery([]);
        if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual(
      expect.objectContaining({
        pendingPotentialBanCandidateCount: 1,
        pendingReviewCount: 1,
        pendingCount: 2,
        recentResolvedCount: 0,
      }),
    );
    expect(db.get).not.toHaveBeenCalled();
  });

  it("keeps resumable legacy and synchronizing signal scans visible", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const legacySignalRun = {
      _id: "publisherAbuseScoreRuns:legacy-signal",
      modelVersion: "publisher-abuse-temporal.v1",
      status: "running",
      phase: "collecting",
      trigger: "cron",
      startedAt: 200,
      updatedAt: 200,
      temporalPipelinePhase: "collecting",
    };
    const newerDiagnosticRun = {
      ...legacySignalRun,
      _id: "publisherAbuseScoreRuns:newer-diagnostic",
      startedAt: 300,
      updatedAt: 300,
      temporalPipelinePhase: undefined,
    };
    const synchronizingRun = {
      ...legacySignalRun,
      _id: "publisherAbuseScoreRuns:synchronizing",
      modelVersion: "publisher-abuse-temporal.v2",
      startedAt: 400,
      updatedAt: 400,
      temporalPipelinePhase: "synchronizing",
    };
    let currentModelRun: typeof synchronizingRun | null = null;
    const db = {
      get: vi.fn(async () => null),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") {
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
              return {
                order: () => ({
                  first: async () => {
                    if (indexName === "by_temporal_pipeline_kind_and_started_at") return null;
                    if (
                      indexName ===
                      "by_model_version_and_temporal_pipeline_kind_and_phase_started_at"
                    ) {
                      return constraints.modelVersion === "publisher-abuse-temporal.v1" &&
                        constraints.temporalPipelineKind === undefined &&
                        constraints.temporalPipelinePhase === "collecting"
                        ? legacySignalRun
                        : null;
                    }
                    if (constraints.modelVersion === "publisher-abuse-temporal.v2") {
                      return currentModelRun;
                    }
                    return constraints.modelVersion === "publisher-abuse-temporal.v1"
                      ? newerDiagnosticRun
                      : null;
                  },
                }),
              };
            },
          };
        }
        if (table === "publisherAbuseReviewNominations") {
          return makePublisherAbuseNominationCountQuery([]);
        }
        if (table === "publisherAbuseSignals") return makePublisherAbuseSignalCountQuery([]);
        if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual(
      expect.objectContaining({
        latestRun: expect.objectContaining({ _id: legacySignalRun._id }),
        latestSignalRun: expect.objectContaining({ _id: legacySignalRun._id }),
      }),
    );

    currentModelRun = synchronizingRun;
    await expect(listDashboardHandler({ db }, {})).resolves.toEqual(
      expect.objectContaining({
        latestSignalRun: expect.objectContaining({ _id: synchronizingRun._id }),
      }),
    );
  });

  it("counts only visible publisher abuse nominations on the dashboard", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const visiblePotentialBans = Array.from({ length: 26 }, (_, index) =>
      makeNomination({
        _id: `publisherAbuseReviewNominations:visible-ban-${index}`,
        latestScoreId: `publisherAbuseScores:visible-ban-${index}`,
        label: "potential_ban_candidate",
        status: "pending",
      }),
    );
    const nominations = [
      ...visiblePotentialBans,
      makeNomination({
        _id: "publisherAbuseReviewNominations:inactive-pending",
        latestScoreId: "publisherAbuseScores:inactive-pending",
        ownerUserId: "users:inactive",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      makeNomination({
        _id: "publisherAbuseReviewNominations:official-pending",
        latestScoreId: "publisherAbuseScores:official-pending",
        ownerPublisherId: "publishers:official",
        label: "review",
        status: "pending",
      }),
      makeNomination({
        _id: "publisherAbuseReviewNominations:visible-review",
        latestScoreId: "publisherAbuseScores:visible-review",
        label: "review",
        status: "pending",
      }),
      makeNomination({
        _id: "publisherAbuseReviewNominations:inactive-resolved",
        latestScoreId: "publisherAbuseScores:inactive-resolved",
        ownerUserId: "users:inactive",
        label: "potential_ban_candidate",
        status: "reviewed_no_action",
      }),
      makeNomination({
        _id: "publisherAbuseReviewNominations:official-resolved",
        latestScoreId: "publisherAbuseScores:official-resolved",
        ownerPublisherId: "publishers:official",
        label: "potential_ban_candidate",
        status: "reviewed_no_action",
      }),
    ];
    const db = {
      get: vi.fn(async (id: string) => {
        if (id.startsWith("publisherAbuseScores:")) {
          throw new Error("dashboard count should not hydrate score rows");
        }
        if (id === "users:inactive") {
          return { _id: "users:inactive", role: "user", deactivatedAt: 100 };
        }
        if (id === "publishers:official") {
          return {
            _id: "publishers:official",
            kind: "user",
            handle: "official",
            linkedUserId: "users:official-owner",
          };
        }
        if (id === "users:official-owner") {
          return { _id: "users:official-owner", role: "user" };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") return makeEmptyPublisherAbuseScoreRunsQuery();
        if (table === "publisherAbuseReviewNominations") {
          return makePublisherAbuseNominationCountQuery(nominations);
        }
        if (table === "publisherAbuseSignals") return makePublisherAbuseSignalCountQuery([]);
        if (table === "officialPublishers") {
          return {
            withIndex: (indexName: string) => {
              expect(indexName).toBe("by_publisher");
              return {
                unique: async () => ({ publisherId: "publishers:official" }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual(
      expect.objectContaining({
        pendingPotentialBanCandidateCount: 25,
        pendingReviewCount: 1,
        pendingCount: 26,
        recentResolvedCount: 1,
        pendingPotentialBanCandidateCountHasMore: true,
        pendingReviewCountHasMore: false,
        pendingCountHasMore: true,
        recentResolvedCountHasMore: false,
      }),
    );
  });

  it("does not mark the signal count as approximate at the exact scan limit", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const signals = Array.from({ length: 100 }, (_, index) => ({
      _id: `publisherAbuseSignals:${index}`,
      ownerPublisherId: index === 0 ? undefined : `publishers:staff-${index}`,
    }));
    const db = {
      get: vi.fn(async (id: string) => {
        if (id.startsWith("publishers:staff-")) {
          const index = id.replace("publishers:staff-", "");
          return {
            _id: id,
            kind: "user",
            handle: `staff-${index}`,
            linkedUserId: `users:staff-${index}`,
          };
        }
        if (id.startsWith("users:staff-")) return { _id: id, role: "admin" };
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") return makeEmptyPublisherAbuseScoreRunsQuery();
        if (table === "publisherAbuseReviewNominations") {
          return makePublisherAbuseNominationCountQuery();
        }
        if (table === "publisherAbuseSignals") return makePublisherAbuseSignalCountQuery(signals);
        if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual({
      latestRun: null,
      latestSignalRun: null,
      pendingItems: [],
      pendingPotentialBanCandidateItems: [],
      pendingReviewItems: [],
      recentResolvedItems: [],
      pendingPotentialBanCandidateCount: 0,
      pendingReviewCount: 0,
      pendingCount: 0,
      recentResolvedCount: 0,
      pendingPotentialBanCandidateCountHasMore: false,
      pendingReviewCountHasMore: false,
      pendingCountHasMore: false,
      recentResolvedCountHasMore: false,
      signalCount: 1,
      signalCountHasMore: false,
    });

    expect(db.query).toHaveBeenCalledWith("publisherAbuseSignals");
  });

  it("excludes official publishers from the publisher abuse signal count", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const signals = [
      {
        _id: "publisherAbuseSignals:official",
        ownerPublisherId: "publishers:official",
      },
      {
        _id: "publisherAbuseSignals:visible",
        ownerPublisherId: "publishers:visible",
      },
    ];
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "publishers:official") {
          return {
            _id: "publishers:official",
            kind: "user",
            handle: "official",
            linkedUserId: "users:official",
          };
        }
        if (id === "publishers:visible") {
          return {
            _id: "publishers:visible",
            kind: "user",
            handle: "visible",
            linkedUserId: "users:visible",
          };
        }
        if (id === "users:visible" || id === "users:official") return { _id: id, role: "user" };
        throw new Error(`unexpected get ${id}`);
      }),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") return makeEmptyPublisherAbuseScoreRunsQuery();
        if (table === "publisherAbuseReviewNominations") {
          return makePublisherAbuseNominationCountQuery();
        }
        if (table === "publisherAbuseSignals") return makePublisherAbuseSignalCountQuery(signals);
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
                  constraints.publisherId === "publishers:official"
                    ? { _id: "officialPublishers:official" }
                    : null,
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(listDashboardHandler({ db }, {})).resolves.toEqual({
      latestRun: null,
      latestSignalRun: null,
      pendingItems: [],
      pendingPotentialBanCandidateItems: [],
      pendingReviewItems: [],
      recentResolvedItems: [],
      pendingPotentialBanCandidateCount: 0,
      pendingReviewCount: 0,
      pendingCount: 0,
      recentResolvedCount: 0,
      pendingPotentialBanCandidateCountHasMore: false,
      pendingReviewCountHasMore: false,
      pendingCountHasMore: false,
      recentResolvedCountHasMore: false,
      signalCount: 1,
      signalCountHasMore: false,
    });
  });

  it("defaults publisher abuse autobans to disabled when no setting exists", async () => {
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
      enabled: false,
      updatedAt: null,
      updatedByUserId: null,
    });

    expect(ctx.db.query).toHaveBeenCalledWith("systemSettings");
  });

  it("lets admins enable publisher abuse autobans with an audit log", async () => {
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

    await expect(setPublisherAbuseAutobanEnabledHandler(ctx, { enabled: true })).resolves.toEqual({
      enabled: true,
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
          enabled: true,
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
            previousEnabled: false,
            nextEnabled: true,
          },
          createdAt: expect.any(Number),
        },
      },
    ]);
  });

  it("lets admins disable publisher abuse autobans with an audit log", async () => {
    const user = { _id: "users:admin", role: "admin" };
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user,
    } as never);
    const existingSetting = {
      _id: "systemSettings:autoban",
      key: "publisherAbuseAutobanEnabled",
      enabled: true,
      updatedAt: 1,
      updatedByUserId: "users:admin",
    };
    const inserted: Array<{ table: string; value: unknown }> = [];
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery(existingSetting);
          }
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
    expect(ctx.db.patch).toHaveBeenCalledWith("systemSettings:autoban", {
      enabled: false,
      updatedAt: expect.any(Number),
      updatedByUserId: "users:admin",
    });
    expect(inserted).toEqual([
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
    const patch = vi.fn(async (_id: string, _value: Record<string, unknown>) => null);
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

  it.each([
    {
      name: "official publisher nominations",
      publisher: {
        _id: "publishers:openclaw",
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        linkedUserId: "users:owner",
      },
      official: true,
    },
    {
      name: "staff-linked publisher nominations",
      publisher: {
        _id: "publishers:staff",
        kind: "user",
        handle: "staff",
        displayName: "Staff",
        linkedUserId: "users:staff",
      },
      extraGet: (id: string) =>
        id === "users:staff" ? { _id: "users:staff", role: "admin" } : null,
    },
    {
      name: "staff-managed org publisher nominations",
      publisher: {
        _id: "publishers:staff-managed",
        kind: "org",
        handle: "staff-managed",
        displayName: "Staff Managed",
        linkedUserId: "users:owner",
      },
      extraGet: (id: string) => {
        if (id === "users:owner") return { _id: "users:owner", role: "user" };
        if (id === "users:staff-manager") {
          return { _id: "users:staff-manager", role: "moderator" };
        }
        return null;
      },
      staffManaged: true,
    },
  ])(
    "rejects direct ban actions for $name",
    async ({ publisher, official, staffManaged, extraGet }) => {
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
                ownerKey: `publisher:${publisher._id}`,
                ownerPublisherId: publisher._id,
                ownerUserId: publisher.linkedUserId,
                label: "potential_ban_candidate",
                status: "pending",
                latestScoreId: "publisherAbuseScores:score",
                updatedAt: 1,
              });
            }
            if (id === publisher._id) return publisher;
            const extra = extraGet?.(id);
            if (extra) return extra;
            if (id === publisher.linkedUserId) return { _id: id, role: "user" };
            return null;
          }),
          insert,
          patch,
          query: vi.fn((table: string) => {
            if (table === "officialPublishers") {
              return official
                ? {
                    withIndex: () => ({
                      unique: async () => ({
                        _id: "officialPublishers:openclaw",
                        publisherId: publisher._id,
                      }),
                    }),
                  }
                : makeEmptyOfficialPublishersQuery();
            }
            if (table === "publisherMembers") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_publisher_and_role");
                  return {
                    take: async () =>
                      staffManaged
                        ? [
                            {
                              _id: "publisherMembers:staff-manager",
                              publisherId: publisher._id,
                              userId: "users:staff-manager",
                              role: "owner",
                            },
                          ]
                        : [],
                  };
                },
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
      ).rejects.toThrow(/excluded publisher|staff accounts/i);

      expect(runMutation).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

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
          if (id === "users:previous-owner") {
            return { _id: "users:previous-owner", role: "user" };
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
          if (id === "users:owner") return { _id: "users:owner", role: "user" };
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
      reason: "publisher_abuse: confirmed spam",
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

  it("marks a pending publisher abuse nomination reviewed without banning", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:review",
      ownerKey: "publisher:owner",
      latestScoreId: "publisherAbuseScores:latest",
      updatedAt: 123,
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === nomination._id ? nomination : null)),
        insert,
        patch,
      },
    };

    await expect(
      markPublisherAbuseNominationReviewedHandler(ctx, {
        nominationId: nomination._id,
        expectedLatestScoreId: nomination.latestScoreId,
        expectedUpdatedAt: nomination.updatedAt,
        note: " moved to signals ",
      }),
    ).resolves.toEqual({ ok: true, status: "reviewed_no_action" });

    expect(assertModerator).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "users:moderator" }),
    );
    expect(patch).toHaveBeenCalledWith(
      nomination._id,
      expect.objectContaining({
        status: "reviewed_no_action",
        reviewedByUserId: "users:moderator",
        reviewedAt: expect.any(Number),
        notes: "moved to signals",
        warningSentAt: undefined,
        warningPendingAt: undefined,
        updatedAt: expect.any(Number),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: nomination._id,
        ownerKey: nomination.ownerKey,
        actorUserId: "users:moderator",
        scoreId: nomination.latestScoreId,
        eventType: "triage_status_changed",
        previousStatus: "pending",
        nextStatus: "reviewed_no_action",
        notes: "moved to signals",
      }),
    );
  });

  it("rejects stale publisher abuse nomination review actions", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:stale",
      latestScoreId: "publisherAbuseScores:newer",
      updatedAt: 456,
    });
    const ctx = {
      db: {
        get: vi.fn(async () => nomination),
        insert: vi.fn(),
        patch: vi.fn(),
      },
    };

    await expect(
      markPublisherAbuseNominationReviewedHandler(ctx, {
        nominationId: nomination._id,
        expectedLatestScoreId: "publisherAbuseScores:older",
        expectedUpdatedAt: nomination.updatedAt,
      }),
    ).rejects.toThrow("Publisher abuse nomination changed; refresh and try again");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects marking review-only calibration nominations reviewed", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:calibration",
      latestScoreId: "publisherAbuseScores:latest",
      label: "review",
      status: "pending",
      updatedAt: 123,
    });
    const ctx = {
      db: {
        get: vi.fn(async () => nomination),
        insert: vi.fn(),
        patch: vi.fn(),
      },
    };

    await expect(
      markPublisherAbuseNominationReviewedHandler(ctx, {
        nominationId: nomination._id,
        expectedLatestScoreId: nomination.latestScoreId,
        expectedUpdatedAt: nomination.updatedAt,
      }),
    ).rejects.toThrow(/calibration/i);

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects marking non-pending potential-ban nominations reviewed", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:already-reviewed",
      latestScoreId: "publisherAbuseScores:latest",
      label: "potential_ban_candidate",
      status: "reviewed_no_action",
      updatedAt: 123,
    });
    const ctx = {
      db: {
        get: vi.fn(async () => nomination),
        insert: vi.fn(),
        patch: vi.fn(),
      },
    };

    await expect(
      markPublisherAbuseNominationReviewedHandler(ctx, {
        nominationId: nomination._id,
        expectedLatestScoreId: nomination.latestScoreId,
        expectedUpdatedAt: nomination.updatedAt,
      }),
    ).rejects.toThrow("Only pending publisher abuse nominations can be marked reviewed");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects marking excluded publisher abuse nominations reviewed", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:official",
      ownerKey: "publisher:publishers:official",
      ownerPublisherId: "publishers:official",
      ownerUserId: "users:owner",
      latestScoreId: "publisherAbuseScores:latest",
      label: "potential_ban_candidate",
      status: "pending",
      updatedAt: 123,
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === nomination._id) return nomination;
          if (id === "publishers:official") {
            return {
              _id: "publishers:official",
              kind: "user",
              handle: "official",
              linkedUserId: "users:owner",
            };
          }
          if (id === "users:owner") return { _id: "users:owner", role: "user" };
          return null;
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        query: vi.fn((table: string) => {
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

    await expect(
      markPublisherAbuseNominationReviewedHandler(ctx, {
        nominationId: nomination._id,
        expectedLatestScoreId: nomination.latestScoreId,
        expectedUpdatedAt: nomination.updatedAt,
      }),
    ).rejects.toThrow("Excluded publisher abuse nominations cannot be acted on");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it.each(["admin", "moderator"] as const)(
    "rejects direct ban actions for %s owners without a publisher row",
    async (role) => {
      vi.mocked(requireUser).mockResolvedValue({
        userId: "users:admin",
        user: { _id: "users:admin", role: "admin" },
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
                ownerKey: "user:staff",
                ownerUserId: "users:staff",
                latestScoreId: "publisherAbuseScores:score",
                label: "potential_ban_candidate",
                status: "pending",
                updatedAt: 1,
              };
            }
            if (id === "users:staff") return { _id: "users:staff", role };
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
      ).rejects.toThrow(/staff accounts/i);

      expect(runMutation).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("uses publisher abuse email context for manual bans without notes", async () => {
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
          if (id === "users:owner") return { _id: "users:owner", role: "user" };
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
      }),
    ).resolves.toEqual({ ok: true, status: "banned" });

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: "users:moderator",
      targetUserId: "users:owner",
      reason: "publisher_abuse: potential ban candidate",
    });
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:nomination",
      expect.objectContaining({
        status: "banned",
        notes: undefined,
      }),
    );
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
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
          }
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

  it("records publisher abuse warning delivery and clears pending state", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      warningPendingAt: 10,
      warningPendingScoreId: "publisherAbuseScores:candidate",
      warningPendingRunId: "publisherAbuseScoreRuns:latest",
    };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "publisherAbuseReviewNominations:candidate" ? nomination : null,
        ),
        patch,
        insert,
      },
    };

    await expect(
      recordPublisherAbuseWarningSentHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 10,
        warningSentAt: 20,
        deadlineAt: 30,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        warningSentAt: 20,
        warningExpiresAt: 30,
        warningScoreId: "publisherAbuseScores:candidate",
        warningRunId: "publisherAbuseScoreRuns:latest",
        warningPendingAt: undefined,
        warningPendingScoreId: undefined,
        warningPendingRunId: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        eventType: "autoban_warning_sent",
        createdAt: 20,
      }),
    );
  });

  it("does not send repeat warnings before the warning deadline", async () => {
    const now = Date.now();
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
      warningSentAt: now - 24 * 60 * 60 * 1000,
      warningExpiresAt: now + 6 * 24 * 60 * 60 * 1000,
      warningScoreId: "publisherAbuseScores:candidate",
      warningRunId: "publisherAbuseScoreRuns:latest",
    };
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const patch = vi.fn(async () => null);
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
        insert: vi.fn(),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
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
      skipped: 0,
      isDone: true,
    });

    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects stale publisher abuse warning claims without mutating state", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      warningPendingAt: 10,
      warningPendingScoreId: "publisherAbuseScores:old",
      warningPendingRunId: "publisherAbuseScoreRuns:latest",
    };
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "publisherAbuseReviewNominations:candidate" ? nomination : null,
        ),
        patch,
      },
    };

    await expect(
      claimPublisherAbusePendingWarningHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 10,
      }),
    ).resolves.toEqual({ ok: false, reason: "stale_warning" });

    expect(patch).not.toHaveBeenCalled();
  });

  it("clears pending publisher abuse warnings when autobans are disabled", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      warningPendingAt: 10,
      warningPendingScoreId: "publisherAbuseScores:candidate",
      warningPendingRunId: "publisherAbuseScoreRuns:latest",
    };
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "publisherAbuseReviewNominations:candidate" ? nomination : null,
        ),
        patch,
        query: vi.fn((table: string) => {
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: false,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      claimPublisherAbusePendingWarningHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 10,
      }),
    ).resolves.toEqual({ ok: false, reason: "autoban_disabled" });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        warningPendingAt: undefined,
        warningPendingScoreId: undefined,
        warningPendingRunId: undefined,
      }),
    );
  });

  it("clears pending publisher abuse warnings when the score run failed", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      warningPendingAt: 10,
      warningPendingScoreId: "publisherAbuseScores:candidate",
      warningPendingRunId: "publisherAbuseScoreRuns:latest",
    };
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") return nomination;
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
          if (id === "publisherAbuseScoreRuns:latest") {
            return { ...makeCompletedPressureScoreRun(), status: "failed" };
          }
          return null;
        }),
        patch,
        query: vi.fn((table: string) => {
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      claimPublisherAbusePendingWarningHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 10,
      }),
    ).resolves.toEqual({ ok: false, reason: "score_run_not_actionable" });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        warningPendingAt: undefined,
        warningPendingScoreId: undefined,
        warningPendingRunId: undefined,
      }),
    );
  });

  it("preserves sent warning state when deferring candidates from failed score runs", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      warningSentAt: 10,
      warningExpiresAt: 20,
      warningScoreId: "publisherAbuseScores:warned",
      warningRunId: "publisherAbuseScoreRuns:warned",
    };
    const score = makeScore({
      _id: "publisherAbuseScores:candidate",
      ownerKey: nomination.ownerKey,
      ownerPublisherId: "publishers:candidate",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:candidate") return score;
          if (id === score.runId) return { ...makeCompletedPressureScoreRun(), status: "failed" };
          return null;
        }),
        patch,
        insert,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
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

    expect(patch).toHaveBeenCalledWith(
      nomination._id,
      expect.objectContaining({
        status: "candidate_for_future_action",
        notes: "Autoban skipped: score run failed before completion; manual review required.",
        warningSentAt: 10,
        warningExpiresAt: 20,
        warningScoreId: "publisherAbuseScores:warned",
        warningRunId: "publisherAbuseScoreRuns:warned",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: nomination._id,
        nextStatus: "candidate_for_future_action",
      }),
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "official publisher",
      publisher: {
        _id: "publishers:candidate",
        kind: "user",
        handle: "candidate",
        linkedUserId: "users:candidate",
      },
      official: true,
    },
    {
      name: "staff-linked publisher",
      publisher: {
        _id: "publishers:candidate",
        kind: "user",
        handle: "candidate",
        linkedUserId: "users:candidate",
      },
      users: {
        "users:candidate": { _id: "users:candidate", handle: "candidate", role: "admin" },
      },
    },
    {
      name: "staff-managed org publisher",
      publisher: {
        _id: "publishers:candidate",
        kind: "org",
        handle: "candidate",
        linkedUserId: "users:candidate",
      },
      users: {
        "users:candidate": { _id: "users:candidate", handle: "candidate", role: "user" },
        "users:staff-manager": {
          _id: "users:staff-manager",
          handle: "staff-manager",
          role: "moderator",
        },
      },
      staffMember: {
        _id: "publisherMembers:staff-manager",
        publisherId: "publishers:candidate",
        userId: "users:staff-manager",
        role: "owner",
      },
    },
    {
      name: "relinked publisher",
      publisher: {
        _id: "publishers:candidate",
        kind: "user",
        handle: "candidate",
        linkedUserId: "users:new-owner",
      },
      users: {
        "users:new-owner": { _id: "users:new-owner", handle: "new-owner", role: "user" },
      },
    },
  ])("clears queued warning claims when a $name is no longer actionable", async (testCase) => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:candidate",
        label: "potential_ban_candidate",
        status: "pending",
      }),
      warningPendingAt: 10,
      warningPendingScoreId: "publisherAbuseScores:candidate",
      warningPendingRunId: "publisherAbuseScoreRuns:latest",
    };
    const patch = vi.fn(async () => null);
    const users = testCase.users ?? {
      "users:candidate": { _id: "users:candidate", handle: "candidate", role: "user" },
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseReviewNominations:candidate") return nomination;
          if (id === "publishers:candidate") return testCase.publisher;
          return users[id as keyof typeof users] ?? null;
        }),
        patch,
        query: vi.fn((table: string) => {
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
          }
          if (table === "officialPublishers") {
            if (testCase.official) {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_publisher");
                  return {
                    unique: async () => ({
                      _id: "officialPublishers:candidate",
                      publisherId: "publishers:candidate",
                    }),
                  };
                },
              };
            }
            return makeEmptyOfficialPublishersQuery();
          }
          if (table === "publisherMembers") {
            return {
              withIndex: () => ({
                take: async () => (testCase.staffMember ? [testCase.staffMember] : []),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      claimPublisherAbusePendingWarningHandler(ctx, {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:latest",
        scoreId: "publisherAbuseScores:candidate",
        warningPendingAt: 10,
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        warningPendingAt: undefined,
        warningPendingScoreId: undefined,
        warningPendingRunId: undefined,
      }),
    );
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
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
          }
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
        "publisher_abuse: potential ban candidate (publisher-abuse-pressure.v4): high_catalog_volume, low_installs_per_skill",
    });
  });

  it("does not ban warned candidates after the deadline until a newer score confirms", async () => {
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: "publisherAbuseScores:warned",
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: 1,
        updatedAt: 1,
      }),
      warningSentAt: 1,
      warningExpiresAt: 2,
      warningScoreId: "publisherAbuseScores:warned",
      warningRunId: "publisherAbuseScoreRuns:latest",
    };
    const score = {
      ...makeScore({
        _id: "publisherAbuseScores:warned",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      createdAt: 1,
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === score._id) return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === publisher._id) return publisher;
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
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
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
      skipped: 0,
      isDone: true,
    });

    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not ban when the newer score was created before the warning deadline", async () => {
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
        lastScoredAt: 2,
        updatedAt: 2,
      }),
      warningSentAt: 1,
      warningExpiresAt: 3,
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
      createdAt: 2,
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === score._id) return score;
          if (id === "publisherAbuseScoreRuns:latest") return makeCompletedPressureScoreRun();
          if (id === publisher._id) return publisher;
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
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
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
      skipped: 0,
      isDone: true,
    });

    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("runs the warning-delivery-to-post-deadline-ban workflow", async () => {
    const warningPendingAt = 1_700_000_000_000;
    const warningSentAt = warningPendingAt + 60_000;
    const deadlineAt = warningSentAt + 7 * 24 * 60 * 60 * 1000;
    const firstScore = {
      ...makeScore({
        _id: "publisherAbuseScores:first",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
      }),
      ownerUserId: "users:candidate",
      reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
      createdAt: warningPendingAt - 1,
    };
    const secondScore = {
      ...firstScore,
      _id: "publisherAbuseScores:second",
      createdAt: deadlineAt + 1,
    };
    const nomination = {
      ...makeNomination({
        _id: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        ownerPublisherId: "publishers:candidate",
        ownerUserId: "users:candidate",
        latestScoreId: firstScore._id,
        handleSnapshot: "candidate",
        label: "potential_ban_candidate",
        status: "pending",
        lastScoredAt: warningPendingAt,
        updatedAt: warningPendingAt,
      }),
    };
    const publisher = {
      _id: "publishers:candidate",
      kind: "user",
      handle: "candidate",
      linkedUserId: "users:candidate",
    };
    const user = {
      _id: "users:candidate",
      handle: "candidate",
      email: "candidate@example.test",
      role: "user",
    };
    const run = makeCompletedPressureScoreRun();
    const scheduledWarnings: Array<{
      nominationId: string;
      ownerKey: string;
      runId: string;
      scoreId: string;
      userId: string;
      to: string;
      handle: string;
      publisherHandle: string;
      warningPendingAt: number;
      graceMs: number;
    }> = [];
    const runMutation = vi.fn(async () => ({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 4,
      deletedSkillComments: 0,
      scheduledSkills: false,
    }));
    const scheduler = {
      runAfter: vi.fn(
        async (_delay: number, _action: unknown, args: (typeof scheduledWarnings)[number]) => {
          scheduledWarnings.push(args);
        },
      ),
    };
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === firstScore._id) return firstScore;
          if (id === secondScore._id) return secondScore;
          if (id === run._id) return run;
          if (id === publisher._id) return publisher;
          if (id === user._id) return user;
          if (id === nomination._id) return nomination;
          return null;
        }),
        patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
          if (id !== nomination._id) throw new Error(`unexpected patch id ${id}`);
          Object.assign(nomination, patch);
          return null;
        }),
        insert: vi.fn(async (table: string) => `${table}:new`),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return makeAutoBanNominationQuery([nomination]);
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(warningPendingAt);

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 1,
      banned: 0,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });
    expect(scheduledWarnings).toHaveLength(1);
    expect(nomination).toMatchObject({
      warningPendingAt,
      warningPendingScoreId: firstScore._id,
      warningPendingRunId: run._id,
    });
    expect(nomination).not.toHaveProperty("warningSentAt");

    await expect(
      recordPublisherAbuseWarningSentHandler(ctx, {
        nominationId: scheduledWarnings[0].nominationId,
        ownerKey: scheduledWarnings[0].ownerKey,
        runId: scheduledWarnings[0].runId,
        scoreId: scheduledWarnings[0].scoreId,
        warningPendingAt: scheduledWarnings[0].warningPendingAt,
        warningSentAt,
        deadlineAt,
      }),
    ).resolves.toEqual({ ok: true });
    expect(nomination).toMatchObject({
      warningSentAt,
      warningExpiresAt: deadlineAt,
      warningScoreId: firstScore._id,
      warningRunId: run._id,
      warningPendingAt: undefined,
    });

    Object.assign(nomination, {
      latestScoreId: secondScore._id,
      lastScoredAt: secondScore.createdAt,
      updatedAt: secondScore.createdAt,
    });
    nowSpy.mockReturnValue(deadlineAt + 2);

    await expect(autoBanPublisherAbuseCandidatesPageHandler(ctx, {})).resolves.toEqual({
      ok: true,
      processed: 1,
      warned: 0,
      banned: 1,
      alreadyBanned: 0,
      skipped: 0,
      isDone: true,
    });

    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: user._id,
      nominationId: nomination._id,
      scoreId: secondScore._id,
      reason:
        "publisher_abuse: potential ban candidate (publisher-abuse-pressure.v4): high_catalog_volume, low_installs_per_skill",
    });
    nowSpy.mockRestore();
  });

  it("does not warn or ban candidates when the page sees autobans disabled", async () => {
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn(async () => null) };
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const get = vi.fn();
    const ctx = {
      scheduler,
      runMutation,
      db: {
        get,
        patch,
        insert,
        query: vi.fn((table: string) => {
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
    expect(get).not.toHaveBeenCalled();
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
          if (table === "systemSettings") {
            return makePublisherAbuseAutobanSettingQuery({
              key: "publisherAbuseAutobanEnabled",
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
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
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:no-email",
      expect.objectContaining({
        status: "needs_policy_discussion",
        notes: "Autoban warning skipped: linked user has no email address; manual review required.",
      }),
    );
  });

  it("moves completed current temporal candidates out of the autoban queue", async () => {
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:temporal",
      ownerKey: "publisher:publishers:temporal",
      ownerPublisherId: "publishers:temporal",
      ownerUserId: "users:temporal",
      latestScoreId: "publisherAbuseScores:temporal",
      openedByRunId: "publisherAbuseScoreRuns:temporal",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const score = makeScore({
      _id: "publisherAbuseScores:temporal",
      runId: "publisherAbuseScoreRuns:temporal",
      ownerKey: "publisher:publishers:temporal",
      ownerPublisherId: "publishers:temporal",
    });
    const patch = vi.fn(async () => null);
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const runMutation = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publisherAbuseScores:temporal") return score;
          if (id === "publisherAbuseScoreRuns:temporal") {
            return {
              _id: "publisherAbuseScoreRuns:temporal",
              modelVersion: "publisher-abuse-temporal.v1",
              status: "completed",
              phase: "completed",
              temporalMode: "current",
              temporalScanComplete: true,
            };
          }
          if (id === "publishers:temporal") {
            return {
              _id: "publishers:temporal",
              kind: "user",
              handle: "temporal",
              linkedUserId: "users:temporal",
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
              enabled: true,
              updatedAt: 1,
              updatedByUserId: "users:admin",
            });
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
      "publisherAbuseReviewNominations:temporal",
      expect.objectContaining({
        status: "candidate_for_future_action",
        notes: "Autoban skipped: temporal publisher abuse signals require manual review.",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:temporal",
        nextStatus: "candidate_for_future_action",
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
                  paginate: async (paginationOpts: { numItems: number; cursor: string | null }) => {
                    expect(paginationOpts).toEqual({ numItems: 1, cursor: null });
                    return {
                      page:
                        constraints.label === "review" && constraints.status === "pending"
                          ? [nomination]
                          : [],
                      isDone: true,
                      continueCursor: "",
                    };
                  },
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

    await expect(
      listReviewItemsPageHandler(ctx, {
        tab: "review",
        paginationOpts: { numItems: 1, cursor: null },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        page: [
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

  it("pages nomination rows while skipping hidden dashboard candidates", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const hiddenNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:hidden",
      ownerKey: "publisher:publishers:hidden",
      ownerPublisherId: "publishers:hidden",
      ownerUserId: "users:hidden",
      latestScoreId: "publisherAbuseScores:hidden",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const visibleNomination = makeNomination({
      _id: "publisherAbuseReviewNominations:visible",
      ownerKey: "publisher:publishers:visible",
      ownerPublisherId: "publishers:visible",
      ownerUserId: "users:visible",
      latestScoreId: "publisherAbuseScores:visible",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const hiddenScore = makeScore({
      _id: "publisherAbuseScores:hidden",
      ownerKey: hiddenNomination.ownerKey,
    });
    const visibleScore = makeScore({
      _id: "publisherAbuseScores:visible",
      ownerKey: visibleNomination.ownerKey,
    });
    const nominationsPaginate = vi.fn(
      async (paginationOpts: { numItems: number; cursor: string | null }) => {
        expect(paginationOpts).toEqual({ numItems: 2, cursor: null });
        return {
          page: [hiddenNomination, visibleNomination],
          isDone: true,
          continueCursor: "",
        };
      },
    );
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:hidden") {
            return {
              _id: "publishers:hidden",
              kind: "user",
              handle: "hidden",
              linkedUserId: "users:hidden",
              deletedAt: 10,
            };
          }
          if (id === "publishers:visible") {
            return {
              _id: "publishers:visible",
              kind: "user",
              handle: "visible",
              linkedUserId: "users:visible",
            };
          }
          if (id === "publisherAbuseScores:hidden") return hiddenScore;
          if (id === "publisherAbuseScores:visible") return visibleScore;
          if (id === "users:hidden") {
            return { _id: "users:hidden", handle: "hidden", role: "user" };
          }
          if (id === "users:visible") {
            return { _id: "users:visible", handle: "visible", role: "user" };
          }
          return null;
        }),
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
                if (indexName === "by_status_and_label_and_last_scored_at") {
                  expect(constraints).toEqual({
                    status: "pending",
                    label: "potential_ban_candidate",
                  });
                  return {
                    order: () => ({
                      paginate: nominationsPaginate,
                    }),
                  };
                }
                throw new Error(`unexpected nomination index ${indexName}`);
              },
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      listReviewItemsPageHandler(ctx, {
        tab: "potential_ban_candidate",
        paginationOpts: { numItems: 2, cursor: null },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        page: [
          expect.objectContaining({
            nomination: expect.objectContaining({
              _id: "publisherAbuseReviewNominations:visible",
              latestScoreId: "publisherAbuseScores:visible",
            }),
            latestScore: expect.objectContaining({
              _id: "publisherAbuseScores:visible",
              zScore: visibleScore.zScore,
              reasonCodes: visibleScore.reasonCodes,
            }),
            publisher: expect.objectContaining({
              displayName: null,
              handle: "visible",
            }),
          }),
        ],
      }),
    );
    expect(nominationsPaginate).toHaveBeenCalledWith({ numItems: 2, cursor: null });
  });

  it("excludes staff-managed org rows without a second paginated query", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:staff-org",
      ownerKey: "publisher:publishers:staff-org",
      ownerPublisherId: "publishers:staff-org",
      ownerUserId: "users:owner",
      latestScoreId: "publisherAbuseScores:staff-org",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const nominationsPaginate = vi.fn(async () => ({
      page: [nomination],
      isDone: true,
      continueCursor: "",
    }));
    const publisherMembersTake = vi.fn(async () => [
      {
        _id: "publisherMembers:staff",
        publisherId: "publishers:staff-org",
        userId: "users:staff",
        role: "owner",
      },
    ]);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:staff-org") {
            return {
              _id: "publishers:staff-org",
              kind: "org",
              handle: "staff-org",
              displayName: "Staff Org",
              linkedUserId: "users:owner",
            };
          }
          if (id === "users:owner") return { _id: "users:owner", role: "user" };
          if (id === "users:staff") return { _id: "users:staff", role: "moderator" };
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: nominationsPaginate,
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          if (table === "publisherMembers") {
            return {
              withIndex: () => ({
                take: publisherMembersTake,
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      listReviewItemsPageHandler(ctx, {
        tab: "potential_ban_candidate",
        paginationOpts: { numItems: 1, cursor: null },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        page: [],
        isDone: true,
        continueCursor: "",
      }),
    );
    expect(nominationsPaginate).toHaveBeenCalledWith({ numItems: 1, cursor: null });
    expect(publisherMembersTake).toHaveBeenCalledWith(100);
  });

  it("normalizes absent optional publisher and user fields in nomination rows", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:legacy",
      ownerKey: "publisher:publishers:legacy",
      ownerPublisherId: "publishers:legacy",
      ownerUserId: "users:legacy",
      latestScoreId: "publisherAbuseScores:legacy",
      label: "potential_ban_candidate",
      status: "pending",
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:legacy") {
            return {
              _id: "publishers:legacy",
              kind: "user",
              handle: "legacy",
              createdAt: 1,
              updatedAt: 1,
            };
          }
          if (id === "users:legacy") {
            return { _id: "users:legacy" };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [nomination],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listReviewItemsPageHandler(ctx, {
      tab: "potential_ban_candidate",
      paginationOpts: { numItems: 1, cursor: null },
    });

    const [item] = result.page as Array<{
      publisher: unknown;
      ownerUser: unknown;
    }>;
    expect(result.page).toEqual([
      expect.objectContaining({
        publisher: expect.objectContaining({
          displayName: null,
          linkedUserId: null,
          publishedSkills: 0,
          publishedPackages: 0,
          totalInstalls: 0,
          totalStars: 0,
          totalDownloads: 0,
          skillTotalInstalls: 0,
          skillTotalStars: 0,
          skillTotalDownloads: 0,
          deletedAt: null,
          deactivatedAt: null,
        }),
        ownerUser: expect.objectContaining({
          handle: null,
          name: null,
          displayName: null,
          role: "user",
          image: null,
          deletedAt: null,
          deactivatedAt: null,
          banReason: null,
        }),
      }),
    ]);
    expect(hasNoUndefinedValues(item.publisher)).toBe(true);
    expect(hasNoUndefinedValues(item.ownerUser)).toBe(true);
  });

  it("pages archived publisher abuse signals for staff review", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const signal = {
      _id: "publisherAbuseSignals:ratio",
      _creationTime: 100,
      signalType: "high_install_download_ratio",
      ownerKey: "publisher:publishers:ratio-owner",
      ownerPublisherId: "publishers:ratio-owner",
      ownerUserId: "users:ratio-owner",
      handleSnapshot: "ratio-owner",
      skillId: "skills:ratio",
      skillSlug: "ratio-skill",
      skillDisplayName: "Ratio Skill",
      latestRunId: "publisherAbuseScoreRuns:temporal",
      firstSeenAt: 100,
      lastSeenAt: 200,
      seenCount: 2,
      recent7Downloads: 600,
      recent7Installs: 72,
      recent7InstallDownloadRatio: 0.12,
      recent30Downloads: 2_000,
      recent30Installs: 240,
      recent30InstallDownloadRatio: 0.12,
      allTimeDownloads: 10_000,
      allTimeInstalls: 1_200,
      allTimeInstallDownloadRatio: 0.12,
    };
    const signalPaginate = vi.fn(
      async (paginationOpts: {
        numItems: number;
        cursor: string | null;
        endCursor?: string | null;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        id?: number;
      }) => {
        expect(paginationOpts).toEqual({
          numItems: 10,
          cursor: null,
          endCursor: "page-end",
          maximumRowsRead: 500,
          maximumBytesRead: 50_000,
          id: 7,
        });
        return {
          page: [signal],
          isDone: true,
          continueCursor: "",
          splitCursor: "page-split",
          pageStatus: "SplitRequired",
        };
      },
    );
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:ratio-owner") {
            return {
              _id: "publishers:ratio-owner",
              kind: "user",
              handle: "ratio-owner",
              linkedUserId: "users:ratio-owner",
            };
          }
          if (id === "users:ratio-owner") {
            return {
              _id: "users:ratio-owner",
              handle: "ratio-owner",
              role: "user",
            };
          }
          throw new Error(`unexpected get ${id}`);
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseSignals") {
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
                expect(indexName).toBe("by_signal_type_and_last_seen_at");
                expect(constraints).toEqual({ signalType: "high_install_download_ratio" });
                return {
                  order: () => ({
                    paginate: signalPaginate,
                  }),
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
      listSignalsPageHandler(ctx, {
        signalType: "high_install_download_ratio",
        paginationOpts: {
          numItems: 10,
          cursor: null,
          endCursor: "page-end",
          maximumRowsRead: 500,
          maximumBytesRead: 50_000,
          id: 7,
        },
      }),
    ).resolves.toEqual({
      page: [
        expect.objectContaining({
          signal,
          publisher: expect.objectContaining({
            _id: "publishers:ratio-owner",
            handle: "ratio-owner",
          }),
          ownerUser: expect.objectContaining({
            _id: "users:ratio-owner",
            handle: "ratio-owner",
          }),
        }),
      ],
      isDone: true,
      continueCursor: "",
      splitCursor: "page-split",
      pageStatus: "SplitRequired",
    });
    expect(signalPaginate).toHaveBeenCalledOnce();
  });

  it("pages unfiltered archived publisher abuse signals by last seen time", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const freshSignal = {
      _id: "publisherAbuseSignals:fresh",
      _creationTime: 100,
      signalType: "high_install_download_ratio",
      ownerKey: "publisher:publishers:fresh",
      ownerPublisherId: "publishers:fresh",
      ownerUserId: "users:fresh",
      handleSnapshot: "fresh",
      skillId: "skills:fresh",
      skillSlug: "fresh-skill",
      skillDisplayName: "Fresh Skill",
      latestRunId: "publisherAbuseScoreRuns:temporal",
      firstSeenAt: 100,
      lastSeenAt: 300,
      seenCount: 1,
      recent7Downloads: 500,
      recent7Installs: 75,
      recent7InstallDownloadRatio: 0.15,
      recent30Downloads: 1_000,
      recent30Installs: 150,
      recent30InstallDownloadRatio: 0.15,
      allTimeDownloads: 1_000,
      allTimeInstalls: 150,
      allTimeInstallDownloadRatio: 0.15,
    };
    const olderSignal = {
      ...freshSignal,
      _id: "publisherAbuseSignals:older",
      ownerKey: "publisher:publishers:older",
      ownerPublisherId: "publishers:older",
      ownerUserId: "users:older",
      handleSnapshot: "older",
      skillId: "skills:older",
      skillSlug: "older-skill",
      skillDisplayName: "Older Skill",
      lastSeenAt: 200,
      reviewStatus: "dismissed",
      reviewNote: "Retained legacy decision",
    };
    const signalPaginate = vi.fn(async () => ({
      page: [freshSignal, olderSignal],
      isDone: true,
      continueCursor: "",
    }));
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:fresh" || id === "publishers:older") {
            const handle = id.split(":").at(-1);
            return {
              _id: id,
              kind: "user",
              handle,
              linkedUserId: `users:${handle}`,
            };
          }
          if (id === "users:fresh" || id === "users:older") {
            const handle = id.split(":").at(-1);
            return { _id: id, handle, role: "user" };
          }
          throw new Error(`unexpected get ${id}`);
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseSignals") {
            return {
              withIndex: (indexName: string) => {
                expect(indexName).toBe("by_last_seen_at");
                return {
                  order: (direction: string) => {
                    expect(direction).toBe("desc");
                    return { paginate: signalPaginate };
                  },
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
      listSignalsPageHandler(ctx, {
        reviewStatus: "dismissed",
        paginationOpts: { numItems: 2, cursor: null },
      }),
    ).resolves.toEqual({
      page: [
        expect.objectContaining({
          signal: freshSignal,
          publisher: expect.objectContaining({ handle: "fresh" }),
          ownerUser: expect.objectContaining({ handle: "fresh" }),
        }),
        expect.objectContaining({
          signal: olderSignal,
          publisher: expect.objectContaining({ handle: "older" }),
          ownerUser: expect.objectContaining({ handle: "older" }),
        }),
      ],
      isDone: true,
      continueCursor: "",
    });
    expect(signalPaginate).toHaveBeenCalledWith({ numItems: 2, cursor: null });
  });

  it("excludes archived publisher abuse signals for now-excluded publishers", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const signal = {
      _id: "publisherAbuseSignals:official",
      _creationTime: 100,
      signalType: "high_install_download_ratio",
      ownerKey: "publisher:publishers:official",
      ownerPublisherId: "publishers:official",
      ownerUserId: "users:official",
      handleSnapshot: "official",
      skillId: "skills:official",
      skillSlug: "official-skill",
      skillDisplayName: "Official Skill",
      latestRunId: "publisherAbuseScoreRuns:temporal",
      firstSeenAt: 100,
      lastSeenAt: 300,
      seenCount: 1,
      recent7Downloads: 500,
      recent7Installs: 75,
      recent7InstallDownloadRatio: 0.15,
      recent30Downloads: 1_000,
      recent30Installs: 150,
      recent30InstallDownloadRatio: 0.15,
      allTimeDownloads: 1_000,
      allTimeInstalls: 150,
      allTimeInstallDownloadRatio: 0.15,
    };
    const signalPaginate = vi.fn(async () => ({
      page: [signal],
      isDone: true,
      continueCursor: "",
    }));
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:official") {
            return {
              _id: "publishers:official",
              kind: "user",
              handle: "official",
              linkedUserId: "users:official",
            };
          }
          if (id === "users:official") return { _id: "users:official", role: "user" };
          throw new Error(`unexpected get ${id}`);
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseSignals") {
            return {
              withIndex: (indexName: string) => {
                expect(indexName).toBe("by_last_seen_at");
                return {
                  order: (direction: string) => {
                    expect(direction).toBe("desc");
                    return { paginate: signalPaginate };
                  },
                };
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
                    constraints.publisherId === "publishers:official"
                      ? { _id: "officialPublishers:official" }
                      : null,
                };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      listSignalsPageHandler(ctx, {
        paginationOpts: { numItems: 1, cursor: null },
      }),
    ).resolves.toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
    expect(signalPaginate).toHaveBeenCalledWith({ numItems: 1, cursor: null });
  });

  it("returns a nonfinal empty signal page when the raw page is excluded", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const officialSignal = {
      _id: "publisherAbuseSignals:official",
      _creationTime: 100,
      signalType: "high_install_download_ratio",
      ownerKey: "publisher:publishers:official",
      ownerPublisherId: "publishers:official",
      ownerUserId: "users:official",
      handleSnapshot: "official",
      skillId: "skills:official",
      skillSlug: "official-skill",
      skillDisplayName: "Official Skill",
      latestRunId: "publisherAbuseScoreRuns:temporal",
      firstSeenAt: 100,
      lastSeenAt: 300,
      seenCount: 1,
      recent7Downloads: 500,
      recent7Installs: 75,
      recent7InstallDownloadRatio: 0.15,
      recent30Downloads: 1_000,
      recent30Installs: 150,
      recent30InstallDownloadRatio: 0.15,
      allTimeDownloads: 1_000,
      allTimeInstalls: 150,
      allTimeInstallDownloadRatio: 0.15,
    };
    const signalPaginate = vi.fn(
      async (paginationOpts: { numItems: number; cursor: string | null }) => {
        expect(paginationOpts).toEqual({ numItems: 1, cursor: null });
        return {
          page: [officialSignal],
          isDone: false,
          continueCursor: "after-official",
        };
      },
    );
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:official") {
            const handle = id.split(":").at(-1);
            return {
              _id: id,
              kind: "user",
              handle,
              linkedUserId: `users:${handle}`,
            };
          }
          if (id === "users:official") {
            const handle = id.split(":").at(-1);
            return { _id: id, handle, role: "user" };
          }
          throw new Error(`unexpected get ${id}`);
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseSignals") {
            return {
              withIndex: (indexName: string) => {
                expect(indexName).toBe("by_last_seen_at");
                return {
                  order: (direction: string) => {
                    expect(direction).toBe("desc");
                    return { paginate: signalPaginate };
                  },
                };
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
                    constraints.publisherId === "publishers:official"
                      ? { _id: "officialPublishers:official" }
                      : null,
                };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      listSignalsPageHandler(ctx, {
        paginationOpts: { numItems: 1, cursor: null },
      }),
    ).resolves.toEqual({
      page: [],
      isDone: false,
      continueCursor: "after-official",
    });
    expect(signalPaginate).toHaveBeenCalledTimes(1);
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
    const bannedResolution = {
      _id: "publisherAbuseReviewNominations:banned-resolution",
      ownerKey: "user:banned-resolution",
      ownerPublisherId: undefined,
      ownerUserId: "users:banned-resolution",
      handleSnapshot: "banned-resolution",
      latestScoreId: "publisherAbuseScores:banned-resolution",
      modelVersion: "publisher-abuse-pressure.v2",
      label: "potential_ban_candidate",
      status: "banned",
      openedAt: 1,
      openedByRunId: "publisherAbuseScoreRuns:run",
      lastScoredAt: 6_000,
      reviewedAt: 6_000,
      updatedAt: 6_000,
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
                    expect(limit).toBe(3);
                    if (constraints.status === "banned") return [bannedResolution];
                    if (constraints.status === "reviewed_no_action") {
                      return [rescoredOldResolution, resolvedNomination];
                    }
                    return [];
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
          if (id === "publisherAbuseScores:banned-resolution") {
            return {
              _id: id,
              runId: "publisherAbuseScoreRuns:run",
              ownerKey: "user:banned-resolution",
              ownerPublisherId: undefined,
              ownerUserId: "users:banned-resolution",
              handleSnapshot: "banned-resolution",
              modelVersion: "publisher-abuse-pressure.v2",
              label: "potential_ban_candidate",
              rank: 3,
              pressure: 110,
              logPressure: 2.1,
              zScore: 2.1,
              publishedSkills: 110,
              totalInstalls: 1,
              totalStars: 0,
              totalDownloads: 11,
              installsPerSkill: 0.01,
              starsPerSkill: 0,
              downloadsPerSkill: 0.1,
              reasonCodes: ["high_catalog_volume"],
              createdAt: 1,
            };
          }
          if (id === "users:banned-resolution") {
            return {
              _id: id,
              handle: "banned-resolution",
              name: "Banned Resolution",
              displayName: "Banned Resolution",
              role: "user",
              deletedAt: 6_000,
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

    const result = await listReviewItemsPageHandler(ctx, {
      tab: "resolved",
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(result.page).toEqual([
      expect.objectContaining({
        nomination: expect.objectContaining({
          _id: "publisherAbuseReviewNominations:banned-resolution",
        }),
        ownerUser: expect.objectContaining({
          deletedAt: 6_000,
        }),
      }),
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
    ]);
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

  it("collects finite score rows for stored configs without engagement elasticity", async () => {
    const legacyModelConfig: Partial<typeof TEST_MODEL_CONFIG> = { ...TEST_MODEL_CONFIG };
    delete legacyModelConfig.engagementElasticity;
    const insertedScores: unknown[] = [];
    const insert = vi.fn(async (table: string, doc?: unknown) => {
      if (table === "publisherAbuseScores") insertedScores.push(doc);
      return `${table}:new`;
    });
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          modelVersion: legacyModelConfig.modelVersion,
          modelConfig: legacyModelConfig,
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
                      _id: "publishers:legacy-config",
                      handle: "legacy-config",
                      linkedUserId: "users:legacy-config",
                      publishedSkills: 250,
                      publishedPackages: 0,
                      totalInstalls: 25,
                      totalStars: 1,
                      totalDownloads: 10_000,
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

    expect(insertedScores).toHaveLength(1);
    const [insertedScore] = insertedScores;
    if (typeof insertedScore !== "object" || insertedScore === null) {
      throw new Error("Expected publisher abuse score insert");
    }
    const pressure = Object.getOwnPropertyDescriptor(insertedScore, "pressure")?.value;
    const logPressure = Object.getOwnPropertyDescriptor(insertedScore, "logPressure")?.value;
    expect(Number.isFinite(pressure)).toBe(true);
    expect(Number.isFinite(logPressure)).toBe(true);
    expect(insertedScore).toEqual(
      expect.objectContaining({
        ownerKey: "publisher:publishers:legacy-config",
        handleSnapshot: "legacy-config",
      }),
    );
  });

  it("preserves legacy stored config label semantics while finalizing score rows", async () => {
    const legacyModelConfig: Partial<typeof TEST_MODEL_CONFIG> = { ...TEST_MODEL_CONFIG };
    delete legacyModelConfig.engagementElasticity;
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:legacy-run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v2",
          modelConfig: legacyModelConfig,
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
                        _id: "publisherAbuseScores:legacy-score",
                        ownerKey: "publisher:publishers:legacy-score",
                        ownerPublisherId: "publishers:legacy-score",
                        ownerUserId: "users:legacy-score",
                        handleSnapshot: "legacy-score",
                        modelVersion: "publisher-abuse-pressure.v2",
                        pressure: 1000,
                        logPressure: 6,
                        publishedSkills: 99,
                        totalInstalls: 0,
                        totalStars: 0,
                        totalDownloads: 100,
                        installsPerSkill: 0,
                        starsPerSkill: 0,
                        downloadsPerSkill: 1.01,
                        reasonCodes: ["low_installs_per_skill"],
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
                take: async () => [],
              }),
            };
          }
          if (table === "officialPublishers") return makeEmptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(
      finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:legacy-run" }),
    ).resolves.toEqual(expect.objectContaining({ isDone: true, finalized: 1, nominations: 1 }));

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScores:legacy-score",
      expect.objectContaining({ label: "potential_ban_candidate", zScore: 3 }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations",
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:legacy-score",
        modelVersion: "publisher-abuse-pressure.v2",
        label: "potential_ban_candidate",
      }),
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
                  take: async (numItems: number) => {
                    const members =
                      constraints.publisherId === largeCommunityOrgPublisher._id &&
                      constraints.role === "admin"
                        ? [
                            {
                              _id: "publisherMembers:large-community-admin",
                              publisherId: largeCommunityOrgPublisher._id,
                              userId: "users:large-community-admin-0",
                              role: "admin",
                            },
                          ]
                        : constraints.publisherId === tooManyManagerOrgPublisher._id &&
                            constraints.role === "admin"
                          ? Array.from({ length: 101 }, (_, index) => ({
                              _id: `publisherMembers:too-many-manager-${index}`,
                              publisherId: tooManyManagerOrgPublisher._id,
                              userId: `users:too-many-manager-${index}`,
                              role: "admin",
                            }))
                          : [];
                    return members.slice(0, numItems);
                  },
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
                take: async () => [],
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
      minPublishedSkillsForAggregateLabel: 200,
    };
    const staleV2Nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:stale-v2",
      ownerKey: "publisher:publishers:spacesq-shape",
      ownerPublisherId: "publishers:spacesq-shape",
      ownerUserId: "users:spacesq-shape",
      latestScoreId: "publisherAbuseScores:old-v2-score",
      handleSnapshot: "spacesq-shape",
      label: "potential_ban_candidate",
      status: "pending",
      lastScoredAt: 1,
      updatedAt: 1,
    });
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
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                expect(indexName).toBe("by_owner_key_and_model_version");
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
                    constraints.ownerKey === staleV2Nomination.ownerKey ? [staleV2Nomination] : [],
                };
              },
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
      staleV2Nomination._id,
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:spacesq-shape",
        label: "pass",
        lastScoredAt: expect.any(Number),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: staleV2Nomination._id,
        eventType: "nomination_score_updated",
        previousLabel: "potential_ban_candidate",
        nextLabel: "pass",
        scoreId: "publisherAbuseScores:spacesq-shape",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns:run",
      expect.objectContaining({
        passCount: 1,
        reviewCount: 0,
        potentialBanCandidateCount: 0,
      }),
    );
  });

  it("clears stale higher-severity aggregate nominations after a downgrade to review", async () => {
    const modelConfig = {
      ...TEST_MODEL_CONFIG,
      modelVersion: "publisher-abuse-pressure.v4",
      skillPivot: 200,
      minPublishedSkillsForAggregateLabel: 200,
    };
    const staleV2Nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:stale-v2",
      ownerKey: "publisher:publishers:downgraded",
      ownerPublisherId: "publishers:downgraded",
      ownerUserId: "users:downgraded",
      latestScoreId: "publisherAbuseScores:old-v2-score",
      handleSnapshot: "downgraded",
      modelVersion: "publisher-abuse-pressure.v2",
      label: "potential_ban_candidate",
      status: "pending",
      lastScoredAt: 1,
      updatedAt: 1,
    });
    const insert = vi.fn(async (table: string) =>
      table === "publisherAbuseReviewNominations"
        ? "publisherAbuseReviewNominations:current-v4"
        : `${table}:new`,
    );
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
                        _id: "publisherAbuseScores:downgraded-v4",
                        ownerKey: "publisher:publishers:downgraded",
                        ownerPublisherId: "publishers:downgraded",
                        ownerUserId: "users:downgraded",
                        handleSnapshot: "downgraded",
                        modelVersion: modelConfig.modelVersion,
                        pressure: 100,
                        logPressure: 5,
                        publishedSkills: 220,
                        totalInstalls: 80,
                        totalStars: 2,
                        totalDownloads: 2_000,
                        installsPerSkill: 0.36,
                        starsPerSkill: 0.009,
                        downloadsPerSkill: 9.09,
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
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                expect(indexName).toBe("by_owner_key_and_model_version");
                const constraints: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    constraints[field] = value;
                    return q;
                  },
                };
                build(q);
                return {
                  first: async () => null,
                  take: async () =>
                    constraints.ownerKey === staleV2Nomination.ownerKey ? [staleV2Nomination] : [],
                };
              },
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
      "publisherAbuseScores:downgraded-v4",
      expect.objectContaining({ label: "review", zScore: 2 }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations",
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:downgraded-v4",
        modelVersion: modelConfig.modelVersion,
        label: "review",
        status: "pending",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      staleV2Nomination._id,
      expect.objectContaining({
        latestScoreId: "publisherAbuseScores:downgraded-v4",
        label: "pass",
        lastScoredAt: expect.any(Number),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: staleV2Nomination._id,
        eventType: "nomination_score_updated",
        previousLabel: "potential_ban_candidate",
        nextLabel: "pass",
        scoreId: "publisherAbuseScores:downgraded-v4",
      }),
    );
  });

  it("does not clear newer aggregate nominations when an older stored run finalizes", async () => {
    const modelConfig = {
      ...TEST_MODEL_CONFIG,
      modelVersion: "publisher-abuse-pressure.v2",
      minPublishedSkillsForAggregateLabel: undefined,
    };
    const newerV4Nomination = makeNomination({
      _id: "publisherAbuseReviewNominations:newer-v4",
      ownerKey: "publisher:publishers:late-v2",
      ownerPublisherId: "publishers:late-v2",
      ownerUserId: "users:late-v2",
      latestScoreId: "publisherAbuseScores:newer-v4-score",
      handleSnapshot: "late-v2",
      modelVersion: "publisher-abuse-pressure.v4",
      label: "potential_ban_candidate",
      status: "pending",
      lastScoredAt: 2,
      updatedAt: 2,
    });
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:late-v2",
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
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
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
                        _id: "publisherAbuseScores:late-v2-score",
                        ownerKey: "publisher:publishers:late-v2",
                        ownerPublisherId: "publishers:late-v2",
                        ownerUserId: "users:late-v2",
                        handleSnapshot: "late-v2",
                        modelVersion: modelConfig.modelVersion,
                        pressure: 1,
                        logPressure: 0,
                        publishedSkills: 220,
                        totalInstalls: 600,
                        totalStars: 20,
                        totalDownloads: 80_000,
                        installsPerSkill: 2.72,
                        starsPerSkill: 0.09,
                        downloadsPerSkill: 363.64,
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
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                expect(indexName).toBe("by_owner_key_and_model_version");
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
                    constraints.ownerKey === newerV4Nomination.ownerKey ? [newerV4Nomination] : [],
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
      finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:late-v2" }),
    ).resolves.toEqual(expect.objectContaining({ isDone: true, finalized: 1, nominations: 0 }));

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseScores:late-v2-score",
      expect.objectContaining({ label: "pass", zScore: 0 }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      newerV4Nomination._id,
      expect.objectContaining({ label: "pass" }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: newerV4Nomination._id,
        nextLabel: "pass",
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
                take: async () => [],
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
                take: async () => [],
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

  it("preserves sent warning state when reopening after a failed pressure-run deferral", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => null);
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
                  ownerUserId: "users:repeat",
                  label: "potential_ban_candidate",
                  status: "candidate_for_future_action",
                  notes:
                    "Autoban skipped: score run failed before completion; manual review required.",
                  reviewedByUserId: undefined,
                  reviewedAt: 100,
                  warningSentAt: 10,
                  warningExpiresAt: 20,
                  warningScoreId: "publisherAbuseScores:old-warning",
                  warningRunId: "publisherAbuseScoreRuns:old-warning",
                  warningPendingAt: 30,
                  warningPendingScoreId: "publisherAbuseScores:pending-warning",
                  warningPendingRunId: "publisherAbuseScoreRuns:pending-warning",
                }),
                take: async () => [],
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

    const nominationPatch = patch.mock.calls.find(
      ([id]) => id === "publisherAbuseReviewNominations:existing",
    )?.[1] as Record<string, unknown>;
    expect(nominationPatch).toMatchObject({
      latestScoreId: "publisherAbuseScores:repeat",
      label: "potential_ban_candidate",
      status: "pending",
      warningPendingAt: undefined,
      warningPendingScoreId: undefined,
      warningPendingRunId: undefined,
      reviewedByUserId: undefined,
      reviewedAt: undefined,
    });
    expect(nominationPatch).not.toHaveProperty("warningSentAt");
    expect(nominationPatch).not.toHaveProperty("warningExpiresAt");
    expect(nominationPatch).not.toHaveProperty("warningScoreId");
    expect(nominationPatch).not.toHaveProperty("warningRunId");
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
                take: async () => [],
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
                take: async () => [],
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
            const existingNomination = {
              _id: "publisherAbuseReviewNominations:existing",
              ownerKey: "publisher:publishers:recovered",
              modelVersion: "publisher-abuse-pressure.v2",
              label: "review",
              warningSentAt: 10,
              warningExpiresAt: 20,
              warningScoreId: "publisherAbuseScores:old-warning",
              warningRunId: "publisherAbuseScoreRuns:old-warning",
              warningPendingAt: 30,
              warningPendingScoreId: "publisherAbuseScores:pending-warning",
              warningPendingRunId: "publisherAbuseScoreRuns:pending-warning",
            };
            return {
              withIndex: () => ({
                take: async () => [existingNomination],
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
        warningSentAt: undefined,
        warningExpiresAt: undefined,
        warningScoreId: undefined,
        warningRunId: undefined,
        warningPendingAt: undefined,
        warningPendingScoreId: undefined,
        warningPendingRunId: undefined,
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
      5_000,
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
    const runMutation = vi.fn(async (target: symbol, _args?: unknown) => {
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

  it("does not mark a completed score run failed when the autoban sweep fails", async () => {
    const autobanError = new Error("autoban failed");
    const runMutation = vi.fn(async (target: symbol, _args?: unknown) => {
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

  it("records and retries transient score run page failures without failing the run", async () => {
    const transientError = new Error("Your request couldn't be completed. Try again later.");
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async (target: symbol, _args?: unknown) => {
      const targetName = String(target);
      if (targetName.includes("collectPublisherAbuseScoresPageInternal")) {
        throw transientError;
      }
      if (targetName.includes("recordPublisherAbuseScoreRunTransientErrorInternal")) {
        return { ok: true, recorded: true };
      }
      if (targetName.includes("markPublisherAbuseScoreRunFailedInternal")) {
        throw new Error("transient failure should not mark the run failed");
      }
      throw new Error(`unexpected mutation ${targetName}`);
    });
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:run",
        phase: "collecting",
        status: "running",
      })),
      runMutation,
    };

    await expect(
      runHandler(ctx, { runId: "publisherAbuseScoreRuns:run", batchSize: 100, maxPages: 1 }),
    ).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 0,
      isDone: false,
    });

    const runMutationCalls = runMutation.mock.calls as unknown[][];
    expect(String(runMutationCalls[0]?.[0])).toContain("collectPublisherAbuseScoresPageInternal");
    expect(String(runMutationCalls[1]?.[0])).toContain(
      "recordPublisherAbuseScoreRunTransientErrorInternal",
    );
    expect(runMutationCalls[1]?.[1]).toEqual({
      runId: "publisherAbuseScoreRuns:run",
      errorMessage: "Your request couldn't be completed. Try again later.",
      retryAttempt: 1,
      retryDelayMs: 30_000,
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(30_000, expect.any(Symbol), {
      runId: "publisherAbuseScoreRuns:run",
      batchSize: 100,
      maxPages: 1,
      trigger: "cron",
      retryAttempt: 1,
    });
  });

  it("records and retries transient score run state-load failures", async () => {
    const transientError = new Error("Your request couldn't be completed. Try again later.");
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async (target: symbol, _args?: unknown) => {
      const targetName = String(target);
      if (targetName.includes("recordPublisherAbuseScoreRunTransientErrorInternal")) {
        return { ok: true, recorded: true };
      }
      if (targetName.includes("markPublisherAbuseScoreRunFailedInternal")) {
        throw new Error("transient state-load failure should not mark the run failed");
      }
      throw new Error(`unexpected mutation ${targetName}`);
    });
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => {
        throw transientError;
      }),
      runMutation,
    };

    await expect(
      runHandler(ctx, { runId: "publisherAbuseScoreRuns:run", batchSize: 100, maxPages: 1 }),
    ).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 0,
      isDone: false,
    });

    const runQueryCalls = ctx.runQuery.mock.calls as unknown[][];
    expect(String(runQueryCalls[0]?.[0])).toContain("getPublisherAbuseScoreRunStateInternal");
    expect(String(runMutation.mock.calls[0]?.[0])).toContain(
      "recordPublisherAbuseScoreRunTransientErrorInternal",
    );
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      runId: "publisherAbuseScoreRuns:run",
      errorMessage: "Your request couldn't be completed. Try again later.",
      retryAttempt: 1,
      retryDelayMs: 30_000,
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(30_000, expect.any(Symbol), {
      runId: "publisherAbuseScoreRuns:run",
      batchSize: 100,
      maxPages: 1,
      trigger: "cron",
      retryAttempt: 1,
    });
  });

  it("does not retry transient score run failures when telemetry finds an inactive run", async () => {
    const transientError = new Error("Your request couldn't be completed. Try again later.");
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async (target: symbol, _args?: unknown) => {
      const targetName = String(target);
      if (targetName.includes("collectPublisherAbuseScoresPageInternal")) {
        throw transientError;
      }
      if (targetName.includes("recordPublisherAbuseScoreRunTransientErrorInternal")) {
        return { ok: true, recorded: false };
      }
      if (targetName.includes("markPublisherAbuseScoreRunFailedInternal")) {
        throw new Error("inactive transient retry should not mark the run failed");
      }
      throw new Error(`unexpected mutation ${targetName}`);
    });
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:run",
        phase: "collecting",
        status: "running",
      })),
      runMutation,
    };

    await expect(
      runHandler(ctx, { runId: "publisherAbuseScoreRuns:run", batchSize: 100, maxPages: 1 }),
    ).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 0,
      isDone: true,
    });

    expect(String(runMutation.mock.calls[0]?.[0])).toContain(
      "collectPublisherAbuseScoresPageInternal",
    );
    expect(String(runMutation.mock.calls[1]?.[0])).toContain(
      "recordPublisherAbuseScoreRunTransientErrorInternal",
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("marks transient score run failures failed after the retry budget is exhausted", async () => {
    const transientError = new Error("changed while this mutation was being run");
    const scheduler = { runAfter: vi.fn(async () => null) };
    const runMutation = vi.fn(async (target: symbol, _args?: unknown) => {
      const targetName = String(target);
      if (targetName.includes("collectPublisherAbuseScoresPageInternal")) {
        throw transientError;
      }
      if (targetName.includes("markPublisherAbuseScoreRunFailedInternal")) {
        return {
          runId: "publisherAbuseScoreRuns:run",
          phase: "collecting",
          status: "failed",
        };
      }
      if (targetName.includes("recordPublisherAbuseScoreRunTransientErrorInternal")) {
        throw new Error("exhausted transient retry should not be recorded for retry");
      }
      throw new Error(`unexpected mutation ${targetName}`);
    });
    const ctx = {
      scheduler,
      runQuery: vi.fn(async () => ({
        runId: "publisherAbuseScoreRuns:run",
        phase: "collecting",
        status: "running",
      })),
      runMutation,
    };

    await expect(
      runHandler(ctx, {
        runId: "publisherAbuseScoreRuns:run",
        batchSize: 100,
        maxPages: 1,
        retryAttempt: 5,
      }),
    ).rejects.toThrow("changed while this mutation was being run");

    const runMutationCalls = runMutation.mock.calls as unknown[][];
    expect(String(runMutationCalls[0]?.[0])).toContain("collectPublisherAbuseScoresPageInternal");
    expect(String(runMutationCalls[1]?.[0])).toContain("markPublisherAbuseScoreRunFailedInternal");
    expect(runMutationCalls[1]?.[1]).toEqual({
      runId: "publisherAbuseScoreRuns:run",
      errorMessage: "changed while this mutation was being run",
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
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
    expect(indexBuilder.eq).toHaveBeenCalledWith("modelVersion", "publisher-abuse-pressure.v4");
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

    expect(indexBuilder.eq).toHaveBeenCalledWith("modelVersion", "publisher-abuse-pressure.v4");
    expect(indexBuilder.eq).toHaveBeenCalledWith("status", "running");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns",
      expect.objectContaining({
        modelVersion: "publisher-abuse-pressure.v4",
        status: "running",
        phase: "collecting",
      }),
    );
  });

  it("benchmarks review candidates against every scanned active skill", async () => {
    const candidate = temporalCandidate("skills:anysearch", {
      slug: "anysearch",
      displayName: "AnySearch",
    });
    candidate.temporalScore.spike = false;
    candidate.temporalScore.sustained = false;
    candidate.temporalScore.recent30Downloads = 6_400;
    candidate.temporalScore.recent30Installs = 4;
    candidate.temporalScore.spikeMultiplier = 1;
    candidate.temporalScore.excess7Downloads = 0;
    candidate.temporalScore.sustainedWindowInstalls = 4;
    candidate.temporalScore.sustainedDailyDownloads = [
      ...Array.from({ length: 10 }, () => 640),
      0,
      0,
      0,
      0,
    ];
    candidate.temporalScore.reasonCodes = [];
    const ordinaryScore = {
      ...candidate.temporalScore,
      recent30Downloads: 100,
      recent30Installs: 1,
      spikeMultiplier: 1,
      excess7Downloads: 0,
      sustainedWindowInstalls: 1,
      sustainedDailyDownloads: Array.from({ length: 14 }, () => 0),
    };
    const ctx = {
      runQuery: vi.fn(async () => ({
        cursor: undefined,
        isDone: true,
        scannedSkills: 100,
        benchmarkScores: [
          ...Array.from({ length: 99 }, () => ({ ...ordinaryScore })),
          candidate.temporalScore,
        ],
        candidates: [candidate],
      })),
      runMutation: vi.fn(),
    };

    await expect(
      temporalRunHandler(ctx, {
        candidateLimit: 100,
        batchSize: 100,
        maxPages: 1,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      scannedSkills: 100,
      highTemporalSkills: 1,
      benchmark: {
        sampleSize: 100,
        downloads30dP95: 100,
        downloads30dP99: 100,
      },
      candidates: [
        expect.objectContaining({
          slug: "anysearch",
          temporalScore: expect.objectContaining({
            sustained: true,
            sustainedDaysAboveThreshold: 10,
          }),
        }),
      ],
    });
  });

  it("keeps temporal previews read-only", async () => {
    const candidate = temporalCandidate("skills:read-only-ratio", {
      slug: "read-only-ratio",
      displayName: "Read Only Ratio",
    });
    candidate.temporalScore.spike = false;
    candidate.temporalScore.nearConversion = true;
    candidate.temporalScore.recent7Downloads = 800;
    candidate.temporalScore.recent7Installs = 96;
    candidate.temporalScore.recent30Downloads = 2_400;
    candidate.temporalScore.recent30Installs = 288;
    candidate.temporalScore.installDownloadRatio7 = 0.12;
    candidate.temporalScore.installDownloadRatio30 = 0.12;
    candidate.temporalScore.installDownloadExcessZScore7 = 12;
    candidate.temporalScore.installDownloadExcessZScore30 = 12;
    candidate.temporalScore.reasonCodes = ["temporal_installs_track_downloads"];
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => null) },
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
        candidateLimit: 1,
        batchSize: 1,
        maxPages: 1,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      mode: "current",
      scannedSkills: 1,
      highTemporalSkills: 1,
      flaggedPublishers: 1,
      nominations: 0,
    });

    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not present percentile signals or a benchmark for partial dry runs", async () => {
    const candidate = temporalCandidate("skills:partial-spike", {
      slug: "partial-spike",
      displayName: "Partial Spike",
    });
    const ctx = {
      runQuery: vi.fn(async () => ({
        cursor: "next-page",
        isDone: false,
        scannedSkills: 1,
        benchmarkScores: [candidate.temporalScore],
        candidates: [candidate],
      })),
      runMutation: vi.fn(),
    };

    const result = await temporalRunHandler(ctx, {
      candidateLimit: 1,
      batchSize: 1,
      maxPages: 1,
      todayDay: 100,
    });

    expect(result).toMatchObject({
      scannedSkills: 1,
      highTemporalSkills: 0,
      candidates: [],
    });
    expect(result).not.toHaveProperty("benchmark");
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("keeps near-conversion-only public temporal candidates", async () => {
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
                        {
                          _id: "skills:hidden-traffic",
                          ownerPublisherId: publisher._id,
                          slug: "hidden-traffic",
                          displayName: "Hidden Traffic",
                          softDeletedAt: undefined,
                          moderationStatus: "hidden",
                          moderationFlags: [],
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
        batchSize: 2,
        todayDay: 100,
      }),
    ).resolves.toMatchObject({
      cursor: undefined,
      isDone: true,
      scannedSkills: 2,
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
    expect(ctx.db.query.mock.calls.filter(([table]) => table === "skillDailyStats")).toHaveLength(
      1,
    );
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
              withIndex: (_indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                callback(indexBuilder);
                return { take: async () => [] };
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
        batchSize: 1,
        todayDay: 100,
      }),
    ).resolves.toEqual({
      cursor: undefined,
      isDone: true,
      scannedSkills: 1,
      benchmarkScores: [expect.objectContaining({ recent30Downloads: 0 })],
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
                    expect(numItems).toBe(100);
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
          if (table === "skillDailyStats") {
            return {
              withIndex: (_indexName: string, callback: (q: typeof indexBuilder) => unknown) => {
                callback(indexBuilder);
                return { take: async () => [] };
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
        batchSize: 1,
        todayDay: 100,
      }),
    ).resolves.toEqual({
      cursor: undefined,
      isDone: true,
      scannedSkills: 1,
      benchmarkScores: [expect.objectContaining({ recent30Downloads: 0 })],
      candidates: [],
    });
  });

  it("archives surge, sustained-day, and high-ratio signals separately", async () => {
    const highRatio = temporalCandidate("skills:ratio", {
      slug: "ratio",
      displayName: "Ratio",
    });
    highRatio.temporalScore.spike = false;
    highRatio.temporalScore.nearConversion = true;
    highRatio.temporalScore.recent7Downloads = 800;
    highRatio.temporalScore.recent7Installs = 96;
    highRatio.temporalScore.recent30Downloads = 2_400;
    highRatio.temporalScore.recent30Installs = 288;
    highRatio.temporalScore.installDownloadRatio7 = 0.12;
    highRatio.temporalScore.installDownloadRatio30 = 0.12;
    highRatio.temporalScore.installDownloadExcessZScore7 = 12;
    highRatio.temporalScore.installDownloadExcessZScore30 = 12;
    highRatio.temporalScore.reasonCodes = ["temporal_installs_track_downloads"];

    const sustained = temporalCandidate("skills:sustained", {
      slug: "sustained",
      displayName: "Sustained",
    });
    sustained.temporalScore.spike = false;
    sustained.temporalScore.sustained = true;
    sustained.temporalScore.recent7Downloads = 1_000;
    sustained.temporalScore.recent30Downloads = 5_000;
    sustained.temporalScore.reasonCodes = ["temporal_sustained_abnormal_download_days"];

    const spikeOnly = temporalCandidate("skills:spike", {
      slug: "spike",
      displayName: "Spike",
    });
    const existingSignal = {
      _id: "publisherAbuseSignals:existing-ratio",
      signalType: "high_install_download_ratio",
      ownerKey: highRatio.ownerKey,
      ownerPublisherId: highRatio.ownerPublisherId,
      ownerUserId: highRatio.ownerUserId,
      handleSnapshot: highRatio.handleSnapshot,
      skillId: highRatio.skillId,
      skillSlug: highRatio.slug,
      skillDisplayName: highRatio.displayName,
      latestRunId: "publisherAbuseScoreRuns:old",
      firstSeenAt: 10,
      lastSeenAt: 20,
      seenCount: 5,
      recent7Downloads: 700,
      recent7Installs: 70,
      recent7InstallDownloadRatio: 0.1,
      recent30Downloads: 2_100,
      recent30Installs: 210,
      recent30InstallDownloadRatio: 0.1,
      allTimeDownloads: 10_000,
      allTimeInstalls: 1_000,
      allTimeInstallDownloadRatio: 0.1,
    };
    const signalLookups: Array<Record<string, unknown>> = [];
    const insertedSignals: unknown[] = [];
    const insert = vi.fn(async (table: string, value?: unknown) => {
      if (table === "publisherAbuseScoreRuns") return "publisherAbuseScoreRuns:temporal";
      if (table === "publisherAbuseSignals") {
        insertedSignals.push(value);
        return "publisherAbuseSignals:new";
      }
      if (table === "publisherAbuseScores") return "publisherAbuseScores:temporal";
      if (table === "publisherAbuseReviewNominations") {
        return "publisherAbuseReviewNominations:temporal";
      }
      if (table === "publisherAbuseReviewEvents") return "publisherAbuseReviewEvents:temporal";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async (_id: string, _value: Record<string, unknown>) => null);
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
          if (table === "publisherAbuseSignals") {
            return {
              withIndex: (
                indexName: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                expect(indexName).toBe("by_skill_signal_type_and_owner_key");
                const constraints: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    constraints[field] = value;
                    return q;
                  },
                };
                build(q);
                signalLookups.push(constraints);
                return {
                  first: async () =>
                    constraints.skillId === highRatio.skillId &&
                    constraints.signalType === "high_install_download_ratio" &&
                    constraints.ownerKey === highRatio.ownerKey
                      ? existingSignal
                      : null,
                };
              },
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: (indexName: string) => {
                if (indexName === "by_owner_key_and_model_version") {
                  return {
                    first: async () => null,
                    take: async () => [],
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
      archiveTemporalPublisherAbuseSignalsHandler(
        ctx as never,
        {
          runId: "publisherAbuseScoreRuns:temporal",
          candidates: [highRatio, sustained, spikeOnly],
          now: 1_234,
        } as never,
      ),
    ).resolves.toEqual({
      archivedCandidates: 3,
      archivedSignals: 3,
      changedSignals: 2,
    });

    expect(signalLookups).toEqual([
      {
        skillId: "skills:ratio",
        signalType: "high_install_download_ratio",
        ownerKey: highRatio.ownerKey,
      },
      {
        skillId: "skills:sustained",
        signalType: "sustained_abnormal_download_days",
        ownerKey: sustained.ownerKey,
      },
      {
        skillId: "skills:sustained",
        signalType: "sustained_downloads_flat_installs",
        ownerKey: sustained.ownerKey,
      },
      {
        skillId: "skills:spike",
        signalType: "download_spike_flat_installs",
        ownerKey: spikeOnly.ownerKey,
      },
    ]);
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseSignals:existing-ratio",
      expect.objectContaining({
        latestRunId: "publisherAbuseScoreRuns:temporal",
        recent7Downloads: 800,
        recent7Installs: 96,
        recent7InstallDownloadRatio: 0.12,
        lastSeenAt: 1_234,
        seenCount: 6,
      }),
    );
    expect(insertedSignals).toEqual([
      expect.objectContaining({
        signalType: "sustained_abnormal_download_days",
        skillId: "skills:sustained",
        skillSlug: "sustained",
        recent30Downloads: 5_000,
        firstSeenAt: 1_234,
        lastSeenAt: 1_234,
        seenCount: 1,
      }),
      expect.objectContaining({
        signalType: "download_spike_flat_installs",
        skillId: "skills:spike",
        skillSlug: "spike",
        spikeMultiplier: 20,
        firstSeenAt: 1_234,
        lastSeenAt: 1_234,
        seenCount: 1,
      }),
    ]);
    patch.mockClear();
    highRatio.totalDownloads = 10_500;
    highRatio.totalInstalls = 1_050;

    await expect(
      archiveTemporalPublisherAbuseSignalsHandler(
        ctx as never,
        {
          runId: "publisherAbuseScoreRuns:temporal",
          candidates: [highRatio],
          now: 2_345,
        } as never,
      ),
    ).resolves.toEqual({
      archivedCandidates: 1,
      archivedSignals: 1,
      changedSignals: 0,
    });
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseSignals:existing-ratio",
      expect.objectContaining({
        allTimeDownloads: 10_500,
        allTimeInstalls: 1_050,
        lastSeenAt: 2_345,
      }),
    );
  });

  it("reuses an earlier sustained signal row when the signal type is upgraded", async () => {
    const candidate = temporalCandidate("skills:earlier", {
      slug: "earlier",
      displayName: "Earlier",
    });
    candidate.temporalScore.spike = false;
    candidate.temporalScore.sustained = true;
    const legacySignal = {
      _id: "publisherAbuseSignals:earlier",
      signalType: "sustained_downloads_flat_installs",
      ownerKey: candidate.ownerKey,
      ownerPublisherId: candidate.ownerPublisherId,
      ownerUserId: candidate.ownerUserId,
      handleSnapshot: candidate.handleSnapshot,
      skillId: candidate.skillId,
      skillSlug: candidate.slug,
      skillDisplayName: candidate.displayName,
      firstSeenAt: 10,
      lastSeenAt: 20,
      seenCount: 2,
      recent7Downloads: 1_000,
      recent7Installs: 0,
      recent7InstallDownloadRatio: 0,
      recent30Downloads: 5_000,
      recent30Installs: 0,
      recent30InstallDownloadRatio: 0,
      allTimeDownloads: candidate.totalDownloads,
      allTimeInstalls: candidate.totalInstalls,
      allTimeInstallDownloadRatio: 0,
    };
    const patch = vi.fn(async (_id: string, _value: Record<string, unknown>) => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (
            _indexName: string,
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
            return {
              first: async () =>
                constraints.signalType === "sustained_downloads_flat_installs"
                  ? legacySignal
                  : null,
            };
          },
        })),
        insert: vi.fn(async () => {
          throw new Error("legacy sustained signals must be reused");
        }),
        patch,
      },
      scheduler,
    };

    await expect(
      archiveTemporalPublisherAbuseSignalsHandler(
        ctx as never,
        {
          runId: "publisherAbuseScoreRuns:temporal",
          candidates: [candidate],
          now: 1_234,
        } as never,
      ),
    ).resolves.toEqual({
      archivedCandidates: 1,
      archivedSignals: 1,
      changedSignals: 0,
    });
    expect(patch).toHaveBeenCalledWith(
      legacySignal._id,
      expect.objectContaining({
        signalType: "sustained_abnormal_download_days",
      }),
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
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
      expected7Downloads: 23.333333333333336,
      excess7Downloads: 1_976.6666666666667,
      recent30Downloads: 2_000,
      recent30Installs: 0,
      downloadInstallRatio30: 2_000,
      installDownloadRatio7: 0,
      installDownloadRatio30: 0,
      installDownloadExcessZScore7: 0,
      installDownloadExcessZScore30: 0,
      sustainedDaysAboveThreshold: 0,
      sustainedWindowDays: 14,
      sustainedDailyDownloadThreshold: 0,
      sustainedExpectedDailyDownloads: 0,
      sustainedWindowDownloads: 0,
      sustainedWindowInstalls: 0,
      sustainedDailyDownloads: [] as number[],
      spikeWindowStartDay: 94,
      spikeWindowEndDay: 100,
      reasonCodes: ["temporal_download_spike_flat_installs"],
    },
  };
}
