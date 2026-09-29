import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getDownloadMetrics } = await import("./dashboard");

type WrappedHandler = {
  _handler: (
    ctx: unknown,
    args: { publisherId: string; endDay: number },
  ) => Promise<{ allTimeDownloads: number }>;
};

const getDownloadMetricsHandler = (getDownloadMetrics as unknown as WrappedHandler)._handler;

function emptyQuery() {
  const chain: {
    withIndex: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    collect: ReturnType<typeof vi.fn>;
    take: ReturnType<typeof vi.fn>;
    unique: ReturnType<typeof vi.fn>;
  } = {
    withIndex: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    collect: vi.fn(async () => []),
    take: vi.fn(async () => []),
    unique: vi.fn(async () => null),
  };
  chain.withIndex.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

describe("dashboard.getDownloadMetrics", () => {
  it("forbids an unlinked personal publisher to a different caller", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:attacker" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:attacker") return { _id: id };
          if (id === "publishers:victim") {
            return { _id: id, kind: "user", handle: "victim" };
          }
          return null;
        }),
        query: vi.fn(() => emptyQuery()),
      },
    };

    await expect(
      getDownloadMetricsHandler(ctx, {
        publisherId: "publishers:victim",
        endDay: 1_800_000_000_000,
      }),
    ).rejects.toThrow(/Forbidden/);
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("allows a linked personal publisher to the linked user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:owner") {
            return { _id: id, kind: "user", handle: "owner", linkedUserId: "users:owner" };
          }
          return null;
        }),
        query: vi.fn(() => emptyQuery()),
      },
    };

    const result = await getDownloadMetricsHandler(ctx, {
      publisherId: "publishers:owner",
      endDay: 1_800_000_000_000,
    });
    expect(result.allTimeDownloads).toBe(0);
    expect(ctx.db.query).toHaveBeenCalled();
  });

  it("forbids a linked personal publisher to a different caller", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:attacker" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:attacker") return { _id: id };
          if (id === "publishers:owner") {
            return { _id: id, kind: "user", handle: "owner", linkedUserId: "users:owner" };
          }
          return null;
        }),
        query: vi.fn(() => emptyQuery()),
      },
    };

    await expect(
      getDownloadMetricsHandler(ctx, {
        publisherId: "publishers:owner",
        endDay: 1_800_000_000_000,
      }),
    ).rejects.toThrow(/Forbidden/);
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
});
