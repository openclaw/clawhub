/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { consumeRateLimitInternal, getRateLimitStatusInternal } from "./rateLimits";

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

describe("rate limit sharding", () => {
  it("sums all shards when checking status", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () =>
              table === "rateLimits" ? [{ count: 3 }] : [{ count: 4 }, { count: 5 }],
            ),
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
    expect(result.remaining).toBe(8);
  });

  it("writes only the selected shard when consuming", async () => {
    const insert = vi.fn();
    const withIndex = vi.fn((_index, builder) => {
      builder({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(),
          })),
        })),
      });
      return { unique: vi.fn(async () => null) };
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
      "rateLimitShards",
      expect.objectContaining({
        key: "ip:test",
        shard: 7,
        count: 1,
      }),
    );
  });
});
