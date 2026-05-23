/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    publisherAbuse: {
      collectPublisherAbuseScoresPageInternal: Symbol("collectPublisherAbuseScoresPageInternal"),
      finalizePublisherAbuseScoresPageInternal: Symbol("finalizePublisherAbuseScoresPageInternal"),
      getOrStartPublisherAbuseScoreRunInternal: Symbol("getOrStartPublisherAbuseScoreRunInternal"),
      getPublisherAbuseScoreRunStateInternal: Symbol("getPublisherAbuseScoreRunStateInternal"),
      markPublisherAbuseScoreRunFailedInternal: Symbol("markPublisherAbuseScoreRunFailedInternal"),
      runPublisherAbuseScoreRunInternal: Symbol("runPublisherAbuseScoreRunInternal"),
    },
  },
}));

vi.mock("./lib/access", () => ({
  assertAdmin: vi.fn((user: { role?: string }) => {
    if (user.role !== "admin") throw new Error("Forbidden");
  }),
  requireUser: vi.fn(async () => ({
    userId: "users:admin",
    user: { _id: "users:admin", role: "admin" },
  })),
}));

const publisherAbuse = await import("./publisherAbuse");

const TEST_MODEL_CONFIG = {
  modelVersion: "publisher-abuse-pressure.v1",
  skillPivot: 100,
  installsPerSkillPivot: 2,
  starsPerSkillPivot: 0.05,
  downloadsPerSkillPivot: 250,
  outputElasticity: 1,
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
    { runId?: string; batchSize?: number; maxPages?: number; trigger?: "cron" | "manual" },
    { ok: true; runId: string; pages: number; isDone: boolean }
  >
)._handler;

const listQueueHandler = (
  publisherAbuse.listPublisherAbuseReviewQueue as unknown as Wrapped<
    {
      label?: "all" | "pass" | "review" | "potential_ban_candidate";
      status?:
        | "unreviewed"
        | "reviewed"
        | "all"
        | "pending"
        | "reviewed_no_action"
        | "false_positive"
        | "needs_policy_discussion"
        | "candidate_for_future_action";
      minSkillCount?: number;
      search?: string;
      limit?: number;
    },
    {
      items: Array<{
        nomination: {
          _id: string;
          label: "pass" | "review" | "potential_ban_candidate";
          handleSnapshot: string;
        };
        score: { publishedSkills: number } | null;
      }>;
      total: number;
    }
  >
)._handler;

const startManualHandler = (
  publisherAbuse.startManualPublisherAbuseScoreRun as unknown as Wrapped<
    { batchSize?: number; maxPages?: number },
    { ok: true; runId: string }
  >
)._handler;

describe("publisher abuse dry-run persistence", () => {
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
                  async *[Symbol.asyncIterator]() {
                    yield {
                      _id: "skills:one",
                      ownerPublisherId: "publishers:not-backfilled",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 7,
                      statsStars: 1,
                      statsDownloads: 70,
                      stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 7 },
                    };
                    yield {
                      _id: "skills:two",
                      ownerPublisherId: "publishers:not-backfilled",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 11,
                      statsStars: 2,
                      statsDownloads: 110,
                      stats: { downloads: 110, stars: 2, installsCurrent: 1, installsAllTime: 11 },
                    };
                  },
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

  it("treats a missing package count as unknown when skill-only engagement is missing", async () => {
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
                  async *[Symbol.asyncIterator]() {
                    yield {
                      _id: "skills:one",
                      ownerPublisherId: "publishers:package-count-missing",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 7,
                      statsStars: 1,
                      statsDownloads: 70,
                      stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 7 },
                    };
                    yield {
                      _id: "skills:two",
                      ownerPublisherId: "publishers:package-count-missing",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 11,
                      statsStars: 2,
                      statsDownloads: 110,
                      stats: { downloads: 110, stars: 2, installsCurrent: 1, installsAllTime: 11 },
                    };
                  },
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
                  async *[Symbol.asyncIterator]() {
                    yield {
                      _id: "skills:first",
                      ownerPublisherId: "publishers:legacy-stats",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 3,
                      statsStars: 1,
                      statsDownloads: 30,
                      stats: { downloads: 30, stars: 1, installsCurrent: 1, installsAllTime: 3 },
                    };
                    yield {
                      _id: "skills:second",
                      ownerPublisherId: "publishers:legacy-stats",
                      softDeletedAt: undefined,
                      statsInstallsAllTime: 5,
                      statsStars: 2,
                      statsDownloads: 50,
                      stats: { downloads: 50, stars: 2, installsCurrent: 1, installsAllTime: 5 },
                    };
                  },
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
          modelVersion: "publisher-abuse-pressure.v1",
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
                        modelVersion: "publisher-abuse-pressure.v1",
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

  it("reopens a reviewed nomination when a later score is actionable again", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v1",
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
                        modelVersion: "publisher-abuse-pressure.v1",
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
                  status: "false_positive",
                  reviewedByUserId: "users:admin",
                  reviewedAt: 100,
                }),
              }),
            };
          }
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

  it("refreshes an existing nomination when a later score passes", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v1",
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
                        modelVersion: "publisher-abuse-pressure.v1",
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

  it("keeps the requested label when listing all queue statuses", async () => {
    const reviewNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:review",
      latestScoreId: "publisherAbuseScores:review",
      label: "review",
      status: "pending",
      handleSnapshot: "review-publisher",
      lastScoredAt: 300,
    });
    const candidateNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:candidate",
      latestScoreId: "publisherAbuseScores:candidate",
      label: "potential_ban_candidate",
      status: "pending",
      handleSnapshot: "candidate-publisher",
      lastScoredAt: 400,
    });
    const ctx = queueCtx([reviewNomination, candidateNomination]);

    const result = await listQueueHandler(ctx, {
      status: "all",
      label: "review",
      limit: 10,
    });

    expect(result.items.map((item) => item.nomination.label)).toEqual(["review"]);
    expect(result.items.map((item) => item.nomination.handleSnapshot)).toEqual([
      "review-publisher",
    ]);
  });

  it("does not include pass nominations in the all-label review queue", async () => {
    const reviewNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:review",
      latestScoreId: "publisherAbuseScores:review",
      label: "review",
      status: "pending",
      handleSnapshot: "review-publisher",
      lastScoredAt: 300,
    });
    const passNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:pass",
      latestScoreId: "publisherAbuseScores:pass",
      label: "pass",
      status: "pending",
      handleSnapshot: "passing-publisher",
      lastScoredAt: 400,
    });
    const ctx = queueCtx([passNomination, reviewNomination]);

    const result = await listQueueHandler(ctx, {
      status: "all",
      label: "all",
      limit: 1,
    });

    expect(result.items.map((item) => item.nomination.handleSnapshot)).toEqual([
      "review-publisher",
    ]);
  });

  it("applies search when a minimum skill count is also set", async () => {
    const matchingNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:match",
      latestScoreId: "publisherAbuseScores:match",
      label: "review",
      status: "pending",
      handleSnapshot: "needle-maker",
      lastScoredAt: 300,
    });
    const nonMatchingNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:miss",
      latestScoreId: "publisherAbuseScores:miss",
      label: "review",
      status: "pending",
      handleSnapshot: "large-catalog",
      lastScoredAt: 400,
    });
    const ctx = queueCtx([nonMatchingNomination, matchingNomination], {
      "publisherAbuseScores:match": { publishedSkills: 20 },
      "publisherAbuseScores:miss": { publishedSkills: 100 },
    });

    const result = await listQueueHandler(ctx, {
      status: "all",
      label: "all",
      minSkillCount: 10,
      search: "needle",
      limit: 10,
    });

    expect(result.items.map((item) => item.nomination.handleSnapshot)).toEqual(["needle-maker"]);
    expect(result.total).toBe(1);
  });

  it("keeps scanning queue candidates until filtered matches are found", async () => {
    const recentLowSkillNominations = Array.from({ length: 40 }, (_, index) =>
      nominationFixture({
        _id: `publisherAbuseReviewNominations:small-${index}`,
        latestScoreId: `publisherAbuseScores:small-${index}`,
        label: "review",
        status: "pending",
        handleSnapshot: `small-catalog-${index}`,
        lastScoredAt: 1_000 - index,
      }),
    );
    const olderEligibleNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:older-eligible",
      latestScoreId: "publisherAbuseScores:older-eligible",
      label: "review",
      status: "pending",
      handleSnapshot: "older-eligible-catalog",
      lastScoredAt: 500,
    });
    const lowSkillScores = Object.fromEntries(
      recentLowSkillNominations.map((nomination) => [
        nomination.latestScoreId,
        { publishedSkills: 1 },
      ]),
    );
    const ctx = queueCtx([...recentLowSkillNominations, olderEligibleNomination], {
      ...lowSkillScores,
      [olderEligibleNomination.latestScoreId]: { publishedSkills: 20 },
    });

    const result = await listQueueHandler(ctx, {
      status: "all",
      label: "all",
      minSkillCount: 10,
      limit: 10,
    });

    expect(result.items.map((item) => item.nomination.handleSnapshot)).toEqual([
      "older-eligible-catalog",
    ]);
    expect(result.total).toBe(1);
  });

  it("counts queue totals after applying the minimum skill count", async () => {
    const smallNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:small",
      latestScoreId: "publisherAbuseScores:small",
      label: "review",
      status: "pending",
      handleSnapshot: "small-catalog",
      lastScoredAt: 400,
    });
    const largeNomination = nominationFixture({
      _id: "publisherAbuseReviewNominations:large",
      latestScoreId: "publisherAbuseScores:large",
      label: "review",
      status: "pending",
      handleSnapshot: "large-catalog",
      lastScoredAt: 300,
    });
    const ctx = queueCtx([smallNomination, largeNomination], {
      "publisherAbuseScores:small": { publishedSkills: 5 },
      "publisherAbuseScores:large": { publishedSkills: 20 },
    });

    const result = await listQueueHandler(ctx, {
      status: "all",
      label: "all",
      minSkillCount: 10,
      limit: 10,
    });

    expect(result.items.map((item) => item.nomination.handleSnapshot)).toEqual(["large-catalog"]);
    expect(result.total).toBe(1);
  });

  it("lets an admin start a manual dry-run recompute", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      db: {
        insert: vi.fn(async () => "publisherAbuseScoreRuns:manual"),
      },
    };

    await expect(startManualHandler(ctx, { batchSize: 50, maxPages: 2 })).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:manual",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns",
      expect.objectContaining({ trigger: "manual", actorUserId: "users:admin" }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({ runId: "publisherAbuseScoreRuns:manual" }),
    );
  });
});

type QueueNominationFixture = {
  _id: string;
  latestScoreId: string;
  label: "pass" | "review" | "potential_ban_candidate";
  status:
    | "pending"
    | "reviewed_no_action"
    | "false_positive"
    | "needs_policy_discussion"
    | "candidate_for_future_action";
  handleSnapshot: string;
  ownerKey: string;
  lastScoredAt: number;
};

type QueueIndexBuilder = {
  eq: (field: string, value: string) => QueueIndexBuilder;
};

function nominationFixture(
  overrides: Omit<QueueNominationFixture, "ownerKey"> & { ownerKey?: string },
): QueueNominationFixture {
  return {
    ownerKey: `publisher:${overrides.handleSnapshot}`,
    ...overrides,
  };
}

function queueCtx(
  nominations: QueueNominationFixture[],
  scores: Record<string, { publishedSkills: number }> = {},
) {
  const defaultScores: Record<string, { publishedSkills: number }> = {};
  for (const nomination of nominations) {
    defaultScores[nomination.latestScoreId] = { publishedSkills: 25 };
  }
  const scoreById = { ...defaultScores, ...scores };
  return {
    db: {
      get: vi.fn(async (id: string) => scoreById[id] ?? null),
      query: vi.fn((table: string) => {
        if (table === "publisherAbuseScoreRuns") {
          return {
            withIndex: () => ({
              order: () => ({
                first: async () => null,
              }),
            }),
          };
        }
        if (table !== "publisherAbuseReviewNominations") {
          throw new Error(`unexpected table ${table}`);
        }
        return {
          withIndex: (indexName: string, buildQuery?: (q: QueueIndexBuilder) => unknown) => {
            const constraints: Record<string, string> = {};
            const q: QueueIndexBuilder = {
              eq: (field: string, value: string) => {
                constraints[field] = value;
                return q;
              },
            };
            buildQuery?.(q);
            return {
              order: () => ({
                take: async (limit: number) => {
                  if (indexName === "by_last_scored_at") {
                    return sortQueueNominations(nominations).slice(0, limit);
                  }
                  if (indexName === "by_status_and_last_scored_at") {
                    return sortQueueNominations(
                      nominations.filter((nomination) => nomination.status === constraints.status),
                    ).slice(0, limit);
                  }
                  if (indexName === "by_status_and_label_and_last_scored_at") {
                    return sortQueueNominations(
                      nominations.filter(
                        (nomination) =>
                          nomination.status === constraints.status &&
                          nomination.label === constraints.label,
                      ),
                    ).slice(0, limit);
                  }
                  throw new Error(`unexpected index ${indexName}`);
                },
              }),
            };
          },
        };
      }),
    },
  };
}

function sortQueueNominations(nominations: QueueNominationFixture[]) {
  return [...nominations].sort((left, right) => right.lastScoredAt - left.lastScoredAt);
}
