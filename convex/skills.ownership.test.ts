import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { getAuthUserId } from "@convex-dev/auth/server";
import {
  changeOwner,
  getBySlug,
  getSkillForPublishPreflightInternal,
  getSkillBySlugInternal,
  mergeOwnedSkillIntoCanonicalInternal,
  renameOwnedSkillInternal,
  resolveVersionByHash,
  setDuplicate,
  transferSkillOwnerForUserInternal,
} from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getSkillBySlugInternalHandler = (
  getSkillBySlugInternal as unknown as WrappedHandler<{ slug: string }>
)._handler;
const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<{ slug: string; ownerHandle?: string }>
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
    sourceOwnerHandle?: string;
    targetOwnerHandle?: string;
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
const changeOwnerHandler = (
  changeOwner as unknown as WrappedHandler<{
    skillId: string;
    ownerUserId: string;
  }>
)._handler;
const setDuplicateHandler = (
  setDuplicate as unknown as WrappedHandler<{
    skillId: string;
    canonicalSlug?: string;
    canonicalSkillId?: string;
  }>
)._handler;

afterEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

const defaultSkillStats = {
  downloads: 0,
  stars: 0,
  installsCurrent: 0,
  installsAllTime: 0,
  versions: 1,
  comments: 0,
};

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
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
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
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
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
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
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

  it("returns an ambiguous result for legacy slug-only version resolution", async () => {
    const skills = [
      {
        _id: "skills:one",
        slug: "demo",
        ownerUserId: "users:one",
        ownerPublisherId: "publishers:one",
        latestVersionId: "skillVersions:one",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:two",
        slug: "demo",
        ownerUserId: "users:two",
        ownerPublisherId: "publishers:two",
        latestVersionId: "skillVersions:two",
        softDeletedAt: undefined,
      },
    ];

    const result = await resolveVersionByHashHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "publishers:one") {
              return { _id: id, kind: "org", handle: "one" };
            }
            if (id === "publishers:two") {
              return { _id: id, kind: "org", handle: "two" };
            }
            return skills.find((entry) => entry._id === id) ?? null;
          }),
          query: vi.fn((table: string) => {
            return {
              withIndex: (name: string) => {
                if (table === "skills" && name !== "by_slug") {
                  throw new Error(`unexpected skills index ${name}`);
                }
                if (table === "skillSlugAliases" && name !== "by_slug") {
                  throw new Error(`unexpected skillSlugAliases index ${name}`);
                }
                if (table !== "skills" && table !== "skillSlugAliases") {
                  throw new Error(`unexpected table ${table}`);
                }
                return {
                  take: async () => (table === "skills" ? skills : []),
                  unique: async () => {
                    throw new Error("unique should not be used for legacy duplicate reads");
                  },
                };
              },
            };
          }),
        },
      } as never,
      { slug: "demo", hash: "a".repeat(64) } as never,
    );

    expect(result).toEqual({
      match: null,
      latestVersion: null,
      ambiguous: true,
      ambiguousMatches: [
        { slug: "demo", ownerHandle: "one" },
        { slug: "demo", ownerHandle: "two" },
      ],
    });
  });

  it("returns an ambiguous result for legacy slug-only public skill lookups", async () => {
    const skills = [
      {
        _id: "skills:one",
        slug: "demo",
        ownerUserId: "users:one",
        ownerPublisherId: "publishers:one",
        latestVersionId: "skillVersions:one",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:two",
        slug: "demo",
        ownerUserId: "users:two",
        ownerPublisherId: "publishers:two",
        latestVersionId: "skillVersions:two",
        softDeletedAt: undefined,
      },
    ];

    const result = await getBySlugHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "publishers:one") {
              return { _id: id, kind: "org", handle: "one" };
            }
            if (id === "publishers:two") {
              return { _id: id, kind: "org", handle: "two" };
            }
            return skills.find((entry) => entry._id === id) ?? null;
          }),
          query: vi.fn((table: string) => {
            return {
              withIndex: (name: string) => {
                if (table === "skills" && name !== "by_slug") {
                  throw new Error(`unexpected skills index ${name}`);
                }
                if (table === "skillSlugAliases" && name !== "by_slug") {
                  throw new Error(`unexpected skillSlugAliases index ${name}`);
                }
                if (table !== "skills" && table !== "skillSlugAliases") {
                  throw new Error(`unexpected table ${table}`);
                }
                return {
                  take: async () => (table === "skills" ? skills : []),
                  unique: async () => {
                    throw new Error("unique should not be used for legacy duplicate reads");
                  },
                };
              },
            };
          }),
          system: {},
        },
        auth: { getUserIdentity: vi.fn() },
      } as never,
      { slug: "demo" } as never,
    );

    expect(result).toMatchObject({ skill: null, ambiguous: true });
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
                  if (name === "by_owner_publisher_slug") {
                    return {
                      unique: async () =>
                        skills.find(
                          (skill) =>
                            skill.ownerPublisherId === constraints.ownerPublisherId &&
                            skill.slug === constraints.slug,
                        ) ?? null,
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

  it("preserves source-owner redirects when merging across owner namespaces", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const deleteAlias = vi.fn(async () => {});
    const skills = [
      {
        _id: "skills:source",
        slug: "merge-source",
        displayName: "Merge Source",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:alice",
        moderationStatus: "hidden",
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        softDeletedAt: undefined,
      },
      {
        _id: "skills:target",
        slug: "merge-target",
        displayName: "Merge Target",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:team",
        moderationStatus: "hidden",
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        softDeletedAt: undefined,
      },
    ];
    const aliases = [
      {
        _id: "skillSlugAliases:source-old",
        slug: "shared-old",
        skillId: "skills:source",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:alice",
      },
      {
        _id: "skillSlugAliases:team-old",
        slug: "shared-old",
        skillId: "skills:other",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:team",
      },
    ];
    const publishers = [
      {
        _id: "publishers:alice",
        kind: "org",
        handle: "alice",
        deletedAt: undefined,
        deactivatedAt: undefined,
      },
      {
        _id: "publishers:team",
        kind: "org",
        handle: "team",
        deletedAt: undefined,
        deactivatedAt: undefined,
      },
    ];

    const result = await mergeOwnedSkillIntoCanonicalInternalHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          system: {},
          get: vi.fn(async (id: string) => {
            if (id === "users:actor") return { _id: "users:actor", role: "user" };
            if (id === "users:creator") return { _id: "users:creator" };
            return (
              skills.find((skill) => skill._id === id) ??
              publishers.find((publisher) => publisher._id === id) ??
              null
            );
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name === "by_owner_publisher_slug") {
                    return {
                      unique: async () =>
                        skills.find(
                          (skill) =>
                            skill.ownerPublisherId === constraints.ownerPublisherId &&
                            skill.slug === constraints.slug,
                        ) ?? null,
                    };
                  }
                  if (name === "by_canonical" || name === "by_fork_of") {
                    return { collect: async () => [] };
                  }
                  throw new Error(`unexpected skills index ${name}`);
                },
              };
            }
            if (table === "publishers") {
              return {
                withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build(chainEq(constraints));
                  if (name !== "by_handle") {
                    throw new Error(`unexpected publishers index ${name}`);
                  }
                  return {
                    unique: async () =>
                      publishers.find((publisher) => publisher.handle === constraints.handle) ??
                      null,
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
                      publisherId: "publishers:team",
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
                  if (name === "by_owner_publisher") {
                    return {
                      take: async () =>
                        aliases
                          .filter(
                            (alias) => alias.ownerPublisherId === constraints.ownerPublisherId,
                          )
                          .slice(0, 25),
                    };
                  }
                  if (name === "by_owner_slug") {
                    return {
                      take: async () =>
                        aliases
                          .filter(
                            (alias) =>
                              alias.ownerUserId === constraints.ownerUserId &&
                              alias.slug === constraints.slug,
                          )
                          .slice(0, 25),
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
          delete: deleteAlias,
        },
      } as never,
      {
        actorUserId: "users:actor",
        sourceSlug: "merge-source",
        targetSlug: "merge-target",
        sourceOwnerHandle: "alice",
        targetOwnerHandle: "team",
      },
    );

    expect(result).toEqual({
      ok: true,
      sourceSlug: "merge-source",
      targetSlug: "merge-target",
    });
    expect(patch).toHaveBeenCalledWith(
      "skillSlugAliases:source-old",
      expect.objectContaining({
        skillId: "skills:target",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillSlugAliases",
      expect.objectContaining({
        slug: "merge-source",
        skillId: "skills:target",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(deleteAlias).not.toHaveBeenCalled();
  });

  it("sets duplicate relationships by canonical skill id when slugs are ambiguous", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:moderator" as never);
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const skills = [
      {
        _id: "skills:source",
        slug: "demo",
        ownerUserId: "users:alice",
        ownerPublisherId: "publishers:alice",
      },
      {
        _id: "skills:canonical",
        slug: "demo",
        ownerUserId: "users:team",
        ownerPublisherId: "publishers:team",
        latestVersionId: "skillVersions:canonical",
      },
    ];

    await setDuplicateHandler(
      {
        db: {
          normalizeId: vi.fn(() => null),
          system: {},
          get: vi.fn(async (id: string) => {
            if (id === "users:moderator") return { _id: id, role: "moderator" };
            if (id === "skillVersions:canonical") return { _id: id, version: "2.0.0" };
            return skills.find((skill) => skill._id === id) ?? null;
          }),
          query: vi.fn(),
          patch,
          insert,
        },
      } as never,
      { skillId: "skills:source", canonicalSkillId: "skills:canonical" },
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:source",
      expect.objectContaining({
        canonicalSkillId: "skills:canonical",
        forkOf: expect.objectContaining({
          skillId: "skills:canonical",
          kind: "duplicate",
          version: "2.0.0",
        }),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.duplicate.set",
        metadata: { canonicalSlug: "demo", canonicalSkillId: "skills:canonical" },
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
      latestVersionId: "skillVersions:latest",
      softDeletedAt: undefined,
    };
    const latestVersion = {
      _id: "skillVersions:latest",
      version: "1.0.0",
      files: [{ path: "SKILL.md", size: 5, storageId: "storage:skill", sha256: "sha" }],
      createdAt: 1_700_000_000_000,
      softDeletedAt: undefined,
    };

    const result = await renameOwnedSkillInternalHandler(
      {
        scheduler: { runAfter: vi.fn(async () => {}) },
        db: {
          normalizeId: vi.fn(() => null),
          get: vi.fn(async (id: string) => {
            if (id === "users:actor") return { _id: "users:actor", role: "user" };
            if (id === "publishers:org") {
              return { _id: "publishers:org", kind: "org", handle: "org" };
            }
            if (id === "skillVersions:latest") return latestVersion;
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
    const deleteDoc = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const skill = {
      _id: "skills:source",
      slug: "portable",
      displayName: "Portable",
      ownerUserId: "users:actor",
      ownerPublisherId: "publishers:personal",
      softDeletedAt: undefined,
      moderationVerdict: "clean",
      moderationReasonCodes: ["suspicious.dynamic_code_execution"],
      stats: defaultSkillStats,
    };
    const aliases = [
      {
        _id: "skillSlugAliases:old",
        slug: "portable-old",
        skillId: "skills:source",
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:personal",
      },
      {
        _id: "skillSlugAliases:source-owned",
        slug: "source-namespace-redirect",
        skillId: "skills:source",
        ownerUserId: "users:creator",
        ownerPublisherId: "publishers:source",
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
                  if (name !== "by_slug" && name !== "by_owner_publisher_slug") {
                    throw new Error(`unexpected skills index ${name}`);
                  }
                  return {
                    take: async () =>
                      name === "by_slug" && constraints.slug === "portable" ? [skill] : [],
                    unique: async () =>
                      name === "by_slug" && constraints.slug === "portable" ? skill : null,
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
                withIndex: (name: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
                  const constraints: Record<string, unknown> = {};
                  build?.(chainEq(constraints));
                  if (
                    name !== "by_skill" &&
                    name !== "by_owner_publisher_slug" &&
                    name !== "by_slug"
                  ) {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return {
                    collect: async () => aliases,
                    unique: async () =>
                      name === "by_owner_publisher_slug" &&
                      constraints.ownerPublisherId === "publishers:org" &&
                      constraints.slug === "portable"
                        ? {
                            _id: "skillSlugAliases:destination-conflict",
                            slug: "portable",
                            skillId: "skills:destination",
                            ownerUserId: "users:actor",
                            ownerPublisherId: "publishers:org",
                          }
                        : null,
                  };
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
          delete: deleteDoc,
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
    expect(patch).not.toHaveBeenCalledWith("skillSlugAliases:old", expect.anything());
    expect(patch).not.toHaveBeenCalledWith("skillSlugAliases:source-owned", expect.anything());
    expect(deleteDoc).toHaveBeenCalledWith("skillSlugAliases:destination-conflict");
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:source",
      expect.objectContaining({
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:org",
        ownerHandle: "team",
        ownerKind: "org",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.owner.transfer",
        metadata: expect.objectContaining({
          replacedDestinationAliasId: "skillSlugAliases:destination-conflict",
          replacedDestinationAliasSkillId: "skills:destination",
        }),
      }),
    );
  });

  it("rejects direct owner transfers when the destination already has the slug", async () => {
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
    const destinationSkill = {
      ...skill,
      _id: "skills:destination",
      ownerPublisherId: "publishers:org",
    };

    await expect(
      transferSkillOwnerForUserInternalHandler(
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
                    if (name !== "by_slug" && name !== "by_owner_publisher_slug") {
                      throw new Error(`unexpected skills index ${name}`);
                    }
                    return {
                      take: async () =>
                        name === "by_slug" && constraints.slug === "portable" ? [skill] : [],
                      unique: async () => {
                        if (name === "by_slug" && constraints.slug === "portable") return skill;
                        if (
                          name === "by_owner_publisher_slug" &&
                          constraints.slug === "portable" &&
                          constraints.ownerPublisherId === "publishers:org"
                        ) {
                          return destinationSkill;
                        }
                        return null;
                      },
                    };
                  },
                };
              }
              if (table === "publishers") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_handle")
                      throw new Error(`unexpected publishers index ${name}`);
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
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_skill" && name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return {
                      collect: async () => [],
                      take: async () => [],
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
                    if (name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return { take: async () => [] };
                  },
                };
              }
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return { take: async () => [] };
                  },
                };
              }
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return { take: async () => [] };
                  },
                };
              }
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return { take: async () => [] };
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
      ),
    ).rejects.toThrow(
      'Destination owner @team already has skill "portable". Choose a different slug or publish without migrating ownership.',
    );

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("allows platform admins to transfer a soft-deleted skill without restoring it", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const softDeletedAt = 123;
    const skill = {
      _id: "skills:deleted",
      slug: "deleted-demo",
      displayName: "Deleted Demo",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:previous",
      softDeletedAt,
      hiddenBy: "users:admin",
      moderationStatus: "hidden",
      moderationVerdict: "clean",
      forkOf: undefined as
        | {
            skillId: string;
            kind: "duplicate";
            at: number;
          }
        | undefined,
      stats: defaultSkillStats,
    };
    let hideAuditActorRole: "admin" | "moderator" | "user" = "user";
    let ownerCurrentRole: "admin" | "moderator" | "user" = "user";
    let hasMergeAudit = false;

    const ctx = {
      db: {
        normalizeId: vi.fn(() => null),
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: "users:admin", role: "admin" };
          if (id === "users:owner") return { _id: "users:owner", role: ownerCurrentRole };
          if (id === "publishers:previous") {
            return {
              _id: "publishers:previous",
              kind: "user",
              handle: "owner",
              linkedUserId: "users:owner",
            };
          }
          if (id === "publishers:team") {
            return {
              _id: "publishers:team",
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
                if (name !== "by_slug" && name !== "by_owner_publisher_slug") {
                  throw new Error(`unexpected skills index ${name}`);
                }
                return {
                  take: async () =>
                    name === "by_slug" && constraints.slug === "deleted-demo" ? [skill] : [],
                  unique: async () => null,
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
                    _id: "publishers:team",
                    kind: "org",
                    handle: "team",
                    displayName: "Team",
                    deletedAt: undefined,
                    deactivatedAt: undefined,
                  }),
                };
              },
            };
          }
          if (table === "auditLogs") {
            return {
              withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
                const constraints: Record<string, unknown> = {};
                build(chainEq(constraints));
                if (name !== "by_target_createdAt") {
                  throw new Error(`unexpected auditLogs index ${name}`);
                }
                return {
                  take: async () => {
                    if (constraints.createdAt === softDeletedAt) {
                      return [
                        {
                          _id: "auditLogs:delete",
                          action: "skill.delete",
                          actorUserId: skill.hiddenBy,
                          targetType: "skill",
                          targetId: skill._id,
                          createdAt: softDeletedAt,
                          metadata: {
                            actorRole: hideAuditActorRole,
                            softDeletedAt,
                          },
                        },
                      ];
                    }
                    const duplicate = skill.forkOf;
                    if (hasMergeAudit && duplicate && constraints.createdAt === duplicate.at) {
                      return [
                        {
                          _id: "auditLogs:merge",
                          action: "skill.merge",
                          actorUserId: skill.hiddenBy,
                          targetType: "skill",
                          targetId: skill._id,
                          createdAt: duplicate.at,
                          metadata: {
                            targetSkillId: duplicate.skillId,
                          },
                        },
                      ];
                    }
                    return [];
                  },
                };
              },
            };
          }
          if (table === "skillSlugAliases") {
            return {
              withIndex: (name: string) => {
                if (
                  name !== "by_skill" &&
                  name !== "by_slug" &&
                  name !== "by_owner_publisher_slug" &&
                  name !== "by_owner_slug"
                ) {
                  throw new Error(`unexpected skillSlugAliases index ${name}`);
                }
                return { collect: async () => [], take: async () => [], unique: async () => null };
              },
            };
          }
          if (table === "skillEmbeddings") {
            return {
              withIndex: (name: string) => {
                if (name !== "by_skill")
                  throw new Error(`unexpected skillEmbeddings index ${name}`);
                return { collect: async () => [] };
              },
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: (name: string) => {
                if (name !== "by_skill") {
                  throw new Error(`unexpected skillSearchDigest index ${name}`);
                }
                return { unique: async () => ({ _id: "skillSearchDigest:deleted" }) };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert,
      },
    } as never;

    await expect(
      transferSkillOwnerForUserInternalHandler(ctx, {
        actorUserId: "users:admin",
        slug: "deleted-demo",
        toOwner: "team",
        reason: "Publisher recovery",
      }),
    ).rejects.toThrow("Skill is not eligible for ownership transfer while under moderation");

    skill.hiddenBy = "users:owner";

    hideAuditActorRole = "moderator";
    await expect(
      transferSkillOwnerForUserInternalHandler(ctx, {
        actorUserId: "users:admin",
        slug: "deleted-demo",
        toOwner: "team",
        reason: "Publisher recovery",
      }),
    ).rejects.toThrow("Skill is not eligible for ownership transfer while under moderation");

    hideAuditActorRole = "user";
    skill.forkOf = {
      skillId: "skills:canonical",
      kind: "duplicate",
      at: 100,
    };
    hasMergeAudit = true;
    await expect(
      transferSkillOwnerForUserInternalHandler(ctx, {
        actorUserId: "users:admin",
        slug: "deleted-demo",
        toOwner: "team",
        reason: "Publisher recovery",
      }),
    ).rejects.toThrow("Skill is not eligible for ownership transfer while under moderation");
    hasMergeAudit = false;

    // Deletion-time audit provenance remains authoritative after a later staff promotion.
    ownerCurrentRole = "admin";
    await expect(
      transferSkillOwnerForUserInternalHandler(ctx, {
        actorUserId: "users:admin",
        slug: "deleted-demo",
        toOwner: "team",
      }),
    ).rejects.toThrow("Reason required for soft-deleted skill ownership transfer");

    const result = await transferSkillOwnerForUserInternalHandler(ctx, {
      actorUserId: "users:admin",
      slug: "deleted-demo",
      toOwner: "team",
      reason: "Publisher recovery",
    });

    expect(result).toMatchObject({
      ok: true,
      transferred: true,
      skillSlug: "deleted-demo",
      toPublisherHandle: "team",
    });
    expect(patch).toHaveBeenCalledWith(
      "skills:deleted",
      expect.objectContaining({
        ownerUserId: "users:admin",
        ownerPublisherId: "publishers:team",
      }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "skills:deleted",
      expect.objectContaining({ softDeletedAt: undefined }),
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
                    if (name !== "by_slug" && name !== "by_owner_publisher_slug") {
                      throw new Error(`unexpected skills index ${name}`);
                    }
                    return {
                      take: async () =>
                        name === "by_slug" && constraints.slug === "portable" ? [skill] : [],
                      unique: async () =>
                        name === "by_slug" && constraints.slug === "portable" ? skill : null,
                    };
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
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return { take: async () => [] };
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
      stats: defaultSkillStats,
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
                  if (name !== "by_slug" && name !== "by_owner_publisher_slug") {
                    throw new Error(`unexpected skills index ${name}`);
                  }
                  return {
                    take: async () =>
                      name === "by_slug" && constraints.slug === "portable" ? [skill] : [],
                    unique: async () =>
                      name === "by_slug" && constraints.slug === "portable" ? skill : null,
                  };
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
            if (table === "users") {
              return {
                withIndex: (name: string) => {
                  if (name !== "handle") {
                    throw new Error(`unexpected users index ${name}`);
                  }
                  return { unique: async () => null };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (
                    name !== "by_skill" &&
                    name !== "by_owner_publisher_slug" &&
                    name !== "by_slug"
                  ) {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return {
                    collect: async () => aliases,
                    unique: async () => null,
                  };
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
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") {
                    throw new Error(`unexpected skillSlugAliases index ${name}`);
                  }
                  return { take: async () => [] };
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

  it("rejects direct owner transfers for skills under moderation", async () => {
    const moderationStates = [
      { moderationStatus: "hidden" },
      { moderationStatus: "removed" },
      { moderationVerdict: "suspicious" },
      { moderationVerdict: "malicious" },
      { isSuspicious: true },
      { moderationFlags: ["flagged.suspicious"] },
      { moderationFlags: ["blocked.malware"] },
      { moderationReason: "scanner.llm.suspicious" },
      { moderationReasonCodes: ["suspicious.dynamic_code_execution"] },
      { moderationReasonCodes: ["malicious.crypto_mining"] },
    ];

    for (const moderationState of moderationStates) {
      const patch = vi.fn(async () => {});
      const skill = {
        _id: "skills:source",
        slug: "portable",
        displayName: "Portable",
        ownerUserId: "users:actor",
        ownerPublisherId: "publishers:personal",
        softDeletedAt: undefined,
        ...moderationState,
      };

      await expect(
        transferSkillOwnerForUserInternalHandler(
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
                return null;
              }),
              query: vi.fn((table: string) => {
                if (table === "skills") {
                  return {
                    withIndex: (
                      name: string,
                      build: (q: ReturnType<typeof chainEq>) => unknown,
                    ) => {
                      const constraints: Record<string, unknown> = {};
                      build(chainEq(constraints));
                      if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                      return {
                        unique: async () => (constraints.slug === "portable" ? skill : null),
                      };
                    },
                  };
                }
                if (table === "skillSlugAliases") {
                  return {
                    withIndex: (name: string) => {
                      if (name !== "by_slug") {
                        throw new Error(`unexpected skillSlugAliases index ${name}`);
                      }
                      return { take: async () => [] };
                    },
                  };
                }
                throw new Error(`unexpected table ${table}`);
              }),
              patch,
              insert: vi.fn(async () => "auditLogs:1"),
            },
          } as never,
          {
            actorUserId: "users:actor",
            slug: "portable",
            toOwner: "team",
          },
        ),
      ).rejects.toThrow("under moderation");

      expect(patch).not.toHaveBeenCalledWith("skills:source", expect.anything());
    }
  });

  it("rejects admin owner changes for skills under moderation", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const patch = vi.fn(async () => {});

    await expect(
      changeOwnerHandler(
        {
          db: {
            normalizeId: vi.fn(() => null),
            system: {},
            get: vi.fn(async (id: string) => {
              if (id === "users:admin") return { _id: "users:admin", role: "admin" };
              if (id === "users:next") return { _id: "users:next", role: "user" };
              if (id === "skills:source") {
                return {
                  _id: "skills:source",
                  slug: "portable",
                  displayName: "Portable",
                  ownerUserId: "users:owner",
                  moderationReasonCodes: ["malicious.crypto_mining"],
                };
              }
              return null;
            }),
            query: vi.fn(() => {
              throw new Error("unexpected query");
            }),
            patch,
            insert: vi.fn(async () => "auditLogs:1"),
          },
        } as never,
        {
          skillId: "skills:source",
          ownerUserId: "users:next",
        },
      ),
    ).rejects.toThrow("under moderation");

    expect(patch).not.toHaveBeenCalledWith("skills:source", expect.anything());
  });

  it("checks direct transfer permissions before revealing moderation state", async () => {
    const patch = vi.fn(async () => {});
    const skill = {
      _id: "skills:source",
      slug: "portable",
      displayName: "Portable",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:personal",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
    };

    await expect(
      transferSkillOwnerForUserInternalHandler(
        {
          db: {
            normalizeId: vi.fn(() => null),
            get: vi.fn(async (id: string) => {
              if (id === "users:actor") return { _id: "users:actor", role: "user" };
              if (id === "publishers:personal") {
                return {
                  _id: "publishers:personal",
                  kind: "user",
                  handle: "owner",
                  linkedUserId: "users:owner",
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
                      unique: async () => (constraints.slug === "portable" ? skill : null),
                    };
                  },
                };
              }
              if (table === "publisherMembers") {
                return {
                  withIndex: () => ({
                    unique: async () => null,
                  }),
                };
              }
              if (table === "skillSlugAliases") {
                return {
                  withIndex: (name: string) => {
                    if (name !== "by_slug") {
                      throw new Error(`unexpected skillSlugAliases index ${name}`);
                    }
                    return { take: async () => [] };
                  },
                };
              }
              throw new Error(`unexpected table ${table}`);
            }),
            patch,
            insert: vi.fn(async () => "auditLogs:1"),
          },
        } as never,
        {
          actorUserId: "users:actor",
          slug: "portable",
          toOwner: "team",
        },
      ),
    ).rejects.toThrow("Forbidden");

    expect(patch).not.toHaveBeenCalledWith("skills:source", expect.anything());
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
                    if (name === "by_owner_publisher_slug") {
                      return {
                        unique: async () => null,
                      };
                    }
                    if (name === "by_owner_slug") {
                      return {
                        take: async () =>
                          skills
                            .filter(
                              (skill) =>
                                skill.ownerUserId === constraints.ownerUserId &&
                                skill.slug === constraints.slug,
                            )
                            .slice(0, 25),
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
                    if (name === "by_owner_publisher_slug") {
                      return {
                        unique: async () => null,
                      };
                    }
                    if (name === "by_owner_slug") {
                      return {
                        take: async () =>
                          aliases
                            .filter(
                              (alias) =>
                                alias.ownerUserId === constraints.ownerUserId &&
                                alias.slug === constraints.slug,
                            )
                            .slice(0, 25),
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
