/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "../src/__tests__/helpers/convexDb";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";
import type { Id } from "./_generated/dataModel";
import {
  filterTopNonSuspiciousTrendingEntries,
  rebuildTrendingLeaderboardAction,
  rebuildTrendingLeaderboardInternal,
} from "./leaderboards";
import type { LeaderboardEntry } from "./lib/leaderboards";

const filterHandler = getTestHandler<
  { entries: LeaderboardEntry[]; limit: number },
  LeaderboardEntry[]
>(filterTopNonSuspiciousTrendingEntries);

const mutationHandler = getTestHandler<{ limit?: number }>(rebuildTrendingLeaderboardInternal);
const actionHandler = getTestHandler<{ limit?: number }>(rebuildTrendingLeaderboardAction);

describe("leaderboards.rebuildTrendingLeaderboardInternal", () => {
  it("schedules the action-based rebuild instead of reading daily stats inline", async () => {
    const runAfter = vi.fn().mockResolvedValue("job-1");
    const ctx = {
      db: {
        ...createMockDb(),
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

describe("leaderboards.filterTopNonSuspiciousTrendingEntries", () => {
  it("keeps scanning past suspicious entries until it finds enough clean skills", async () => {
    const skillId = (value: string) => value as Id<"skills">;
    const entries: LeaderboardEntry[] = [
      { skillId: skillId("skills:suspicious-1"), score: 300, installs: 300, downloads: 10 },
      { skillId: skillId("skills:suspicious-2"), score: 200, installs: 200, downloads: 9 },
      { skillId: skillId("skills:clean"), score: 100, installs: 100, downloads: 8 },
    ];

    const ctx = {
      db: {
        get: vi.fn(async (id: Id<"skills">) => {
          if (id === skillId("skills:clean")) {
            return {
              _id: id,
              softDeletedAt: undefined,
              moderationFlags: [],
              moderationReason: undefined,
            };
          }
          return {
            _id: id,
            softDeletedAt: undefined,
            moderationFlags: ["flagged.suspicious"],
            moderationReason: undefined,
          };
        }),
      },
    };

    const items = await filterHandler(ctx, { entries, limit: 1 });

    expect(items).toEqual([
      { skillId: skillId("skills:clean"), score: 100, installs: 100, downloads: 8 },
    ]);
  });
});
