/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  rebuildTrendingLeaderboardAction,
  rebuildTrendingLeaderboardInternal,
} from "./packageLeaderboards";

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

describe("packageLeaderboards", () => {
  it("schedules a bounded leaderboard rebuild", async () => {
    const runAfter = vi.fn().mockResolvedValue("job-1");
    const result = await mutationHandler(
      {
        db: {
          get: vi.fn(),
          insert: vi.fn(),
          normalizeId: vi.fn(),
          patch: vi.fn(),
          query: vi.fn(),
          replace: vi.fn(),
          system: { get: vi.fn(), query: vi.fn() },
          delete: vi.fn(),
        },
        scheduler: { runAfter },
      },
      { limit: 500 },
    );

    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), { limit: 200 });
    expect(result).toEqual({ ok: true, count: 0, scheduled: true, days: 7 });
  });

  it("aggregates recent installs and downloads into a weighted top list", async () => {
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.day === Math.floor(Date.now() / 86_400_000)) {
        return {
          rows: [
            { packageId: "packages:one", installs: 2, downloads: 1 },
            { packageId: "packages:two", installs: 0, downloads: 8 },
          ],
          isDone: true,
          continueCursor: "",
        };
      }
      return { rows: [], isDone: true, continueCursor: "" };
    });
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await actionHandler({ runQuery, runMutation }, { limit: 5 });

    expect(result).toEqual({ ok: true, count: 2 });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [
          expect.objectContaining({ packageId: "packages:two", score: 8 }),
          expect.objectContaining({ packageId: "packages:one", score: 7 }),
        ],
      }),
    );
  });
});
