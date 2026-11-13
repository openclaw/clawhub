import { describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { countPublicPlugins, countPublicPluginsInternal } from "./packages";

const countPublicPluginsHandler = getTestHandler<Record<string, never>, number | null>(
  countPublicPluginsInternal,
);
const countPublicPluginsPublicHandler = getTestHandler<Record<string, never>, number>(
  countPublicPlugins,
);

function makeCtx(globalStats: { activePluginsCount?: number } | null) {
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table === "globalStats") {
          return {
            withIndex: () => ({
              unique: async () => globalStats,
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
  };
}

describe("packages.countPublicPluginsInternal", () => {
  it("returns the precomputed global plugin count when available", async () => {
    const result = await countPublicPluginsHandler(makeCtx({ activePluginsCount: 251 }), {});

    expect(result).toBe(251);
  });

  it("returns null when the global stats row predates plugin counts", async () => {
    const result = await countPublicPluginsHandler(makeCtx({}), {});

    expect(result).toBeNull();
  });
});

describe("packages.countPublicPlugins", () => {
  it("returns the precomputed global plugin count when available", async () => {
    const result = await countPublicPluginsPublicHandler(makeCtx({ activePluginsCount: 251 }), {});

    expect(result).toBe(251);
  });

  it("returns zero when the global stats row predates plugin counts", async () => {
    const result = await countPublicPluginsPublicHandler(makeCtx({}), {});

    expect(result).toBe(0);
  });
});
