/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/badges", () => ({
  getSkillBadgeMap: vi.fn(),
  getSkillBadgeMaps: vi.fn(),
  isSkillHighlighted: vi.fn(),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getSkillBadgeMap } = await import("./lib/badges");
const { getBySlug } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<
    {
      slug: string;
    },
    {
      owner?: {
        _id: string;
        _creationTime: number;
        handle: string | null;
        name: string | null;
        displayName: string | null;
        image: string | null;
        bio?: string | null;
      } | null;
    } | null
  >
)._handler;

function makeCtx(args: {
  skill: Record<string, unknown> | null;
  owner: Record<string, unknown> | null;
  latestVersion?: Record<string, unknown> | null;
}) {
  const unique = vi.fn().mockResolvedValue(args.skill);
  const withIndex = vi.fn(() => ({ unique }));
  const query = vi.fn((table: string) => {
    if (table !== "skills") throw new Error(`Unexpected query table: ${table}`);
    return { withIndex };
  });
  const get = vi.fn(async (id: string) => {
    if (!args.skill) return null;
    if (id === args.skill.ownerUserId) return args.owner;
    if (id === args.skill.latestVersionId) return args.latestVersion ?? null;
    return null;
  });
  return { db: { query, get } } as never;
}

describe("skills.getBySlug", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(getSkillBadgeMap).mockReset();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
    vi.mocked(getSkillBadgeMap).mockResolvedValue({} as never);
  });

  it("sanitizes owner fields in the public response", async () => {
    const ctx = makeCtx({
      skill: {
        _id: "skills:1",
        _creationTime: 1,
        slug: "demo",
        displayName: "Demo",
        summary: "Public demo skill",
        ownerUserId: "users:1",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: null,
        tags: {},
        stats: {
          downloads: 10,
          installsCurrent: 2,
          installsAllTime: 5,
          stars: 3,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
        moderationStatus: "active",
        moderationFlags: undefined,
        softDeletedAt: undefined,
      },
      owner: {
        _id: "users:1",
        _creationTime: 1,
        handle: "demo-owner",
        name: "Demo Owner",
        displayName: "Demo Owner",
        image: null,
        bio: "Ships demo skills",
        email: "owner@example.com",
        emailVerificationTime: 123,
        githubCreatedAt: 456,
        githubFetchedAt: 789,
        githubProfileSyncedAt: 999,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.owner).toEqual({
      _id: "users:1",
      _creationTime: 1,
      handle: "demo-owner",
      name: "Demo Owner",
      displayName: "Demo Owner",
      image: null,
      bio: "Ships demo skills",
    });
    expect(result?.owner).not.toHaveProperty("email");
    expect(result?.owner).not.toHaveProperty("emailVerificationTime");
    expect(result?.owner).not.toHaveProperty("githubCreatedAt");
    expect(result?.owner).not.toHaveProperty("githubFetchedAt");
    expect(result?.owner).not.toHaveProperty("githubProfileSyncedAt");
  });

  it("hides skills whose owner is deleted or banned", async () => {
    const ctx = makeCtx({
      skill: {
        _id: "skills:1",
        _creationTime: 1,
        slug: "demo",
        displayName: "Demo",
        summary: "Public demo skill",
        ownerUserId: "users:1",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: null,
        tags: {},
        stats: {
          downloads: 10,
          installsCurrent: 2,
          installsAllTime: 5,
          stars: 3,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
        moderationStatus: "active",
        moderationFlags: undefined,
        softDeletedAt: undefined,
      },
      owner: {
        _id: "users:1",
        _creationTime: 1,
        handle: "demo-owner",
        name: "Demo Owner",
        displayName: "Demo Owner",
        image: null,
        deletedAt: 123,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result).toBeNull();
  });
});
