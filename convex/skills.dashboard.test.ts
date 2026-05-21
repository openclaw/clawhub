import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { list, listDashboardPaginated } from "./skills";

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
const listHandler = (
  list as unknown as WrappedHandler<
    {
      ownerUserId?: string;
      ownerPublisherId?: string;
      limit?: number;
    },
    Array<{ slug: string }>
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
    capabilityTags: [],
    badges: undefined,
    stats: {
      downloads: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    statsDownloads: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    statsStars: 0,
    createdAt: 1,
    updatedAt: 2,
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    moderationReason: undefined,
    isSuspicious: false,
    ...overrides,
  };
}

function makeCtx(
  indexPages: Record<string, ReturnType<typeof makeSkill>[]>,
  options: { membership?: Record<string, unknown> | null } = {},
) {
  const indexCalls: string[] = [];
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "users:owner") {
          return { _id: "users:owner", _creationTime: 1, handle: "owner", displayName: "Owner" };
        }
        if (id === "users:other") {
          return { _id: "users:other", _creationTime: 1, handle: "other", displayName: "Other" };
        }
        if (id === "users:member") {
          return { _id: "users:member", _creationTime: 1, handle: "member", displayName: "Member" };
        }
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
        if (id === "publishers:org") {
          return {
            _id: "publishers:org",
            _creationTime: 1,
            kind: "org",
            handle: "team",
            displayName: "Team",
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "publisherMembers") {
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue(options.membership ?? null),
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
        if (table === "skills") {
          return {
            withIndex: vi.fn((indexName: string) => {
              indexCalls.push(indexName);
              return {
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue(indexPages[indexName] ?? []),
                  paginate: vi.fn().mockResolvedValue({
                    page: indexPages[indexName] ?? [],
                    isDone: true,
                    continueCursor: "",
                  }),
                })),
              };
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
  };
  return { ctx, indexCalls };
}

const paginationOpts = { cursor: null, numItems: 50 };

describe("skills.listDashboardPaginated", () => {
  it("paginates user dashboard skills through an active owner index", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner_active_updated: [makeSkill("slack")],
    });

    const result = await handler(
      ctx as never,
      {
        ownerUserId: "users:owner",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_active_updated");
    expect(result.page).toEqual([expect.objectContaining({ slug: "slack" })]);
  });

  it("includes linked-user legacy skills when paginating a personal publisher", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner_active_updated: [makeSkill("legacy-skill")],
    });

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:self",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_active_updated");
    expect(result.page).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
  });

  it("keeps non-owner personal publisher reads scoped to publisher-owned skills", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:other" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner_publisher_active_updated: [
        makeSkill("published-skill", { ownerPublisherId: "publishers:self" }),
      ],
    });

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:self",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_publisher_active_updated");
    expect(indexCalls).not.toContain("by_owner_active_updated");
    expect(result.page).toEqual([expect.objectContaining({ slug: "published-skill" })]);
  });

  it("paginates org publisher skills through an active publisher index", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner_publisher_active_updated: [
        makeSkill("team-skill", { ownerPublisherId: "publishers:org" }),
      ],
    });

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:org",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_publisher_active_updated");
    expect(result.page).toEqual([expect.objectContaining({ slug: "team-skill" })]);
  });

  it("ignores stale personal memberships for hidden dashboard skills", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:other" as never);
    const { ctx, indexCalls } = makeCtx(
      {
        by_owner_publisher_active_updated: [
          makeSkill("hidden-personal", {
            ownerPublisherId: "publishers:self",
            moderationStatus: "hidden",
          }),
        ],
      },
      {
        membership: {
          _id: "publisherMembers:stale",
          publisherId: "publishers:self",
          userId: "users:other",
          role: "owner",
        },
      },
    );

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:self",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_publisher_active_updated");
    expect(indexCalls).not.toContain("by_owner_active_updated");
    expect(result.page).toEqual([]);
  });

  it("keeps org members authorized for hidden dashboard skills", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:member" as never);
    const { ctx } = makeCtx(
      {
        by_owner_publisher_active_updated: [
          makeSkill("hidden-team", {
            ownerPublisherId: "publishers:org",
            moderationStatus: "hidden",
          }),
        ],
      },
      {
        membership: {
          _id: "publisherMembers:member",
          publisherId: "publishers:org",
          userId: "users:member",
          role: "publisher",
        },
      },
    );

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:org",
        paginationOpts,
      } as never,
    );

    expect(result.page).toEqual([expect.objectContaining({ slug: "hidden-team" })]);
  });

  it("ignores stale personal memberships in the non-paginated skill list", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:other" as never);
    const { ctx, indexCalls } = makeCtx(
      {
        by_owner_publisher: [
          makeSkill("hidden-personal", {
            ownerPublisherId: "publishers:self",
            moderationStatus: "hidden",
          }),
        ],
      },
      {
        membership: {
          _id: "publisherMembers:stale",
          publisherId: "publishers:self",
          userId: "users:other",
          role: "owner",
        },
      },
    );

    const result = await listHandler(
      ctx as never,
      { ownerPublisherId: "publishers:self", limit: 20 } as never,
    );

    expect(indexCalls).toContain("by_owner_publisher");
    expect(result).toEqual([]);
  });
});
