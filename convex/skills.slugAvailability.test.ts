import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatReservedSlugCooldownMessage } from "./lib/reservedSlugs";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { getAuthUserId } from "@convex-dev/auth/server";
import { checkSlugAvailability } from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

type SkillDoc = {
  _id: string;
  slug: string;
  ownerUserId: string;
  ownerPublisherId?: string;
  softDeletedAt?: number;
  hiddenBy?: string;
  unpublishedSlugReservedUntil?: number;
  moderationStatus?: "active" | "hidden" | "removed";
  moderationFlags?: string[];
};

type ReservationDoc = {
  _id: string;
  slug: string;
  originalOwnerUserId: string;
  deletedAt: number;
  expiresAt: number;
  releasedAt?: number;
};

type AliasDoc = {
  _id: string;
  slug: string;
  skillId: string;
  ownerUserId?: string;
  ownerPublisherId?: string;
};

const checkSlugAvailabilityHandler = (
  checkSlugAvailability as unknown as WrappedHandler<{ slug: string; ownerHandle?: string }>
)._handler;

function createCtx(options: {
  skill: SkillDoc | null;
  skills?: SkillDoc[];
  alias?: AliasDoc | null;
  aliases?: AliasDoc[];
  aliasedSkill?: SkillDoc | null;
  reservation?: ReservationDoc | null;
  owner?: {
    _id: string;
    handle?: string | null;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    deletedAt?: number;
    deactivatedAt?: number;
  } | null;
  callerId?: string;
  publisherMembership?: { role: "owner" | "admin" | "publisher" } | null;
  publisher?: {
    _id: string;
    handle: string;
    kind: "user" | "org";
    linkedUserId?: string;
    deletedAt?: number;
    deactivatedAt?: number;
  } | null;
  ownerProviderAccountId?: string | null;
  callerProviderAccountId?: string | null;
}) {
  const callerId = options.callerId ?? "users:caller";
  let authAccountLookupCount = 0;
  const skills = options.skills ?? (options.skill ? [options.skill] : []);
  const aliases = options.aliases ?? (options.alias ? [options.alias] : []);

  const captureConstraints = (
    callback?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ) => {
    const constraints: Record<string, unknown> = {};
    const query = {
      eq: (field: string, value: unknown) => {
        constraints[field] = value;
        return query;
      },
    };
    callback?.(query);
    return constraints;
  };

  const filterSkills = (name: string, constraints: Record<string, unknown>) => {
    if (name === "by_slug") {
      return skills.filter((skill) => skill.slug === constraints.slug);
    }
    if (name === "by_owner_publisher_slug") {
      return skills.filter(
        (skill) =>
          skill.ownerPublisherId === constraints.ownerPublisherId &&
          skill.slug === constraints.slug,
      );
    }
    if (name === "by_owner_slug") {
      return skills.filter(
        (skill) => skill.ownerUserId === constraints.ownerUserId && skill.slug === constraints.slug,
      );
    }
    throw new Error(`unexpected skills index ${name}`);
  };

  const filterAliases = (name: string, constraints: Record<string, unknown>) => {
    if (name === "by_slug") {
      return aliases.filter((alias) => alias.slug === constraints.slug);
    }
    if (name === "by_owner_publisher_slug") {
      return aliases.filter(
        (alias) =>
          alias.ownerPublisherId === constraints.ownerPublisherId &&
          alias.slug === constraints.slug,
      );
    }
    if (name === "by_owner_slug") {
      return aliases.filter(
        (alias) => alias.ownerUserId === constraints.ownerUserId && alias.slug === constraints.slug,
      );
    }
    throw new Error(`unexpected skillSlugAliases index ${name}`);
  };

  const db = {
    get: vi.fn(async (id: string) => {
      if (options.publisher && id === options.publisher._id) return options.publisher;
      if (options.owner && id === options.owner._id) return options.owner;
      if (id === callerId) {
        return { _id: callerId, deletedAt: undefined, deactivatedAt: undefined };
      }
      const skill = skills.find((entry) => entry._id === id);
      if (skill) return skill;
      if (options.aliasedSkill && id === options.aliasedSkill._id) return options.aliasedSkill;
      return null;
    }),
    query: vi.fn((table: string) => {
      if (table === "skills") {
        return {
          withIndex: (
            name: string,
            callback?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const matches = filterSkills(name, captureConstraints(callback));
            return {
              unique: async () => {
                if (matches.length > 1) throw new Error("unique() query returned multiple rows");
                return matches[0] ?? null;
              },
              take: async (limit: number) => matches.slice(0, limit),
            };
          },
        };
      }
      if (table === "users") {
        return {
          withIndex: (
            name: string,
            callback?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            if (name !== "handle") throw new Error(`unexpected users index ${name}`);
            const constraints = captureConstraints(callback);
            return {
              unique: async () => {
                const candidates = [options.owner].filter(Boolean);
                return candidates.find((user) => user?.handle === constraints.handle) ?? null;
              },
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
                take: async () => (options.reservation ? [options.reservation] : []),
              }),
            };
          },
        };
      }
      if (table === "skillSlugAliases") {
        return {
          withIndex: (
            name: string,
            callback?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const matches = filterAliases(name, captureConstraints(callback));
            return {
              unique: async () => {
                if (matches.length > 1) throw new Error("unique() query returned multiple rows");
                return matches[0] ?? null;
              },
              take: async (limit: number) => matches.slice(0, limit),
            };
          },
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_publisher_user")
              throw new Error(`unexpected publisherMembers index ${name}`);
            return {
              unique: async () =>
                options.publisherMembership
                  ? {
                      _id: "publisherMembers:caller",
                      publisherId: options.skill?.ownerPublisherId,
                      userId: callerId,
                      role: options.publisherMembership.role,
                    }
                  : null,
            };
          },
        };
      }
      if (table === "publishers") {
        return {
          withIndex: (
            name: string,
            callback?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            if (name !== "by_handle" && name !== "by_linked_user") {
              throw new Error(`unexpected publishers index ${name}`);
            }
            const constraints = captureConstraints(callback);
            return {
              unique: async () => {
                if (!options.publisher) return null;
                if (name === "by_handle" && options.publisher.handle !== constraints.handle) {
                  return null;
                }
                if (
                  name === "by_linked_user" &&
                  options.publisher.linkedUserId !== constraints.linkedUserId
                ) {
                  return null;
                }
                return options.publisher;
              },
            };
          },
        };
      }
      if (table === "authAccounts") {
        return {
          withIndex: (name: string) => {
            if (name !== "userIdAndProvider") {
              throw new Error(`unexpected authAccounts index ${name}`);
            }
            return {
              unique: async () => {
                authAccountLookupCount += 1;
                if (authAccountLookupCount === 1) {
                  return options.ownerProviderAccountId
                    ? { providerAccountId: options.ownerProviderAccountId }
                    : null;
                }
                return options.callerProviderAccountId
                  ? { providerAccountId: options.callerProviderAccountId }
                  : null;
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { db };
}

describe("skills.checkSlugAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns taken without URL for non-public collisions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: 123,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
        ownerProviderAccountId: "owner-gh",
        callerProviderAccountId: "caller-gh",
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message: "Slug is already taken. Choose a different slug.",
      url: null,
    });
  });

  it("returns reserved while an owner-unpublished slug reservation is active", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "unpublished-skill",
          ownerUserId: "users:owner",
          softDeletedAt: now - 1_000,
          hiddenBy: "users:owner",
          unpublishedSlugReservedUntil: now + 60_000,
          moderationStatus: "hidden",
          moderationFlags: undefined,
        },
      }) as never,
      { slug: "unpublished-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "reserved",
      message:
        'Slug "unpublished-skill" is reserved by an unpublished skill until ' +
        "2023-11-14T22:14:20.000Z. Publish or restore it before then to keep the slug; " +
        "after that another publisher can claim it.",
      url: null,
    });
  });

  it("returns available when an owner-unpublished slug reservation has expired", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "unpublished-skill",
          ownerUserId: "users:owner",
          softDeletedAt: now - 120_000,
          hiddenBy: "users:owner",
          unpublishedSlugReservedUntil: now - 60_000,
          moderationStatus: "hidden",
          moderationFlags: undefined,
        },
      }) as never,
      { slug: "unpublished-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns taken when a stale owner reservation remains on a moderation hide", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "moderated-skill",
          ownerUserId: "users:owner",
          softDeletedAt: now - 120_000,
          hiddenBy: undefined,
          unpublishedSlugReservedUntil: now - 60_000,
          moderationStatus: "hidden",
          moderationFlags: ["blocked.malware"],
        },
        owner: {
          _id: "users:owner",
          handle: "owner",
        },
      }) as never,
      { slug: "moderated-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message: "Slug is already taken. Choose a different slug.",
      url: null,
    });
  });

  it("returns taken with URL for public collisions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
        ownerProviderAccountId: "owner-gh",
        callerProviderAccountId: "caller-gh",
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message: "Slug is already taken. Choose a different slug. Existing skill: /alice/taken-skill",
      url: "/alice/taken-skill",
    });
  });

  it("returns taken without requiring auth context", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message: "Slug is already taken. Choose a different slug. Existing skill: /alice/taken-skill",
      url: "/alice/taken-skill",
    });
  });

  it("returns available when slug belongs to current user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:caller",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns available for current user when personal publisher is only synthesized", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "legacy-skill",
          ownerUserId: "users:caller",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:caller",
          handle: "legacy-user",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
        publisher: null,
      }) as never,
      { slug: "legacy-skill", ownerHandle: "legacy-user" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns available when slug belongs to a publisher the caller can publish to", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "mapv-three",
          ownerUserId: "users:original",
          ownerPublisherId: "publishers:baidu-maps",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        publisherMembership: { role: "publisher" },
        publisher: {
          _id: "publishers:baidu-maps",
          handle: "baidu-maps",
          kind: "org",
        },
      }) as never,
      { slug: "mapv-three", ownerHandle: "baidu-maps" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns a validation result instead of throwing when duplicate slugs exist", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: null,
        skills: [
          {
            _id: "skills:personal-shared",
            slug: "shared-slug",
            ownerUserId: "users:alice",
            ownerPublisherId: "publishers:alice",
            softDeletedAt: undefined,
            moderationStatus: "active",
            moderationFlags: undefined,
          },
          {
            _id: "skills:org-shared",
            slug: "shared-slug",
            ownerUserId: "users:bob",
            ownerPublisherId: "publishers:other-org",
            softDeletedAt: undefined,
            moderationStatus: "active",
            moderationFlags: undefined,
          },
        ],
        publisher: {
          _id: "publishers:target-org",
          handle: "target-org",
          kind: "org",
        },
      }) as never,
      { slug: "shared-slug", ownerHandle: "target-org" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message: "Slug is already used by multiple publishers. Choose a specific owner.",
      url: null,
    });
  });

  it("returns taken when publisher membership does not match the requested owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "mapv-three",
          ownerUserId: "users:original",
          ownerPublisherId: "publishers:baidu-maps",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:original",
          handle: "original",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
        publisherMembership: { role: "publisher" },
        publisher: {
          _id: "publishers:other-org",
          handle: "other-org",
          kind: "org",
        },
      }) as never,
      { slug: "mapv-three", ownerHandle: "other-org" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message:
        "Slug is already taken. Choose a different slug. Existing skill: /original/mapv-three",
      url: "/original/mapv-three",
    });
  });

  it("returns reserved when active reservation belongs to another user", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: null,
        reservation: {
          _id: "reservedSlugs:1",
          slug: "taken-skill",
          originalOwnerUserId: "users:owner",
          deletedAt: now - 1_000,
          expiresAt: now + 60_000,
          releasedAt: undefined,
        },
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "reserved",
      message: formatReservedSlugCooldownMessage("taken-skill", now + 60_000),
      url: null,
    });
  });

  it("returns reserved without requiring auth context", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: null,
        reservation: {
          _id: "reservedSlugs:1",
          slug: "taken-skill",
          originalOwnerUserId: "users:owner",
          deletedAt: now - 1_000,
          expiresAt: now + 60_000,
          releasedAt: undefined,
        },
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "reserved",
      message: formatReservedSlugCooldownMessage("taken-skill", now + 60_000),
      url: null,
    });
  });

  it("returns reserved for protected namespace slugs", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: null,
      }) as never,
      { slug: "openclaw-helper" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "reserved",
      message:
        '"openclaw-helper" uses the protected "openclaw" slug namespace. ' +
        'Choose a slug that does not start with "openclaw-" or end with "-openclaw".',
      url: null,
    });
  });

  it("returns available when reservation has expired", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: null,
        reservation: {
          _id: "reservedSlugs:1",
          slug: "taken-skill",
          originalOwnerUserId: "users:owner",
          deletedAt: now - 120_000,
          expiresAt: now - 60_000,
          releasedAt: undefined,
        },
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns available when owner is deleted but GitHub identity matches", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: 123,
          deactivatedAt: undefined,
        },
        ownerProviderAccountId: "shared-gh",
        callerProviderAccountId: "shared-gh",
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns available when owner is deactivated but GitHub identity matches", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: 123,
        },
        ownerProviderAccountId: "shared-gh",
        callerProviderAccountId: "shared-gh",
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns taken with contact message when owner is deleted and identity does not match", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: 123,
          deactivatedAt: undefined,
        },
        ownerProviderAccountId: "owner-gh",
        callerProviderAccountId: "caller-gh",
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message:
        "This slug is locked to a deleted or banned account. " +
        "If you believe you are the rightful owner, please contact security@openclaw.ai to reclaim it.",
      url: null,
    });
  });

  it("returns taken with contact message when owner is deleted and caller is unauthenticated", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: 123,
          deactivatedAt: undefined,
        },
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message:
        "This slug is locked to a deleted or banned account. " +
        "If you believe you are the rightful owner, please contact security@openclaw.ai to reclaim it.",
      url: null,
    });
  });

  it("returns available when ownership can be healed via shared GitHub identity", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: {
          _id: "skills:1",
          slug: "taken-skill",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
        ownerProviderAccountId: "shared-gh",
        callerProviderAccountId: "shared-gh",
      }) as never,
      { slug: "taken-skill" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string | null;
      url: string | null;
    };

    expect(result).toEqual({
      available: true,
      reason: "available",
      message: null,
      url: null,
    });
  });

  it("returns taken for alias slugs with canonical URL", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);

    const result = (await checkSlugAvailabilityHandler(
      createCtx({
        skill: null,
        alias: {
          _id: "skillSlugAliases:1",
          slug: "demo-old",
          skillId: "skills:target",
        },
        aliasedSkill: {
          _id: "skills:target",
          slug: "demo",
          ownerUserId: "users:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
        },
        owner: {
          _id: "users:owner",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
      }) as never,
      { slug: "demo-old" } as never,
    )) as {
      available: boolean;
      reason: string;
      message: string;
      url: string | null;
    };

    expect(result).toEqual({
      available: false,
      reason: "taken",
      message:
        "Slug redirects to an existing skill. Choose a different slug. Existing skill: /alice/demo",
      url: "/alice/demo",
    });
  });
});
