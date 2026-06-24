/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { pruneRateLimitCountersInternal } from "./rateLimits";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const pruneHandler = (
  pruneRateLimitCountersInternal as unknown as WrappedHandler<
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

describe("legacy rate limit counter pruning", () => {
  it("deletes stale legacy counter rows by expiresAt", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const deleteRow = vi.fn();
    const take = vi.fn(async () => [
      { _id: "rateLimitCounters:a", expiresAt: 930_000 },
      { _id: "rateLimitCounters:b", expiresAt: 940_000 },
    ]);
    const withIndex = vi.fn((_index, builder) => {
      builder({ lt: vi.fn() });
      return { take };
    });
    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({ withIndex })),
        delete: deleteRow,
      }),
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await pruneHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(ctx.db.query).toHaveBeenCalledWith("rateLimitCounters");
    expect(withIndex).toHaveBeenCalledWith("by_expires_at", expect.any(Function));
    expect(take).toHaveBeenCalledWith(10);
    expect(deleteRow).toHaveBeenCalledWith("rateLimitCounters:a");
    expect(deleteRow).toHaveBeenCalledWith("rateLimitCounters:b");
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("continues pruning when a full bounded batch is deleted", async () => {
    const stale = Array.from({ length: 3 }, (_, index) => ({
      _id: `rateLimitCounters:${index}`,
      expiresAt: 900_000 + index,
    }));
    const ctx = {
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

    const result = await pruneHandler(ctx, { batchSize: 3 });

    expect(result).toEqual({ deleted: 3, hasMore: true });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({ batchSize: 3 }),
    );
  });
});
