import { describe, expect, it, vi } from "vitest";
/* @vitest-environment node */
import type { Id } from "../_generated/dataModel";
import { takeTopNonSuspiciousTrendingEntries, type LeaderboardEntry } from "./leaderboards";

describe("takeTopNonSuspiciousTrendingEntries", () => {
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

    const items = await takeTopNonSuspiciousTrendingEntries(ctx as never, entries, 1);

    expect(items).toEqual([
      { skillId: skillId("skills:clean"), score: 100, installs: 100, downloads: 8 },
    ]);
  });
});
