/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_TREND_DAYS, getActivityTrendRange } from "./lib/downloadTrend";
import {
  computeRecommendationScore,
  RECOMMENDATION_SCORE_VERSION,
} from "./lib/recommendationScore";
import {
  getActivityTrendForName,
  processPackageStatEventsInternal,
  recordPackageDownloadInternal,
  recordPackageInstallInternal,
} from "./packages";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");

const packageDailyStatsRolloutAtEnv = "PACKAGE_DAILY_STATS_ROLLOUT_AT";
const originalPackageDailyStatsRolloutAt = process.env[packageDailyStatsRolloutAtEnv];

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
      installs: {
        range: "daily";
        days: number;
        total: number;
        points: Array<{ day: number; value: number }>;
      };
    } | null
  >
)._handler;

function setPackageDailyStatsRolloutAt(value: string | undefined) {
  if (value === undefined) {
    delete process.env[packageDailyStatsRolloutAtEnv];
    return;
  }
  process.env[packageDailyStatsRolloutAtEnv] = value;
}

describe("package stat events", () => {
  afterEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    setPackageDailyStatsRolloutAt(originalPackageDailyStatsRolloutAt);
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

    expect(result).toEqual({ processed: 3, packagesUpdated: 2 });
    expect(insert).toHaveBeenCalledWith(
      "packageDailyStats",
      expect.objectContaining({
        packageId: "packages:one",
        day: 1,
        downloads: 1,
        installs: 1,
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
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 11 }),
        recommendedScore: computeRecommendationScore({
          downloads: 11,
          installs: 2,
          stars: 2,
        }),
        recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ installs: 2 }),
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

  it("builds package activity from 30 daily package stat rows", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { startDay, endDay } = getActivityTrendRange(now);
    setPackageDailyStatsRolloutAt("2026-06-18T00:00:00.000Z");
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
      expect(trend?.installs.range).toBe("daily");
      expect(trend?.installs.days).toBe(ACTIVITY_TREND_DAYS);
      expect(trend?.installs.total).toBe(4);
      expect(trend?.installs.points.find((point) => point.day === endDay - 1)).toEqual({
        day: endDay - 1,
        value: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null for unseeded historical package trends", async () => {
    const now = Date.UTC(2026, 5, 20) + 1;
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

      const { endDay } = getActivityTrendRange(now);
      const trend = await getActivityTrendHandler(ctx, { name: "demo-plugin", endDay });

      expect(takeDailyStats).toHaveBeenCalledWith(ACTIVITY_TREND_DAYS);
      expect(trend).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null until the actual package daily rollout window is complete", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { endDay } = getActivityTrendRange(now);
    setPackageDailyStatsRolloutAt("2026-07-10T00:00:00.000Z");
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
      const takeDailyStats = vi.fn(async () => [{ day: endDay, downloads: 1, installs: 1 }]);
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
      expect(trend).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps future package trend windows before checking rollout completeness", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { endDay: serverEndDay } = getActivityTrendRange(now);
    const { endDay: futureEndDay } = getActivityTrendRange(Date.UTC(2026, 8, 20) + 1);
    setPackageDailyStatsRolloutAt("2026-08-10T00:00:00.000Z");
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
          return { take: vi.fn(async () => [{ day: futureEndDay, downloads: 1, installs: 1 }]) };
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
      expect(trend).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns private package trends when the owner is signed in", async () => {
    const now = Date.UTC(2026, 6, 18) + 1;
    const { endDay } = getActivityTrendRange(now);
    setPackageDailyStatsRolloutAt("2026-06-18T00:00:00.000Z");
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
      expect(trend?.installs.total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
