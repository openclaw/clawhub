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
  softDeletedAt?: number;
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

const checkSlugAvailabilityHandler = (
  checkSlugAvailability as unknown as WrappedHandler<{ slug: string }>
)._handler;

function createCtx(options: {
  skill: SkillDoc | null;
  alias?: { _id: string; slug: string; skillId: string } | null;
  aliasedSkill?: SkillDoc | null;
  reservation?: ReservationDoc | null;
  owner?: {
    _id: string;
    handle?: string | null;
    deletedAt?: number;
    deactivatedAt?: number;
  } | null;
  callerId?: string;
  ownerProviderAccountId?: string | null;
  callerProviderAccountId?: string | null;
}) {
  const callerId = options.callerId ?? "users:caller";
  let authAccountLookupCount = 0;

  const db = {
    get: vi.fn(async (id: string) => {
      if (id === callerId) {
        return { _id: callerId, deletedAt: undefined, deactivatedAt: undefined };
      }
      if (options.aliasedSkill && id === options.aliasedSkill._id) return options.aliasedSkill;
      if (options.owner && id === options.owner._id) return options.owner;
      return null;
    }),
    query: vi.fn((table: string) => {
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
            return {
              unique: async () => options.skill,
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
          withIndex: (name: string) => {
            if (name !== "by_slug") throw new Error(`unexpected skillSlugAliases index ${name}`);
            return {
              unique: async () => options.alias ?? null,
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
