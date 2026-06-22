/* @vitest-environment node */
import { getAuthUserId } from "@convex-dev/auth/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./skillStatEvents", () => ({
  insertStatEvent: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./functions", () => ({
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

const { insertStatEvent } = await import("./skillStatEvents");
const { addStarInternal, isStarred, removeStarInternal, toggle } = await import("./stars");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const toggleHandler = (
  toggle as unknown as WrappedHandler<{ skillId: string }, { starred: boolean }>
)._handler;
const addStarInternalHandler = (
  addStarInternal as unknown as WrappedHandler<
    { userId: string; skillId: string },
    { ok: true; starred: boolean; alreadyStarred: boolean }
  >
)._handler;
const removeStarInternalHandler = (
  removeStarInternal as unknown as WrappedHandler<
    { userId: string; skillId: string },
    { ok: true; unstarred: boolean; alreadyUnstarred: boolean }
  >
)._handler;
const isStarredHandler = (isStarred as unknown as WrappedHandler<{ skillId: string }, boolean>)
  ._handler;

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:1",
    ownerUserId: "users:owner",
    softDeletedAt: undefined,
    statsDownloads: 10,
    statsStars: 2,
    statsInstallsCurrent: 3,
    statsInstallsAllTime: 4,
    stats: {
      downloads: 10,
      stars: 2,
      installsCurrent: 3,
      installsAllTime: 4,
      versions: 1,
      comments: 0,
    },
    ...overrides,
  };
}

function makeCtx(params: {
  skill?: Record<string, unknown>;
  existingStar?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
}) {
  const skill = params.skill ?? makeSkill();
  const owner = {
    _id: "users:owner",
    publishedSkills: 1,
    totalStars: 2,
    totalDownloads: 10,
  };
  const viewer = params.user === undefined ? { _id: "users:viewer", role: "user" } : params.user;
  const get = vi.fn(async (id: string) => {
    if (id === "skills:1") return skill;
    if (id === "users:owner") return owner;
    if (id === "users:viewer") return viewer;
    return null;
  });
  const insert = vi.fn();
  const deleteDoc = vi.fn();
  const patch = vi.fn();
  const query = vi.fn((table: string) => {
    if (table !== "stars") throw new Error(`unexpected table ${table}`);
    return {
      withIndex: () => ({
        unique: async () => params.existingStar ?? null,
      }),
    };
  });
  return {
    ctx: { db: { get, insert, delete: deleteDoc, patch, query } },
    db: { get, insert, deleteDoc, patch, query },
  };
}

describe("stars mutations", () => {
  afterEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(insertStatEvent).mockReset();
  });

  it("toggle inserts a star row and updates denormalized star counts synchronously", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);
    const { ctx, db } = makeCtx({ existingStar: null });

    const result = await toggleHandler(ctx, { skillId: "skills:1" });

    expect(result).toEqual({ starred: true });
    expect(db.insert).toHaveBeenCalledWith("stars", {
      skillId: "skills:1",
      userId: "users:viewer",
      createdAt: expect.any(Number),
    });
    expect(db.patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        statsStars: 3,
        stats: expect.objectContaining({ stars: 3 }),
      }),
    );
    expect(db.patch).toHaveBeenCalledWith(
      "users:owner",
      expect.objectContaining({ totalStars: 3 }),
    );
    expect(insertStatEvent).not.toHaveBeenCalled();
  });

  it("toggle deletes a star row and decrements counts without going below zero", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);
    const { ctx, db } = makeCtx({
      skill: makeSkill({
        statsStars: 0,
        stats: {
          downloads: 10,
          stars: 0,
          installsCurrent: 3,
          installsAllTime: 4,
          versions: 1,
          comments: 0,
        },
      }),
      existingStar: { _id: "stars:1", skillId: "skills:1", userId: "users:viewer" },
    });

    const result = await toggleHandler(ctx, { skillId: "skills:1" });

    expect(result).toEqual({ starred: false });
    expect(db.deleteDoc).toHaveBeenCalledWith("stars:1");
    expect(db.patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        statsStars: 0,
        stats: expect.objectContaining({ stars: 0 }),
      }),
    );
    expect(insertStatEvent).not.toHaveBeenCalled();
  });

  it("addStarInternal is idempotent and increments only when inserting a row", async () => {
    const alreadyStarred = makeCtx({
      existingStar: { _id: "stars:1", skillId: "skills:1", userId: "users:viewer" },
    });

    await expect(
      addStarInternalHandler(alreadyStarred.ctx, {
        userId: "users:viewer",
        skillId: "skills:1",
      }),
    ).resolves.toEqual({ ok: true, starred: true, alreadyStarred: true });
    expect(alreadyStarred.db.patch).not.toHaveBeenCalled();

    const newStar = makeCtx({ existingStar: null });
    await expect(
      addStarInternalHandler(newStar.ctx, {
        userId: "users:viewer",
        skillId: "skills:1",
      }),
    ).resolves.toEqual({ ok: true, starred: true, alreadyStarred: false });
    expect(newStar.db.patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({ statsStars: 3 }),
    );
  });

  it("removeStarInternal is idempotent and decrements only when deleting a row", async () => {
    const alreadyUnstarred = makeCtx({ existingStar: null });

    await expect(
      removeStarInternalHandler(alreadyUnstarred.ctx, {
        userId: "users:viewer",
        skillId: "skills:1",
      }),
    ).resolves.toEqual({ ok: true, unstarred: false, alreadyUnstarred: true });
    expect(alreadyUnstarred.db.patch).not.toHaveBeenCalled();

    const existing = makeCtx({
      existingStar: { _id: "stars:1", skillId: "skills:1", userId: "users:viewer" },
    });
    await expect(
      removeStarInternalHandler(existing.ctx, {
        userId: "users:viewer",
        skillId: "skills:1",
      }),
    ).resolves.toEqual({ ok: true, unstarred: true, alreadyUnstarred: false });
    expect(existing.db.patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({ statsStars: 1 }),
    );
  });
});

describe("stars queries", () => {
  afterEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("returns false instead of throwing when skill star auth is stale", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);

    await expect(
      isStarredHandler(makeCtx({ user: null }), { skillId: "skills:demo" }),
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
});
