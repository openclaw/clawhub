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

/** Build a mock ctx where `skills` queries return `allSkills`,
 *  and search-index queries return `searchHits` (defaults to allSkills). */
function makeCtx(
  allSkills: ReturnType<typeof makeSkill>[],
  searchHits?: ReturnType<typeof makeSkill>[],
) {
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
          const makeFilterChain = (items: ReturnType<typeof makeSkill>[]) => ({
            order: vi.fn(() => ({
              take: vi.fn().mockResolvedValue(items),
              paginate: vi.fn().mockResolvedValue({
                page: items,
                isDone: true,
                continueCursor: "",
              }),
            })),
            collect: vi.fn().mockResolvedValue(items),
          });
          return {
            withIndex: vi.fn(() => ({
              filter: vi.fn(() => makeFilterChain(allSkills)),
              ...makeFilterChain(allSkills),
            })),
            withSearchIndex: vi.fn(() => ({
              take: vi.fn().mockResolvedValue(searchHits ?? allSkills),
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

// ---------------------------------------------------------------------------
// countDashboard
// ---------------------------------------------------------------------------

describe("skills.countDashboard", () => {
  it("counts skills for ownerUserId", async () => {
    const ctx = makeCtx([makeSkill("a"), makeSkill("b"), makeSkill("c")]);
    const result = await countHandler(ctx as never, { ownerUserId: "users:owner" } as never);
    expect(result).toBe(3);
  });

  it("counts skills for ownerPublisherId", async () => {
    const ctx = makeCtx([makeSkill("a"), makeSkill("b")]);
    const result = await countHandler(ctx as never, { ownerPublisherId: "publishers:pub" } as never);
    expect(result).toBe(2);
  });

  it("returns 0 when no owner specified", async () => {
    const ctx = makeCtx([makeSkill("a")]);
    const result = await countHandler(ctx as never, {});
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// searchDashboard
// ---------------------------------------------------------------------------

describe("skills.searchDashboard", () => {
  const allSkills = [
    makeSkill("slack", { displayName: "Slack", summary: "Slack messaging." }),
    makeSkill("stripe", { displayName: "Stripe", summary: "Payment processing." }),
    makeSkill("github", { displayName: "GitHub", summary: "Code hosting." }),
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

  it("returns matched skills from search index", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const hits = [allSkills[0]]; // Slack
    const ctx = makeCtx(allSkills, hits);
    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "Slack",
    } as never);
    expect(result).toEqual([expect.objectContaining({ slug: "slack" })]);
  });

  it("returns multiple search hits", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const hits = [allSkills[0], allSkills[2]]; // Slack, GitHub
    const ctx = makeCtx(allSkills, hits);
    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "integration",
    } as never);
    expect(result).toHaveLength(2);
  });

  it("returns empty when no hits", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills, []);
    const result = await searchHandler(ctx as never, {
      ownerUserId: "users:owner",
      search: "nonexistent",
    } as never);
    expect(result).toEqual([]);
  });

  it("returns empty when no owner specified", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeCtx(allSkills);
    const result = await searchHandler(ctx as never, { search: "slack" } as never);
    expect(result).toEqual([]);
  });

  it("works with ownerPublisherId", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const hits = [allSkills[1]]; // Stripe
    const ctx = makeCtx(allSkills, hits);
    const result = await searchHandler(ctx as never, {
      ownerPublisherId: "publishers:pub",
      search: "Stripe",
    } as never);
    expect(result).toEqual([expect.objectContaining({ slug: "stripe" })]);
  });
});
