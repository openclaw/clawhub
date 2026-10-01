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
    expect(result).toEqual({ ok: true, count: 0, scheduled: true, days: 1 });
  });

  it("aggregates recent installs and downloads into a weighted top list", async () => {
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (Array.isArray(args.packageIds)) return args.packageIds;
      return {
        page: [
          { packageId: "packages:one", kind: "install" },
          { packageId: "packages:one", kind: "install" },
          { packageId: "packages:one", kind: "download" },
          ...Array.from({ length: 8 }, () => ({ packageId: "packages:two", kind: "download" })),
        ],
        isDone: true,
        continueCursor: "",
      };
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
