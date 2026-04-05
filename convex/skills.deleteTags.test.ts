import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { deleteTags } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const deleteTagsHandler = (
  deleteTags as unknown as WrappedHandler<{
    skillId: string;
    tags: string[];
  }>
)._handler;

function buildGlobalStatsQuery(table: string) {
  if (table !== "globalStats") return null;
  return {
    withIndex: () => ({
      unique: async () => ({ _id: "globalStats:1", activeSkillsCount: 100 }),
    }),
  };
}

function buildDigestQuery(table: string) {
  if (table !== "skillSearchDigest") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
    }),
  };
}

function makeCtx(params: { user: Record<string, unknown>; skill: Record<string, unknown> | null }) {
  vi.mocked(getAuthUserId).mockResolvedValue(params.user._id as never);
  const patch = vi.fn(async (_id: string, value: Record<string, unknown>) => value);
  const db = {
    get: vi.fn(async (id: string) => {
      if (id === params.user._id) return params.user;
      if (params.skill && id === params.skill._id) return params.skill;
      return null;
    }),
    query: vi.fn((table: string) => {
      const globalStatsQuery = buildGlobalStatsQuery(table);
      if (globalStatsQuery) return globalStatsQuery;
      const digestQuery = buildDigestQuery(table);
      if (digestQuery) return digestQuery;
      throw new Error(`unexpected table ${table}`);
    }),
    insert: vi.fn(),
    patch,
    delete: vi.fn(),
    replace: vi.fn(),
    normalizeId: vi.fn(() => null),
  };
  const auth = { getUserIdentity: vi.fn(async () => ({ tokenIdentifier: "test" })) };
  return { db, auth, patch };
}

const ownerUser = {
  _id: "users:owner",
  deletedAt: undefined,
  deactivatedAt: undefined,
  role: undefined,
};

const modUser = {
  _id: "users:mod",
  deletedAt: undefined,
  deactivatedAt: undefined,
  role: "moderator",
};

const otherUser = {
  _id: "users:other",
  deletedAt: undefined,
  deactivatedAt: undefined,
  role: undefined,
};

const baseSkill = {
  _id: "skills:1",
  ownerUserId: "users:owner",
  tags: {
    latest: "versions:3",
    stable: "versions:2",
    beta: "versions:3",
    "old-tag": "versions:1",
  },
  moderationStatus: "active",
  moderationFlags: undefined,
  softDeletedAt: undefined,
};

describe("deleteTags", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("deletes specified tags and keeps latest", async () => {
    const { db, auth, patch } = makeCtx({ user: ownerUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["stable", "old-tag"] } as never,
    );
    expect(patch).toHaveBeenCalledOnce();
    const patchArgs = patch.mock.calls[0];
    expect(patchArgs[1]).toHaveProperty("tags");
    const newTags = (patchArgs[1] as Record<string, unknown>).tags as Record<string, string>;
    expect(newTags).toHaveProperty("latest");
    expect(newTags).toHaveProperty("beta");
    expect(newTags).not.toHaveProperty("stable");
    expect(newTags).not.toHaveProperty("old-tag");
  });

  it("protects the latest tag from deletion", async () => {
    const { db, auth, patch } = makeCtx({ user: ownerUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["latest"] } as never,
    );
    // No actual tag removed → no db.patch call
    expect(patch).not.toHaveBeenCalled();
  });

  it("skips db write when no tags are actually removed", async () => {
    const { db, auth, patch } = makeCtx({ user: ownerUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["nonexistent", "latest"] } as never,
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("throws for non-owner non-moderator user", async () => {
    const { db, auth } = makeCtx({ user: otherUser, skill: baseSkill });
    await expect(
      deleteTagsHandler({ db, auth } as never, { skillId: "skills:1", tags: ["stable"] } as never),
    ).rejects.toThrow();
  });

  it("allows moderator to delete tags on other user's skill", async () => {
    const { db, auth, patch } = makeCtx({ user: modUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["beta"] } as never,
    );
    expect(patch).toHaveBeenCalledOnce();
    const newTags = (patch.mock.calls[0][1] as Record<string, unknown>).tags as Record<
      string,
      string
    >;
    expect(newTags).not.toHaveProperty("beta");
    expect(newTags).toHaveProperty("latest");
    expect(newTags).toHaveProperty("stable");
  });

  it("throws when skill not found", async () => {
    const { db, auth } = makeCtx({ user: ownerUser, skill: null });
    await expect(
      deleteTagsHandler(
        { db, auth } as never,
        { skillId: "skills:missing", tags: ["stable"] } as never,
      ),
    ).rejects.toThrow("Skill not found");
  });
});
