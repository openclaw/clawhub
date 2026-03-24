import { describe, expect, it, vi } from "vitest";
import {
  enforceReservedSlugCooldownForNewSkill,
  formatReservedSlugCooldownMessage,
} from "./reservedSlugs";

describe("reservedSlugs", () => {
  it("throws a user-facing error when slug is actively reserved by another user", async () => {
    const now = Date.now();
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedSlugs") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "reservedSlugs:1",
                    slug: "taken-skill",
                    originalOwnerUserId: "users:owner",
                    deletedAt: now - 1000,
                    expiresAt: now + 60_000,
                    releasedAt: undefined,
                  },
                ],
              }),
            };
          },
        };
      }),
      patch: vi.fn(async () => {}),
    };

    await expect(
      enforceReservedSlugCooldownForNewSkill({ db } as never, {
        slug: "taken-skill",
        userId: "users:caller" as never,
        now,
      }),
    ).rejects.toThrow(formatReservedSlugCooldownMessage("taken-skill", now + 60_000));
  });
});
