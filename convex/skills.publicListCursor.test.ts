/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("convex-helpers/server/pagination", async () => {
  const actual = await vi.importActual<typeof import("convex-helpers/server/pagination")>(
    "convex-helpers/server/pagination",
  );
  return {
    ...actual,
    getPage: vi.fn(),
  };
});

const pagination = await import("convex-helpers/server/pagination");
const {
  listAuditPage,
  listPublicApiPageV1,
  listPublicPageV4,
  listPublicTrendingPage,
  listRelatedByCategory,
} = await import("./skills");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type PublicListArgs = {
  cursor?: string;
  numItems?: number;
  sort?:
    | "default"
    | "recommended"
    | "newest"
    | "updated"
    | "downloads"
    | "installs"
    | "stars"
    | "name";
  dir?: "asc" | "desc";
  highlightedOnly?: boolean;
  nonSuspiciousOnly?: boolean;
  capabilityTag?: string;
  categorySlug?: string;
  categoryKeywords?: string[];
  excludeCategoryKeywords?: string[];
};

type PublicListResult = {
  page: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
};

type PublicApiListResult = {
  items: unknown[];
  nextCursor: string | null;
};

const getPageMock = pagination.getPage as unknown as ReturnType<typeof vi.fn>;
const listPublicPageV4Handler = (
  listPublicPageV4 as unknown as WrappedHandler<PublicListArgs, PublicListResult>
)._handler;
const listPublicApiPageV1Handler = (
  listPublicApiPageV1 as unknown as WrappedHandler<PublicListArgs, PublicApiListResult>
)._handler;
const listRelatedByCategoryHandler = (
  listRelatedByCategory as unknown as WrappedHandler<
    { skillId: string; categorySlug?: string; keywords: string[]; limit?: number },
    { items: Array<{ skill: { slug: string }; ownerHandle: string | null }> }
  >
)._handler;
const listPublicTrendingPageHandler = (
  listPublicTrendingPage as unknown as WrappedHandler<
    { limit?: number; nonSuspiciousOnly?: boolean },
    PublicApiListResult
  >
)._handler;
const listAuditPageHandler = (
  listAuditPage as unknown as WrappedHandler<
    { paginationOpts: { cursor: string | null; numItems: number } },
    PublicListResult
  >
)._handler;

function makeSearchDigest(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skillSearchDigest:demo",
    skillId: "skills:demo",
    slug: "demo",
    displayName: "Demo",
    summary: "Demo skill",
    icon: undefined,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    ownerHandle: "owner",
    ownerKind: "user",
    ownerName: "Owner",
    ownerDisplayName: "Owner",
    ownerImage: null,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: "skillVersions:1",
    latestVersionSkillId: "skills:demo",
    latestVersionSummary: {
      version: "1.0.0",
      createdAt: 9,
      changelog: "initial",
      changelogSource: "user",
      clawdis: undefined,
    },
    tags: {},
    capabilityTags: [],
    badges: {},
    stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
    statsDownloads: 0,
    statsStars: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: undefined,
    moderationReason: undefined,
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function legacyCursor(key: unknown[]): string {
  return JSON.stringify(key);
}

function cursorForIndex(index: string, key: unknown[]): string {
  return JSON.stringify({ v: 1, index, key });
}

class TestEqBuilder {
  eq(_field: string, _value: unknown) {
    return this;
  }
}

function makeMissingRecommendedRankStatsCtx() {
  const first = vi.fn(async () => makeSearchDigest({ statsStars: undefined }));
  const withIndex = vi.fn((_indexName: string, build: (q: TestEqBuilder) => unknown) => {
    build(new TestEqBuilder());
    return { first };
  });
  const query = vi.fn((table: string) => {
    if (table !== "skillSearchDigest") throw new Error(`unexpected table ${table}`);
    return { withIndex };
  });

  return {
    ctx: { db: { query } },
    first,
    query,
    withIndex,
  };
}

describe("public skill list deterministic cursors", () => {
  beforeEach(() => {
    getPageMock.mockReset();
    getPageMock.mockResolvedValue({ page: [], hasMore: false, indexKeys: [] });
  });

  it("falls back to the updated index while default rank stats are missing", async () => {
    const { ctx, withIndex } = makeMissingRecommendedRankStatsCtx();

    await listPublicPageV4Handler(ctx, {
      numItems: 10,
    });

    expect(withIndex.mock.calls.map(([indexName]) => indexName)).toEqual([
      "by_active_stats_stars",
      "by_active_stats_downloads",
    ]);
    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined],
      endIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("falls back to the non-suspicious updated index while default rank stats are missing", async () => {
    const { ctx, withIndex } = makeMissingRecommendedRankStatsCtx();

    await listPublicApiPageV1Handler(ctx, {
      numItems: 10,
      sort: "recommended",
      nonSuspiciousOnly: true,
    });

    expect(withIndex.mock.calls.map(([indexName]) => indexName)).toEqual([
      "by_nonsuspicious_stars",
      "by_nonsuspicious_downloads",
    ]);
    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_nonsuspicious_updated",
      startIndexKey: [undefined, false],
      endIndexKey: [undefined, false],
      startInclusive: true,
    });
  });

  it("ignores stale legacy cursors that are longer than the selected index", async () => {
    const staleDownloadsCursor = legacyCursor([{ __undef: 1 }, false, 100, 200]);

    await listPublicPageV4Handler({} as never, {
      cursor: staleDownloadsCursor,
      sort: "name",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_name",
      startIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("ignores self-describing cursors from a different selected index", async () => {
    const staleCursor = cursorForIndex("by_nonsuspicious_downloads", [
      { __undef: 1 },
      false,
      100,
      200,
    ]);

    await listPublicPageV4Handler({} as never, {
      cursor: staleCursor,
      sort: "downloads",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_stats_downloads",
      startIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("continues from valid cursors and emits the selected index with the next cursor", async () => {
    getPageMock.mockResolvedValueOnce({
      page: [],
      hasMore: true,
      indexKeys: [[undefined, "delta", 200, "skillSearchDigest:delta"]],
    });
    const validCursor = cursorForIndex("by_active_name", [
      { __undef: 1 },
      "beta",
      100,
      "skillSearchDigest:beta",
    ]);

    const result = await listPublicPageV4Handler({} as never, {
      cursor: validCursor,
      sort: "name",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_name",
      startIndexKey: [undefined, "beta", 100, "skillSearchDigest:beta"],
      startInclusive: false,
    });
    expect(JSON.parse(result.nextCursor ?? "")).toEqual({
      v: 1,
      index: "by_active_name",
      key: [{ __undef: 1 }, "delta", 200, "skillSearchDigest:delta"],
    });
  });

  it("guards the public API list against stale index cursors too", async () => {
    const staleCursor = legacyCursor([{ __undef: 1 }, false, 100, 200]);

    await listPublicApiPageV1Handler({} as never, {
      cursor: staleCursor,
      sort: "updated",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("paginates the public API list from getPage's full self-describing cursor", async () => {
    getPageMock
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        indexKeys: [[undefined, 200, 201, "skillSearchDigest:alpha"]],
      })
      .mockResolvedValueOnce({
        page: [],
        hasMore: false,
        indexKeys: [[undefined, 300, 301, "skillSearchDigest:beta"]],
      });

    const first = await listPublicApiPageV1Handler({} as never, {
      sort: "updated",
      nonSuspiciousOnly: false,
      numItems: 1,
    });

    expect(first.nextCursor).not.toBeNull();
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined],
      startInclusive: true,
    });

    const second = await listPublicApiPageV1Handler({} as never, {
      cursor: first.nextCursor!,
      sort: "updated",
      nonSuspiciousOnly: false,
      numItems: 1,
    });

    expect(second.nextCursor).toBeNull();
    expect(getPageMock.mock.calls[1]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined, 200, 201, "skillSearchDigest:alpha"],
      startInclusive: false,
    });
  });

  it("applies token-based category filters while scanning public list pages", async () => {
    getPageMock.mockResolvedValueOnce({
      page: [
        makeDigest({
          slug: "navigation-without-screens",
          displayName: "Navigation Without Screens",
          summary: "Physical navigation skills without digital devices.",
          statsDownloads: 22,
        }),
        makeDigest({
          slug: "developer-utils",
          displayName: "Developer Utils",
          summary: "Utilities for build and debug workflows.",
          statsDownloads: 21,
        }),
      ],
      hasMore: false,
      indexKeys: [
        [undefined, 22, 1],
        [undefined, 21, 2],
      ],
    });

    const result = await listPublicPageV4Handler(
      {} as never,
      {
        categoryKeywords: ["dev", "debug", "lint", "test", "build"],
        categorySlug: "dev-tools",
        nonSuspiciousOnly: false,
        numItems: 10,
        sort: "downloads",
      } as PublicListArgs,
    );

    expect(getPageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        absoluteMaxRows: expect.any(Number),
        index: "by_active_stats_downloads",
      }),
    );
    expect(
      (result.page as Array<{ skill: { slug: string } }>).map((entry) => entry.skill.slug),
    ).toEqual(["developer-utils"]);
  });

  it("continues filtered public list pagination across empty scan windows", async () => {
    const emptySecurityWindow = (downloads: number) => ({
      page: [
        makeDigest({
          slug: `weather-helper-${downloads}`,
          displayName: "Weather Helper",
          summary: "Get current forecasts.",
          statsDownloads: downloads,
        }),
      ],
      hasMore: true,
      indexKeys: [[undefined, downloads, downloads]],
    });
    getPageMock
      .mockResolvedValueOnce(emptySecurityWindow(30))
      .mockResolvedValueOnce(emptySecurityWindow(29))
      .mockResolvedValueOnce(emptySecurityWindow(28))
      .mockResolvedValueOnce(emptySecurityWindow(27));

    const result = await listPublicPageV4Handler({} as never, {
      categoryKeywords: ["security", "scan", "auth", "encrypt"],
      categorySlug: "security",
      nonSuspiciousOnly: false,
      numItems: 10,
      sort: "downloads",
    });

    expect(result.page).toEqual([]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
  });

  it("drops stale API list latest versions that belong to another skill", async () => {
    getPageMock.mockResolvedValueOnce({
      page: [
        makeSearchDigest({
          latestVersionId: "skillVersions:other",
          latestVersionSkillId: "skills:other",
          latestVersionSummary: {
            version: "9.9.9",
            createdAt: 9,
            changelog: "other",
            changelogSource: "user",
            clawdis: undefined,
          },
        }),
      ],
      hasMore: false,
      indexKeys: [],
    });

    const result = await listPublicApiPageV1Handler({} as never, {
      numItems: 10,
      sort: "updated",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ latestVersion: null });
  });

  it("keeps verified legacy API list latest versions without owner markers", async () => {
    getPageMock.mockResolvedValueOnce({
      page: [
        makeSearchDigest({
          latestVersionSkillId: undefined,
        }),
      ],
      hasMore: false,
      indexKeys: [],
    });

    const result = await listPublicApiPageV1Handler(
      {
        db: {
          get: vi.fn(async (id: string) =>
            id === "skillVersions:1"
              ? {
                  _id: id,
                  skillId: "skills:demo",
                  version: "1.0.0",
                  softDeletedAt: undefined,
                }
              : null,
          ),
        },
      } as never,
      { numItems: 10, sort: "updated" },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      latestVersion: {
        version: "1.0.0",
      },
    });
  });

  it("drops stale trending latest versions that belong to another skill", async () => {
    const staleDigest = makeSearchDigest({
      latestVersionId: "skillVersions:other",
      latestVersionSkillId: "skills:other",
      latestVersionSummary: {
        version: "9.9.9",
        createdAt: 9,
        changelog: "other",
        changelogSource: "user",
        clawdis: undefined,
      },
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "skillLeaderboards") {
            return {
              withIndex: () => ({
                order: () => ({
                  first: async () => ({ items: [{ skillId: "skills:demo" }] }),
                }),
              }),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: () => ({
                unique: async () => staleDigest,
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listPublicTrendingPageHandler(ctx as never, { limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ latestVersion: null });
  });

  it("keeps verified legacy trending latest versions without owner markers", async () => {
    const legacyDigest = makeSearchDigest({
      latestVersionSkillId: undefined,
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "skillVersions:1"
            ? {
                _id: id,
                skillId: "skills:demo",
                version: "1.0.0",
                softDeletedAt: undefined,
              }
            : null,
        ),
        query: vi.fn((table: string) => {
          if (table === "skillLeaderboards") {
            return {
              withIndex: () => ({
                order: () => ({
                  first: async () => ({ items: [{ skillId: "skills:demo" }] }),
                }),
              }),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: () => ({
                unique: async () => legacyDigest,
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listPublicTrendingPageHandler(ctx as never, { limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      latestVersion: {
        version: "1.0.0",
      },
    });
  });

  it("drops audit latest versions that resolve to another skill", async () => {
    const digest = makeSearchDigest({
      latestVersionId: "skillVersions:other",
      latestVersionSkillId: undefined,
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "skillVersions:other") {
            return {
              _id: id,
              _creationTime: 1,
              skillId: "skills:other",
              version: "9.9.9",
              createdAt: 9,
              files: [],
              vtAnalysis: { status: "clean" },
              llmAnalysis: { status: "clean" },
              staticScan: { status: "clean", reasonCodes: [], findings: [] },
              softDeletedAt: undefined,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table !== "skillSearchDigest") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({
                paginate: vi.fn().mockResolvedValue({
                  page: [digest],
                  isDone: true,
                  continueCursor: "",
                }),
              })),
            })),
          };
        }),
      },
    };

    const result = await listAuditPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({ latestVersion: null });
  });
});

function makeDigest(overrides: Record<string, unknown>) {
  return {
    _id: `skillSearchDigest:${String(overrides.slug)}`,
    _creationTime: 0,
    skillId: `skills:${String(overrides.slug)}`,
    slug: String(overrides.slug),
    displayName: String(overrides.displayName ?? overrides.slug),
    summary: overrides.summary,
    ownerUserId: "users:owner",
    ownerPublisherId: "publishers:owner",
    ownerHandle: "owner",
    ownerKind: "user",
    ownerDisplayName: "Owner",
    tags: {},
    badges: {},
    stats: {
      downloads: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    statsDownloads: overrides.statsDownloads ?? 0,
    statsStars: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    softDeletedAt: overrides.softDeletedAt,
    moderationStatus: overrides.moderationStatus ?? "active",
    moderationFlags: overrides.moderationFlags,
    isSuspicious: overrides.isSuspicious,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("skills.listRelatedByCategory", () => {
  it("uses an indexed bounded digest query and returns matching public category skills", async () => {
    const digests = [
      makeDigest({
        skillId: "skills:current",
        slug: "workflow-runner",
        displayName: "Workflow Runner",
        summary: "Build workflow pipelines.",
      }),
      makeDigest({
        slug: "pipeline-builder",
        displayName: "Pipeline Builder",
        summary: "Compose workflow automations.",
        statsDownloads: 20,
      }),
      makeDigest({
        slug: "calendar",
        displayName: "Calendar",
        summary: "Track meetings.",
        statsDownloads: 18,
      }),
      makeDigest({
        slug: "hidden-workflow",
        displayName: "Hidden Workflow",
        summary: "Workflow helper.",
        moderationStatus: "hidden",
        statsDownloads: 16,
      }),
      makeDigest({
        slug: "suspicious-workflow",
        displayName: "Suspicious Workflow",
        summary: "Workflow helper.",
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
        statsDownloads: 14,
      }),
      makeDigest({
        slug: "workflow-audit",
        displayName: "Workflow Audit",
        summary: "Review workflow runs.",
        statsDownloads: 12,
      }),
    ];
    const take = vi.fn().mockResolvedValue(digests);
    const order = vi.fn(() => ({ take }));
    const eq = vi.fn(() => ({ eq }));
    const withIndex = vi.fn((_index: string, builder: (q: { eq: typeof eq }) => void) => {
      builder({ eq });
      return { order };
    });
    const query = vi.fn((table: string) => {
      if (table !== "skillSearchDigest") throw new Error(`Unexpected query table: ${table}`);
      return { withIndex };
    });

    const result = await listRelatedByCategoryHandler({ db: { query } } as never, {
      skillId: "skills:current",
      keywords: ["workflow"],
      limit: 2,
    });

    expect(withIndex).toHaveBeenCalledWith("by_active_stats_downloads", expect.any(Function));
    expect(eq).toHaveBeenCalledWith("softDeletedAt", undefined);
    expect(order).toHaveBeenCalledWith("desc");
    expect(take).toHaveBeenCalledWith(expect.any(Number));
    expect(result.items.map((entry) => entry.skill.slug)).toEqual([
      "pipeline-builder",
      "workflow-audit",
    ]);
    expect(result.items[0]?.ownerHandle).toBe("owner");
  });

  it("does not match generated dev slug prefixes as Dev Tools suggestions", async () => {
    const digests = [
      makeDigest({
        skillId: "skills:current",
        slug: "debug-helper",
        displayName: "Debug Helper",
        summary: "Debug build failures.",
      }),
      makeDigest({
        slug: "navigation-without-screens",
        displayName: "Navigation Without Screens",
        summary: "Physical navigation skills without digital devices.",
        statsDownloads: 22,
      }),
      makeDigest({
        slug: "developer-utils",
        displayName: "Developer Utils",
        summary: "Utilities for build and debug workflows.",
        statsDownloads: 21,
      }),
      makeDigest({
        slug: "web3-dev",
        displayName: "Blockscout for Web3 Dev",
        summary:
          "Build web3 applications that need blockchain data via the Blockscout PRO API over HTTP.",
        statsDownloads: 19,
      }),
      makeDigest({
        slug: "dev-jh86ceyb-weather-helper",
        displayName: "Weather Helper",
        summary: "Get current forecasts.",
        statsDownloads: 20,
      }),
      makeDigest({
        slug: "build-runner",
        displayName: "Build Runner",
        summary: "Run build checks.",
        statsDownloads: 18,
      }),
    ];
    const take = vi.fn().mockResolvedValue(digests);
    const order = vi.fn(() => ({ take }));
    const eq = vi.fn(() => ({ eq }));
    const withIndex = vi.fn((_index: string, builder: (q: { eq: typeof eq }) => void) => {
      builder({ eq });
      return { order };
    });
    const query = vi.fn((table: string) => {
      if (table !== "skillSearchDigest") throw new Error(`Unexpected query table: ${table}`);
      return { withIndex };
    });

    const result = await listRelatedByCategoryHandler({ db: { query } } as never, {
      skillId: "skills:current",
      categorySlug: "dev-tools",
      keywords: ["dev", "debug", "lint", "test", "build"],
      limit: 3,
    });

    expect(result.items.map((entry) => entry.skill.slug)).toEqual([
      "developer-utils",
      "build-runner",
    ]);
  });
});
