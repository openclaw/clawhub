/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  consumeHttpRateLimitKeyInternal,
  pruneHttpRateLimitKeysInternal,
  touchHttpRateLimitKeyInternal,
} from "./rateLimits";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const touchHttpKeyHandler = (
  touchHttpRateLimitKeyInternal as unknown as WrappedHandler<
    { name: string; key: string; shard?: number; now?: number; ttlMs?: number },
    { action: "inserted" | "retained" | "updated"; expiresAt: number; shard: number }
  >
)._handler;
const consumeHttpKeyHandler = (
  consumeHttpRateLimitKeyInternal as unknown as WrappedHandler<
    {
      name: string;
      key: string;
      config: {
        kind: "fixed window";
        rate: number;
        period: number;
        start?: number;
        shards?: number;
      };
    },
    { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
  >
)._handler;
const pruneHttpKeyHandler = (
  pruneHttpRateLimitKeysInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { deleted: number; hasMore: boolean }
  >
)._handler;

function makeDb(overrides: { query: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }) {
  return {
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    replace: vi.fn(),
    delete: overrides.delete,
    query: overrides.query,
    normalizeId: vi.fn(() => null),
    system: {
      get: vi.fn(),
      query: vi.fn(),
    },
  };
}

describe("component HTTP rate limit key metadata", () => {
  it("consumes a component bucket without coupling retention metadata writes", async () => {
    const runMutation = vi.fn(async () => ({ ok: true }));
    const ctx = {
      runMutation,
      db: makeDb({
        query: vi.fn(),
        delete: vi.fn(),
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await consumeHttpKeyHandler(ctx, {
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      config: { kind: "fixed window", rate: 1200, period: 60_000, start: 0, shards: 16 },
    });

    expect(result).toEqual({ ok: true });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      config: { kind: "fixed window", rate: 1200, period: 60_000, start: 0, shards: 16 },
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("inserts sharded metadata for a newly observed component key", async () => {
    const take = vi.fn(async () => []);
    const eqShard = vi.fn();
    const eqKey = vi.fn(() => ({ eq: eqShard }));
    const eqName = vi.fn(() => ({ eq: eqKey }));
    const withIndex = vi.fn((_index, builder) => {
      builder({ eq: eqName });
      return { take };
    });
    const insert = vi.fn();
    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({ withIndex })),
        delete: vi.fn(),
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };
    ctx.db.insert = insert;

    const result = await touchHttpKeyHandler(ctx, {
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      shard: 3,
      now: 10_000,
      ttlMs: 60_000,
    });

    expect(result).toEqual({ action: "inserted", expiresAt: 70_000, shard: 3 });
    expect(ctx.db.query).toHaveBeenCalledWith("httpRateLimitKeys");
    expect(withIndex).toHaveBeenCalledWith("by_name_and_key_and_shard", expect.any(Function));
    expect(eqName).toHaveBeenCalledWith("name", "downloadIp");
    expect(eqKey).toHaveBeenCalledWith("key", "ip:203.0.113.1:download");
    expect(eqShard).toHaveBeenCalledWith("shard", 3);
    expect(insert).toHaveBeenCalledWith("httpRateLimitKeys", {
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      shard: 3,
      lastTouchedAt: 10_000,
      expiresAt: 70_000,
    });
  });

  it("refreshes metadata for an existing component key shard", async () => {
    const existing = {
      _id: "httpRateLimitKeys:1",
      name: "readKey",
      key: "user:users_123:read",
      shard: 11,
      lastTouchedAt: 1_000,
      expiresAt: 49_000,
    };
    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take: vi.fn(async () => [existing]) })),
        })),
        delete: vi.fn(),
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await touchHttpKeyHandler(ctx, {
      name: "readKey",
      key: "user:users_123:read",
      shard: 11,
      now: 20_000,
      ttlMs: 60_000,
    });

    expect(result).toEqual({ action: "updated", expiresAt: 80_000, shard: 11 });
    expect(ctx.db.patch).toHaveBeenCalledWith("httpRateLimitKeys:1", {
      lastTouchedAt: 20_000,
      expiresAt: 80_000,
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("retains fresh metadata without another write", async () => {
    const existing = {
      _id: "httpRateLimitKeys:1",
      name: "readKey",
      key: "user:users_123:read",
      shard: 11,
      lastTouchedAt: 10_000,
      expiresAt: 70_000,
    };
    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take: vi.fn(async () => [existing]) })),
        })),
        delete: vi.fn(),
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await touchHttpKeyHandler(ctx, {
      name: "readKey",
      key: "user:users_123:read",
      shard: 11,
      now: 20_000,
      ttlMs: 60_000,
    });

    expect(result).toEqual({ action: "retained", expiresAt: 70_000, shard: 11 });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.delete).not.toHaveBeenCalled();
  });

  it("repairs duplicate metadata rows while refreshing a component key shard", async () => {
    const existing = {
      _id: "httpRateLimitKeys:1",
      name: "readKey",
      key: "user:users_123:read",
      shard: 11,
      lastTouchedAt: 1_000,
      expiresAt: 61_000,
    };
    const duplicate = {
      ...existing,
      _id: "httpRateLimitKeys:2",
    };
    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take: vi.fn(async () => [existing, duplicate]) })),
        })),
        delete: vi.fn(),
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await touchHttpKeyHandler(ctx, {
      name: "readKey",
      key: "user:users_123:read",
      shard: 11,
      now: 20_000,
      ttlMs: 60_000,
    });

    expect(result).toEqual({ action: "updated", expiresAt: 80_000, shard: 11 });
    expect(ctx.db.patch).toHaveBeenCalledWith("httpRateLimitKeys:1", {
      lastTouchedAt: 20_000,
      expiresAt: 80_000,
    });
    expect(ctx.db.delete).toHaveBeenCalledWith("httpRateLimitKeys:2");
  });

  it("keeps component buckets when another shard is still active", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const stale = {
      _id: "httpRateLimitKeys:a",
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      shard: 2,
      expiresAt: 900_000,
    };
    const active = {
      _id: "httpRateLimitKeys:b",
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      shard: 9,
      expiresAt: 1_050_000,
    };
    const staleTake = vi.fn(async () => [stale]);
    const activeTake = vi.fn(async () => [active]);
    const withIndex = vi
      .fn()
      .mockImplementationOnce((_index, builder) => {
        builder({ lt: vi.fn() });
        return { take: staleTake };
      })
      .mockImplementationOnce((_index, builder) => {
        builder({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ gte: vi.fn() })) })) });
        return { take: activeTake };
      });
    const runMutation = vi.fn();
    const deleteRow = vi.fn();
    const ctx = {
      runMutation,
      db: makeDb({
        query: vi.fn(() => ({ withIndex })),
        delete: deleteRow,
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await pruneHttpKeyHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ deleted: 1, hasMore: false });
    expect(withIndex).toHaveBeenNthCalledWith(1, "by_expires_at", expect.any(Function));
    expect(withIndex).toHaveBeenNthCalledWith(
      2,
      "by_name_and_key_and_expires_at",
      expect.any(Function),
    );
    expect(activeTake).toHaveBeenCalledWith(1);
    expect(runMutation).not.toHaveBeenCalled();
    expect(deleteRow).toHaveBeenCalledWith("httpRateLimitKeys:a");
  });

  it("resets component buckets once before deleting fully expired key metadata", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const stale = [
      {
        _id: "httpRateLimitKeys:a",
        name: "downloadIp",
        key: "ip:203.0.113.1:download",
        shard: 2,
        expiresAt: 900_000,
      },
      {
        _id: "httpRateLimitKeys:b",
        name: "downloadIp",
        key: "ip:203.0.113.1:download",
        shard: 9,
        expiresAt: 910_000,
      },
    ];
    const staleTake = vi.fn(async () => stale);
    const activeTake = vi.fn(async () => []);
    const expiredTake = vi.fn(async () => stale);
    const withIndex = vi
      .fn()
      .mockImplementationOnce((_index, builder) => {
        builder({ lt: vi.fn() });
        return { take: staleTake };
      })
      .mockImplementationOnce((_index, builder) => {
        builder({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ gte: vi.fn() })) })) });
        return { take: activeTake };
      })
      .mockImplementationOnce((_index, builder) => {
        builder({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn() })) })) });
        return { take: expiredTake };
      });
    const runMutation = vi.fn();
    const deleteRow = vi.fn();
    const ctx = {
      runMutation,
      db: makeDb({
        query: vi.fn(() => ({ withIndex })),
        delete: deleteRow,
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await pruneHttpKeyHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(staleTake).toHaveBeenCalledWith(10);
    expect(activeTake).toHaveBeenCalledWith(1);
    expect(expiredTake).toHaveBeenCalledWith(128);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
    });
    expect(deleteRow).toHaveBeenCalledWith("httpRateLimitKeys:a");
    expect(deleteRow).toHaveBeenCalledWith("httpRateLimitKeys:b");
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("resets independent expired component keys before deleting metadata rows", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const first = {
      _id: "httpRateLimitKeys:a",
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      shard: 2,
      expiresAt: 900_000,
    };
    const second = {
      _id: "httpRateLimitKeys:b",
      name: "writeKey",
      key: "user:users_123:write",
      shard: 4,
      expiresAt: 910_000,
    };
    const staleTake = vi.fn(async () => [first, second]);
    const withIndex = vi.fn((_index, builder) => {
      builder({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ gte: vi.fn(), lt: vi.fn() })) })),
        lt: vi.fn(),
      });
      return { take };
    });
    const take = vi
      .fn()
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([second]);
    const runMutation = vi.fn();
    const deleteRow = vi.fn();
    const ctx = {
      runMutation,
      db: makeDb({
        query: vi.fn(() => ({ withIndex })),
        delete: deleteRow,
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await pruneHttpKeyHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(ctx.db.query).toHaveBeenCalledWith("httpRateLimitKeys");
    expect(withIndex).toHaveBeenCalledWith("by_expires_at", expect.any(Function));
    expect(staleTake).not.toHaveBeenCalled();
    expect(take).toHaveBeenCalledWith(10);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
    });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      name: "writeKey",
      key: "user:users_123:write",
    });
    expect(deleteRow).toHaveBeenCalledWith("httpRateLimitKeys:a");
    expect(deleteRow).toHaveBeenCalledWith("httpRateLimitKeys:b");
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("continues pruning expired component keys when a full bounded batch is deleted", async () => {
    const stale = Array.from({ length: 3 }, (_, index) => ({
      _id: `httpRateLimitKeys:${index}`,
      name: "downloadIp",
      key: `ip:203.0.113.${index}:download`,
      expiresAt: 900_000 + index,
    }));
    const ctx = {
      runMutation: vi.fn(),
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take: vi.fn(async () => stale) })),
        })),
        delete: vi.fn(),
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await pruneHttpKeyHandler(ctx, { batchSize: 3 });

    expect(result).toEqual({ deleted: 3, hasMore: true });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({ batchSize: 3 }),
    );
  });
});
