import { describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { countPublicSkills } from "./skills";

const countPublicSkillsHandler = getTestHandler<Record<string, never>, number>(countPublicSkills);

describe("skills.countPublicSkills", () => {
  it("returns the deduplicated native plus public skills.sh catalog count", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "globalStats") {
            return {
              withIndex: () => ({
                unique: async () => ({
                  _id: "globalStats:1",
                  activeSkillsCount: 123,
                  activeExternalSkillsCount: 7,
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await countPublicSkillsHandler(ctx, {});
    expect(result).toBe(130);
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
