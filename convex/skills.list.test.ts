import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import { list } from "./skills";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:skill",
    _creationTime: 1,
    slug: "demo-skill",
    displayName: "Demo Skill",
    summary: "Demo skill",
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    latestVersionSummary: undefined,
    tags: {},
    capabilityTags: [],
    badges: undefined,
    statsDownloads: 7,
    statsStars: 3,
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
    updatedAt: 2,
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    moderationReason: undefined,
    moderationVerdict: "clean",
    isSuspicious: false,
    ...overrides,
  };
}

const listHandler = (
  list as unknown as WrappedHandler<
    { ownerPublisherId?: string; ownerUserId?: string; limit?: number },
    Array<{ slug: string; stats: { downloads: number; stars: number } }>
  >
)._handler;

describe("skills.list", () => {
  it("includes legacy personal skills when listing a personal publisher", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const legacySkill = makeSkill({
      _id: "skills:legacy",
      slug: "legacy-skill",
      displayName: "Legacy Skill",
      summary: "Pre-backfill skill",
    });

    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:self") {
            return {
              _id: "publishers:self",
              _creationTime: 1,
              kind: "user",
              handle: "owner",
              displayName: "Owner",
              linkedUserId: "users:owner",
            };
          }
          if (id === "users:owner") {
            return {
              _id: "users:owner",
              _creationTime: 1,
              handle: "owner",
              displayName: "Owner",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
              })),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName === "by_owner_publisher") {
                  return {
                    order: vi.fn(() => ({
                      take: vi.fn().mockResolvedValue([]),
                    })),
                  };
                }
                if (indexName === "by_owner") {
                  return {
                    order: vi.fn(() => ({
                      take: vi.fn().mockResolvedValue([legacySkill]),
                    })),
                  };
                }
                throw new Error(`unexpected skills index ${indexName}`);
              }),
            };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listHandler(
      ctx as never,
      { ownerPublisherId: "publishers:self", limit: 10 } as never,
    );

    expect(result).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
  });

  it("includes non-public flagged skills for the owning user dashboard", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const blockedSkill = makeSkill({
      slug: "blocked-skill",
      moderationStatus: "hidden",
      moderationFlags: ["blocked.malware"],
      moderationReason: "scanner.vt.malicious",
      moderationVerdict: "malicious",
      isSuspicious: true,
    });

    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") {
            return {
              _id: "users:owner",
              _creationTime: 1,
              handle: "owner",
              displayName: "Owner",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue([blockedSkill]),
                })),
              })),
            };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listHandler(
      ctx as never,
      { ownerUserId: "users:owner", limit: 10 } as never,
    );

    expect(result).toEqual([
      expect.objectContaining({
        slug: "blocked-skill",
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        stats: expect.objectContaining({ downloads: 7, stars: 3 }),
      }),
    ]);
  });

  it("does not expose non-public flagged skills to non-owner list callers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    const blockedSkill = makeSkill({
      slug: "blocked-skill",
      moderationStatus: "hidden",
      moderationFlags: ["blocked.malware"],
      moderationReason: "scanner.vt.malicious",
      moderationVerdict: "malicious",
    });

    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") {
            return {
              _id: "users:owner",
              _creationTime: 1,
              handle: "owner",
              displayName: "Owner",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue([blockedSkill]),
                })),
              })),
            };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listHandler(
      ctx as never,
      { ownerUserId: "users:owner", limit: 10 } as never,
    );

    expect(result).toEqual([]);
  });
});
