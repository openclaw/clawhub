import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { listMine } = await import("./tokens");

type WrappedHandler = {
  _handler: (ctx: unknown, args: Record<string, never>) => Promise<unknown>;
};

const listMineHandler = (listMine as unknown as WrappedHandler)._handler;

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

describe("tokens.listMine", () => {
  it("returns an empty list while a deleted user's auth session is expiring", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:deleted" as never);
    const query = vi.fn();

    const result = await listMineHandler(
      {
        db: {
          get: vi.fn().mockResolvedValue({
            _id: "users:deleted",
            deactivatedAt: Date.now(),
          }),
          query,
        },
      },
      {},
    );

    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
