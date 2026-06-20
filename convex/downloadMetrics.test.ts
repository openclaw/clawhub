/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __test,
  pruneDownloadMetricDedupesInternal,
  recordDownloadMetricInternal,
} from "./downloadMetrics";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const recordDownloadMetricHandler = (
  recordDownloadMetricInternal as unknown as WrappedHandler<
    {
      target: { kind: "skill"; id: string } | { kind: "package"; id: string };
      identityKind: "user" | "ip";
      identityHash: string;
      dayStart: number;
      occurredAt?: number;
    },
    void
  >
)._handler;

const pruneDownloadMetricDedupesHandler = (
  pruneDownloadMetricDedupesInternal as unknown as WrappedHandler<
    Record<string, never>,
    { deleted: number; hasMore: boolean }
  >
)._handler;

function makeQueryBuilder() {
  const builder = {
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
  };
  return builder;
}

type QueryBuilder = ReturnType<typeof makeQueryBuilder>;

function makeDb(
  existingByTable: Record<string, unknown> = {},
  rowsByTable: Record<string, Array<{ _id: string }>> = {},
) {
  const indexCalls: Array<{ table: string; indexName: string; builder: QueryBuilder }> = [];
  const insert = vi.fn();
  const unique = vi.fn(async function uniqueForTable(this: { table: string }) {
    return existingByTable[this.table] ?? null;
  });
  const take = vi.fn(async function takeForTable(this: { table: string }, limit: number) {
    return (rowsByTable[this.table] ?? []).slice(0, limit);
  });
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
      const builder = makeQueryBuilder();
      buildQuery(builder);
      indexCalls.push({ table, indexName, builder });
      return {
        unique: unique.bind({ table }),
        take: take.bind({ table }),
      };
    }),
  }));
  const delete_ = vi.fn();
  return {
    db: {
      query,
      get: vi.fn(),
      insert,
      patch: vi.fn(),
      replace: vi.fn(),
      delete: delete_,
      normalizeId: vi.fn(),
      system: {
        get: vi.fn(),
        query: vi.fn(),
      },
    },
    insert,
    delete_,
    take,
    indexCalls,
  };
}

describe("download metric helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a day bucket for download dedupe", () => {
    expect(__test.getDayStart(86_400_000 - 1)).toBe(0);
    expect(__test.getDayStart(86_400_000)).toBe(86_400_000);
  });

  it("prefers user identity and falls back to IP identity", () => {
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });

    expect(__test.getDownloadIdentity(request, "users:one")).toEqual({
      identityKind: "user",
      identityValue: "users:one",
    });
    expect(__test.getDownloadIdentity(request, null)).toEqual({
      identityKind: "ip",
      identityValue: "203.0.113.10",
    });
  });

  it("does not create a metering identity when user and IP are missing", () => {
    expect(__test.getDownloadIdentity(new Request("https://example.com"), null)).toBeNull();
  });

  it("records one authenticated skill download and emits the existing skill stat event", async () => {
    const { db, insert, indexCalls } = makeDb();

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "skill", id: "skills:one" },
        identityKind: "user",
        identityHash: "hash-user",
        dayStart: 86_400_000,
        occurredAt: 86_500_000,
      },
    );

    expect(indexCalls[0]?.table).toBe("downloadMetricDedupes");
    expect(indexCalls[0]?.indexName).toBe("by_target_identity_day");
    expect(indexCalls[0]?.builder.eq).toHaveBeenCalledWith("targetKind", "skill");
    expect(indexCalls[0]?.builder.eq).toHaveBeenCalledWith("targetId", "skills:one");
    expect(indexCalls[0]?.builder.eq).toHaveBeenCalledWith("identityKind", "user");
    expect(indexCalls[0]?.builder.eq).toHaveBeenCalledWith("identityHash", "hash-user");
    expect(indexCalls[0]?.builder.eq).toHaveBeenCalledWith("dayStart", 86_400_000);
    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDedupes",
      expect.objectContaining({
        targetKind: "skill",
        targetId: "skills:one",
        identityKind: "user",
        identityHash: "hash-user",
        dayStart: 86_400_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:one",
        kind: "download",
        occurredAt: 86_500_000,
      }),
    );
    expect(insert).not.toHaveBeenCalledWith("packageStatEvents", expect.anything());
  });

  it("records one anonymous package download and emits the existing package stat event", async () => {
    const { db, insert } = makeDb();

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "package", id: "packages:one" },
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
        occurredAt: 86_500_000,
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDedupes",
      expect.objectContaining({
        targetKind: "package",
        targetId: "packages:one",
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "download",
        occurredAt: 86_500_000,
      }),
    );
    expect(insert).not.toHaveBeenCalledWith("skillStatEvents", expect.anything());
  });

  it("ignores duplicate identities in the same target/day bucket", async () => {
    const { db, insert } = makeDb({
      downloadMetricDedupes: { _id: "downloadMetricDedupes:existing" },
    });

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "skill", id: "skills:one" },
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
      },
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it("prunes stale dedupe rows by day bucket", async () => {
    vi.setSystemTime(30 * 86_400_000);
    const { db, delete_, take, indexCalls } = makeDb(
      {},
      {
        downloadMetricDedupes: [
          { _id: "downloadMetricDedupes:one" },
          { _id: "downloadMetricDedupes:two" },
        ],
      },
    );

    const result = await pruneDownloadMetricDedupesHandler({ db }, {});

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(indexCalls[0]?.table).toBe("downloadMetricDedupes");
    expect(indexCalls[0]?.indexName).toBe("by_day");
    expect(take).toHaveBeenCalledWith(500);
    expect(delete_).toHaveBeenCalledWith("downloadMetricDedupes:one");
    expect(delete_).toHaveBeenCalledWith("downloadMetricDedupes:two");
  });

  it("prunes stale package install metric dedupe rows after download rows", async () => {
    vi.setSystemTime(30 * 86_400_000);
    const { db, delete_, indexCalls } = makeDb(
      {},
      {
        packageInstallMetricDedupes: [
          { _id: "packageInstallMetricDedupes:one" },
          { _id: "packageInstallMetricDedupes:two" },
        ],
      },
    );

    const result = await pruneDownloadMetricDedupesHandler({ db }, {});

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(indexCalls.map((call) => call.table)).toEqual([
      "downloadMetricDedupes",
      "packageInstallMetricDedupes",
    ]);
    expect(indexCalls[1]?.indexName).toBe("by_day");
    expect(delete_).toHaveBeenCalledWith("packageInstallMetricDedupes:one");
    expect(delete_).toHaveBeenCalledWith("packageInstallMetricDedupes:two");
  });

  it("reschedules stale dedupe pruning when one bounded batch fills", async () => {
    vi.setSystemTime(30 * 86_400_000);
    const rows = Array.from({ length: 500 }, (_, index) => ({
      _id: `downloadMetricDedupes:${index}`,
    }));
    const { db, delete_ } = makeDb({}, { downloadMetricDedupes: rows });
    const runAfter = vi.fn();

    const result = await pruneDownloadMetricDedupesHandler({ db, scheduler: { runAfter } }, {});

    expect(result).toEqual({ deleted: 500, hasMore: true });
    expect(delete_).toHaveBeenCalledTimes(500);
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {});
  });
});
