import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { countPublicPlugins, countPublicPluginsInternal } from "./packages";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const countPublicPluginsHandler = (
  countPublicPluginsInternal as unknown as WrappedHandler<Record<string, never>, number | null>
)._handler;
const countPublicPluginsPublicHandler = (
  countPublicPlugins as unknown as WrappedHandler<Record<string, never>, number>
)._handler;

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
