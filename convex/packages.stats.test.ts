/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_TREND_DAYS, getActivityTrendRange } from "./lib/downloadTrend";
import {
  computeRecommendationScore,
  RECOMMENDATION_SCORE_VERSION,
} from "./lib/recommendationScore";
import {
  getActivityTrendForName,
  pruneProcessedPackageStatEventBatchInternal,
  processPackageStatEventsInternal,
  recordPackageDownloadInternal,
  recordPackageInstallInternal,
} from "./packages";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const recordDownloadHandler = (
  recordPackageDownloadInternal as unknown as WrappedHandler<{ packageId: string }, void>
)._handler;

const recordInstallHandler = (
  recordPackageInstallInternal as unknown as WrappedHandler<
    {
      packageId: string;
      identityKind?: "user" | "ip";
      identityHash?: string;
      dayStart?: number;
      occurredAt?: number;
    },
    void
  >
)._handler;

const processStatsHandler = (
  processPackageStatEventsInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { processed: number; packagesUpdated: number }
  >
)._handler;

const pruneProcessedPackageStatEventBatchHandler = (
  pruneProcessedPackageStatEventBatchInternal as unknown as WrappedHandler<
    {
      cutoffProcessedAt: number;
      dryRun: boolean;
      batchSize?: number;
      confirmationToken?: string;
    },
    { matched: number; deleted: number; hasMore: boolean }
  >
)._handler;

const getActivityTrendHandler = (
  getActivityTrendForName as unknown as WrappedHandler<
    { name: string; endDay: number },
    {
      downloads: {
        range: "daily";
        days: number;
        total: number;
        points: Array<{ day: number; value: number }>;
      };
    } | null
  >
)._handler;

describe("package stat events", () => {
  afterEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("records downloads as append-only events", async () => {
    const insert = vi.fn();

    await recordDownloadHandler(
      {
        db: {
          query: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      },
      {
        packageId: "packages:one",
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "download",
        processedAt: undefined,
      }),
    );
  });

  it("records installs as append-only events", async () => {
    const insert = vi.fn();

    await recordInstallHandler(
      {
        db: {
          query: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      },
      {
        packageId: "packages:one",
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "install",
        processedAt: undefined,
      }),
    );
  });

  it("dedupes identity-backed installs before appending stat events", async () => {
    const insert = vi.fn();
    const unique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: "packageInstallMetricDedupes:existing",
    });
    const queryBuilder = {
      eq: vi.fn(() => queryBuilder),
    };
    const withIndex = vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
      buildQuery(queryBuilder);
      return { unique };
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex })),
        get: vi.fn(),
        normalizeId: vi.fn(),
        insert,
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
    };
    const args = {
      packageId: "packages:one",
      identityKind: "ip" as const,
      identityHash: "hash-ip",
      dayStart: 86_400_000,
      occurredAt: 86_500_000,
    };

    await recordInstallHandler(ctx, args);
    await recordInstallHandler(ctx, args);

    expect(withIndex).toHaveBeenCalledWith("by_target_metric_identity_day", expect.any(Function));
    expect(queryBuilder.eq).toHaveBeenCalledWith("targetKind", "package");
    expect(queryBuilder.eq).toHaveBeenCalledWith("targetId", "packages:one");
    expect(queryBuilder.eq).toHaveBeenCalledWith("metricKind", "install");
    expect(queryBuilder.eq).toHaveBeenCalledWith("identityKind", "ip");
    expect(queryBuilder.eq).toHaveBeenCalledWith("identityHash", "hash-ip");
    expect(queryBuilder.eq).toHaveBeenCalledWith("dayStart", 86_400_000);
    expect(insert).toHaveBeenCalledWith(
      "packageInstallMetricDedupes",
      expect.objectContaining({
        targetKind: "package",
        targetId: "packages:one",
        metricKind: "install",
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "install",
        occurredAt: 86_500_000,
      }),
    );
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("aggregates queued downloads and installs before patching package stats", async () => {
    const dayStart = 86_400_000;
    const events = [
      {
        _id: "packageStatEvents:1",
        packageId: "packages:one",
        kind: "download",
        occurredAt: dayStart,
      },
      {
        _id: "packageStatEvents:2",
        packageId: "packages:one",
        kind: "install",
        occurredAt: dayStart,
      },
      {
        _id: "packageStatEvents:3",
        packageId: "packages:two",
        kind: "download",
        occurredAt: dayStart,
      },
      {
        _id: "packageStatEvents:4",
        packageId: "packages:one",
        kind: "download",
        occurredAt: dayStart * 2,
      },
      {
        _id: "packageStatEvents:5",
        packageId: "packages:one",
        kind: "install_clear",
        occurredAt: dayStart,
      },
    ];
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((tableName: string) => {
          if (tableName === "packageStatEvents") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => events),
              })),
            };
          }
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn(async () => null),
            })),
          };
        }),
        get: vi.fn(async (id: string) => ({
          _id: id,
          stats: { downloads: 10, installs: 1, stars: 2, versions: 3 },
        })),
        normalizeId: vi.fn(),
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await processStatsHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ processed: 5, packagesUpdated: 2 });
    expect(insert).toHaveBeenCalledWith(
      "packageDailyStats",
      expect.objectContaining({
        packageId: "packages:one",
        day: 1,
        downloads: 1,
        installs: 0,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packageDailyStats",
      expect.objectContaining({
        packageId: "packages:two",
        day: 1,
        downloads: 1,
        installs: 0,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packageDailyStats",
      expect.objectContaining({
        packageId: "packages:one",
        day: 2,
        downloads: 1,
        installs: 0,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 12 }),
        recommendedScore: computeRecommendationScore({
          downloads: 12,
          installs: 1,
          stars: 2,
        }),
        recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ installs: 1 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:two",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 11 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packageStatEvents:1",
      expect.objectContaining({ processedAt: expect.any(Number) }),
    );
  });

  it("updates an existing package daily stat row for another batch on the same day", async () => {
    const dayStart = 86_400_000;
    const events = [
      {
        _id: "packageStatEvents:1",
        packageId: "packages:one",
        kind: "download",
        occurredAt: dayStart,
      },
      {
        _id: "packageStatEvents:2",
        packageId: "packages:one",
        kind: "install",
        occurredAt: dayStart,
      },
    ];
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((tableName: string) => {
          if (tableName === "packageStatEvents") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => events),
              })),
            };
          }
          if (tableName === "packageDailyStats") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "packageDailyStats:existing",
                  downloads: 4,
                  installs: 2,
                })),
              })),
            };
          }
          throw new Error(`Unexpected query table ${tableName}`);
        }),
        get: vi.fn(async (id: string) => ({
          _id: id,
          stats: { downloads: 10, installs: 1, stars: 2, versions: 3 },
        })),
        normalizeId: vi.fn(),
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await processStatsHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ processed: 2, packagesUpdated: 1 });
    expect(insert).not.toHaveBeenCalledWith("packageDailyStats", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "packageDailyStats:existing",
      expect.objectContaining({
        downloads: 5,
        installs: 3,
        updatedAt: expect.any(Number),
      }),
    );
  });

  it("caps package stat batches after adding daily stat writes", async () => {
    const events = Array.from({ length: 100 }, (_, index) => ({
      _id: `packageStatEvents:${index}`,
      packageId: `packages:${index}`,
      kind: "download",
      occurredAt: 86_400_000,
    }));
    const take = vi.fn(async () => events);
    const patch = vi.fn();
    const runAfter = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((tableName: string) => {
          if (tableName === "packageStatEvents") {
            return {
              withIndex: vi.fn(() => ({ take })),
            };
          }
          if (tableName === "packageDailyStats") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn(async () => null) })),
            };
          }
          throw new Error(`Unexpected query table ${tableName}`);
        }),
        get: vi.fn(async (id: string) => ({
          _id: id,
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        })),
        normalizeId: vi.fn(),
        insert: vi.fn(),
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter,
      },
    };

    const result = await processStatsHandler(ctx, { batchSize: 500 });

    expect(take).toHaveBeenCalledWith(100);
    expect(result).toEqual({ processed: 100, packagesUpdated: 100 });
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), { batchSize: 100 });
    expect(patch).toHaveBeenCalledTimes(200);
  });

  it("prunes processed package stat events older than the cutoff", async () => {
    const staleEvents = [
      { _id: "packageStatEvents:old-1", processedAt: 1_000 },
      { _id: "packageStatEvents:old-2", processedAt: 2_000 },
    ];
    const take = vi.fn(async () => staleEvents);
    const deleteDoc = vi.fn();
    const gt = vi.fn(() => ({ lt: vi.fn(() => "processed-range") }));
    const ctx = {
      db: {
        query: vi.fn((tableName: string) => {
          expect(tableName).toBe("packageStatEvents");
          return {
            withIndex: vi.fn((indexName: string, builder: (q: { gt: typeof gt }) => unknown) => {
              expect(indexName).toBe("by_unprocessed");
              expect(builder({ gt })).toBe("processed-range");
              return { take };
            }),
          };
        }),
        delete: deleteDoc,
        get: vi.fn(),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
    };

    const result = await pruneProcessedPackageStatEventBatchHandler(ctx, {
      cutoffProcessedAt: 3_000,
      dryRun: false,
      batchSize: 2,
      confirmationToken: "PRUNE_PROCESSED_PACKAGE_STAT_EVENTS",
    });

    expect(gt).toHaveBeenCalledWith("processedAt", 0);
    expect(take).toHaveBeenCalledWith(2);
    expect(deleteDoc).toHaveBeenCalledWith("packageStatEvents:old-1");
    expect(deleteDoc).toHaveBeenCalledWith("packageStatEvents:old-2");
    expect(result).toEqual({
      cutoffProcessedAt: 3_000,
      dryRun: false,
      matched: 2,
      deleted: 2,
      hasMore: true,
    });
  });

  it("builds package activity from 30 daily package stat rows", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { startDay, endDay } = getActivityTrendRange(now);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const packageIndexBuilder = { eq: vi.fn(() => packageIndexBuilder) };
      const dailyIndexBuilder = {
        eq: vi.fn(() => dailyIndexBuilder),
        gte: vi.fn(() => dailyIndexBuilder),
        lte: vi.fn(() => dailyIndexBuilder),
      };
      const packageWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof packageIndexBuilder) => unknown) => {
          buildQuery(packageIndexBuilder);
          return {
            unique: vi.fn(async () => ({
              _id: "packages:one",
              _creationTime: Date.UTC(2026, 5, 1),
              createdAt: Date.UTC(2026, 5, 1),
              normalizedName: "demo-plugin",
              channel: "public",
              scanStatus: "clean",
              stats: { downloads: 143, installs: 0, stars: 0, versions: 1 },
            })),
          };
        },
      );
      const takeDailyStats = vi.fn(async () => [
        { day: endDay - 1, downloads: 2, installs: 1 },
        { day: endDay, downloads: 1, installs: 3 },
      ]);
      const dailyWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof dailyIndexBuilder) => unknown) => {
          buildQuery(dailyIndexBuilder);
          return { take: takeDailyStats };
        },
      );
      const ctx = {
        db: {
          query: vi.fn((tableName: string) => {
            if (tableName === "packages") return { withIndex: packageWithIndex };
            if (tableName === "packageDailyStats") return { withIndex: dailyWithIndex };
            throw new Error(`Unexpected table ${tableName}`);
          }),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert: vi.fn(),
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      };

      const trend = await getActivityTrendHandler(ctx, { name: "demo-plugin", endDay });

      expect(packageWithIndex).toHaveBeenCalledWith("by_name", expect.any(Function));
      expect(packageIndexBuilder.eq).toHaveBeenCalledWith("normalizedName", "demo-plugin");
      expect(dailyWithIndex).toHaveBeenCalledWith("by_package_day", expect.any(Function));
      expect(dailyIndexBuilder.eq).toHaveBeenCalledWith("packageId", "packages:one");
      expect(dailyIndexBuilder.gte).toHaveBeenCalledWith("day", startDay);
      expect(dailyIndexBuilder.lte).toHaveBeenCalledWith("day", endDay);
      expect(takeDailyStats).toHaveBeenCalledWith(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.range).toBe("daily");
      expect(trend?.downloads.days).toBe(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.total).toBe(3);
      expect(trend?.downloads.points).toHaveLength(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.points[0]).toEqual({ day: startDay, value: 0 });
      expect(trend?.downloads.points.at(-1)).toEqual({ day: endDay, value: 1 });
      expect(trend?.downloads.points.find((point) => point.day === endDay - 1)).toEqual({
        day: endDay - 1,
        value: 2,
      });
      expect(trend && "installs" in trend).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a zero-filled trend for packages without daily rows", async () => {
    const now = Date.UTC(2026, 5, 20) + 1;
    const { startDay, endDay } = getActivityTrendRange(now);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const packageIndexBuilder = { eq: vi.fn(() => packageIndexBuilder) };
      const dailyIndexBuilder = {
        eq: vi.fn(() => dailyIndexBuilder),
        gte: vi.fn(() => dailyIndexBuilder),
        lte: vi.fn(() => dailyIndexBuilder),
      };
      const packageWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof packageIndexBuilder) => unknown) => {
          buildQuery(packageIndexBuilder);
          return {
            unique: vi.fn(async () => ({
              _id: "packages:one",
              _creationTime: Date.UTC(2026, 5, 1),
              createdAt: Date.UTC(2026, 5, 1),
              normalizedName: "demo-plugin",
              channel: "public",
              scanStatus: "clean",
              stats: { downloads: 143, installs: 12, stars: 0, versions: 1 },
            })),
          };
        },
      );
      const takeDailyStats = vi.fn(async () => []);
      const dailyWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof dailyIndexBuilder) => unknown) => {
          buildQuery(dailyIndexBuilder);
          return { take: takeDailyStats };
        },
      );
      const ctx = {
        db: {
          query: vi.fn((tableName: string) => {
            if (tableName === "packages") return { withIndex: packageWithIndex };
            if (tableName === "packageDailyStats") return { withIndex: dailyWithIndex };
            throw new Error(`Unexpected table ${tableName}`);
          }),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert: vi.fn(),
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      };

      const trend = await getActivityTrendHandler(ctx, { name: "demo-plugin", endDay });

      expect(takeDailyStats).toHaveBeenCalledWith(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.total).toBe(0);
      expect(trend?.downloads.points).toHaveLength(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.points[0]).toEqual({ day: startDay, value: 0 });
      expect(trend?.downloads.points.at(-1)).toEqual({ day: endDay, value: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds package activity from available daily rows", async () => {
    const now = Date.UTC(2026, 5, 20) + 1;
    const { startDay, endDay } = getActivityTrendRange(now);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const packageIndexBuilder = { eq: vi.fn(() => packageIndexBuilder) };
      const dailyIndexBuilder = {
        eq: vi.fn(() => dailyIndexBuilder),
        gte: vi.fn(() => dailyIndexBuilder),
        lte: vi.fn(() => dailyIndexBuilder),
      };
      const packageWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof packageIndexBuilder) => unknown) => {
          buildQuery(packageIndexBuilder);
          return {
            unique: vi.fn(async () => ({
              _id: "packages:one",
              _creationTime: Date.UTC(2026, 4, 1),
              createdAt: Date.UTC(2026, 4, 1),
              normalizedName: "demo-plugin",
              channel: "public",
              scanStatus: "clean",
              stats: { downloads: 143, installs: 12, stars: 0, versions: 1 },
            })),
          };
        },
      );
      const takeDailyStats = vi.fn(async () => [
        { day: endDay - 2, downloads: 41, installs: 3 },
        { day: endDay - 1, downloads: 52, installs: 4 },
        { day: endDay, downloads: 50, installs: 5 },
      ]);
      const dailyWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof dailyIndexBuilder) => unknown) => {
          buildQuery(dailyIndexBuilder);
          return { take: takeDailyStats };
        },
      );
      const ctx = {
        db: {
          query: vi.fn((tableName: string) => {
            if (tableName === "packages") return { withIndex: packageWithIndex };
            if (tableName === "packageDailyStats") return { withIndex: dailyWithIndex };
            throw new Error(`Unexpected table ${tableName}`);
          }),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert: vi.fn(),
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      };

      const trend = await getActivityTrendHandler(ctx, { name: "demo-plugin", endDay });

      expect(takeDailyStats).toHaveBeenCalledWith(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.total).toBe(143);
      expect(trend?.downloads.points).toHaveLength(ACTIVITY_TREND_DAYS);
      expect(trend?.downloads.points[0]).toEqual({ day: startDay, value: 0 });
      expect(trend?.downloads.points.at(-1)).toEqual({ day: endDay, value: 50 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps future package trend windows to the current day", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { endDay: serverEndDay } = getActivityTrendRange(now);
    const { endDay: futureEndDay } = getActivityTrendRange(Date.UTC(2026, 8, 20) + 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const packageIndexBuilder = { eq: vi.fn(() => packageIndexBuilder) };
      const dailyIndexBuilder = {
        eq: vi.fn(() => dailyIndexBuilder),
        gte: vi.fn(() => dailyIndexBuilder),
        lte: vi.fn(() => dailyIndexBuilder),
      };
      const packageWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof packageIndexBuilder) => unknown) => {
          buildQuery(packageIndexBuilder);
          return {
            unique: vi.fn(async () => ({
              _id: "packages:one",
              _creationTime: Date.UTC(2026, 5, 1),
              createdAt: Date.UTC(2026, 5, 1),
              normalizedName: "demo-plugin",
              channel: "public",
              scanStatus: "clean",
              stats: { downloads: 143, installs: 12, stars: 0, versions: 1 },
            })),
          };
        },
      );
      const dailyWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof dailyIndexBuilder) => unknown) => {
          buildQuery(dailyIndexBuilder);
          return { take: vi.fn(async () => [{ day: serverEndDay, downloads: 1, installs: 1 }]) };
        },
      );
      const ctx = {
        db: {
          query: vi.fn((tableName: string) => {
            if (tableName === "packages") return { withIndex: packageWithIndex };
            if (tableName === "packageDailyStats") return { withIndex: dailyWithIndex };
            throw new Error(`Unexpected table ${tableName}`);
          }),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert: vi.fn(),
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      };

      const trend = await getActivityTrendHandler(ctx, {
        name: "demo-plugin",
        endDay: futureEndDay,
      });

      expect(dailyIndexBuilder.lte).toHaveBeenCalledWith("day", serverEndDay);
      expect(trend?.downloads.points.at(-1)).toEqual({ day: serverEndDay, value: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns private package trends when the owner is signed in", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { endDay } = getActivityTrendRange(now);
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const packageIndexBuilder = { eq: vi.fn(() => packageIndexBuilder) };
      const dailyIndexBuilder = {
        eq: vi.fn(() => dailyIndexBuilder),
        gte: vi.fn(() => dailyIndexBuilder),
        lte: vi.fn(() => dailyIndexBuilder),
      };
      const packageWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof packageIndexBuilder) => unknown) => {
          buildQuery(packageIndexBuilder);
          return {
            unique: vi.fn(async () => ({
              _id: "packages:one",
              _creationTime: Date.UTC(2026, 5, 1),
              createdAt: Date.UTC(2026, 5, 1),
              ownerUserId: "users:owner",
              ownerPublisherId: undefined,
              normalizedName: "demo-plugin",
              channel: "private",
              scanStatus: "clean",
              stats: { downloads: 143, installs: 12, stars: 0, versions: 1 },
            })),
          };
        },
      );
      const takeDailyStats = vi.fn(async () => [{ day: endDay, downloads: 2, installs: 1 }]);
      const dailyWithIndex = vi.fn(
        (_indexName: string, buildQuery: (q: typeof dailyIndexBuilder) => unknown) => {
          buildQuery(dailyIndexBuilder);
          return { take: takeDailyStats };
        },
      );
      const get = vi.fn(async (id: string) => {
        if (id === "users:owner") {
          return { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined };
        }
        return null;
      });
      const ctx = {
        db: {
          query: vi.fn((tableName: string) => {
            if (tableName === "packages") return { withIndex: packageWithIndex };
            if (tableName === "packageDailyStats") return { withIndex: dailyWithIndex };
            throw new Error(`Unexpected table ${tableName}`);
          }),
          get,
          normalizeId: vi.fn(),
          insert: vi.fn(),
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      };

      const trend = await getActivityTrendHandler(ctx, { name: "demo-plugin", endDay });

      expect(getAuthUserId).toHaveBeenCalled();
      expect(get).toHaveBeenCalledWith("users:owner");
      expect(trend?.downloads.total).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
