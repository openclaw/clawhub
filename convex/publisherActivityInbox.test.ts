/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));
vi.mock("./lib/access", () => ({ requireUser: vi.fn() }));

const { requireUser } = await import("./lib/access");
const { getMine, markSeenThrough } = await import("./publisherActivityInbox");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getMineHandler = (getMine as unknown as WrappedHandler<Record<string, never>, unknown>)
  ._handler;
const markSeenThroughHandler = (
  markSeenThrough as unknown as WrappedHandler<{ groupId: string }, unknown>
)._handler;

function makeCtx({
  group = { _id: "publisherActivityGroups:1", publisherId: "publishers:1", sortKey: "200:b" },
  follow = { _id: "publisherFollows:1" } as { _id: string } | null,
  state = null as null | {
    _id: string;
    userId: string;
    seenThroughSortKey: string;
    updatedAt: number;
  },
} = {}) {
  const insert = vi.fn(async () => "publisherActivityInboxState:1");
  const patch = vi.fn();
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((_index: string, build: (q: unknown) => unknown) => {
      const q = { eq: vi.fn().mockReturnThis() };
      build(q);
      return { unique: vi.fn(async () => (table === "publisherFollows" ? follow : state)) };
    }),
  }));
  return {
    db: { get: vi.fn(async () => group), insert, patch, query },
    insert,
    patch,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("publisher activity inbox state", () => {
  it("returns an empty read frontier for a new inbox", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "users:1" } as never);
    const result = await getMineHandler(makeCtx(), {});
    expect(result).toEqual({ ok: true, seenThroughSortKey: null, updatedAt: null });
  });

  it("creates a seen-through frontier for a followed activity group", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "users:1" } as never);
    const ctx = makeCtx();
    const result = await markSeenThroughHandler(ctx, { groupId: "publisherActivityGroups:1" });
    expect(ctx.insert).toHaveBeenCalledWith("publisherActivityInboxState", {
      userId: "users:1",
      seenThroughSortKey: "200:b",
      updatedAt: expect.any(Number),
    });
    expect(result).toEqual({ ok: true, seenThroughSortKey: "200:b" });
  });

  it("never moves the frontier backwards", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "users:1" } as never);
    const ctx = makeCtx({
      state: {
        _id: "publisherActivityInboxState:1",
        userId: "users:1",
        seenThroughSortKey: "300:c",
        updatedAt: 1,
      },
    });
    const result = await markSeenThroughHandler(ctx, { groupId: "publisherActivityGroups:1" });
    expect(ctx.patch).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, seenThroughSortKey: "300:c" });
  });

  it("does not reveal groups from publishers the user no longer follows", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "users:1" } as never);
    const ctx = makeCtx({ follow: null });
    await expect(
      markSeenThroughHandler(ctx, { groupId: "publisherActivityGroups:1" }),
    ).rejects.toThrow("Publisher activity group not found");
    expect(ctx.insert).not.toHaveBeenCalled();
  });
});
