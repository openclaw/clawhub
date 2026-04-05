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
      executesCode?: boolean;
      capabilityTag?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{
        name: string;
        family: "skill";
        channel: "official" | "community";
        isOfficial: boolean;
        capabilityTags: string[];
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
      executesCode?: boolean;
      capabilityTag?: string;
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
    latestVersionSummary: {
      version: "1.0.0",
      createdAt: 10,
      changelog: "init",
    },
    tags: { latest: `skillVersions:${slug}-1` },
    capabilityTags: [],
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
          withIndex: () => ({
            order: () => ({
              paginate: async ({ cursor: pageCursor }: { cursor: string | null }) =>
                pageByCursor.get(pageCursor) ?? { page: [], isDone: true, continueCursor: "" },
            }),
            unique: async () => null,
          }),
        };
      },
    },
  };
}

describe("skills package catalog queries", () => {
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

  it("filters skills by capability tag", async () => {
    const result = await listPackageCatalogPageHandler(
      makeCtx([
        {
          page: [
            makeDigest("paytoll", { capabilityTags: ["crypto", "requires-wallet"] }),
            makeDigest("weather"),
          ],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        capabilityTag: "crypto",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(result.page).toEqual([
      expect.objectContaining({
        name: "paytoll",
        capabilityTags: ["crypto", "requires-wallet"],
      }),
    ]);
  });

  it("returns empty immediately for unknown capability tags", async () => {
    const result = await listPackageCatalogPageHandler(
      makeCtx([
        {
          page: [makeDigest("paytoll", { capabilityTags: ["crypto", "requires-wallet"] })],
          isDone: true,
          continueCursor: "",
        },
      ]),
      {
        capabilityTag: "not-a-real-tag",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    expect(result).toEqual({ page: [], isDone: true, continueCursor: "" });
  });
});
