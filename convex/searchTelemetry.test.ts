/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  mergeSearchStatRows,
  normalizePublicSearchQuery,
  pruneSearchQueryDailyDedupeInternal,
  recordSearchInternal,
} from "./searchTelemetry";

const recordSearchInternalHandler = (
  recordSearchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { query: string; bucketKey: string; occurredAt: number },
    ) => Promise<{ recorded: boolean }>;
  }
)._handler;

const pruneSearchQueryDailyDedupeInternalHandler = (
  pruneSearchQueryDailyDedupeInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { batchSize?: number },
    ) => Promise<{ deleted: number; dedupeDeleted: number; statsDeleted: number }>;
  }
)._handler;

describe("search telemetry", () => {
  it("normalizes public search queries into stable display terms", () => {
    expect(normalizePublicSearchQuery("  GitHub   Integration  ")).toEqual({
      normalizedQuery: "github integration",
      displayQuery: "github integration",
    });
  });

  it("rejects blank, noisy, and private-looking search queries", () => {
    expect(normalizePublicSearchQuery("ai")).toBeNull();
    expect(normalizePublicSearchQuery("alice@example.com")).toBeNull();
    expect(normalizePublicSearchQuery("https://example.com/search?q=secret")).toBeNull();
    expect(normalizePublicSearchQuery("customer-internal.example.com")).toBeNull();
    expect(normalizePublicSearchQuery("staging.company.io")).toBeNull();
    expect(normalizePublicSearchQuery("sk-abcdefghijklmnopqrstuvwxyz1234567890")).toBeNull();
    expect(normalizePublicSearchQuery("one two three four five six seven eight nine")).toBeNull();
  });

  it("merges aggregate search rows by query and ranks them by count and recency", () => {
    const results = mergeSearchStatRows([
      {
        normalizedQuery: "github integration",
        displayQuery: "github integration",
        count: 2,
        lastSearchedAt: 100,
      },
      {
        normalizedQuery: "dashboard builder",
        displayQuery: "dashboard builder",
        count: 3,
        lastSearchedAt: 90,
      },
      {
        normalizedQuery: "github integration",
        displayQuery: "github integration",
        count: 3,
        lastSearchedAt: 110,
      },
    ]);

    expect(results).toEqual([
      {
        normalizedQuery: "github integration",
        displayQuery: "github integration",
        count: 5,
        lastSearchedAt: 110,
      },
      {
        normalizedQuery: "dashboard builder",
        displayQuery: "dashboard builder",
        count: 3,
        lastSearchedAt: 90,
      },
    ]);
  });

  it("counts a client bucket only once per query per day", async () => {
    const ctx = makeRecordSearchCtx();

    await expect(
      recordSearchInternalHandler(ctx, {
        query: "dashboard builder",
        bucketKey: "bucket-a",
        occurredAt: 0,
      }),
    ).resolves.toEqual({ recorded: true });
    await expect(
      recordSearchInternalHandler(ctx, {
        query: "dashboard builder",
        bucketKey: "bucket-a",
        occurredAt: 1,
      }),
    ).resolves.toEqual({ recorded: false });
    await expect(
      recordSearchInternalHandler(ctx, {
        query: "dashboard builder",
        bucketKey: "bucket-b",
        occurredAt: 2,
      }),
    ).resolves.toEqual({ recorded: true });

    expect(ctx.stats).toEqual([
      expect.objectContaining({
        normalizedQuery: "dashboard builder",
        count: 2,
      }),
    ]);
    expect(ctx.dedupe).toHaveLength(2);
  });

  it("prunes expired search telemetry rows with day indexes", async () => {
    const ctx = makeRecordSearchCtx();
    const currentDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    ctx.dedupe.push(
      {
        _id: "dedupe:old",
        normalizedQuery: "old query",
        day: currentDay - 30,
        bucketKey: "bucket-old",
        createdAt: 0,
      },
      {
        _id: "dedupe:recent",
        normalizedQuery: "recent query",
        day: currentDay,
        bucketKey: "bucket-recent",
        createdAt: Date.now(),
      },
    );
    ctx.stats.push(
      {
        _id: "stats:old",
        normalizedQuery: "old query",
        displayQuery: "old query",
        day: currentDay - 30,
        count: 20,
        lastSearchedAt: 0,
        updatedAt: 0,
      },
      {
        _id: "stats:recent",
        normalizedQuery: "recent query",
        displayQuery: "recent query",
        day: currentDay,
        count: 1,
        lastSearchedAt: Date.now(),
        updatedAt: Date.now(),
      },
    );

    await expect(
      pruneSearchQueryDailyDedupeInternalHandler(ctx, { batchSize: 10 }),
    ).resolves.toEqual({ deleted: 2, dedupeDeleted: 1, statsDeleted: 1 });

    expect(ctx.dedupe.map((row) => row._id)).toEqual(["dedupe:recent"]);
    expect(ctx.stats.map((row) => row._id)).toEqual(["stats:recent"]);
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("schedules a continuation when telemetry pruning fills a batch", async () => {
    const ctx = makeRecordSearchCtx();
    const currentDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    ctx.dedupe.push(
      {
        _id: "dedupe:old-a",
        normalizedQuery: "old query",
        day: currentDay - 30,
        bucketKey: "bucket-old-a",
        createdAt: 0,
      },
      {
        _id: "dedupe:old-b",
        normalizedQuery: "old query",
        day: currentDay - 30,
        bucketKey: "bucket-old-b",
        createdAt: 0,
      },
    );

    await expect(
      pruneSearchQueryDailyDedupeInternalHandler(ctx, { batchSize: 1 }),
    ).resolves.toMatchObject({ deleted: 1, dedupeDeleted: 1 });

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), { batchSize: 1 });
  });
});

function makeRecordSearchCtx() {
  const stats: Array<{
    _id: string;
    normalizedQuery: string;
    displayQuery: string;
    day: number;
    count: number;
    lastSearchedAt: number;
    updatedAt: number;
  }> = [];
  const dedupe: Array<{
    _id: string;
    normalizedQuery: string;
    day: number;
    bucketKey: string;
    createdAt: number;
  }> = [];

  const ctx = {
    stats,
    dedupe,
    db: {
      get: async () => null,
      query(table: string) {
        return {
          withIndex(_indexName: string, collectValues: (q: QueryBuilder) => QueryBuilder) {
            const values = collectValues(makeQueryBuilder()).values;
            return {
              unique: async () => {
                if (table === "searchQueryDailyStats") {
                  return (
                    stats.find(
                      (row) => row.normalizedQuery === values[0] && row.day === values[1],
                    ) ?? null
                  );
                }
                if (table === "searchQueryDailyDedupe") {
                  return (
                    dedupe.find(
                      (row) =>
                        row.normalizedQuery === values[0] &&
                        row.day === values[1] &&
                        row.bucketKey === values[2],
                    ) ?? null
                  );
                }
                throw new Error(`Unexpected table: ${table}`);
              },
              take: async (limit: number) => {
                if (table === "searchQueryDailyDedupe") {
                  const cutoffDay = Number(values[0]);
                  return dedupe.filter((row) => row.day < cutoffDay).slice(0, limit);
                }
                if (table === "searchQueryDailyStats") {
                  const cutoffDay = Number(values[0]);
                  return stats.filter((row) => row.day < cutoffDay).slice(0, limit);
                }
                throw new Error(`Unexpected take table: ${table}`);
              },
            };
          },
        };
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        if (table === "searchQueryDailyStats") {
          stats.push({
            _id: `stats:${stats.length + 1}`,
            normalizedQuery: String(value.normalizedQuery),
            displayQuery: String(value.displayQuery),
            day: Number(value.day),
            count: Number(value.count),
            lastSearchedAt: Number(value.lastSearchedAt),
            updatedAt: Number(value.updatedAt),
          });
          return;
        }
        if (table === "searchQueryDailyDedupe") {
          dedupe.push({
            _id: `dedupe:${dedupe.length + 1}`,
            normalizedQuery: String(value.normalizedQuery),
            day: Number(value.day),
            bucketKey: String(value.bucketKey),
            createdAt: Number(value.createdAt),
          });
          return;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = stats.find((candidate) => candidate._id === id);
        if (!row) throw new Error(`Missing row: ${id}`);
        Object.assign(row, patch);
      },
      replace: async () => {
        throw new Error("replace should not be called");
      },
      delete: async (id: string) => {
        const dedupeIndex = dedupe.findIndex((row) => row._id === id);
        if (dedupeIndex >= 0) {
          dedupe.splice(dedupeIndex, 1);
          return;
        }
        const statsIndex = stats.findIndex((row) => row._id === id);
        if (statsIndex >= 0) {
          stats.splice(statsIndex, 1);
          return;
        }
        throw new Error(`Missing row: ${id}`);
      },
      normalizeId: () => null,
    },
    scheduler: {
      runAfter: vi.fn(),
    },
  };

  return ctx;
}

type QueryBuilder = {
  values: unknown[];
  eq: (field: string, value: unknown) => QueryBuilder;
  lt: (field: string, value: unknown) => QueryBuilder;
};

function makeQueryBuilder(): QueryBuilder {
  const builder: QueryBuilder = {
    values: [],
    eq: (_field, value) => {
      builder.values.push(value);
      return builder;
    },
    lt: (_field, value) => {
      builder.values.push(value);
      return builder;
    },
  };
  return builder;
}
