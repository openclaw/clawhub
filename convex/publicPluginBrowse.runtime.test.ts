/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { RECOMMENDATION_SCORE_VERSION } from "./lib/recommendationScore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture(withCount = true) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "browse-metadata-owner" });
    const packages = await Promise.all(
      (["code-plugin", "bundle-plugin"] as const).map((family) =>
        ctx.db.insert("packages", {
          name: family,
          normalizedName: family,
          displayName: family,
          family,
          ownerUserId,
          channel: "community",
          isOfficial: false,
          tags: {},
          stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
          recommendedScore: 100,
          recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
          createdAt: 1,
          updatedAt: 1,
        }),
      ),
    );
    if (withCount) {
      await ctx.db.insert("globalStats", {
        key: "default",
        activeSkillsCount: 0,
        activePluginsCount: 2345,
        updatedAt: 1,
      });
    }
    return { "code-plugin": packages[0], "bundle-plugin": packages[1] };
  });
  return { t, ids };
}

it("returns the maintained public count rather than counting package rows", async () => {
  const { t } = await fixture();
  expect(await t.query(api.publicPluginBrowse.getMetadata, {})).toEqual({
    totalCount: 2345,
    recommendedFallback: null,
  });
});

it("preserves an unavailable public count", async () => {
  const { t } = await fixture(false);
  expect(await t.query(api.publicPluginBrowse.getMetadata, {})).toEqual({
    totalCount: null,
    recommendedFallback: null,
  });
});

it.each(["code-plugin", "bundle-plugin"] as const)(
  "falls back when %s has a missing or stale recommendation",
  async (family) => {
    for (const patch of [
      { recommendedScore: undefined },
      { recommendedScoreVersion: undefined },
      { recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION - 1 },
    ]) {
      const { t, ids } = await fixture();
      await t.run(async (ctx) => ctx.db.patch(ids[family], patch));
      expect(await t.query(api.publicPluginBrowse.getMetadata, {})).toEqual({
        totalCount: 2345,
        recommendedFallback: "downloads",
      });
    }
  },
);

it("ignores deleted rows when selecting the ranking fallback", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) =>
    ctx.db.patch(ids["code-plugin"], { softDeletedAt: 1, recommendedScore: undefined }),
  );
  expect((await t.query(api.publicPluginBrowse.getMetadata, {})).recommendedFallback).toBeNull();
});

it("preserves the existing fallback for a private unscored plugin", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) =>
    ctx.db.patch(ids["code-plugin"], { channel: "private", recommendedScore: undefined }),
  );
  expect((await t.query(api.publicPluginBrowse.getMetadata, {})).recommendedFallback).toBe(
    "downloads",
  );
});
