/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  consumeRateLimitInternal,
  getRateLimitStatusInternal,
  pruneRateLimitCountersInternal,
} from "./rateLimits";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getStatusHandler = (
  getRateLimitStatusInternal as unknown as WrappedHandler<
    { key: string; limit: number; windowMs: number },
    { allowed: boolean; remaining: number; limit: number; resetAt: number }
  >
)._handler;

const consumeHandler = (
  consumeRateLimitInternal as unknown as WrappedHandler<
    { key: string; limit: number; windowMs: number; shard?: number },
    { allowed: boolean; remaining: number }
  >
)._handler;

const pruneHandler = (
  pruneRateLimitCountersInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { deleted: number; hasMore: boolean }
  >
)._handler;

describe("rate limit sharding", () => {
  it("sums active counter rows without reading legacy rate limit tables", async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => [{ count: 4 }, { count: 5 }]),
          })),
        })),
      },
    };

    const result = await getStatusHandler(ctx, {
      key: "ip:test",
      limit: 20,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(11);
    expect(ctx.db.query).toHaveBeenCalledTimes(1);
    expect(ctx.db.query).toHaveBeenCalledWith("rateLimitCounters");
    expect(ctx.db.query).not.toHaveBeenCalledWith("rateLimits");
  });

  it("writes only the selected active counter shard when consuming", async () => {
    const insert = vi.fn();
    const withIndex = vi.fn((_index, builder) => {
      builder({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(),
          })),
        })),
      });
      return { first: vi.fn(async () => null) };
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

    await consumeHandler(ctx, {
      key: "ip:test",
      limit: 20,
      windowMs: 60_000,
      shard: 7,
    });

    expect(withIndex).toHaveBeenCalledWith("by_key_window_shard", expect.any(Function));
    expect(insert).toHaveBeenCalledWith(
      "rateLimitCounters",
      expect.objectContaining({
        key: "ip:test",
        shard: 7,
        count: 1,
        expiresAt: expect.any(Number),
      }),
    );
  });

  it("clamps out-of-range shard inputs to the active counter shard range", async () => {
    const insert = vi.fn();
    const withIndex = vi.fn((_index, builder) => {
      builder({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(),
          })),
        })),
      });
      return { first: vi.fn(async () => null) };
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

    await consumeHandler(ctx, {
      key: "ip:test",
      limit: 20,
      windowMs: 60_000,
      shard: 999,
    });

    expect(insert).toHaveBeenCalledWith(
      "rateLimitCounters",
      expect.objectContaining({
        shard: 15,
      }),
    );
  });

  it("prunes only expired active counter rows in bounded batches", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const stale = [
      { _id: "rateLimitCounters:a", expiresAt: 930_000 },
      { _id: "rateLimitCounters:b", expiresAt: 940_000 },
    ];
    const take = vi.fn(async () => stale);
    const withIndex = vi.fn((_index, builder) => {
      builder({ lt: vi.fn() });
      return { take };
    });
    const deleteRow = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex })),
        get: vi.fn(),
        normalizeId: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: deleteRow,
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await pruneHandler(ctx, { batchSize: 10 });

    expect(ctx.db.query).toHaveBeenCalledWith("rateLimitCounters");
    expect(withIndex).toHaveBeenCalledWith("by_expires_at", expect.any(Function));
    expect(take).toHaveBeenCalledWith(10);
    expect(deleteRow).toHaveBeenCalledTimes(2);
    expect(deleteRow).toHaveBeenCalledWith("rateLimitCounters:a");
    expect(deleteRow).toHaveBeenCalledWith("rateLimitCounters:b");
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 2, hasMore: false });
  });
});
