/* @vitest-environment node */
import { getAuthUserId } from "@convex-dev/auth/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./functions", () => ({
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

const { followPublisherInternal, listFollowedPublishersInternal, unfollowPublisherInternal } =
  await import("./publisherFollows");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const followPublisherInternalHandler = (
  followPublisherInternal as unknown as WrappedHandler<
    { followerUserId: string; publisherId: string; notifications?: "all" | "none" },
    { following: boolean; notifications: "all" | "none" }
  >
)._handler;
const unfollowPublisherInternalHandler = (
  unfollowPublisherInternal as unknown as WrappedHandler<
    { followerUserId: string; publisherId: string },
    { following: boolean; unfollowed: boolean; alreadyUnfollowed: boolean }
  >
)._handler;
const listFollowedPublishersInternalHandler = (
  listFollowedPublishersInternal as unknown as WrappedHandler<
    { followerUserId: string; limit?: number },
    { items: Array<{ publisher: { handle: string }; notifications: "all" | "none" }> }
  >
)._handler;

function makePublisher(overrides: Record<string, unknown> = {}) {
  return {
    _id: "publishers:1",
    handle: "demo",
    displayName: "Demo Publisher",
    kind: "user",
    image: undefined,
    deletedAt: undefined,
    deactivatedAt: undefined,
    ...overrides,
  };
}

function makeCtx(params: {
  publisher?: Record<string, unknown> | null;
  existingFollow?: Record<string, unknown> | null;
  listRows?: Array<Record<string, unknown>>;
  listPages?: Array<Array<Record<string, unknown>>>;
}) {
  const publisher = params.publisher === undefined ? makePublisher() : params.publisher;
  let pageIndex = 0;
  const get = vi.fn(async (id: string) => {
    if (id === "publishers:1") return publisher;
    if (id === "publishers:2") return makePublisher({ _id: id, handle: "active-2" });
    if (id === "publishers:hidden") return makePublisher({ _id: id, deletedAt: Date.now() });
    if (id === "users:viewer") return { _id: id, role: "user" };
    return null;
  });
  const insert = vi.fn(async (table: string) => `${table}:new`);
  const patch = vi.fn();
  const deleteDoc = vi.fn();
  const query = vi.fn((table: string) => {
    if (table !== "publisherFollows") throw new Error(`unexpected table ${table}`);
    return {
      withIndex: (_index: string, build?: (q: unknown) => unknown) => {
        const q = { eq: vi.fn() };
        q.eq.mockReturnValue(q);
        build?.(q);
        return {
          unique: async () => params.existingFollow ?? null,
          order: () => ({
            take: async () => params.listRows ?? [],
            paginate: async () => {
              const pages = params.listPages ?? [params.listRows ?? []];
              const page = pages[pageIndex] ?? [];
              pageIndex += 1;
              return {
                page,
                isDone: pageIndex >= pages.length,
                continueCursor: pageIndex >= pages.length ? "" : `cursor:${pageIndex}`,
              };
            },
          }),
        };
      },
    };
  });
  return {
    ctx: { db: { get, insert, patch, delete: deleteDoc, query } },
    db: { get, insert, patch, deleteDoc, query },
  };
}

describe("publisher follows", () => {
  afterEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("creates a follow row with default notifications and audit log", async () => {
    const { ctx, db } = makeCtx({ existingFollow: null });

    const result = await followPublisherInternalHandler(ctx, {
      followerUserId: "users:viewer",
      publisherId: "publishers:1",
    });

    expect(result).toMatchObject({
      following: true,
      notifications: "all",
      publisherId: "publishers:1",
    });
    expect(db.insert).toHaveBeenCalledWith("publisherFollows", {
      followerUserId: "users:viewer",
      publisherId: "publishers:1",
      notifications: "all",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(db.insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        actorUserId: "users:viewer",
        action: "publisher.follow.create",
        targetId: "publishers:1",
      }),
    );
  });

  it("is idempotent and only patches an existing row when the notification preference changes", async () => {
    const existingFollow = {
      _id: "publisherFollows:1",
      followerUserId: "users:viewer",
      publisherId: "publishers:1",
      notifications: "none",
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, db } = makeCtx({ existingFollow });

    const result = await followPublisherInternalHandler(ctx, {
      followerUserId: "users:viewer",
      publisherId: "publishers:1",
      notifications: "all",
    });

    expect(result).toMatchObject({ following: true, notifications: "all" });
    expect(db.patch).toHaveBeenCalledWith("publisherFollows:1", {
      notifications: "all",
      updatedAt: expect.any(Number),
    });
    expect(db.insert).not.toHaveBeenCalledWith("publisherFollows", expect.anything());
  });

  it("unfollow is idempotent and audits only real deletes", async () => {
    const missing = makeCtx({ existingFollow: null });
    await expect(
      unfollowPublisherInternalHandler(missing.ctx, {
        followerUserId: "users:viewer",
        publisherId: "publishers:1",
      }),
    ).resolves.toEqual({
      ok: true,
      following: false,
      unfollowed: false,
      alreadyUnfollowed: true,
      publisherId: "publishers:1",
    });
    expect(missing.db.deleteDoc).not.toHaveBeenCalled();

    const existing = makeCtx({
      existingFollow: {
        _id: "publisherFollows:1",
        followerUserId: "users:viewer",
        publisherId: "publishers:1",
        notifications: "all",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    await expect(
      unfollowPublisherInternalHandler(existing.ctx, {
        followerUserId: "users:viewer",
        publisherId: "publishers:1",
      }),
    ).resolves.toMatchObject({ following: false, unfollowed: true });
    expect(existing.db.deleteDoc).toHaveBeenCalledWith("publisherFollows:1");
    expect(existing.db.insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "publisher.follow.delete" }),
    );
  });

  it("allows stale follows to be removed after a publisher is deactivated", async () => {
    const existing = makeCtx({
      publisher: makePublisher({ deactivatedAt: Date.now() }),
      existingFollow: {
        _id: "publisherFollows:1",
        followerUserId: "users:viewer",
        publisherId: "publishers:1",
        notifications: "none",
        createdAt: 1,
        updatedAt: 1,
      },
    });

    await expect(
      unfollowPublisherInternalHandler(existing.ctx, {
        followerUserId: "users:viewer",
        publisherId: "publishers:1",
      }),
    ).resolves.toMatchObject({ following: false, unfollowed: true });
    expect(existing.db.deleteDoc).toHaveBeenCalledWith("publisherFollows:1");
  });

  it("omits inactive publishers from the private follow list", async () => {
    const { ctx } = makeCtx({
      listRows: [
        {
          _id: "publisherFollows:1",
          followerUserId: "users:viewer",
          publisherId: "publishers:1",
          notifications: "all",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "publisherFollows:2",
          followerUserId: "users:viewer",
          publisherId: "publishers:hidden",
          notifications: "none",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const result = await listFollowedPublishersInternalHandler(ctx, {
      followerUserId: "users:viewer",
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        notifications: "all",
        publisher: expect.objectContaining({ handle: "demo" }),
      }),
    ]);
  });

  it("continues scanning until active follows fill the requested list", async () => {
    const { ctx } = makeCtx({
      listPages: [
        [
          {
            _id: "publisherFollows:hidden",
            followerUserId: "users:viewer",
            publisherId: "publishers:hidden",
            notifications: "none",
            createdAt: 1,
            updatedAt: 3,
          },
        ],
        [
          {
            _id: "publisherFollows:2",
            followerUserId: "users:viewer",
            publisherId: "publishers:2",
            notifications: "all",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      ],
    });

    const result = await listFollowedPublishersInternalHandler(ctx, {
      followerUserId: "users:viewer",
      limit: 1,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        publisherId: "publishers:2",
        publisher: expect.objectContaining({ handle: "active-2" }),
      }),
    ]);
  });
});
