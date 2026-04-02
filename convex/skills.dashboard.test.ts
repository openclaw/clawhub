import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { countDashboard, searchDashboard } from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const countHandler = (
  countDashboard as unknown as WrappedHandler<
    { ownerUserId?: string; ownerPublisherId?: string },
    number
  >
)._handler;

const searchHandler = (
  searchDashboard as unknown as WrappedHandler<
    { ownerUserId?: string; ownerPublisherId?: string; search: string; limit?: number },
    Array<{ slug: string }>
  >
)._handler;

function makeSkill(
  slug: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: `skills:${slug}`,
    _creationTime: 1,
    slug,
    displayName: slug.charAt(0).toUpperCase() + slug.slice(1),
    summary: `${slug} integration.`,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: undefined,
    stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0, versions: 1, comments: 0 },
    createdAt: 1,
    updatedAt: 2,
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    moderationReason: undefined,
    ...overrides,
  };
}

function makeCtx(skills: ReturnType<typeof makeSkill>[]) {
  return {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "users:owner") {
          return { _id: "users:owner", _creationTime: 1, handle: "owner", displayName: "Owner" };
        }
        if (id === "publishers:pub") {
          return {
            _id: "publishers:pub",
            _creationTime: 1,
            kind: "user",
            handle: "owner",
            displayName: "Owner",
            linkedUserId: "users:owner",
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
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({
                take: vi.fn().mockResolvedValue(skills),
                paginate: vi.fn().mockResolvedValue({
                  page: skills,
                  isDone: true,
                  continueCursor: "",
                }),
              })),
              collect: vi.fn().mockResolvedValue(skills),
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
}

describe("skills.countDashboard", () => {
  it("counts non-deleted skills for ownerUserId", async () => {
    const skills = [makeSkill("a"), makeSkill("b"), makeSkill("c")];
    const ctx = makeCtx(skills);

    const result = await countHandler(ctx as never, { ownerUserId: "users:owner" } as never);
    expect(result).toBe(3);
  });

  it("excludes soft-deleted skills", async () => {
    const skills = [
      makeSkill("a"),
      makeSkill("deleted", { softDeletedAt: 123 }),
      makeSkill("c"),
    ];
    const ctx = makeCtx(skills);

    const result = await countHandler(ctx as never, { ownerUserId: "users:owner" } as never);
    expect(result).toBe(2);
  });

  it("returns 0 when no owner specified", async () => {
    const ctx = makeCtx([makeSkill("a")]);

    const result = await countHandler(ctx as never, {});
    expect(result).toBe(0);
  });

  it("counts skills for ownerPublisherId", async () => {
    const skills = [makeSkill("a"), makeSkill("b")];
    const ctx = makeCtx(skills);

    const result = await countHandler(ctx as never, { ownerPublisherId: "publishers:pub" } as never);
    expect(result).toBe(2);
  });
});

describe("skills.searchDashboard", () => {
  const allSkills = [
    makeSkill("slack", { displayName: "Slack", summary: "Slack messaging integration." }),
    makeSkill("stripe", { displayName: "Stripe", summary: "Payment processing." }),
    makeSkill("github", { displayName: "GitHub", summary: "Code hosting platform." }),
    makeSkill("gitlab", { displayName: "GitLab", summary: "DevOps lifecycle tool." }),
    makeSkill("deleted-one", { displayName: "Deleted", summary: "Gone.", softDeletedAt: 100 }),
  ];

  it("returns empty array when search is empty", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "",
    } as never);
    expect(result).toEqual([]);
  });

  it("matches by slug", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "slack",
    } as never);
    expect(result).toEqual([expect.objectContaining({ slug: "slack" })]);
  });

  it("matches by displayName (case-insensitive)", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "GITHUB",
    } as never);
    expect(result).toEqual([expect.objectContaining({ slug: "github" })]);
  });

  it("matches by summary substring", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "payment",
    } as never);
    expect(result).toEqual([expect.objectContaining({ slug: "stripe" })]);
  });

  it("returns multiple matches", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "git",
    } as never);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.slug).sort()).toEqual(["github", "gitlab"]);
  });

  it("excludes soft-deleted skills", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "deleted",
    } as never);
    expect(result).toEqual([]);
  });

  it("respects limit", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "git",
      limit: 1,
    } as never);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no owner specified", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);

    const result = await searchHandler(ctx as never, { search: "slack" } as never);
    expect(result).toEqual([]);
  });
});
