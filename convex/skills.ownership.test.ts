import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import {
  getSkillForPublishPreflightInternal,
  getSkillBySlugInternal,
  mergeOwnedSkillIntoCanonicalInternal,
  renameOwnedSkillInternal,
  resolveVersionByHash,
  transferSkillOwnerForUserInternal,
} from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getSkillBySlugInternalHandler = (
  getSkillBySlugInternal as unknown as WrappedHandler<{ slug: string }>
)._handler;
const getSkillForPublishPreflightInternalHandler = (
  getSkillForPublishPreflightInternal as unknown as WrappedHandler<{
    userId: string;
    slug: string;
    ownerPublisherId?: string;
    sourceOwnerPublisherId?: string;
    migrateOwner?: boolean;
  }>
)._handler;
const resolveVersionByHashHandler = (
  resolveVersionByHash as unknown as WrappedHandler<{
    slug: string;
    hash: string;
    ownerHandle?: string;
  }>
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
  it("resolves publish preflight by owner namespace instead of global slug", async () => {
    const constraintsByIndex: Array<{
      table: string;
      index: string;
      constraints: Record<string, unknown>;
    }> = [];

    const result = await getSkillForPublishPreflightInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:caller") {
              return {
                _id: "users:caller",
                handle: "caller",
                personalPublisherId: "publishers:personal",
                deletedAt: undefined,
                deactivatedAt: undefined,
              };
            }
            if (id === "publishers:personal") {
              return {
                _id: "publishers:personal",
                kind: "user",
                handle: "caller",
                linkedUserId: "users:caller",
                deletedAt: undefined,
                deactivatedAt: undefined,
              };
            }
            if (id === "publishers:org") {
              return {
                _id: "publishers:org",
                kind: "org",
                handle: "team",
                deletedAt: undefined,
                deactivatedAt: undefined,
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table !== "skills") throw new Error(`unexpected table ${table}`);
            return {
              withIndex: (
                index: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                if (index === "by_slug") {
                  throw new Error("publish preflight must not use global by_slug");
                }
                const constraints: Record<string, unknown> = {};
                const q = chainEq(constraints);
                build(q);
                constraintsByIndex.push({ table, index, constraints });
                return {
                  unique: async () =>
                    index === "by_owner_publisher_slug" &&
                    constraints.ownerPublisherId === "publishers:org" &&
                    constraints.slug === "publish"
                      ? {
                          _id: "skills:orgPublish",
                          slug: "publish",
                          ownerUserId: "users:caller",
                          ownerPublisherId: "publishers:org",
                          summary: "Grandfathered reserved slug",
                        }
                      : null,
                };
              },
            };
          }),
        },
      } as never,
      {
        userId: "users:caller",
        slug: "publish",
        ownerPublisherId: "publishers:org",
      } as never,
    );

    expect(result).toMatchObject({
      _id: "skills:orgPublish",
      ownerPublisherId: "publishers:org",
    });
    expect(constraintsByIndex).toEqual([
      {
        table: "skills",
        index: "by_owner_publisher_slug",
        constraints: {
          ownerPublisherId: "publishers:org",
          slug: "publish",
        },
      },
    ]);
  });

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
                    take: async () => [],
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
                    take: async () => [
                      {
                        _id: "skillSlugAliases:1",
                        slug: "demo-old",
                        skillId: "skills:target",
                      },
                    ],
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

  it("prefers openclaw for legacy slug-only reads when duplicate visible skills exist", async () => {
    const skills = [
      {
        _id: "skills:community",
        slug: "demo",
        ownerUserId: "users:community",
        ownerPublisherId: "publishers:community",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:openclaw",
        slug: "demo",
        ownerUserId: "users:openclaw",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
      },
    ];

    const result = await getSkillBySlugInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          system: {},
          get: vi.fn(async (id: string) => {
            if (id === "publishers:community") {
              return { _id: id, kind: "org", handle: "community" };
            }
            if (id === "publishers:openclaw") {
              return { _id: id, kind: "org", handle: "openclaw" };
            }
            return skills.find((entry) => entry._id === id) ?? null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return {
                    take: async () => skills,
                    unique: async () => {
                      throw new Error("unique should not be used for legacy duplicate reads");
                    },
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      } as never,
      { slug: "demo" } as never,
    );

    expect(result).toEqual(expect.objectContaining({ _id: "skills:openclaw" }));
  });

  it("ignores soft-deleted duplicates before treating legacy slug-only reads as ambiguous", async () => {
    const skills = [
      {
        _id: "skills:visible",
        slug: "demo",
        ownerUserId: "users:visible",
        ownerPublisherId: "publishers:visible",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:deleted",
        slug: "demo",
        ownerUserId: "users:deleted",
        ownerPublisherId: "publishers:deleted",
        softDeletedAt: 123,
      },
    ];

    const result = await getSkillBySlugInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          system: {},
          get: vi.fn(async (id: string) => skills.find((entry) => entry._id === id) ?? null),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return {
                    take: async () => skills,
                    unique: async () => {
                      throw new Error("unique should not be used for legacy duplicate reads");
                    },
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      } as never,
      { slug: "demo" } as never,
    );

    expect(result).toEqual(expect.objectContaining({ _id: "skills:visible" }));
  });

  it("does not resolve owner-scoped public version metadata for soft-deleted skills", async () => {
    const result = await resolveVersionByHashHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "publishers:openclaw") {
              return {
                _id: id,
                kind: "org",
                handle: "openclaw",
                deletedAt: undefined,
                deactivatedAt: undefined,
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "publishers") {
              return {
                withIndex: (
                  name: string,
                  build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
                ) => {
                  if (name !== "by_handle") throw new Error(`unexpected publishers index ${name}`);
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  return {
                    unique: async () =>
                      constraints.handle === "openclaw"
                        ? {
                            _id: "publishers:openclaw",
                            kind: "org",
                            handle: "openclaw",
                            deletedAt: undefined,
                            deactivatedAt: undefined,
                          }
                        : null,
                  };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (
                  name: string,
                  build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
                ) => {
                  if (name !== "by_owner_publisher_slug") {
                    throw new Error(`unexpected aliases index ${name}`);
                  }
                  build(chainEq({}));
                  return { unique: async () => null };
                },
              };
            }
            if (table !== "skills") {
              throw new Error(`soft-deleted skill should stop before querying ${table}`);
            }
            return {
              withIndex: (
                name: string,
                build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                if (name !== "by_owner_publisher_slug") {
                  throw new Error(`unexpected skills index ${name}`);
                }
                const constraints: Record<string, unknown> = {};
                build(chainEq(constraints));
                return {
                  unique: async () => ({
                    _id: "skills:deleted",
                    slug: "demo",
                    ownerUserId: "users:openclaw",
                    ownerPublisherId: "publishers:openclaw",
                    latestVersionId: "skillVersions:latest",
                    softDeletedAt: 123,
                  }),
                };
              },
            };
          }),
        },
      } as never,
      {
        slug: "demo",
        ownerHandle: "openclaw",
        hash: "a".repeat(64),
      },
    );

    expect(result).toBeNull();
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
                      take: async () =>
                        skills.filter((skill) => skill.slug === constraints.slug).slice(0, 2),
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
                      take: async () =>
                        aliases.filter((alias) => alias.slug === constraints.slug).slice(0, 2),
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
                  if (name === "by_owner_publisher_slug") {
                    return {
                      unique: async () =>
                        aliases.find(
                          (alias) =>
                            alias.ownerPublisherId === constraints.ownerPublisherId &&
                            alias.slug === constraints.slug,
                        ) ?? null,
                    };
                  }
                  if (name === "by_owner_slug") {
                    return {
                      unique: async () =>
                        aliases.find(
                          (alias) =>
                            alias.ownerUserId === constraints.ownerUserId &&
                            alias.slug === constraints.slug,
                        ) ?? null,
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
                  if (name === "by_owner_publisher_slug") {
                    return { unique: async () => null };
                  }
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return {
                    take: async () => (constraints.slug === "old-name" ? [skill] : []),
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
                  if (name === "by_owner_publisher_slug") return { unique: async () => null };
                  if (name === "by_owner_slug") return { unique: async () => null };
                  if (name === "by_slug") return { take: async () => [], unique: async () => null };
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
                  return {
                    take: async () => (constraints.slug === "portable" ? [skill] : []),
                    unique: async () => (constraints.slug === "portable" ? skill : null),
                  };
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
                        take: async () =>
                          skills.filter((skill) => skill.slug === constraints.slug).slice(0, 2),
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
                        take: async () =>
                          aliases.filter((alias) => alias.slug === constraints.slug).slice(0, 2),
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
