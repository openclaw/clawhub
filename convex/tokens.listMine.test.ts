import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { listMine } = await import("./tokens");

const listMineHandler = getTestHandler<Record<string, never>>(listMine);

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
