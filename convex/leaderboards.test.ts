/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { rebuildTrendingLeaderboardInternal } from "./leaderboards";

const handler = (
  rebuildTrendingLeaderboardInternal as unknown as {
    _handler: (ctx: unknown, args: { limit?: number }) => Promise<unknown>;
  }
)._handler;

describe("leaderboards.rebuildTrendingLeaderboardInternal", () => {
  it("schedules the action-based rebuild instead of reading daily stats inline", async () => {
    const runAfter = vi.fn().mockResolvedValue("job-1");
    const ctx = {
      db: {
        get: vi.fn(),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
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
    } as never;

    const result = await handler(ctx, { limit: 500 });

    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0]?.[0]).toBe(0);
    expect(runAfter.mock.calls[0]?.[2]).toEqual({ limit: 200 });
    expect(result).toEqual({ ok: true, count: 0, scheduled: true });
  });
});
