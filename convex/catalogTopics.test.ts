/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { listTopByCategory, rankTopCatalogTopics } from "./catalogTopics";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listTopByCategoryHandler = (
  listTopByCategory as unknown as WrappedHandler<
    { kind: "skill" | "plugin"; category: string },
    string[]
  >
)._handler;

function makeQueryCtx(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  const indexNames: string[] = [];
  const filters: Array<{ field: string; value: unknown }> = [];

  return {
    indexNames,
    filters,
    db: {
      query: vi.fn((table: string) => ({
        withIndex: vi.fn(
          (
            indexName: string,
            build: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            indexNames.push(indexName);
            const query = {
              eq: (field: string, value: unknown) => {
                filters.push({ field, value });
                return query;
              },
            };
            build(query);
            return {
              order: vi.fn(() => ({
                take: vi.fn(async (limit: number) => (rowsByTable[table] ?? []).slice(0, limit)),
              })),
            };
          },
        ),
      })),
    },
  };
}

function makeSkillDigest(overrides: Record<string, unknown> = {}) {
  return {
    skillId: "skills:demo",
    slug: "demo",
    displayName: "Demo",
    ownerUserId: "users:owner",
    forkOf: undefined,
    tags: {},
    badges: {},
    stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
    moderationStatus: "active",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function makePluginCategoryDigest(overrides: Record<string, unknown> = {}) {
  return {
    packageId: "packages:demo",
    name: "demo",
    normalizedName: "demo",
    displayName: "Demo",
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    ownerUserId: "users:owner",
    pluginCategory: "runtime",
    scanStatus: "clean",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("catalog topic ranking", () => {
  it("returns the most frequent normalized topics and excludes the selected category", () => {
    expect(
      rankTopCatalogTopics(
        [
          { topics: ["TypeScript", "Development", "Docker"] },
          { topics: ["typescript", "GitHub", "Debugging"] },
          { topics: ["docker", "typescript", "Coding"] },
          { topics: ["Automation", "GitHub"] },
        ],
        "development",
      ),
    ).toEqual(["typescript", "docker", "github", "debugging", "coding", "automation"]);
  });
});

describe("listTopByCategory", () => {
  it("returns top public skill topics from the selected category", async () => {
    const ctx = makeQueryCtx({
      skillSearchDigest: [
        makeSkillDigest({
          categories: ["development"],
          topics: ["TypeScript", "Docker"],
        }),
        makeSkillDigest({
          skillId: "skills:second",
          slug: "second",
          categories: ["development"],
          topics: ["typescript", "GitHub"],
        }),
        makeSkillDigest({
          skillId: "skills:other",
          slug: "other",
          categories: ["productivity"],
          topics: ["notes"],
        }),
        makeSkillDigest({
          skillId: "skills:blocked",
          slug: "blocked",
          categories: ["development"],
          topics: ["malware"],
          moderationStatus: "rejected",
        }),
      ],
    });

    await expect(
      listTopByCategoryHandler(ctx, { kind: "skill", category: "development" }),
    ).resolves.toEqual(["typescript", "docker", "github"]);
    expect(ctx.indexNames).toEqual(["by_active_recommended_score"]);
    expect(ctx.filters).toContainEqual({ field: "softDeletedAt", value: undefined });
  });

  it("collects a category sample beyond the first global topic sample", async () => {
    const globallyHigherRanked = Array.from({ length: 240 }, (_, index) =>
      makeSkillDigest({
        skillId: `skills:global-${index}`,
        slug: `global-${index}`,
        categories: ["productivity"],
        topics: ["notes"],
      }),
    );
    const ctx = makeQueryCtx({
      skillSearchDigest: [
        ...globallyHigherRanked,
        makeSkillDigest({
          skillId: "skills:development",
          slug: "development",
          categories: ["development"],
          topics: ["TypeScript", "Docker"],
        }),
      ],
    });

    await expect(
      listTopByCategoryHandler(ctx, { kind: "skill", category: "development" }),
    ).resolves.toEqual(["typescript", "docker"]);
  });

  it("uses the plugin category index and excludes private or blocked plugins", async () => {
    const ctx = makeQueryCtx({
      packagePluginCategorySearchDigest: [
        makePluginCategoryDigest({ topics: ["Docker", "TypeScript"] }),
        makePluginCategoryDigest({
          packageId: "packages:second",
          name: "second",
          normalizedName: "second",
          topics: ["docker", "GitHub"],
        }),
        makePluginCategoryDigest({
          packageId: "packages:private",
          name: "private",
          normalizedName: "private",
          topics: ["secret"],
          channel: "private",
        }),
        makePluginCategoryDigest({
          packageId: "packages:blocked",
          name: "blocked",
          normalizedName: "blocked",
          topics: ["malware"],
          scanStatus: "malicious",
        }),
      ],
    });

    await expect(
      listTopByCategoryHandler(ctx, { kind: "plugin", category: "runtime" }),
    ).resolves.toEqual(["docker", "typescript", "github"]);
    expect(ctx.indexNames).toEqual(["by_active_category_installs"]);
    expect(ctx.filters).toContainEqual({ field: "pluginCategory", value: "runtime" });
  });

  it("rejects categories that do not belong to the requested catalog kind", async () => {
    const ctx = makeQueryCtx({});

    await expect(
      listTopByCategoryHandler(ctx, { kind: "skill", category: "runtime" }),
    ).resolves.toEqual([]);
    await expect(
      listTopByCategoryHandler(ctx, { kind: "plugin", category: "development" }),
    ).resolves.toEqual([]);
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
});
