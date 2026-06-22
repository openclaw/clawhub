import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { countPublicSkills } from "./skills";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const countPublicSkillsHandler = (
  countPublicSkills as unknown as WrappedHandler<Record<string, never>, number>
)._handler;

describe("skills.countPublicSkills", () => {
  it("returns precomputed global stats count when available", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "globalStats") {
            return {
              withIndex: () => ({
                unique: async () => ({ _id: "globalStats:1", activeSkillsCount: 123 }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await countPublicSkillsHandler(ctx, {});
    expect(result).toBe(123);
  });

  it("returns zero when the global stats row is missing", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "globalStats") {
            return {
              withIndex: () => ({
                unique: async () => null,
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await countPublicSkillsHandler(ctx, {});
    expect(result).toBe(0);
  });

  it("returns zero when globalStats table is unavailable", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "globalStats") {
            throw new Error("unexpected table globalStats");
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await countPublicSkillsHandler(ctx, {});
    expect(result).toBe(0);
  });
});
