/* @vitest-environment node */

import { getAuthUserId } from "@convex-dev/auth/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isStarred } from "./stars";
import { isStarred as isSoulStarred } from "./soulStars";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult> = {
  _handler?: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function unwrapHandler<TArgs, TResult>(
  wrapped: unknown,
): (ctx: unknown, args: TArgs) => Promise<TResult> {
  const handler = (wrapped as WrappedHandler<TArgs, TResult>)._handler;
  if (!handler) throw new Error("Expected Convex test wrapper to expose _handler");
  return handler;
}

const isStarredHandler = unwrapHandler<{ skillId: string }, boolean>(isStarred);
const isSoulStarredHandler = unwrapHandler<{ soulId: string }, boolean>(isSoulStarred);

function makeCtx(options: { user?: Record<string, unknown> | null; existingStar?: unknown }) {
  return {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "users:viewer") return options.user ?? { _id: "users:viewer" };
        return null;
      }),
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          unique: vi.fn().mockResolvedValue(options.existingStar ?? null),
        })),
      })),
    },
  };
}

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

describe("stars queries", () => {
  it("returns false instead of throwing when skill star auth is stale", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);

    await expect(
      isStarredHandler(makeCtx({ user: null }), { skillId: "skills:demo" }),
    ).resolves.toBe(false);
  });

  it("returns false instead of throwing when soul star auth is stale", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);

    await expect(
      isSoulStarredHandler(makeCtx({ user: null }), { soulId: "souls:demo" }),
    ).resolves.toBe(false);
  });

  it("still reports existing stars for active users", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);

    await expect(
      isStarredHandler(makeCtx({ existingStar: { _id: "stars:demo" } }), {
        skillId: "skills:demo",
      }),
    ).resolves.toBe(true);
  });

  it("still reports existing soul stars for active users", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);

    await expect(
      isSoulStarredHandler(makeCtx({ existingStar: { _id: "soulStars:demo" } }), {
        soulId: "souls:demo",
      }),
    ).resolves.toBe(true);
  });
});
