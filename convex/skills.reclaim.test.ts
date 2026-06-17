import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { reclaimSlugInternal } from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const reclaimSlugInternalHandler = (
  reclaimSlugInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;

describe("skills reclaim ownership transfer", () => {
  it("transfers ownership in-place when transferRootSlugOnly is true", async () => {
    const now = Date.now();
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => {});
    const runAfter = vi.fn(async () => {});

    const existingSkill = {
      _id: "skills:1",
      slug: "capability-evolver",
      ownerUserId: "users:old",
      stats: { downloads: 3, stars: 2, installsCurrent: 0, installsAllTime: 0 },
    };
    const activeReservation = {
      _id: "reservedSlugs:1",
      slug: "capability-evolver",
      originalOwnerUserId: "users:old",
      deletedAt: now - 1_000,
      expiresAt: now + 10_000,
    };

    const db = {
      normalizeId: vi.fn(),
      get: vi.fn(async (id: string) => {
        if (id === "users:admin") return { _id: "users:admin", role: "admin" };
        if (id === "users:new") return { _id: "users:new", role: "user" };
        if (id === "users:old") {
          return {
            _id: "users:old",
            role: "user",
            publishedSkills: 1,
            totalDownloads: 3,
            totalStars: 2,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return { unique: async () => existingSkill, take: async () => [existingSkill] };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected embeddings index ${name}`);
              return {
                collect: async () => [
                  { _id: "skillEmbeddings:1", skillId: "skills:1", ownerId: "users:old" },
                ],
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") return { take: async () => [] };
              if (name !== "by_skill") throw new Error(`unexpected aliases index ${name}`);
              return {
                collect: async () => [
                  {
                    _id: "skillSlugAliases:1",
                    skillId: "skills:1",
                    ownerUserId: "users:old",
                  },
                ],
              };
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug_active_deletedAt") {
                throw new Error(`unexpected reservedSlugs index ${name}`);
              }
              return {
                order: () => ({
                  take: async () => [activeReservation],
                }),
              };
            },
          };
        }
        if (table === "skillSearchDigest") {
          return {
            withIndex: () => ({
              unique: async () => null,
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
    };

    const result = (await reclaimSlugInternalHandler(
      { db, scheduler: { runAfter } } as never,
      {
        actorUserId: "users:admin",
        slug: "Capability-Evolver",
        rightfulOwnerUserId: "users:new",
        transferRootSlugOnly: true,
      } as never,
    )) as { ok: boolean; action: string };

    expect(result).toEqual({ ok: true, action: "ownership_transferred" });
    expect(runAfter).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:new",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillEmbeddings:1",
      expect.objectContaining({
        ownerId: "users:new",
      }),
    );
    expect(patch).not.toHaveBeenCalledWith("skillSlugAliases:1", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "reservedSlugs:1",
      expect.objectContaining({
        releasedAt: expect.any(Number),
      }),
    );
  });

  it("returns missing without reserving when transferRootSlugOnly is true and slug does not exist", async () => {
    const insert = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    const runAfter = vi.fn(async () => {});

    const db = {
      normalizeId: vi.fn(),
      get: vi.fn(async (id: string) => {
        if (id === "users:admin") return { _id: "users:admin", role: "admin" };
        if (id === "users:new") return { _id: "users:new", role: "user" };
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return { unique: async () => null, take: async () => [] };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected aliases index ${name}`);
              return { take: async () => [] };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
    };

    const result = (await reclaimSlugInternalHandler(
      { db, scheduler: { runAfter } } as never,
      {
        actorUserId: "users:admin",
        slug: "missing-slug",
        rightfulOwnerUserId: "users:new",
        transferRootSlugOnly: true,
      } as never,
    )) as { ok: boolean; action: string };

    expect(result).toEqual({ ok: true, action: "missing" });
    expect(runAfter).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("throws a controlled ambiguity error when transferRootSlugOnly sees duplicate publishers", async () => {
    const insert = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    const runAfter = vi.fn(async () => {});

    const duplicateSkills = [
      {
        _id: "skills:1",
        slug: "shared-slug",
        ownerUserId: "users:one",
      },
      {
        _id: "skills:2",
        slug: "shared-slug",
        ownerUserId: "users:two",
      },
    ];

    const db = {
      normalizeId: vi.fn(),
      get: vi.fn(async (id: string) => {
        if (id === "users:admin") return { _id: "users:admin", role: "admin" };
        if (id === "users:new") return { _id: "users:new", role: "user" };
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return { unique: async () => null, take: async () => duplicateSkills };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected aliases index ${name}`);
              return { take: async () => [] };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
    };

    await expect(
      reclaimSlugInternalHandler(
        { db, scheduler: { runAfter } } as never,
        {
          actorUserId: "users:admin",
          slug: "shared-slug",
          rightfulOwnerUserId: "users:new",
          transferRootSlugOnly: true,
        } as never,
      ),
    ).rejects.toThrow(/Slug is used by multiple publishers/);

    expect(runAfter).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects transferRootSlugOnly ownership moves for moderated skills", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => {});
    const runAfter = vi.fn(async () => {});

    const existingSkill = {
      _id: "skills:1",
      slug: "blocked-skill",
      ownerUserId: "users:old",
      moderationStatus: "active",
      moderationReasonCodes: ["malicious.crypto_mining"],
    };

    const db = {
      normalizeId: vi.fn(),
      get: vi.fn(async (id: string) => {
        if (id === "users:admin") return { _id: "users:admin", role: "admin" };
        if (id === "users:new") return { _id: "users:new", role: "user" };
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return { unique: async () => existingSkill, take: async () => [existingSkill] };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected aliases index ${name}`);
              return { take: async () => [] };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
    };

    await expect(
      reclaimSlugInternalHandler(
        { db, scheduler: { runAfter } } as never,
        {
          actorUserId: "users:admin",
          slug: "blocked-skill",
          rightfulOwnerUserId: "users:new",
          transferRootSlugOnly: true,
        } as never,
      ),
    ).rejects.toThrow("under moderation");

    expect(runAfter).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalledWith("skills:1", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });
});
