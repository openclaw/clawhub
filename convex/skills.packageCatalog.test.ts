/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("convex-helpers/server/pagination", async () => {
  const actual = await vi.importActual<typeof import("convex-helpers/server/pagination")>(
    "convex-helpers/server/pagination",
  );
  return {
    ...actual,
    paginator: (db: unknown) => db,
  };
});

const { listPackageCatalogPage, searchPackageCatalogPublic } = await import("./skills");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listPackageCatalogPageHandler = (
  listPackageCatalogPage as unknown as WrappedHandler<
    {
      channel?: "official" | "community" | "private";
      isOfficial?: boolean;
      sort?: "updated" | "downloads" | "recommended" | "installs";
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{
        name: string;
        family: "skill";
        channel: "official" | "community";
        isOfficial: boolean;
      }>;
      isDone: boolean;
      continueCursor: string;
    }
  >
)._handler;

const searchPackageCatalogPublicHandler = (
  searchPackageCatalogPublic as unknown as WrappedHandler<
    {
      query: string;
      limit?: number;
      channel?: "official" | "community" | "private";
      isOfficial?: boolean;
    },
    Array<{ score: number; package: { name: string; family: "skill"; isOfficial: boolean } }>
  >
)._handler;

function makeDigest(
  slug: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    _id: `skillSearchDigest:${slug}`,
    _creationTime: 1,
    skillId: `skills:${slug}`,
    slug,
    displayName: slug,
    summary: `${slug} summary`,
    ownerUserId: "users:owner",
    ownerHandle: "steipete",
    ownerName: "Peter",
    ownerDisplayName: "Peter",
    ownerImage: null,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: `skillVersions:${slug}-1`,
    latestVersionSkillId: `skills:${slug}`,
    latestVersionSummary: {
      version: "1.0.0",
      createdAt: 10,
      changelog: "init",
    },
    tags: { latest: `skillVersions:${slug}-1` },
    badges: {},
    stats: {
      downloads: 1,
      installsCurrent: 1,
      installsAllTime: 1,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    statsDownloads: 1,
    statsStars: 0,
    statsInstallsCurrent: 1,
    statsInstallsAllTime: 1,
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    moderationReason: undefined,
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeCtx(
  pages: Array<{ page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }>,
  optionsOrIndexNames:
    | { indexNames?: string[]; missingRecommendedScores?: boolean }
    | string[] = {},
) {
  const indexNames = Array.isArray(optionsOrIndexNames)
    ? optionsOrIndexNames
    : optionsOrIndexNames.indexNames;
  const missingRecommendedScores =
    !Array.isArray(optionsOrIndexNames) && optionsOrIndexNames.missingRecommendedScores === true;
  const pageByCursor = new Map<
    string | null,
    { page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }
  >();
  const allDigests = pages.flatMap((page) => page.page);
  let cursor: string | null = null;
  for (const page of pages) {
    pageByCursor.set(cursor, page);
    cursor = page.continueCursor;
  }
  return {
    db: {
      query: (table: string) => {
        if (table === "skills") {
          return {
            withIndex: (
              _index: string,
              builder: (q: {
                eq: (field: string, value: string) => { field: string; value: string };
              }) => { field: string; value: string },
            ) => {
              const constraint = builder({ eq: (field, value) => ({ field, value }) });
              return {
                unique: async () => {
                  if (constraint.field !== "slug") return null;
                  const digest = allDigests.find((entry) => entry.slug === constraint.value);
                  if (!digest) return null;
                  return {
                    _id: digest.skillId,
                    slug: digest.slug,
                    softDeletedAt: digest.softDeletedAt,
                  };
                },
              };
            },
          };
        }

        return {
          withIndex: (indexName: string) => {
            indexNames?.push(indexName);
            return {
              order: () => ({
                paginate: async ({ cursor: pageCursor }: { cursor: string | null }) =>
                  pageByCursor.get(pageCursor) ?? { page: [], isDone: true, continueCursor: "" },
              }),
              first: async () =>
                missingRecommendedScores && indexName.startsWith("by_active_recommended_")
                  ? (allDigests[0] ?? {})
                  : null,
              unique: async () => null,
            };
          },
        };
      },
    },
  };
}

describe("skills package catalog queries", () => {
  it("sorts skill package catalog rows by all-time installs", async () => {
    const indexNames: string[] = [];

    await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [makeDigest("installed-skill")],
            isDone: true,
            continueCursor: "",
          },
        ],
        indexNames,
      ),
      {
        sort: "installs",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(indexNames).toContain("by_active_stats_installs_all_time");
  });

  it("lists official skills as package catalog rows", async () => {
    const result = await listPackageCatalogPageHandler(
      makeCtx([
        {
          page: [
            makeDigest("official-skill", {
              badges: { official: { byUserId: "users:admin", at: 1 } },
            }),
            makeDigest("community-skill"),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        isOfficial: true,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(result.page).toEqual([
      expect.objectContaining({
        name: "official-skill",
        family: "skill",
        channel: "official",
        isOfficial: true,
      }),
    ]);
  });

  it("uses the all-time installs index for install-sorted package catalog rows", async () => {
    const indexNames: string[] = [];
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [
              makeDigest("installed-skill", {
                stats: {
                  downloads: 1,
                  installsCurrent: 2,
                  installsAllTime: 20,
                  stars: 0,
                  versions: 1,
                  comments: 0,
                },
                statsInstallsAllTime: 20,
              }),
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        { indexNames },
      ),
      {
        sort: "installs",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(indexNames).toEqual(["by_active_stats_installs_all_time"]);
    expect(result.page).toEqual([
      expect.objectContaining({
        name: "installed-skill",
        stats: expect.objectContaining({ installs: 20 }),
      }),
    ]);
  });

  it("uses the recommended score index for recommended package catalog rows", async () => {
    const indexNames: string[] = [];
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [
              makeDigest("recommended-skill", {
                recommendedScore: 12,
                recommendedScoreVersion: 1,
              }),
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        { indexNames },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(indexNames.at(-1)).toBe("by_active_recommended_score");
    expect(result.page).toEqual([expect.objectContaining({ name: "recommended-skill" })]);
  });

  it("falls recommended package catalog rows back to updated when scores are missing", async () => {
    const indexNames: string[] = [];
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [makeDigest("updated-fallback-skill")],
            isDone: false,
            continueCursor: "updated-next",
          },
        ],
        { indexNames, missingRecommendedScores: true },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );

    expect(indexNames).toEqual(["by_active_recommended_score", "by_active_updated"]);
    expect(result.page).toEqual([expect.objectContaining({ name: "updated-fallback-skill" })]);
    expect(result.continueCursor).toContain('"recommendedFallback":"updated"');
  });

  it("keeps recommended package catalog cursors on their original index", async () => {
    const indexNames: string[] = [];
    const recommendedCursor = `skillcat:${JSON.stringify({
      cursor: null,
      offset: 1,
      pageSize: 2,
      done: false,
    })}`;
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [
              makeDigest("already-seen-skill", {
                recommendedScore: 20,
                recommendedScoreVersion: 1,
              }),
              makeDigest("next-recommended-skill", {
                recommendedScore: 10,
                recommendedScoreVersion: 1,
              }),
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        { indexNames, missingRecommendedScores: true },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: recommendedCursor, numItems: 1 },
      },
    );

    expect(indexNames).toEqual(["by_active_recommended_score"]);
    expect(result.page).toEqual([expect.objectContaining({ name: "next-recommended-skill" })]);
  });

  it("searches skills with package-style lexical scoring", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [
            makeDigest("demo-skill"),
            makeDigest("other-skill", { displayName: "Other Skill", summary: "nothing here" }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "demo-skill",
        limit: 5,
      },
    );

    expect(result[0]).toMatchObject({
      package: {
        name: "demo-skill",
        family: "skill",
      },
    });
    expect(result[0]?.score).toBeGreaterThan(0);
  });

  it("does not let official status make unrelated skills eligible for package search", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [
            makeDigest("official-skill", {
              badges: { official: { byUserId: "users:admin", at: 1 } },
              displayName: "Official Skill",
              summary: "General integration.",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "zzzznonexistentquery123",
        limit: 5,
      },
    );

    expect(result).toEqual([]);
  });

  it("returns skill package match metadata and orders name matches before summary matches", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [
            makeDigest("official-helper", {
              badges: { official: { byUserId: "users:admin", at: 1 } },
              displayName: "Official Helper",
              summary: "Ghost CMS integration.",
              updatedAt: 100,
            }),
            makeDigest("ghost-tools", {
              displayName: "Ghost Tools",
              summary: "CMS helper.",
              updatedAt: 1,
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "ghost",
        limit: 5,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["ghost-tools", "official-helper"]);
    expect(result[0]).not.toHaveProperty("rankTier");
    expect(result[0]).not.toHaveProperty("matchReason");
  });

  it("uses skill summary as package search evidence", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [
            makeDigest("wallet-helper", {
              displayName: "Wallet Helper",
              summary: "Crypto payment helper.",
            }),
            makeDigest("weather"),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "crypto",
        limit: 5,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["wallet-helper"]);
    expect(result[0]).not.toHaveProperty("rankTier");
  });

  it("does not drop short tokens from exploratory skill package matches", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [
            makeDigest("database-tools", {
              displayName: "Database Tools",
              summary: "Postgres database helper.",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "ai postgres",
        limit: 5,
      },
    );

    expect(result).toEqual([]);
  });

  it("ignores retired capability filter args in skill package listings", async () => {
    const result = await listPackageCatalogPageHandler(
      makeCtx([
        {
          page: [makeDigest("paytoll"), makeDigest("weather")],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        capabilityTag: "crypto",
        paginationOpts: { cursor: null, numItems: 10 },
      } as Parameters<typeof listPackageCatalogPageHandler>[1] & { capabilityTag?: string },
    );

    expect(result.page).toEqual([
      expect.objectContaining({
        name: "paytoll",
      }),
      expect.objectContaining({
        name: "weather",
      }),
    ]);
  });
});
