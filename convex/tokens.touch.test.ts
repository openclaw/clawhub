/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { touchInternal as touchPackagePublishTokenInternal } from "./packagePublishTokens";
import { touchInternal as touchApiTokenInternal } from "./tokens";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<void>;
};

const touchApiTokenHandler = (
  touchApiTokenInternal as unknown as WrappedHandler<{ tokenId: string }>
)._handler;
const touchPackagePublishTokenHandler = (
  touchPackagePublishTokenInternal as unknown as WrappedHandler<{ tokenId: string }>
)._handler;

function makeCtx(token: Record<string, unknown> | null) {
  return {
    db: {
      get: vi.fn(async () => token),
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
  };
}

describe("token touch throttling", () => {
  it("skips api token touches inside the freshness window", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const ctx = makeCtx({
      _id: "apiTokens:one",
      revokedAt: undefined,
      lastUsedAt: 500_000,
    });

    await touchApiTokenHandler(ctx, { tokenId: "apiTokens:one" });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("patches stale api token touches", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const ctx = makeCtx({
      _id: "apiTokens:one",
      revokedAt: undefined,
      lastUsedAt: 1,
    });

    await touchApiTokenHandler(ctx, { tokenId: "apiTokens:one" });

    expect(ctx.db.patch).toHaveBeenCalledWith("apiTokens:one", { lastUsedAt: 1_000_000 });
  });

  it("skips package publish token touches inside the freshness window", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const ctx = makeCtx({
      _id: "packagePublishTokens:one",
      revokedAt: undefined,
      expiresAt: 2_000_000,
      lastUsedAt: 500_000,
    });

    await touchPackagePublishTokenHandler(ctx, { tokenId: "packagePublishTokens:one" });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
