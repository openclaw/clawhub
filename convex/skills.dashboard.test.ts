import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { listDashboardPaginated } from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const handler = (
  listDashboardPaginated as unknown as WrappedHandler<
    {
      ownerUserId?: string;
      ownerPublisherId?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    { page: Array<{ slug: string }>; isDone: boolean; continueCursor: string }
  >
)._handler;

function makeSkill(slug: string, overrides: Record<string, unknown> = {}) {
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
              filter: vi.fn(() => ({
                order: vi.fn(() => ({
                  paginate: vi.fn().mockResolvedValue({
                    page: skills,
                    isDone: true,
                    continueCursor: "",
                  }),
                })),
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
}

const paginationOpts = { cursor: null, numItems: 50 };

describe("skills.listDashboardPaginated", () => {
  it("returns paginated skills for ownerUserId", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const skills = [makeSkill("slack"), makeSkill("stripe")];
    const ctx = makeCtx(skills);

    const result = await handler(ctx as never, {
      ownerUserId: "users:owner",
      paginationOpts,
    } as never);

    expect(result.page).toHaveLength(2);
    expect(result.page.map((s) => s.slug)).toEqual(["slack", "stripe"]);
    expect(result.isDone).toBe(true);
  });

  it("returns paginated skills for ownerPublisherId", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const skills = [makeSkill("github")];
    const ctx = makeCtx(skills);

    const result = await handler(ctx as never, {
      ownerPublisherId: "publishers:pub",
      paginationOpts,
    } as never);

    expect(result.page).toEqual([expect.objectContaining({ slug: "github" })]);
  });

  it("returns empty when no owner specified", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx([makeSkill("a")]);

    const result = await handler(ctx as never, { paginationOpts } as never);

    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
  });

  it("includes pending-review skills for own dashboard", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const skills = [
      makeSkill("pending-skill", {
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
      }),
    ];
    const ctx = makeCtx(skills);

    const result = await handler(ctx as never, {
      ownerUserId: "users:owner",
      paginationOpts,
    } as never);

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toHaveProperty("pendingReview", true);
  });

  it("filters out non-visible skills for non-owner callers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:other" as never);
    const skills = [
      makeSkill("hidden-skill", {
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
      }),
    ];
    const ctx = makeCtx(skills);

    const result = await handler(ctx as never, {
      ownerUserId: "users:owner",
      paginationOpts,
    } as never);

    expect(result.page).toEqual([]);
  });
});
