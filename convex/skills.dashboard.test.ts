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

type SkillTestDoc = ReturnType<typeof makeSkill>;
type IndexPage =
  | SkillTestDoc[]
  | Array<{ page: SkillTestDoc[]; isDone: boolean; continueCursor: string }>;

function isPaginatedIndexPage(
  page: IndexPage | undefined,
): page is Array<{ page: SkillTestDoc[]; isDone: boolean; continueCursor: string }> {
  return Array.isArray(page) && page.length > 0 && "page" in page[0];
}

function makeCtx(
  indexPages: Record<string, IndexPage>,
  options: { membership?: Record<string, unknown> | null; legacyPersonalPublisher?: boolean } = {},
) {
  const indexCalls: string[] = [];
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            _creationTime: 1,
            handle: "owner",
            displayName: "Owner",
            personalPublisherId: options.legacyPersonalPublisher ? "publishers:self" : undefined,
          };
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
            linkedUserId: options.legacyPersonalPublisher ? undefined : "users:owner",
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
        if (id === "publishers:other-personal") {
          return {
            _id: "publishers:other-personal",
            _creationTime: 1,
            kind: "user",
            handle: "other",
            displayName: "Other",
            linkedUserId: "users:other",
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
              const indexPage = indexPages[indexName] ?? [];
              const takeRows = isPaginatedIndexPage(indexPage)
                ? indexPage.flatMap((entry) => entry.page)
                : indexPage;
              return {
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue(takeRows),
                  paginate: vi.fn((paginationOpts: { cursor: string | null }) => {
                    if (isPaginatedIndexPage(indexPage)) {
                      const pageIndex = paginationOpts.cursor
                        ? Number(paginationOpts.cursor.replace("cursor:", ""))
                        : 0;
                      return Promise.resolve(
                        indexPage[pageIndex] ?? { page: [], isDone: true, continueCursor: "" },
                      );
                    }
                    return Promise.resolve({
                      page: indexPage,
                      isDone: true,
                      continueCursor: "",
                    });
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

  it("includes legacy no-link personal publisher skills when paginating", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx(
      {
        by_owner_active_updated: [makeSkill("legacy-skill")],
      },
      { legacyPersonalPublisher: true },
    );

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

  it("excludes other publisher-owned skills from personal publisher dashboards", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner_active_updated: [
        makeSkill("team-hidden", {
          ownerPublisherId: "publishers:org",
          moderationStatus: "hidden",
        }),
        makeSkill("personal-published", {
          ownerPublisherId: "publishers:self",
          moderationStatus: "hidden",
        }),
        makeSkill("legacy-skill"),
      ],
    });

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:self",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_active_updated");
    expect(result.page).toEqual([
      expect.objectContaining({ slug: "personal-published" }),
      expect.objectContaining({ slug: "legacy-skill" }),
    ]);
  });

  it("continues personal dashboard pagination past other publisher-owned rows", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx } = makeCtx({
      by_owner_active_updated: [
        {
          page: [
            makeSkill("team-hidden", {
              ownerPublisherId: "publishers:org",
              moderationStatus: "hidden",
            }),
          ],
          isDone: false,
          continueCursor: "cursor:1",
        },
        {
          page: [makeSkill("legacy-skill")],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:self",
        paginationOpts: { cursor: null, numItems: 1 },
      } as never,
    );

    expect(result.page).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe("");
  });

  it("continues owner-user dashboard pagination past stale publisher-owned rows", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx } = makeCtx({
      by_owner_active_updated: [
        {
          page: [
            makeSkill("other-personal-hidden", {
              ownerPublisherId: "publishers:other-personal",
              moderationStatus: "hidden",
            }),
            makeSkill("org-hidden", {
              ownerPublisherId: "publishers:org",
              moderationStatus: "hidden",
            }),
          ],
          isDone: false,
          continueCursor: "cursor:1",
        },
        {
          page: [makeSkill("legacy-skill", { moderationStatus: "hidden" })],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await handler(
      ctx as never,
      {
        ownerUserId: "users:owner",
        paginationOpts: { cursor: null, numItems: 1 },
      } as never,
    );

    expect(result.page).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe("");
  });

  it("includes linked-user legacy skills in non-owner personal publisher reads", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:other" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner_active_updated: [
        makeSkill("published-skill", { ownerPublisherId: "publishers:self" }),
        makeSkill("legacy-skill"),
      ],
    });

    const result = await handler(
      ctx as never,
      {
        ownerPublisherId: "publishers:self",
        paginationOpts,
      } as never,
    );

    expect(indexCalls).toContain("by_owner_active_updated");
    expect(indexCalls).not.toContain("by_owner_publisher_active_updated");
    expect(result.page).toEqual([
      expect.objectContaining({ slug: "published-skill" }),
      expect.objectContaining({ slug: "legacy-skill" }),
    ]);
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
        legacyPersonalPublisher: true,
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
        legacyPersonalPublisher: true,
      },
    );

    const result = await listHandler(
      ctx as never,
      { ownerPublisherId: "publishers:self", limit: 20 } as never,
    );

    expect(indexCalls).toContain("by_owner_publisher");
    expect(result).toEqual([]);
  });

  it("includes linked-user legacy personal skills in public non-paginated lists", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:other" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner: [makeSkill("legacy-skill")],
    });

    const result = await listHandler(
      ctx as never,
      { ownerPublisherId: "publishers:self", limit: 20 } as never,
    );

    expect(indexCalls).toContain("by_owner");
    expect(result).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
  });

  it("includes legacy no-link personal publisher skills in the non-paginated list", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx(
      {
        by_owner: [makeSkill("legacy-skill")],
      },
      { legacyPersonalPublisher: true },
    );

    const result = await listHandler(
      ctx as never,
      { ownerPublisherId: "publishers:self", limit: 20 } as never,
    );

    expect(indexCalls).toContain("by_owner");
    expect(result).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
  });

  it("keeps stale publisher-owned rows out of owner-user non-paginated dashboards", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx, indexCalls } = makeCtx({
      by_owner: [
        makeSkill("other-personal-hidden", {
          ownerPublisherId: "publishers:other-personal",
          moderationStatus: "hidden",
        }),
        makeSkill("org-hidden", {
          ownerPublisherId: "publishers:org",
          moderationStatus: "hidden",
        }),
        makeSkill("legacy-skill", { moderationStatus: "hidden" }),
      ],
    });

    const result = await listHandler(
      ctx as never,
      { ownerUserId: "users:owner", limit: 20 } as never,
    );

    expect(indexCalls).toContain("by_owner");
    expect(result).toEqual([expect.objectContaining({ slug: "legacy-skill" })]);
  });
});
