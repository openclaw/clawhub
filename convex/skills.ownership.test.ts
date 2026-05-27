import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import {
  getSkillBySlugInternal,
  mergeOwnedSkillIntoCanonicalInternal,
  renameOwnedSkillInternal,
  transferSkillOwnerForUserInternal,
} from "./skills";

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
const renameOwnedSkillInternalHandler = (
  renameOwnedSkillInternal as unknown as WrappedHandler<{
    actorUserId: string;
    slug: string;
    newSlug: string;
  }>
)._handler;
const transferSkillOwnerForUserInternalHandler = (
  transferSkillOwnerForUserInternal as unknown as WrappedHandler<{
    actorUserId: string;
    slug: string;
    toOwner: string;
    reason?: string;
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

  it("allows publisher admins to rename publisher-owned skills", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "skillSlugAliases:old");
    const skill = {
      _id: "skills:source",
      slug: "old-name",
      displayName: "Old Name",
      ownerUserId: "users:creator",
      ownerPublisherId: "publishers:org",
      softDeletedAt: undefined,
    };

    const result = await renameOwnedSkillInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          get: vi.fn(async (id: string) => {
            if (id === "users:actor") return { _id: "users:actor", role: "user" };
            if (id === "publishers:org") return { _id: "publishers:org", kind: "org" };
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return {
                    unique: async () => (constraints.slug === "old-name" ? skill : null),
                  };
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
                withIndex: (name: string) => {
                  if (name === "by_slug") return { unique: async () => null };
                  if (name === "by_skill") return { collect: async () => [] };
                  if (name === "by_owner_publisher") return { take: async () => [] };
                  throw new Error(`unexpected skillSlugAliases index ${name}`);
                },
              };
            }
            if (table === "reservedSlugs") {
              return {
                withIndex: () => ({
                  order: () => ({ take: async () => [] }),
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
          patch,
          insert,
          delete: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:actor",
        slug: "old-name",
        newSlug: "new-name",
      },
    );

    expect(result).toEqual({ ok: true, slug: "new-name", previousSlug: "old-name" });
    expect(patch).toHaveBeenCalledWith(
      "skills:source",
      expect.objectContaining({ slug: "new-name" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillSlugAliases",
      expect.objectContaining({
        slug: "old-name",
        skillId: "skills:source",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:org",
      }),
    );
  });

  it("allows publisher admins to move a skill into an org they administer", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const skill = {
      _id: "skills:source",
      slug: "portable",
      displayName: "Portable",
      ownerUserId: "users:actor",
      ownerPublisherId: "publishers:personal",
      softDeletedAt: undefined,
    };
    const aliases = [
      {
        _id: "skillSlugAliases:old",
        slug: "portable-old",
        skillId: "skills:source",
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:personal",
      },
    ];

    const result = await transferSkillOwnerForUserInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          get: vi.fn(async (id: string) => {
            if (id === "users:actor") return { _id: "users:actor", role: "user" };
            if (id === "publishers:personal") {
              return {
                _id: "publishers:personal",
                kind: "user",
                handle: "actor",
                linkedUserId: "users:actor",
              };
            }
            if (id === "publishers:org") {
              return {
                _id: "publishers:org",
                kind: "org",
                handle: "team",
                displayName: "Team",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return { unique: async () => (constraints.slug === "portable" ? skill : null) };
                },
              };
            }
            if (table === "publishers") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_handle") throw new Error(`unexpected publishers index ${name}`);
                  return {
                    unique: async () => ({
                      _id: "publishers:org",
                      kind: "org",
                      handle: "team",
                      deletedAt: undefined,
                      deactivatedAt: undefined,
                    }),
                  };
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
                withIndex: (name: string) => {
                  if (name !== "by_skill") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { collect: async () => aliases };
                },
              };
            }
            if (table === "skillSearchDigest") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_skill") {
                    throw new Error(`unexpected skillSearchDigest index ${name}`);
                  }
                  return { unique: async () => ({ _id: "skillSearchDigest:source" }) };
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
        slug: "portable",
        toOwner: "team",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        transferred: true,
        skillSlug: "portable",
        toPublisherHandle: "team",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:source",
      expect.objectContaining({
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:org",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillSlugAliases:old",
      expect.objectContaining({
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:org",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:source",
      expect.objectContaining({
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:org",
        ownerHandle: "team",
        ownerKind: "org",
      }),
    );
  });

  it("rejects stale personal publisher memberships as skill transfer destinations", async () => {
    const patch = vi.fn(async () => {});
    const skill = {
      _id: "skills:source",
      slug: "portable",
      displayName: "Portable",
      ownerUserId: "users:actor",
      ownerPublisherId: "publishers:actor",
      softDeletedAt: undefined,
    };

    await expect(
      transferSkillOwnerForUserInternalHandler(
        {
          db: {
            normalizeId: vi.fn(() => null),
            get: vi.fn(async (id: string) => {
              if (id === "users:actor") return { _id: "users:actor", role: "user" };
              if (id === "users:owner") return { _id: "users:owner", role: "user" };
              if (id === "publishers:actor") {
                return {
                  _id: "publishers:actor",
                  kind: "user",
                  handle: "actor",
                  linkedUserId: "users:actor",
                };
              }
              if (id === "publishers:owner") {
                return {
                  _id: "publishers:owner",
                  kind: "user",
                  handle: "owner",
                  linkedUserId: "users:owner",
                  deletedAt: undefined,
                  deactivatedAt: undefined,
                };
              }
              return null;
            }),
            query: vi.fn((table: string) => {
              if (table === "skills") {
                return {
                  withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                    const constraints: Record<string, unknown> = {};
                    build(chainEq(constraints));
                    if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                    return { unique: async () => (constraints.slug === "portable" ? skill : null) };
                  },
                };
              }
              if (table === "publishers") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_handle") {
                      throw new Error(`unexpected publishers index ${name}`);
                    }
                    return {
                      unique: async () => ({
                        _id: "publishers:owner",
                        kind: "user",
                        handle: "owner",
                        linkedUserId: "users:owner",
                        deletedAt: undefined,
                        deactivatedAt: undefined,
                      }),
                    };
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
                        _id: "publisherMembers:stale",
                        publisherId: "publishers:owner",
                        userId: "users:actor",
                        role: "admin",
                      }),
                    };
                  },
                };
              }
              throw new Error(`unexpected table ${table}`);
            }),
            patch,
            insert: vi.fn(),
          },
        } as never,
        {
          actorUserId: "users:actor",
          slug: "portable",
          toOwner: "owner",
        },
      ),
    ).rejects.toThrow('admin access for "@owner"');

    expect(patch).not.toHaveBeenCalled();
  });

  it("allows transfers into the actor's legacy no-link personal publisher", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const skill = {
      _id: "skills:source",
      slug: "portable",
      displayName: "Portable",
      ownerUserId: "users:actor",
      ownerPublisherId: "publishers:actor",
      softDeletedAt: undefined,
    };
    const aliases = [
      {
        _id: "skillSlugAliases:old",
        slug: "portable-old",
        skillId: "skills:source",
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:actor",
      },
    ];

    const result = await transferSkillOwnerForUserInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          get: vi.fn(async (id: string) => {
            if (id === "users:actor") {
              return {
                _id: "users:actor",
                role: "user",
                personalPublisherId: "publishers:actor-legacy",
              };
            }
            if (id === "publishers:actor") {
              return {
                _id: "publishers:actor",
                kind: "user",
                handle: "actor",
                linkedUserId: "users:actor",
              };
            }
            if (id === "publishers:actor-legacy") {
              return {
                _id: "publishers:actor-legacy",
                kind: "user",
                handle: "actor-legacy",
                linkedUserId: undefined,
                deletedAt: undefined,
                deactivatedAt: undefined,
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return { unique: async () => (constraints.slug === "portable" ? skill : null) };
                },
              };
            }
            if (table === "publishers") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_handle") {
                    throw new Error(`unexpected publishers index ${name}`);
                  }
                  return {
                    unique: async () => ({
                      _id: "publishers:actor-legacy",
                      kind: "user",
                      handle: "actor-legacy",
                      linkedUserId: undefined,
                      deletedAt: undefined,
                      deactivatedAt: undefined,
                    }),
                  };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_skill") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { collect: async () => aliases };
                },
              };
            }
            if (table === "skillSearchDigest") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_skill") {
                    throw new Error(`unexpected skillSearchDigest index ${name}`);
                  }
                  return { unique: async () => ({ _id: "skillSearchDigest:source" }) };
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
        slug: "portable",
        toOwner: "actor-legacy",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      transferred: true,
      toPublisherHandle: "actor-legacy",
    });
    expect(patch).toHaveBeenCalledWith(
      "skills:source",
      expect.objectContaining({
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:actor-legacy",
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
