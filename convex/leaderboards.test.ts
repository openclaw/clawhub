/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  rebuildTrendingLeaderboardAction,
  rebuildTrendingLeaderboardInternal,
} from "./leaderboards";

const mutationHandler = (
  rebuildTrendingLeaderboardInternal as unknown as {
    _handler: (ctx: unknown, args: { limit?: number }) => Promise<unknown>;
  }
)._handler;
const actionHandler = (
  rebuildTrendingLeaderboardAction as unknown as {
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

    const result = await mutationHandler(ctx, { limit: 500 });

    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0]?.[0]).toBe(0);
    expect(runAfter.mock.calls[0]?.[2]).toEqual({ limit: 200 });
    expect(result).toEqual({ ok: true, count: 0, scheduled: true });
  });

  it("rebuild action pages daily stats instead of collecting a whole day", async () => {
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (Array.isArray(args.entries)) return args.entries;
      return {
        rows: [
          {
            skillId: "skills:one",
            installs: 1,
            downloads: 2,
          },
        ],
        isDone: true,
        continueCursor: "",
      };
    });
    const runMutation = vi.fn(async () => ({ ok: true }));

    const result = await actionHandler(
      {
        runQuery,
        runMutation,
      },
      { limit: 5 },
    );

    expect(result).toEqual({ ok: true, count: 1 });
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: null, limit: 1000 }),
    );
    expect(runMutation).toHaveBeenCalledTimes(2);
  });
});
