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
      skill?: {
        canonicalSkillId?: string;
        forkOf?: unknown;
      };
      owner?: {
        _id: string;
        _creationTime: number;
        handle: string | null;
        name: string | null;
        displayName: string | null;
        image: string | null;
        bio?: string | null;
      } | null;
      latestVersion?: {
        files?: Array<{
          path: string;
          contentType?: string;
        }>;
      } | null;
      forkOf?: {
        skill: {
          slug: string;
          displayName: string;
        };
        owner: {
          handle: string | null;
          userId: string | null;
        };
      } | null;
      canonical?: {
        skill: {
          slug: string;
          displayName: string;
        };
        owner: {
          handle: string | null;
          userId: string | null;
        };
      } | null;
    } | null
  >
)._handler;

function makeCtx(args: {
  skill: Record<string, unknown> | null;
  owner: Record<string, unknown> | null;
  latestVersion?: Record<string, unknown> | null;
  skillsById?: Record<string, Record<string, unknown>>;
  ownersById?: Record<string, Record<string, unknown>>;
}) {
  const unique = vi.fn().mockResolvedValue(args.skill);
  const withIndex = vi.fn(() => ({ unique }));
  const query = vi.fn((table: string) => {
    if (table !== "skills") throw new Error(`Unexpected query table: ${table}`);
    return { withIndex };
  });
  const get = vi.fn(async (id: string) => {
    if (!args.skill) return null;
    if (id === args.skill._id) return args.skill;
    if (args.skillsById?.[id]) return args.skillsById[id];
    if (args.ownersById?.[id]) return args.ownersById[id];
    if (id === args.skill.ownerUserId) return args.owner;
    if (id === args.skill.latestVersionId) return args.latestVersion ?? null;
    return null;
  });
  return { db: { query, get } } as never;
}

function makeOwner(id: string, handle: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: 1,
    handle,
    name: handle,
    displayName: handle,
    image: null,
    ...overrides,
  };
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
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
      _id: "publishers:demo-owner",
      _creationTime: 1,
      kind: "user",
      handle: "demo-owner",
      displayName: "Demo Owner",
      image: null,
      bio: "Ships demo skills",
      linkedUserId: "users:1",
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

  it("omits duplicate references to nonpublic skills", async () => {
    const ctx = makeCtx({
      skill: makeSkill({
        canonicalSkillId: "skills:hidden-canonical",
        forkOf: {
          skillId: "skills:deleted-fork",
          kind: "duplicate",
          version: "1.0.0",
        },
      }),
      owner: makeOwner("users:1", "demo-owner", { displayName: "Demo Owner" }),
      skillsById: {
        "skills:deleted-fork": makeSkill({
          _id: "skills:deleted-fork",
          _creationTime: 2,
          slug: "deleted-fork",
          displayName: "Deleted Fork",
          summary: "Deleted duplicate source",
          ownerUserId: "users:fork-owner",
          softDeletedAt: 123,
        }),
        "skills:hidden-canonical": makeSkill({
          _id: "skills:hidden-canonical",
          _creationTime: 3,
          slug: "hidden-canonical",
          displayName: "Hidden Canonical",
          summary: "Hidden canonical source",
          ownerUserId: "users:canonical-owner",
          moderationStatus: "hidden",
        }),
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.forkOf).toBeNull();
    expect(result?.canonical).toBeNull();
    expect(result?.skill?.forkOf).toBeUndefined();
    expect(result?.skill?.canonicalSkillId).toBeUndefined();
  });

  it("keeps duplicate references to public skills", async () => {
    const ctx = makeCtx({
      skill: makeSkill({
        canonicalSkillId: "skills:canonical",
        forkOf: {
          skillId: "skills:fork",
          kind: "duplicate",
          version: "1.0.0",
        },
      }),
      owner: makeOwner("users:1", "demo-owner", { displayName: "Demo Owner" }),
      skillsById: {
        "skills:fork": makeSkill({
          _id: "skills:fork",
          _creationTime: 2,
          slug: "fork-source",
          displayName: "Fork Source",
          summary: "Public duplicate source",
          ownerUserId: "users:fork-owner",
        }),
        "skills:canonical": makeSkill({
          _id: "skills:canonical",
          _creationTime: 3,
          slug: "canonical-source",
          displayName: "Canonical Source",
          summary: "Public canonical source",
          ownerUserId: "users:canonical-owner",
        }),
      },
      ownersById: {
        "users:fork-owner": makeOwner("users:fork-owner", "fork-owner", {
          _creationTime: 2,
          displayName: "Fork Owner",
        }),
        "users:canonical-owner": makeOwner("users:canonical-owner", "canonical-owner", {
          _creationTime: 3,
          displayName: "Canonical Owner",
        }),
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.forkOf).toMatchObject({
      kind: "duplicate",
      version: "1.0.0",
      skill: {
        slug: "fork-source",
        displayName: "Fork Source",
      },
      owner: {
        handle: "fork-owner",
        userId: "users:fork-owner",
      },
    });
    expect(result?.canonical).toMatchObject({
      skill: {
        slug: "canonical-source",
        displayName: "Canonical Source",
      },
      owner: {
        handle: "canonical-owner",
        userId: "users:canonical-owner",
      },
    });
    expect(result?.skill?.forkOf).toBeDefined();
    expect(result?.skill?.canonicalSkillId).toBe("skills:canonical");
  });

  it("normalizes misleading file MIME types in public version metadata", async () => {
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
        latestVersionId: "skillVersions:1",
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
      },
      latestVersion: {
        _id: "skillVersions:1",
        _creationTime: 2,
        skillId: "skills:1",
        version: "1.0.0",
        fingerprint: "abc",
        changelog: "",
        changelogSource: "user",
        files: [
          {
            path: "src/index.ts",
            size: 10,
            sha256: "deadbeef",
            contentType: "video/mp2t",
          },
        ],
        createdBy: "users:1",
        createdAt: 2,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.latestVersion?.files).toEqual([
      expect.objectContaining({
        path: "src/index.ts",
        contentType: "application/typescript",
      }),
    ]);
  });
});
