import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { getSkillBySlugInternal, mergeOwnedSkillIntoCanonicalInternal } from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getSkillBySlugInternalHandler = (
  getSkillBySlugInternal as unknown as WrappedHandler<{ slug: string }>
)._handler;
const mergeOwnedSkillIntoCanonicalInternalHandler = (
  mergeOwnedSkillIntoCanonicalInternal as unknown as WrappedHandler<{
    actorUserId: string;
    sourceSlug: string;
    targetSlug: string;
  }>
)._handler;

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

describe("skills ownership", () => {
  it("resolves alias slugs to the live target skill", async () => {
    const result = await getSkillBySlugInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          system: {},
          get: vi.fn(async (id: string) => {
            if (id === "skills:target") {
              return {
                _id: "skills:target",
                slug: "demo",
                ownerUserId: "users:1",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return {
                    unique: async () => null,
                  };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") throw new Error(`unexpected alias index ${name}`);
                  return {
                    unique: async () => ({
                      _id: "skillSlugAliases:1",
                      slug: "demo-old",
                      skillId: "skills:target",
                    }),
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      } as never,
      { slug: "demo-old" } as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        _id: "skills:target",
        slug: "demo",
      }),
    );
  });

  it("allows publisher admins to merge publisher-owned skills and preserves alias ownership", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const skills = [
      {
        _id: "skills:source",
        slug: "merge-source",
        displayName: "Merge Source",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:org",
        moderationStatus: "hidden",
        softDeletedAt: undefined,
        statsDownloads: 7,
        statsStars: 2,
      },
      {
        _id: "skills:target",
        slug: "merge-target",
        displayName: "Merge Target",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:org",
        latestVersionId: "skillVersions:target",
        moderationStatus: "hidden",
        softDeletedAt: undefined,
      },
    ];
    const aliases = [
      {
        _id: "skillSlugAliases:old",
        slug: "merge-source-old",
        skillId: "skills:source",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:org",
      },
    ];

    const result = await mergeOwnedSkillIntoCanonicalInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          system: {},
          get: vi.fn(async (id: string) => {
            if (id === "users:actor") return { _id: "users:actor", role: "user" };
            if (id === "users:creator") {
              return {
                _id: "users:creator",
                publishedSkills: 2,
                totalDownloads: 9,
                totalStars: 5,
              };
            }
            if (id === "publishers:org") {
              return {
                _id: "publishers:org",
                kind: "org",
                handle: "team",
                linkedUserId: undefined,
              };
            }
            if (id === "skillVersions:target") return { _id: id, version: "1.2.3" };
            return skills.find((skill) => skill._id === id) ?? null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name === "by_slug") {
                    return {
                      unique: async () =>
                        skills.find((skill) => skill.slug === constraints.slug) ?? null,
                    };
                  }
                  if (name === "by_canonical" || name === "by_fork_of") {
                    return { collect: async () => [] };
                  }
                  throw new Error(`unexpected skills index ${name}`);
                },
              };
            }
            if (table === "publisherMembers") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_publisher_user") {
                    throw new Error(`unexpected publisherMembers index ${name}`);
                  }
                  return {
                    unique: async () => ({
                      _id: "publisherMembers:1",
                      publisherId: "publishers:org",
                      userId: "users:actor",
                      role: "admin",
                    }),
                  };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name === "by_skill") {
                    return {
                      collect: async () =>
                        aliases.filter((alias) => alias.skillId === constraints.skillId),
                    };
                  }
                  if (name === "by_slug") {
                    return {
                      unique: async () =>
                        aliases.find((alias) => alias.slug === constraints.slug) ?? null,
                    };
                  }
                  if (name === "by_owner_publisher") {
                    return {
                      take: async () =>
                        aliases.filter(
                          (alias) => alias.ownerPublisherId === constraints.ownerPublisherId,
                        ),
                    };
                  }
                  if (name === "by_owner") {
                    return {
                      take: async () =>
                        aliases.filter((alias) => alias.ownerUserId === constraints.ownerUserId),
                    };
                  }
                  throw new Error(`unexpected skillSlugAliases index ${name}`);
                },
              };
            }
            if (table === "skillEmbeddings") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_skill") {
                    throw new Error(`unexpected skillEmbeddings index ${name}`);
                  }
                  return { collect: async () => [] };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
          patch,
          insert,
        },
      } as never,
      {
        actorUserId: "users:actor",
        sourceSlug: "merge-source",
        targetSlug: "merge-target",
      },
    );

    expect(result).toEqual({
      ok: true,
      sourceSlug: "merge-source",
      targetSlug: "merge-target",
    });
    expect(patch).toHaveBeenCalledWith(
      "skillSlugAliases:old",
      expect.objectContaining({
        skillId: "skills:target",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:org",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillSlugAliases",
      expect.objectContaining({
        slug: "merge-source",
        skillId: "skills:target",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:org",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:source",
      expect.objectContaining({
        canonicalSkillId: "skills:target",
        forkOf: expect.objectContaining({
          skillId: "skills:target",
          kind: "duplicate",
          version: "1.2.3",
        }),
        moderationReason: "owner.merged",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "users:creator",
      expect.objectContaining({
        publishedSkills: 1,
        totalDownloads: 2,
        totalStars: 3,
      }),
    );
  });

  it("rejects merges that would reserve too many historical slugs for one skill", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const skills = [
      {
        _id: "skills:source",
        slug: "merge-source",
        displayName: "Merge Source",
        ownerUserId: "users:actor",
        moderationStatus: "hidden",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:target",
        slug: "merge-target",
        displayName: "Merge Target",
        ownerUserId: "users:actor",
        moderationStatus: "hidden",
        softDeletedAt: undefined,
      },
    ];
    const aliases = Array.from({ length: 5 }, (_, index) => ({
      _id: `skillSlugAliases:target-${index}`,
      slug: `target-old-${index}`,
      skillId: "skills:target",
      ownerUserId: "users:actor",
      ownerPublisherId: undefined,
    }));

    await expect(
      mergeOwnedSkillIntoCanonicalInternalHandler(
        {
          db: {
            normalizeId: vi.fn(() => null),
            system: {},
            get: vi.fn(async (id: string) => {
              if (id === "users:actor") return { _id: "users:actor", role: "user" };
              return skills.find((skill) => skill._id === id) ?? null;
            }),
            query: vi.fn((table: string) => {
              if (table === "skills") {
                return {
                  withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                    const constraints: Record<string, unknown> = {};
                    build(chainEq(constraints));
                    if (name === "by_slug") {
                      return {
                        unique: async () =>
                          skills.find((skill) => skill.slug === constraints.slug) ?? null,
                      };
                    }
                    if (name === "by_canonical" || name === "by_fork_of") {
                      return { collect: async () => [] };
                    }
                    throw new Error(`unexpected skills index ${name}`);
                  },
                };
              }
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                    const constraints: Record<string, unknown> = {};
                    build(chainEq(constraints));
                    if (name === "by_skill") {
                      return {
                        collect: async () =>
                          aliases.filter((alias) => alias.skillId === constraints.skillId),
                      };
                    }
                    if (name === "by_slug") {
                      return {
                        unique: async () =>
                          aliases.find((alias) => alias.slug === constraints.slug) ?? null,
                      };
                    }
                    if (name === "by_owner") {
                      return {
                        take: async () =>
                          aliases.filter((alias) => alias.ownerUserId === constraints.ownerUserId),
                      };
                    }
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  },
                };
              }
              throw new Error(`unexpected table ${table}`);
            }),
            patch,
            insert,
          },
        } as never,
        {
          actorUserId: "users:actor",
          sourceSlug: "merge-source",
          targetSlug: "merge-target",
        },
      ),
    ).rejects.toThrow(/Too many historical slugs/);

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
