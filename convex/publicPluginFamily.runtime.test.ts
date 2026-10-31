/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { RECOMMENDATION_SCORE_VERSION } from "./lib/recommendationScore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture(count = 32) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "family-user" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "family-owner",
      displayName: "Family owner",
      linkedUserId: ownerUserId,
      image: "https://example.invalid/publisher.png",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(ownerUserId, { personalPublisherId: publisherId });
    await ctx.db.insert("officialPublishers", {
      publisherId,
      createdAt: 1,
      updatedAt: 1,
    });
    const packages = [];
    for (const family of ["code-plugin", "bundle-plugin"] as const) {
      for (let i = 0; i < count; i += 1) {
        packages.push(
          await ctx.db.insert("packages", {
            name: `${family}-${i}`,
            normalizedName: `${family}-${i}`,
            displayName: `${family} ${i}`,
            family,
            ownerUserId,
            ownerPublisherId: publisherId,
            channel: i === 0 ? "private" : "community",
            scanStatus: i === 1 ? "malicious" : "clean",
            softDeletedAt: i === 3 ? 1 : undefined,
            isOfficial: false,
            tags: {},
            categories: ["channels"],
            summary: "Public plugin fixture",
            latestVersionSummary:
              i === 2 ? undefined : { version: "1.0.0", createdAt: 1, changelog: "Fixture" },
            stats: { downloads: 1000 - i, installs: 0, stars: 0, versions: 1 },
            recommendedScore: 2000 - i,
            recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
            createdAt: i + 1,
            updatedAt: i + 1,
          }),
        );
      }
    }
    return { packages, publisherId };
  });
  return { t, ids };
}

it.each(["code-plugin", "bundle-plugin"] as const)(
  "returns ranked %s cards with current visibility and publisher fields",
  async (family) => {
    const { t } = await fixture();
    for (const sort of ["recommended", "downloads"] as const) {
      const page = await t.query(api.publicPluginFamily.listPage, {
        family,
        sort,
        paginationOpts: { cursor: null, numItems: 25 },
      });
      expect(page.page.map((p) => p.name)).toEqual(
        Array.from({ length: 25 }, (_, i) => `${family}-${i + 4}`),
      );
      expect(page.page[0]).toMatchObject({
        family,
        channel: "community",
        latestVersion: "1.0.0",
        ownerHandle: "family-owner",
        ownerImage: "https://example.invalid/publisher.png",
        ownerOfficial: true,
        isOfficial: false,
        categories: ["channels"],
      });
      expect(page.isDone).toBe(false);
      const next = await t.query(api.publicPluginFamily.listPage, {
        family,
        sort,
        paginationOpts: { cursor: page.continueCursor, numItems: 25 },
      });
      expect(next.page.map((p) => p.name)).toEqual([29, 30, 31].map((i) => `${family}-${i}`));
      expect(next.isDone).toBe(true);
      expect(next.continueCursor).toBe("");
    }
  },
);

it("returns a continuation when hidden entries fill the native scan window", async () => {
  const { t, ids } = await fixture(160);
  await t.run(async (ctx) => {
    for (const id of ids.packages) {
      const p = await ctx.db.get(id);
      if (p && Number(p.name.split("-").at(-1)) < 130) {
        await ctx.db.patch(id, { channel: "private" });
      }
    }
  });
  const args = { family: "code-plugin", sort: "downloads" } as const;
  const first = await t.query(api.publicPluginFamily.listPage, {
    ...args,
    paginationOpts: { cursor: null, numItems: 25 },
  });
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);
  expect(first.continueCursor).not.toBe("");
  const next = await t.query(api.publicPluginFamily.listPage, {
    ...args,
    paginationOpts: { cursor: first.continueCursor, numItems: 25 },
  });
  expect(next.page.map((p) => p.name)).toEqual(
    Array.from({ length: 25 }, (_, i) => `code-plugin-${130 + i}`),
  );
});

it("uses the existing reader for other page sizes and missing-score fallback", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.packages[4], { recommendedScore: undefined });
  });
  for (const numItems of [1, 25]) {
    const args = {
      family: "code-plugin" as const,
      sort: "recommended" as const,
      paginationOpts: { cursor: null, numItems },
    };
    expect(await t.query(api.publicPluginFamily.listPage, args)).toEqual(
      await t.query(api.packages.listPublicPage, args),
    );
  }
});

it("resolves the existing user fallback when a publisher becomes inactive", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.publisherId, { deactivatedAt: 1 });
  });
  const page = await t.query(api.publicPluginFamily.listPage, {
    family: "code-plugin",
    sort: "downloads",
    paginationOpts: { cursor: null, numItems: 25 },
  });
  expect(page.page).toHaveLength(25);
  expect(page.page.every((p) => p.ownerHandle === "family-user")).toBe(true);
});
