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
      topic?: string;
      sort?: "updated" | "downloads" | "installs";
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
      topic?: string;
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
  indexNames: string[] = [],
) {
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
            indexNames.push(indexName);
            return {
              order: () => ({
                paginate: async ({ cursor: pageCursor }: { cursor: string | null }) =>
                  pageByCursor.get(pageCursor) ?? { page: [], isDone: true, continueCursor: "" },
                take: async () => [],
              }),
              unique: async () => null,
            };
          },
        };
      },
    },
  };
}

function makeTopicCtx(
  pages: Array<{ page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }>,
  digests: Array<Record<string, unknown>>,
  indexNames: string[] = [],
) {
  const pageByCursor = new Map<
    string | null,
    { page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }
  >();
  let cursor: string | null = null;
  for (const page of pages) {
    pageByCursor.set(cursor, page);
    cursor = page.continueCursor;
  }
  return {
    db: {
      query: (table: string) => ({
        withIndex: (
          indexName: string,
          builder?: (q: {
            eq: (
              field: string,
              value: string,
            ) => {
              eq: (nextField: string, nextValue: string) => unknown;
              field: string;
              value: string;
            };
          }) => unknown,
        ) => {
          indexNames.push(indexName);
          if (table === "skills" || table === "skillSlugAliases") {
            builder?.({
              eq: (field, value) => ({
                field,
                value,
                eq: () => ({}),
              }),
            });
            return { unique: async () => null };
          }
          if (table === "skillSearchDigest" && indexName === "by_skill") {
            let skillId: string | undefined;
            builder?.({
              eq: (field, value) => {
                if (field === "skillId") skillId = value;
                return {
                  field,
                  value,
                  eq: () => ({}),
                };
              },
            });
            return {
              unique: async () => digests.find((digest) => digest.skillId === skillId) ?? null,
            };
          }
          builder?.({
            eq: (field, value) => ({
              field,
              value,
              eq: () => ({}),
            }),
          });
          return {
            order: () => ({
              paginate: async ({ cursor: pageCursor }: { cursor: string | null }) =>
                pageByCursor.get(pageCursor) ?? { page: [], isDone: true, continueCursor: "" },
              take: async (limit: number) => pages.flatMap((page) => page.page).slice(0, limit),
            }),
          };
        },
      }),
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

  it("normalizes and filters skill package catalog topics", async () => {
    const indexNames: string[] = [];
    const calendarSkill = makeDigest("calendar-skill", { topics: ["calendar"] });
    const result = await listPackageCatalogPageHandler(
      makeTopicCtx(
        [
          {
            page: [
              {
                skillId: calendarSkill.skillId,
                topic: "calendar",
                updatedAt: calendarSkill.updatedAt,
              },
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        [calendarSkill],
        indexNames,
      ),
      {
        topic: " Calendar ",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(result.page.map((entry) => entry.name)).toEqual(["calendar-skill"]);
    expect(indexNames).toContain("by_active_topic_updated");
    expect(indexNames).not.toContain("by_active_updated");
  });

  it("uses the selected topic digest sort index for skill package listings", async () => {
    const indexNames: string[] = [];
    const calendarSkill = makeDigest("calendar-skill", { topics: ["calendar"] });

    await listPackageCatalogPageHandler(
      makeTopicCtx(
        [
          {
            page: [
              {
                skillId: calendarSkill.skillId,
                topic: "calendar",
                updatedAt: calendarSkill.updatedAt,
              },
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        [calendarSkill],
        indexNames,
      ),
      {
        topic: "calendar",
        sort: "installs",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(indexNames).toContain("by_active_topic_installs");
    expect(indexNames).not.toContain("by_active_stats_installs_all_time");
  });

  it("rejects invalid skill package catalog topics instead of returning an unfiltered page", async () => {
    const result = await listPackageCatalogPageHandler(
      makeCtx([
        {
          page: [makeDigest("unfiltered-skill")],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        topic: "!!!",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(result).toEqual({ page: [], isDone: true, continueCursor: "" });
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

  it("matches author topics in unfiltered skill package search", async () => {
    const topicSkill = makeDigest("render-helper", {
      displayName: "Render Helper",
      summary: "Configure a rendering pipeline.",
      topics: ["GPU development"],
    });
    const indexNames: string[] = [];
    const result = await searchPackageCatalogPublicHandler(
      makeTopicCtx(
        [
          {
            page: [
              {
                skillId: topicSkill.skillId,
                topic: "gpu-development",
                updatedAt: topicSkill.updatedAt,
              },
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        [topicSkill],
        indexNames,
      ),
      {
        query: "GPU development",
        limit: 1,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["render-helper"]);
    expect(indexNames).toContain("by_active_topic_updated");
  });

  it("normalizes and filters skill package catalog search topics", async () => {
    const indexNames: string[] = [];
    const calendarSkill = makeDigest("calendar-demo", { topics: ["calendar"] });
    const result = await searchPackageCatalogPublicHandler(
      makeTopicCtx(
        [
          {
            page: [
              {
                skillId: calendarSkill.skillId,
                topic: "calendar",
                updatedAt: calendarSkill.updatedAt,
              },
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        [calendarSkill],
        indexNames,
      ),
      {
        query: "demo",
        topic: " Calendar ",
        limit: 5,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["calendar-demo"]);
    expect(indexNames).toContain("by_active_topic_updated");
    expect(indexNames).not.toContain("by_active_updated");
  });

  it("uses author topics as skill package search evidence", async () => {
    const topicSkill = makeDigest("render-helper", {
      displayName: "Render Helper",
      summary: "Configure a rendering pipeline.",
      topics: ["GPU development"],
    });
    const result = await searchPackageCatalogPublicHandler(
      makeTopicCtx(
        [
          {
            page: [
              {
                skillId: topicSkill.skillId,
                topic: "gpu-development",
                updatedAt: topicSkill.updatedAt,
              },
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        [topicSkill],
      ),
      {
        query: "GPU development",
        topic: "gpu-development",
        limit: 5,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["render-helper"]);
  });

  it("rejects invalid skill package catalog search topics instead of returning unfiltered results", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [makeDigest("unfiltered-skill")],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "skill",
        topic: "!!!",
        limit: 5,
      },
    );

    expect(result).toEqual([]);
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
