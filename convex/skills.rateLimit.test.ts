import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { internal } from "./_generated/api";
import {
  approveSkillByHashInternal,
  backfillLatestSkillModerationInternal,
  clearOwnerSuspiciousFlagsInternal,
  escalateSkillByIdInternal,
  escalateByVtInternal,
  insertVersion,
  updateSkillVersionStaticScanInternal,
} from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const insertVersionHandler = (insertVersion as unknown as WrappedHandler<Record<string, unknown>>)
  ._handler;
const updateSkillVersionStaticScanHandler = (
  updateSkillVersionStaticScanInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const approveSkillByHashHandler = (
  approveSkillByHashInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const escalateSkillByIdHandler = (
  escalateSkillByIdInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const escalateByVtHandler = (
  escalateByVtInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const backfillLatestSkillModerationHandler = (
  backfillLatestSkillModerationInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const clearOwnerSuspiciousFlagsHandler = (
  clearOwnerSuspiciousFlagsInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;

function buildGlobalStatsQuery(table: string) {
  if (table !== "globalStats") return null;
  return {
    withIndex: (name: string) => {
      if (name !== "by_key") throw new Error(`unexpected globalStats index ${name}`);
      return {
        unique: async () => ({
          _id: "globalStats:1",
          activeSkillsCount: 100,
        }),
      };
    },
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

function buildEmptyReservedSlugsQuery(table: string) {
  if (table !== "reservedSlugs") return null;
  return {
    withIndex: () => ({
      order: () => ({ take: async () => [] }),
    }),
  };
}

function buildEmptySkillSlugAliasesQuery(table: string) {
  if (table !== "skillSlugAliases") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
      take: async () => [],
    }),
  };
}

function buildEmptySkillVersionFingerprintsQuery(table: string) {
  if (table !== "skillVersionFingerprints") return null;
  return {
    withIndex: () => ({
      take: async () => [],
    }),
  };
}

function buildEmptySkillVersionsQuery(table: string) {
  if (table !== "skillVersions") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
    }),
  };
}

function buildEmptySkillBadgesQuery(table: string) {
  if (table !== "skillBadges") return null;
  return {
    withIndex: () => ({
      take: async () => [],
    }),
  };
}

function buildEmptySkillEmbeddingsQuery(table: string) {
  if (table !== "skillEmbeddings") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
    }),
  };
}

function buildEmptyPublishersQuery(table: string) {
  if (table !== "publishers") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
    }),
  };
}

function buildEmptyPublisherMembersQuery(table: string) {
  if (table !== "publisherMembers") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
    }),
  };
}

function createSuccessfulPublishInsert(
  storedSkills: Map<string, Record<string, unknown>>,
  now: number,
) {
  return vi.fn(async (table: string, value: Record<string, unknown>) => {
    if (table === "skills") {
      storedSkills.set("skills:new", { _id: "skills:new", _creationTime: now, ...value });
      return "skills:new";
    }
    if (table === "publishers") return "publishers:caller";
    if (table === "publisherMembers") return "publisherMembers:caller";
    if (table === "auditLogs") return "auditLogs:1";
    if (table === "skillVersions") return "skillVersions:1";
    if (table === "skillEmbeddings") return "skillEmbeddings:1";
    if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
    if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
    if (table === "skillSearchDigest") return "skillSearchDigest:1";
    throw new Error(`unexpected insert table ${table}`);
  });
}

function createPublishArgs(overrides?: Partial<Record<string, unknown>>) {
  return {
    userId: "users:owner",
    slug: "spam-skill",
    displayName: "Spam Skill",
    version: "1.0.0",
    changelog: "Initial release",
    changelogSource: "user",
    tags: ["latest"],
    fingerprint: "f".repeat(64),
    files: [
      {
        path: "SKILL.md",
        size: 128,
        storageId: "_storage:1",
        sha256: "a".repeat(64),
        contentType: "text/markdown",
      },
    ],
    parsed: {
      frontmatter: { description: "test" },
      metadata: {},
      clawdis: {},
    },
    embedding: [0.1, 0.2],
    ...overrides,
  };
}

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function emptyOwnerScopedSkillLookup(name: string) {
  if (name === "by_owner") {
    return { order: () => ({ take: async () => [] }) };
  }
  if (name === "by_owner_slug" || name === "by_owner_publisher_slug") {
    return { unique: async () => null };
  }
  return null;
}

function emptyOwnerScopedAliasLookup(name: string) {
  if (name === "by_owner_slug" || name === "by_owner_publisher_slug") {
    return { unique: async () => null };
  }
  return null;
}

describe("skills anti-spam guards", () => {
  it("blocks low-trust users after hourly new-skill cap", async () => {
    const now = Date.now();
    const ownerSkills = Array.from({ length: 5 }, (_, i) => ({
      _id: `skills:${i}`,
      createdAt: now - i * 10_000,
    }));

    const db = {
      get: vi.fn(async () => ({
        _id: "users:owner",
        _creationTime: now - 2 * 24 * 60 * 60 * 1000,
        createdAt: now - 2 * 24 * 60 * 60 * 1000,
        deletedAt: undefined,
      })),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") {
                return { unique: async () => null };
              }
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => ownerSkills,
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected index ${name}`);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected index ${name}`);
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              return { unique: async () => null };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyVersionsQuery = buildEmptySkillVersionsQuery(table);
        if (emptyVersionsQuery) return emptyVersionsQuery;
        const emptyBadgesQuery = buildEmptySkillBadgesQuery(table);
        if (emptyBadgesQuery) return emptyBadgesQuery;
        const emptyEmbeddingsQuery = buildEmptySkillEmbeddingsQuery(table);
        if (emptyEmbeddingsQuery) return emptyEmbeddingsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      normalizeId: vi.fn(),
    };

    await expect(
      insertVersionHandler({ db } as never, createPublishArgs() as never),
    ).rejects.toThrow(/max 5 new skills per hour/i);
  });

  it("allows a legacy personal publish when another owner already uses the slug", async () => {
    const now = Date.now();
    const storedSkills = new Map<string, Record<string, unknown>>();
    let authAccountLookupCount = 0;
    const patch = vi.fn(async () => {});
    const insert = createSuccessfulPublishInsert(storedSkills, now);
    const db = {
      get: vi.fn(async (id: string) => {
        if (storedSkills.has(id)) return storedSkills.get(id);
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            _creationTime: now - 60 * 24 * 60 * 60 * 1000,
            createdAt: now - 60 * 24 * 60 * 60 * 1000,
            handle: "caller",
            trustedPublisher: true,
            role: "user",
            deletedAt: undefined,
            deactivatedAt: undefined,
            personalPublisherId: "publishers:caller",
          };
        }
        if (id === "publishers:caller") {
          return {
            _id: "publishers:caller",
            kind: "user",
            handle: "caller",
            linkedUserId: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedSkillLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skills index `);
              }
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  ownerUserId: "users:owner",
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount === 1
                    ? { providerAccountId: "owner-gh" }
                    : { providerAccountId: "caller-gh" };
                },
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyVersionsQuery = buildEmptySkillVersionsQuery(table);
        if (emptyVersionsQuery) return emptyVersionsQuery;
        const emptyBadgesQuery = buildEmptySkillBadgesQuery(table);
        if (emptyBadgesQuery) return emptyBadgesQuery;
        const emptyEmbeddingsQuery = buildEmptySkillEmbeddingsQuery(table);
        if (emptyEmbeddingsQuery) return emptyEmbeddingsQuery;
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn(),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "taken-skill",
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:new",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        slug: "taken-skill",
        ownerUserId: "users:caller",
        ownerPublisherId: "publishers:caller",
      }),
    );
  });

  it("normalizes mixed-case slugs before owner-scoped publish lookup", async () => {
    const now = Date.now();
    const storedSkills = new Map<string, Record<string, unknown>>();
    let authAccountLookupCount = 0;
    let requestedSlug: string | null = null;
    const patch = vi.fn(async () => {});
    const insert = createSuccessfulPublishInsert(storedSkills, now);
    const db = {
      get: vi.fn(async (id: string) => {
        if (storedSkills.has(id)) return storedSkills.get(id);
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            _creationTime: now - 60 * 24 * 60 * 60 * 1000,
            createdAt: now - 60 * 24 * 60 * 60 * 1000,
            handle: "caller",
            trustedPublisher: true,
            role: "user",
            deletedAt: undefined,
            deactivatedAt: undefined,
            personalPublisherId: "publishers:caller",
          };
        }
        if (id === "publishers:caller") {
          return {
            _id: "publishers:caller",
            kind: "user",
            handle: "caller",
            linkedUserId: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (
              name: string,
              build:
                | ((q: { eq: (field: string, value: string) => unknown }) => unknown)
                | undefined,
            ) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedSkillLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skills index `);
              }
              const q = {
                eq: (field: string, value: string) => {
                  if (field !== "slug") throw new Error(`unexpected field ${field}`);
                  requestedSlug = value;
                  return q;
                },
              };
              build?.(q);
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  ownerUserId: "users:owner",
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount === 1
                    ? { providerAccountId: "owner-gh" }
                    : { providerAccountId: "caller-gh" };
                },
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyVersionsQuery = buildEmptySkillVersionsQuery(table);
        if (emptyVersionsQuery) return emptyVersionsQuery;
        const emptyBadgesQuery = buildEmptySkillBadgesQuery(table);
        if (emptyBadgesQuery) return emptyBadgesQuery;
        const emptyEmbeddingsQuery = buildEmptySkillEmbeddingsQuery(table);
        if (emptyEmbeddingsQuery) return emptyEmbeddingsQuery;
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn(),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "Taken-Skill",
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:new",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
    expect(requestedSlug).toBe("taken-skill");
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        slug: "taken-skill",
        ownerUserId: "users:caller",
        ownerPublisherId: "publishers:caller",
      }),
    );
  });

  it("allows a legacy personal publish when a deleted owner has the same slug", async () => {
    const now = Date.now();
    const storedSkills = new Map<string, Record<string, unknown>>();
    let authAccountLookupCount = 0;
    const patch = vi.fn(async () => {});
    const insert = createSuccessfulPublishInsert(storedSkills, now);
    const db = {
      get: vi.fn(async (id: string) => {
        if (storedSkills.has(id)) return storedSkills.get(id);
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            _creationTime: now - 60 * 24 * 60 * 60 * 1000,
            createdAt: now - 60 * 24 * 60 * 60 * 1000,
            handle: "caller",
            trustedPublisher: true,
            role: "user",
            deletedAt: undefined,
            deactivatedAt: undefined,
            personalPublisherId: "publishers:caller",
          };
        }
        if (id === "publishers:caller") {
          return {
            _id: "publishers:caller",
            kind: "user",
            handle: "caller",
            linkedUserId: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: Date.now(),
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedSkillLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skills index `);
              }
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  ownerUserId: "users:owner",
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount === 1
                    ? { providerAccountId: "owner-gh" }
                    : { providerAccountId: "caller-gh" };
                },
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyVersionsQuery = buildEmptySkillVersionsQuery(table);
        if (emptyVersionsQuery) return emptyVersionsQuery;
        const emptyBadgesQuery = buildEmptySkillBadgesQuery(table);
        if (emptyBadgesQuery) return emptyBadgesQuery;
        const emptyEmbeddingsQuery = buildEmptySkillEmbeddingsQuery(table);
        if (emptyEmbeddingsQuery) return emptyEmbeddingsQuery;
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn(),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "taken-skill",
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:new",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        slug: "taken-skill",
        ownerUserId: "users:caller",
        ownerPublisherId: "publishers:caller",
      }),
    );
  });

  it("releases expired owner-unpublished slugs without alias collisions before accepting a new publish", async () => {
    const now = Date.now();
    const storedSkills = new Map<string, Record<string, unknown>>([
      [
        "skills:expired",
        {
          _id: "skills:expired",
          slug: "released-demo",
          displayName: "Released Demo",
          ownerUserId: "users:previous",
          softDeletedAt: now - 31 * 24 * 60 * 60 * 1000,
          hiddenBy: "users:previous",
          unpublishedSlugReservedUntil: now - 1_000,
          moderationStatus: "hidden",
          tags: {},
          stats: {
            downloads: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            stars: 0,
            versions: 1,
            comments: 0,
          },
          createdAt: now - 40 * 24 * 60 * 60 * 1000,
          updatedAt: now - 31 * 24 * 60 * 60 * 1000,
        },
      ],
    ]);
    const aliasSlugs = new Set(["__unpublished_skills_expired"]);
    const patch = vi.fn(
      async (
        tableOrId: string,
        idOrValue: string | Record<string, unknown>,
        maybeValue?: Record<string, unknown>,
      ) => {
        const id = typeof idOrValue === "string" ? idOrValue : tableOrId;
        const value = typeof idOrValue === "string" ? maybeValue : idOrValue;
        if (!value) return;
        if (storedSkills.has(id)) {
          storedSkills.set(id, { ...storedSkills.get(id), ...value });
        }
      },
    );
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skills") {
        storedSkills.set("skills:new", { _id: "skills:new", _creationTime: now, ...value });
        return "skills:new";
      }
      if (table === "auditLogs") return "auditLogs:release";
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      if (table === "skillSearchDigest") return "skillSearchDigest:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const db = {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const id = maybeId ?? tableOrId;
        if (storedSkills.has(id)) return storedSkills.get(id);
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            _creationTime: now - 60 * 24 * 60 * 60 * 1000,
            createdAt: now - 60 * 24 * 60 * 60 * 1000,
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: true,
            role: "user",
            handle: "caller",
            personalPublisherId: "publishers:caller",
          };
        }
        if (id === "publishers:caller") {
          return {
            _id: "publishers:caller",
            kind: "user",
            handle: "caller",
            linkedUserId: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
            publishedSkills: 0,
            publishedPackages: 0,
            totalInstalls: 0,
            totalDownloads: 0,
            totalStars: 0,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
              const constraints: Record<string, unknown> = {};
              build?.(chainEq(constraints));
              if (name === "by_slug") {
                return {
                  unique: async () =>
                    Array.from(storedSkills.values()).find(
                      (skill) => skill.slug === constraints.slug,
                    ) ?? null,
                  take: async (limit: number) =>
                    Array.from(storedSkills.values())
                      .filter((skill) => skill.slug === constraints.slug)
                      .slice(0, limit),
                };
              }
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              if (name === "by_owner_slug") {
                return {
                  unique: async () =>
                    Array.from(storedSkills.values()).find(
                      (skill) =>
                        skill.ownerUserId === constraints.ownerUserId &&
                        skill.slug === constraints.slug,
                    ) ?? null,
                };
              }
              if (name === "by_owner_publisher_slug") {
                return {
                  unique: async () =>
                    Array.from(storedSkills.values()).find(
                      (skill) =>
                        skill.ownerPublisherId === constraints.ownerPublisherId &&
                        skill.slug === constraints.slug,
                    ) ?? null,
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected reservedSlugs index ${name}`);
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              const constraints: Record<string, unknown> = {};
              build?.(chainEq(constraints));
              const alias = aliasSlugs.has(String(constraints.slug))
                ? {
                    _id: "skillSlugAliases:collision",
                    slug: constraints.slug,
                    skillId: "skills:collision",
                  }
                : null;
              return {
                unique: async () => alias,
                take: async (limit: number) => (alias && limit > 0 ? [alias] : []),
              };
            },
          };
        }
        if (table === "skillVersionFingerprints") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_fingerprint") {
                throw new Error(`unexpected skillVersionFingerprints index ${name}`);
              }
              return { take: async () => [] };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return { unique: async () => null };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return { take: async () => [] };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return { unique: async () => null };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: () => ({
              unique: async () => null,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn((tableName: string, id: string) =>
        id.startsWith(`${tableName}:`) ? id : null,
      ),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "released-demo",
        bypassNewSkillRateLimit: true,
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:new",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
    expect(patch).not.toHaveBeenCalledWith(
      "skills",
      "skills:expired",
      expect.objectContaining({
        slug: "__unpublished_skills_expired_1",
        unpublishedOriginalSlug: "released-demo",
        unpublishedSlugReservedUntil: undefined,
        unpublishedSlugReleasedAt: expect.any(Number),
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "skill.slug.unpublished_release" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        slug: "released-demo",
        ownerUserId: "users:caller",
      }),
    );
  });

  it("allows a new owner to publish when another owner's moderated reservation is stale", async () => {
    const now = Date.now();
    const storedSkills = new Map<string, Record<string, unknown>>([
      [
        "skills:stale",
        {
          _id: "skills:stale",
          slug: "moderated-demo",
          displayName: "Moderated Demo",
          ownerUserId: "users:previous",
          ownerPublisherId: "publishers:previous",
          softDeletedAt: now - 31 * 24 * 60 * 60 * 1000,
          hiddenBy: undefined,
          unpublishedSlugReservedUntil: now - 1_000,
          moderationStatus: "hidden",
          moderationFlags: ["blocked.malware"],
          moderationVerdict: "malicious",
          tags: {},
          stats: {
            downloads: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            stars: 0,
            versions: 1,
            comments: 0,
          },
          createdAt: now - 40 * 24 * 60 * 60 * 1000,
          updatedAt: now - 31 * 24 * 60 * 60 * 1000,
        },
      ],
    ]);
    const patch = vi.fn(async () => {});
    const insert = createSuccessfulPublishInsert(storedSkills, now);
    const db = {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const id = maybeId ?? tableOrId;
        if (storedSkills.has(id)) return storedSkills.get(id);
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            _creationTime: now - 60 * 24 * 60 * 60 * 1000,
            createdAt: now - 60 * 24 * 60 * 60 * 1000,
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: true,
            role: "user",
            handle: "caller",
            personalPublisherId: "publishers:caller",
          };
        }
        if (id === "publishers:caller") {
          return {
            _id: "publishers:caller",
            kind: "user",
            handle: "caller",
            linkedUserId: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
            publishedSkills: 0,
            publishedPackages: 0,
            totalInstalls: 0,
            totalDownloads: 0,
            totalStars: 0,
          };
        }
        if (id === "publishers:previous") {
          return {
            _id: "publishers:previous",
            kind: "user",
            handle: "previous",
            linkedUserId: "users:previous",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        if (id === "users:previous") {
          return {
            _id: "users:previous",
            deletedAt: undefined,
            deactivatedAt: undefined,
            handle: "previous",
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
              const constraints: Record<string, unknown> = {};
              build?.(chainEq(constraints));
              if (name === "by_slug") {
                return {
                  unique: async () =>
                    Array.from(storedSkills.values()).find(
                      (skill) => skill.slug === constraints.slug,
                    ) ?? null,
                };
              }
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected reservedSlugs index ${name}`);
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              return { unique: async () => null };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return { unique: async () => null };
            },
          };
        }
        if (table === "publishers") {
          return {
            withIndex: (name: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
              const constraints: Record<string, unknown> = {};
              build?.(chainEq(constraints));
              if (name === "by_handle") return { unique: async () => null };
              if (name === "by_linked_user") {
                return {
                  unique: async () =>
                    constraints.linkedUserId === "users:caller"
                      ? {
                          _id: "publishers:caller",
                          kind: "user",
                          handle: "caller",
                          linkedUserId: "users:caller",
                          deletedAt: undefined,
                          deactivatedAt: undefined,
                        }
                      : null,
                };
              }
              throw new Error(`unexpected publishers index ${name}`);
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
                  _id: "publisherMembers:caller",
                  publisherId: "publishers:caller",
                  userId: "users:caller",
                  role: "owner",
                }),
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyVersionsQuery = buildEmptySkillVersionsQuery(table);
        if (emptyVersionsQuery) return emptyVersionsQuery;
        const emptyBadgesQuery = buildEmptySkillBadgesQuery(table);
        if (emptyBadgesQuery) return emptyBadgesQuery;
        const emptyEmbeddingsQuery = buildEmptySkillEmbeddingsQuery(table);
        if (emptyEmbeddingsQuery) return emptyEmbeddingsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn((tableName: string, id: string) =>
        id.startsWith(`${tableName}:`) ? id : null,
      ),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "moderated-demo",
        bypassNewSkillRateLimit: true,
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:new",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });

    expect(patch).not.toHaveBeenCalledWith(
      "skills",
      "skills:stale",
      expect.objectContaining({
        slug: expect.stringMatching(/^__unpublished_/),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        slug: "moderated-demo",
        ownerUserId: "users:caller",
        ownerPublisherId: "publishers:caller",
      }),
    );
  });

  it("heals ownership when a legacy unscoped owner is deleted but GitHub identity matches", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async (table: string) => {
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: false,
            role: "user",
          };
        }
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: Date.now(),
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedSkillLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skills index `);
              }
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  displayName: "Taken Skill",
                  summary: "Existing summary",
                  ownerUserId: "users:owner",
                  latestVersionId: undefined,
                  tags: {},
                  softDeletedAt: undefined,
                  badges: {
                    redactionApproved: undefined,
                    highlighted: undefined,
                    official: undefined,
                    deprecated: undefined,
                  },
                  moderationStatus: "active",
                  moderationReason: "pending.scan",
                  moderationNotes: undefined,
                  moderationVerdict: "clean",
                  moderationReasonCodes: undefined,
                  moderationEvidence: undefined,
                  moderationSummary: "Clean",
                  moderationEngineVersion: "test",
                  moderationEvaluatedAt: 1,
                  moderationSourceVersionId: undefined,
                  quality: undefined,
                  moderationFlags: undefined,
                  isSuspicious: false,
                  reportCount: 0,
                  lastReportedAt: undefined,
                  statsDownloads: 0,
                  statsStars: 0,
                  statsInstallsCurrent: 0,
                  statsInstallsAllTime: 0,
                  stats: {
                    downloads: 0,
                    installsCurrent: 0,
                    installsAllTime: 0,
                    stars: 0,
                    versions: 1,
                    comments: 0,
                  },
                  createdAt: 1,
                  updatedAt: 1,
                  manualOverride: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => ({ providerAccountId: "shared-gh" }),
              };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn(),
    };

    const result = await insertVersionHandler(
      { db } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "taken-skill",
      }) as never,
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:caller",
      }),
    );
    expect(result).toEqual({
      skillId: "skills:1",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
  });

  it("keeps engine-backed suspicious skills visible for low-trust publishers", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      vtAnalysis: {
        status: "suspicious",
        source: "engines",
        engineStats: { malicious: 0, suspicious: 1, undetected: 64 },
      },
    };
    const skill = {
      _id: "skills:1",
      slug: "spam-skill",
      ownerUserId: "users:owner",
      moderationFlags: undefined,
      moderationReason: undefined,
    };
    const owner = {
      _id: "users:owner",
      _creationTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "vt",
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.vt.suspicious",
        moderationFlags: ["flagged.suspicious"],
      }),
    );
  });

  it("does not hide or autoban for AI-only VT malicious without engine hits", async () => {
    const patch = vi.fn(async () => {});
    const runAfter = vi.fn();
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.4.24",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "malicious",
        scanner: "code_insight",
        source: "palm",
        engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
      },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "ai-only-vt",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationStatus: "hidden",
      moderationReason: "scanner.vt.malicious",
      moderationFlags: ["blocked.malware"],
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "vt",
        status: "malicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.aggregate.clean",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        isSuspicious: false,
      }),
    );
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("hides static-malicious publishes and schedules owner autoban", async () => {
    const storedSkills = new Map<string, Record<string, unknown>>();
    const storedDigests = new Map<string, Record<string, unknown>>();
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (storedSkills.has(id)) {
        storedSkills.set(id, { ...storedSkills.get(id), ...value });
      }
      const digest = Array.from(storedDigests.values()).find((entry) => entry.skillId === id);
      if (digest) {
        Object.assign(digest, value);
      }
    });
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skills") {
        storedSkills.set("skills:1", { _id: "skills:1", _creationTime: 1, ...value });
        return "skills:1";
      }
      if (table === "skillSearchDigest") {
        storedDigests.set("skillSearchDigest:1", { _id: "skillSearchDigest:1", ...value });
        return "skillSearchDigest:1";
      }
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const runAfter = vi.fn();
    const db = {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const key = maybeId ?? tableOrId;
        if (storedSkills.has(key)) return storedSkills.get(key);
        if (key === "users:owner") {
          return {
            _id: "users:owner",
            _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
            createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: true,
            role: "user",
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") return { unique: async () => null };
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected reservedSlugs index ${name}`);
            },
          };
        }
        if (table === "skillVersionFingerprints") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_fingerprint") {
                throw new Error(`unexpected skillVersionFingerprints index ${name}`);
              }
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn((tableName: string, id: string) =>
        id.startsWith(`${tableName}:`) ? id : null,
      ),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter } } as never,
      createPublishArgs({
        staticScan: {
          status: "malicious",
          reasonCodes: ["malicious.install_terminal_payload"],
          findings: [
            {
              code: "malicious.install_terminal_payload",
              severity: "critical",
              file: "SKILL.md",
              line: 1,
              message: "Install prompt contains an obfuscated terminal payload.",
              evidence: "echo ... | base64 -D | bash",
            },
          ],
          summary: "Detected: malicious.install_terminal_payload",
          engineVersion: "v2.2.0",
          checkedAt: Date.now(),
        },
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:1",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "scanner.static.malicious",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(
      0,
      internal.users.autobanMalwareAuthorInternal,
      expect.objectContaining({
        ownerUserId: "users:owner",
        slug: "spam-skill",
        trigger: "malicious.install_terminal_payload",
      }),
    );
  });

  it("schedules owner autoban when a latest version static scan becomes malicious", async () => {
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      staticScan: undefined,
      sha256hash: "h".repeat(64),
    };
    const skill = {
      _id: "skills:1",
      slug: "spam-skill",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationFlags: undefined,
      moderationReason: undefined,
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const patch = vi.fn();
    const runAfter = vi.fn();
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skillVersions:1") return version;
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await updateSkillVersionStaticScanHandler(
      { db, scheduler: { runAfter } } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        staticScan: {
          status: "malicious",
          reasonCodes: ["malicious.install_terminal_payload"],
          findings: [],
          summary: "Detected: malicious.install_terminal_payload",
          engineVersion: "v2.2.0",
          checkedAt: Date.now(),
        },
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(
      0,
      internal.users.autobanMalwareAuthorInternal,
      expect.objectContaining({
        ownerUserId: "users:owner",
        slug: "spam-skill",
        sha256hash: "h".repeat(64),
        trigger: "malicious.install_terminal_payload",
      }),
    );
  });

  it("keeps new publishes hidden while the uploader is under moderation", async () => {
    const storedSkills = new Map<string, Record<string, unknown>>();
    const storedDigests = new Map<string, Record<string, unknown>>();
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skills") {
        storedSkills.set("skills:1", { _id: "skills:1", _creationTime: 1, ...value });
        return "skills:1";
      }
      if (table === "skillSearchDigest") {
        storedDigests.set("skillSearchDigest:1", { _id: "skillSearchDigest:1", ...value });
        return "skillSearchDigest:1";
      }
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (storedSkills.has(id)) {
        storedSkills.set(id, { ...storedSkills.get(id), ...value });
      }
      const digest = Array.from(storedDigests.values()).find((entry) => entry.skillId === id);
      if (digest) {
        Object.assign(digest, value);
      }
    });
    const db = {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const key = maybeId ?? tableOrId;
        if (storedSkills.has(key)) return storedSkills.get(key);
        if (key === "users:owner") {
          return {
            _id: "users:owner",
            _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
            createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: true,
            requiresModerationAt: Date.now() - 1_000,
            requiresModerationReason: "needs review",
            role: "user",
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") return { unique: async () => null };
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected reservedSlugs index ${name}`);
            },
          };
        }
        if (table === "skillVersionFingerprints") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_fingerprint") {
                throw new Error(`unexpected skillVersionFingerprints index ${name}`);
              }
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") {
                const ownerScoped = emptyOwnerScopedAliasLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skillSlugAliases index `);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert,
      normalizeId: vi.fn((tableName: string, id: string) =>
        id.startsWith(`${tableName}:`) ? id : null,
      ),
    };

    await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "No suspicious patterns detected.",
          engineVersion: "v2.2.0",
          checkedAt: Date.now(),
        },
      }) as never,
    );

    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "user.moderation",
        moderationNotes: "needs review",
      }),
    );
  });

  it("keeps admin-owned skills non-suspicious for suspicious scanner verdicts", async () => {
    const patch = vi.fn(async () => {});
    const version = { _id: "skillVersions:1", skillId: "skills:1" };
    const skill = {
      _id: "skills:1",
      slug: "trusted-skill",
      ownerUserId: "users:owner",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.vt.suspicious",
    };
    const owner = {
      _id: "users:owner",
      role: "admin",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "llm",
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.llm.review",
        moderationFlags: ["flagged.review"],
        isSuspicious: false,
      }),
    );
  });

  it("does not let review guidance override an aggregate suspicious verdict", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.4.24",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "suspicious",
        engineStats: { malicious: 0, suspicious: 1, undetected: 64 },
      },
      llmAnalysis: {
        status: "suspicious",
        riskSummary: {
          abnormal_behavior_control: {
            status: "concern",
            highestSeverity: "medium",
            summary: "Needs review.",
          },
        },
        checkedAt: Date.now(),
      },
    };
    const skill = {
      _id: "skills:1",
      slug: "needs-review-and-vt",
      ownerUserId: "users:owner",
      moderationFlags: ["flagged.review"],
      moderationReason: "scanner.llm.review",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "llm",
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationVerdict: "suspicious",
        moderationReason: "scanner.llm.suspicious",
        moderationFlags: ["flagged.suspicious"],
        moderationReasonCodes: ["review.llm_review", "suspicious.vt_suspicious"],
        isSuspicious: true,
      }),
    );
  });

  it("keeps skills hidden when aggregate verdict remains malicious after a clean scanner update", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "malicious",
        reasonCodes: ["malicious.crypto_mining"],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "malicious",
        source: "engines",
        engineStats: { malicious: 1, suspicious: 0, undetected: 64 },
      },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "miner",
      ownerUserId: "users:owner",
      moderationFlags: undefined,
      moderationReason: "scanner.vt.pending",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              const ownerScoped = emptyOwnerScopedSkillLookup(name);
              if (ownerScoped) return ownerScoped;
              throw new Error(`unexpected skills index `);
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "vt",
        status: "clean",
      } as never,
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 99,
      }),
    );
  });

  it("ignores non-latest versions when approving by hash", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:old",
      skillId: "skills:1",
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dynamic_code_execution"],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: { status: "suspicious" },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "rollback-helper",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:latest",
      moderationFlags: undefined,
      moderationReason: "scanner.vt.clean",
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "vt",
        status: "clean",
      } as never,
    );

    expect(patch).not.toHaveBeenCalled();
  });

  it("vt suspicious escalation does not keep suspicious flags for admin owners", async () => {
    const patch = vi.fn(async () => {});
    const version = { _id: "skillVersions:1", skillId: "skills:1" };
    const skill = {
      _id: "skills:1",
      slug: "trusted-skill",
      ownerUserId: "users:owner",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.llm.suspicious",
    };
    const owner = {
      _id: "users:owner",
      role: "admin",
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateByVtHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationFlags: undefined,
        moderationReason: "scanner.llm.clean",
      }),
    );
  });

  it("vt suspicious escalation clears legacy quarantine for uncorroborated Code Insight", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "suspicious",
        scanner: "code_insight",
        engineStats: {
          malicious: 0,
          suspicious: 0,
          harmless: 12,
          undetected: 54,
        },
      },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "doc-only",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationStatus: "hidden",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.vt.suspicious",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateByVtHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationFlags: undefined,
        moderationReason: "scanner.vt.clean",
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        isSuspicious: false,
      }),
    );
  });

  it("vt malicious escalation clears legacy quarantine for AI-only Code Insight", async () => {
    const patch = vi.fn(async () => {});
    const runAfter = vi.fn();
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "malicious",
        scanner: "code_insight",
        source: "palm",
        engineStats: {
          malicious: 0,
          suspicious: 0,
          harmless: 12,
          undetected: 54,
        },
      },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "ai-only-vt",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationStatus: "hidden",
      moderationFlags: ["blocked.malware"],
      moderationReason: "scanner.vt.malicious",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateByVtHandler(
      { db, scheduler: { runAfter } } as never,
      {
        sha256hash: "h".repeat(64),
        status: "malicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationFlags: undefined,
        moderationReason: "scanner.vt.clean",
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        isSuspicious: false,
      }),
    );
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("ignores vt escalation for non-latest versions", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:old",
      skillId: "skills:1",
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dynamic_code_execution"],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "rollback-helper",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:latest",
      moderationFlags: undefined,
      moderationReason: "scanner.vt.clean",
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateByVtHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        status: "suspicious",
      } as never,
    );

    expect(patch).not.toHaveBeenCalled();
  });

  it("rebuilds structured moderation state for legacy skillId escalation", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dynamic_code_execution"],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "malicious",
        source: "engines",
        engineStats: { malicious: 1, suspicious: 0, undetected: 64 },
      },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "legacy-bad",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationFlags: undefined,
      moderationReason: "scanner.vt.pending",
      moderationStatus: "active",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "skillVersions:1") return version;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateSkillByIdHandler(
      { db } as never,
      {
        skillId: "skills:1",
        moderationReason: "scanner.vt.malicious",
        moderationFlags: ["blocked.malware"],
        moderationStatus: "hidden",
      } as never,
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.malicious",
        moderationFlags: ["blocked.malware"],
        moderationVerdict: "malicious",
        moderationReasonCodes: ["malicious.vt_malicious"],
        moderationSourceVersionId: "skillVersions:1",
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 99,
      }),
    );
  });

  it("bulk-clears suspicious flags/reasons for privileged owner skills", async () => {
    const patch = vi.fn(async () => {});
    const owner = {
      _id: "users:owner",
      role: "admin",
      deletedAt: undefined,
    };
    const skills = [
      {
        _id: "skills:1",
        moderationFlags: ["flagged.suspicious"],
        moderationReason: "scanner.vt.suspicious",
        moderationStatus: "hidden",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:2",
        moderationFlags: undefined,
        moderationReason: "scanner.llm.clean",
        moderationStatus: "active",
        softDeletedAt: undefined,
      },
    ];

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_owner") {
                const ownerScoped = emptyOwnerScopedSkillLookup(name);
                if (ownerScoped) return ownerScoped;
                throw new Error(`unexpected skills index ${name}`);
              }
              return {
                order: () => ({
                  take: async () => skills,
                }),
              };
            },
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    const result = await clearOwnerSuspiciousFlagsHandler(
      { db } as never,
      { ownerUserId: "users:owner", limit: 20 } as never,
    );

    expect(result).toEqual({ inspected: 2, updated: 1 });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationFlags: undefined,
        moderationReason: "scanner.vt.clean",
        moderationStatus: "active",
      }),
    );
  });

  it("re-syncs stale skill moderation from latestVersionId during backfill", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:1",
          slug: "rollback-helper",
          ownerUserId: "users:owner",
          latestVersionId: "skillVersions:latest",
          moderationSourceVersionId: "skillVersions:old",
          moderationStatus: "hidden",
          moderationReason: "scanner.vt.suspicious",
          moderationFlags: ["flagged.suspicious"],
          manualOverride: undefined,
          softDeletedAt: undefined,
        },
        {
          _id: "skills:manual",
          slug: "manually-reviewed",
          ownerUserId: "users:owner",
          latestVersionId: "skillVersions:latest",
          moderationSourceVersionId: "skillVersions:old",
          moderationStatus: "active",
          moderationReason: "user.moderation",
          moderationFlags: undefined,
          manualOverride: undefined,
          softDeletedAt: undefined,
        },
        {
          _id: "skills:ai-only",
          slug: "ai-only-vt",
          ownerUserId: "users:owner",
          latestVersionId: "skillVersions:aiOnly",
          moderationSourceVersionId: "skillVersions:old",
          moderationStatus: "hidden",
          moderationReason: "scanner.vt.malicious",
          moderationFlags: ["blocked.malware"],
          manualOverride: undefined,
          softDeletedAt: undefined,
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn(async () => {});
    const latestVersion = {
      _id: "skillVersions:latest",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: { status: "clean" },
      llmAnalysis: { status: "clean" },
    };
    const aiOnlyVersion = {
      _id: "skillVersions:aiOnly",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: {
        status: "malicious",
        scanner: "code_insight",
        source: "palm",
        engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
      },
      llmAnalysis: { status: "clean" },
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skillVersions:latest") return latestVersion;
        if (id === "skillVersions:aiOnly") return aiOnlyVersion;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        if (table === "skills") {
          return {
            paginate,
          };
        }
        const emptyAliasesQuery = buildEmptySkillSlugAliasesQuery(table);
        if (emptyAliasesQuery) return emptyAliasesQuery;
        const emptyReservationsQuery = buildEmptyReservedSlugsQuery(table);
        if (emptyReservationsQuery) return emptyReservationsQuery;
        const emptyFingerprintsQuery = buildEmptySkillVersionFingerprintsQuery(table);
        if (emptyFingerprintsQuery) return emptyFingerprintsQuery;
        const emptyPublishersQuery = buildEmptyPublishersQuery(table);
        if (emptyPublishersQuery) return emptyPublishersQuery;
        const emptyPublisherMembersQuery = buildEmptyPublisherMembersQuery(table);
        if (emptyPublisherMembersQuery) return emptyPublisherMembersQuery;
        throw new Error(`unexpected table `);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    const result = await backfillLatestSkillModerationHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { batchSize: 10 } as never,
    );

    expect(result).toEqual({ patched: 2, isDone: true, scanned: 3 });
    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.vt.clean",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationSourceVersionId: "skillVersions:latest",
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 101,
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      3,
      "skills:ai-only",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.aggregate.clean",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        moderationSourceVersionId: "skillVersions:aiOnly",
      }),
    );
  });
});
