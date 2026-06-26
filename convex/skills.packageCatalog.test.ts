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
      sort?: "updated" | "downloads" | "installs" | "recommended";
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
  optionsOrIndexNames:
    | {
        firstByIndex?: Record<string, unknown>;
        indexNames?: string[];
        missingRecommendedScores?: boolean;
      }
    | string[] = {},
) {
  const options = Array.isArray(optionsOrIndexNames)
    ? { indexNames: optionsOrIndexNames }
    : optionsOrIndexNames;
  const indexNames = options.indexNames;
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
                take: async () => [],
              }),
              first: async () =>
                options.firstByIndex?.[indexName] ??
                (missingRecommendedScores && indexName.startsWith("by_active_recommended_")
                  ? (allDigests[0] ?? {})
                  : null),
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
  missingRecommendedScores = false,
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
              value: unknown,
            ) => {
              eq: (nextField: string, nextValue: unknown) => unknown;
              lt: (nextField: string, nextValue: unknown) => unknown;
              field: string;
              value: unknown;
            };
          }) => unknown,
        ) => {
          indexNames.push(indexName);
          if (table === "skills" || table === "skillSlugAliases") {
            builder?.({
              eq: (field, value) => ({
                field,
                value,
                eq: () => ({ eq: () => ({}), lt: () => ({}) }),
                lt: () => ({}),
              }),
            });
            return { unique: async () => null };
          }
          if (table === "skillSearchDigest" && indexName === "by_skill") {
            let skillId: string | undefined;
            builder?.({
              eq: (field, value) => {
                if (field === "skillId" && typeof value === "string") skillId = value;
                return {
                  field,
                  value,
                  eq: () => ({ eq: () => ({}), lt: () => ({}) }),
                  gte: () => ({ lt: () => ({}) }),
                  lt: () => ({}),
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
              eq: () => ({ eq: () => ({}), lt: () => ({}) }),
              gte: () => ({ lt: () => ({}) }),
              lt: () => ({}),
            }),
          });
          return {
            first: async () =>
              table === "skillSearchDigest" &&
              missingRecommendedScores &&
              indexName.startsWith("by_active_recommended_")
                ? (digests[0] ?? {})
                : null,
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

  it("uses the selected topic recommendation score index for skill package listings", async () => {
    const indexNames: string[] = [];
    const calendarSkill = makeDigest("calendar-skill", {
      recommendedScore: 12,
      recommendedScoreVersion: 1,
      topics: ["calendar"],
    });

    const result = await listPackageCatalogPageHandler(
      makeTopicCtx(
        [
          {
            page: [
              {
                skillId: calendarSkill.skillId,
                topic: "calendar",
                recommendedScore: calendarSkill.recommendedScore,
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
        sort: "recommended",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(result.page.map((entry) => entry.name)).toEqual(["calendar-skill"]);
    expect(indexNames).toContain("by_active_topic_recommended_score");
    expect(indexNames).not.toContain("by_active_topic_updated");
  });

  it("keeps topic recommended sorting on the recommendation score index while scores are missing", async () => {
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
            isDone: false,
            continueCursor: "recommended-next",
          },
        ],
        [calendarSkill],
        indexNames,
        true,
      ),
      {
        topic: "calendar",
        sort: "recommended",
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );

    expect(result.page.map((entry) => entry.name)).toEqual(["calendar-skill"]);
    expect(indexNames).toContain("by_active_topic_recommended_score");
    expect(indexNames).not.toContain("by_active_topic_downloads");
    expect(result.continueCursor).not.toContain('"recommendedFallback":"downloads"');
  });

  it("keeps legacy topic recommendation fallback cursors on the updated index", async () => {
    const indexNames: string[] = [];
    const skills = [
      makeDigest("already-seen-skill", { topics: ["calendar"] }),
      makeDigest("next-updated-skill", { topics: ["calendar"] }),
      makeDigest("later-updated-skill", { topics: ["calendar"] }),
    ];
    const fallbackCursor = `skillcat:${JSON.stringify({
      cursor: null,
      offset: 1,
      pageSize: 3,
      done: false,
      recommendedFallback: "updated",
    })}`;

    const result = await listPackageCatalogPageHandler(
      makeTopicCtx(
        [
          {
            page: skills.map((skill) => ({
              skillId: skill.skillId,
              topic: "calendar",
              updatedAt: skill.updatedAt,
            })),
            isDone: true,
            continueCursor: "",
          },
        ],
        skills,
        indexNames,
        true,
      ),
      {
        topic: "calendar",
        sort: "recommended",
        paginationOpts: { cursor: fallbackCursor, numItems: 1 },
      },
    );

    expect(result.page).toEqual([expect.objectContaining({ name: "next-updated-skill" })]);
    expect(indexNames).toContain("by_active_topic_updated");
    expect(indexNames).not.toContain("by_active_topic_installs");
    expect(result.continueCursor).toContain('"recommendedFallback":"updated"');
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

  it("accepts recommended sort and uses the recommendation score index for package catalog rows", async () => {
    const exportArgs = (listPackageCatalogPage as unknown as { exportArgs: () => string })
      .exportArgs;
    const exportedArgs = JSON.parse(exportArgs()) as {
      value: {
        sort?: {
          fieldType?: {
            value?: Array<{ value?: string }>;
          };
        };
      };
    };
    expect(exportedArgs.value.sort?.fieldType?.value?.map((entry) => entry.value)).toContain(
      "recommended",
    );

    const indexNames: string[] = [];
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [
              makeDigest("recommended-skill", {
                recommendedScore: 400,
                recommendedScoreVersion: 3,
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

    expect(indexNames).toEqual(["by_active_recommended_score"]);
    expect(result.page).toEqual([
      expect.objectContaining({
        name: "recommended-skill",
        family: "skill",
      }),
    ]);
  });

  it("keeps recommended package catalog rows on the recommendation score index while scores backfill", async () => {
    const indexNames: string[] = [];
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [makeDigest("fallback-skill")],
            isDone: false,
            continueCursor: "next-recommended-page",
          },
        ],
        {
          firstByIndex: {
            by_active_recommended_score_version: { _id: "skillSearchDigest:backfill-needed" },
          },
          indexNames,
        },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );

    expect(indexNames).toEqual(["by_active_recommended_score"]);
    expect(result.page).toEqual([expect.objectContaining({ name: "fallback-skill" })]);
    expect(result.continueCursor).not.toContain('"recommendedFallback":"downloads"');
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

  it("keeps recommended package catalog rows on the recommendation score index when scores are missing", async () => {
    const indexNames: string[] = [];
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [makeDigest("download-fallback-skill")],
            isDone: false,
            continueCursor: "recommended-next",
          },
        ],
        { indexNames, missingRecommendedScores: true },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );

    expect(indexNames).toEqual(["by_active_recommended_score"]);
    expect(result.page).toEqual([expect.objectContaining({ name: "download-fallback-skill" })]);
    expect(result.continueCursor).not.toContain('"recommendedFallback":"downloads"');
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

  it("keeps legacy recommendation fallback cursors on the updated index", async () => {
    const indexNames: string[] = [];
    const fallbackCursor = `skillcat:${JSON.stringify({
      cursor: null,
      offset: 1,
      pageSize: 3,
      done: false,
      recommendedFallback: "updated",
    })}`;
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [
              makeDigest("already-seen-skill"),
              makeDigest("next-updated-skill"),
              makeDigest("later-updated-skill"),
            ],
            isDone: true,
            continueCursor: "",
          },
        ],
        { indexNames, missingRecommendedScores: true },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: fallbackCursor, numItems: 1 },
      },
    );

    expect(indexNames).toEqual(["by_active_updated"]);
    expect(result.page).toEqual([expect.objectContaining({ name: "next-updated-skill" })]);
    expect(result.continueCursor).toContain('"recommendedFallback":"updated"');
  });

  it("resets legacy installs fallback cursors before using downloads", async () => {
    const indexNames: string[] = [];
    const fallbackCursor = `skillcat:${JSON.stringify({
      cursor: "legacy-install-next",
      offset: 2,
      pageSize: 3,
      done: false,
      recommendedFallback: "installs",
    })}`;
    const result = await listPackageCatalogPageHandler(
      makeCtx(
        [
          {
            page: [makeDigest("download-fallback-skill")],
            isDone: true,
            continueCursor: "",
          },
        ],
        { indexNames, missingRecommendedScores: true },
      ),
      {
        sort: "recommended",
        paginationOpts: { cursor: fallbackCursor, numItems: 1 },
      },
    );

    expect(indexNames).toEqual(["by_active_stats_downloads"]);
    expect(result.page).toEqual([expect.objectContaining({ name: "download-fallback-skill" })]);
    expect(result.continueCursor).toBe("");
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

  it("uses stored categories as skill package search evidence", async () => {
    const result = await searchPackageCatalogPublicHandler(
      makeCtx([
        {
          page: [
            makeDigest("focused-helper", {
              displayName: "Focused Helper",
              summary: "Keeps projects tidy.",
              categories: ["development"],
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        query: "dev",
        limit: 5,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["focused-helper"]);
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

  it("uses partial author topics as skill package search evidence", async () => {
    const topicSkill = makeDigest("focused-helper", {
      displayName: "Focused Helper",
      summary: "Keeps projects tidy.",
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
        query: "gpu",
        limit: 1,
      },
    );

    expect(result.map((entry) => entry.package.name)).toEqual(["focused-helper"]);
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
});
