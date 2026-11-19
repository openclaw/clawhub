/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest({ schema, modules });
  registerRateLimiter(t, "rateLimiterV2");
  const { userId, publisherId } = await t.run(async (ctx) => {
    const createdUserId = await ctx.db.insert("users", { handle: "template-maker" });
    const createdPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "template-maker",
      displayName: "Template maker",
      linkedUserId: createdUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId: createdUserId, publisherId: createdPublisherId };
  });
  const publish = (version: string, categories: string[], slug = "travel-planner") =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: userId,
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      name: "@template-maker/" + slug,
      displayName: slug,
      family: "claw",
      version,
      changelog: "Local category regression fixture",
      tags: ["latest"],
      summary: "Plan a trip from owner-approved travel requirements.",
      categories,
      channel: "community",
      files: [],
      integritySha256: "a".repeat(64),
      sha256hash: "a".repeat(64),
      artifactKind: "npm-pack",
      clawpackSha256: "a".repeat(64),
      clawManifestSummary: {
        schemaVersion: 1,
        agent: { id: slug, name: slug },
        workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
        packages: { skillCount: 0, pluginCount: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      },
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
  const listNames = async (search: string) => {
    const response = await t.fetch("/api/v1/packages?family=template&" + search);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ name: string }> };
    return body.items.map((entry) => entry.name).sort();
  };
  const searchNames = async (search: string) => {
    const response = await t.fetch("/api/v1/packages/search?family=template&" + search);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ package: { name: string } }> };
    return body.results.map((entry) => entry.package.name).sort();
  };
  return { t, publish, listNames, searchNames };
}

describe("Template publication category indexing", () => {
  it("preserves the assigned category through real publication triggers and public HTTP discovery", async () => {
    const { t, publish } = await fixture();
    const { packageId } = await publish("1.0.0", ["travel"]);
    const readProjection = () =>
      t.run(async (ctx) => ({
        pkg: await ctx.db.get(packageId),
        digest: await ctx.db
          .query("packageSearchDigest")
          .withIndex("by_package", (q) => q.eq("packageId", packageId))
          .unique(),
        pluginFacets: await ctx.db
          .query("packagePluginCategorySearchDigest")
          .withIndex("by_package", (q) => q.eq("packageId", packageId))
          .collect(),
      }));
    const before = await readProjection();
    expect(before.pkg?.categories).toEqual(["travel"]);
    expect(before.digest?.categories).toEqual(before.pkg?.categories);
    expect(before.digest?.pluginCategoryTags).toEqual([]);
    expect(before.pluginFacets).toEqual([]);

    const response = await t.fetch("/api/v1/packages?family=template&category=travel");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{ name: "@template-maker/travel-planner", categories: ["travel"] }],
    });
    const search = await t.fetch(
      "/api/v1/packages/search?family=template&q=travel&category=travel",
    );
    expect(search.status).toBe(200);
    expect(await search.json()).toMatchObject({
      results: [{ package: { name: "@template-maker/travel-planner", categories: ["travel"] } }],
    });
    const other = await t.query(api.packages.listPublicPage, {
      family: "template",
      category: "other",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(other.page).toEqual([]);

    await publish("1.1.0", ["household"]);
    expect((await readProjection()).digest?.categories).toEqual(["household"]);
    const oldCategory = await t.query(api.packages.listPublicPage, {
      family: "template",
      category: "travel",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(oldCategory.page).toEqual([]);
    const newCategory = await t.query(api.packages.listPublicPage, {
      family: "template",
      category: "household",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(newCategory.page.map((entry) => entry.name)).toEqual(["@template-maker/travel-planner"]);
  });
});

// Listings that were not rewritten when the taxonomy changed, including every first-party
// Template, still store removed slugs, and released OpenClaw clients still request them.
describe("removed Template categories", () => {
  async function legacyFixture() {
    const f = await fixture();
    await f.publish("1.0.0", ["personal", "productivity"], "day-planner");
    await f.publish("1.0.0", ["finance"], "budget-coach");
    await f.publish("1.0.0", ["household"], "meal-planner");
    await f.publish("1.0.0", ["entertainment"], "game-night");
    return f;
  }

  it("still filters lists and searches by a removed slug instead of failing", async () => {
    const { listNames, searchNames } = await legacyFixture();
    expect(await listNames("category=personal")).toEqual(["@template-maker/day-planner"]);
    expect(await listNames("category=finance")).toEqual(["@template-maker/budget-coach"]);
    // A removed slug nothing stores is an empty category, not the whole catalog.
    expect(await listNames("category=governance")).toEqual([]);
    expect(await listNames("category=people")).toEqual([]);
    expect(await searchNames("q=planner&category=personal")).toEqual([
      "@template-maker/day-planner",
    ]);
    expect(await searchNames("q=planner&category=people")).toEqual([]);
    // The router's own path, reached with a parameter the narrow reader does not own.
    expect(await listNames("category=personal&sort=updated")).toEqual([
      "@template-maker/day-planner",
    ]);
  });

  it("lists the new categories and keeps a multi-category listing under each stored slug", async () => {
    const { listNames } = await legacyFixture();
    expect(await listNames("category=household")).toEqual(["@template-maker/meal-planner"]);
    expect(await listNames("category=entertainment")).toEqual(["@template-maker/game-night"]);
    expect(await listNames("category=productivity")).toEqual(["@template-maker/day-planner"]);
  });

  it("still rejects a slug that was never a Template category", async () => {
    const { t } = await legacyFixture();
    for (const path of [
      "/api/v1/packages?family=template&category=marketing",
      "/api/v1/packages?family=template&category=marketing&sort=updated",
      "/api/v1/packages/search?family=template&q=planner&category=marketing",
    ]) {
      const response = await t.fetch(path);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Invalid Template category");
    }
  });

  it("omits removed slugs from the overview while their listings stay installable", async () => {
    const { t } = await legacyFixture();
    const response = await t.fetch("/api/v1/templates/overview?limit=8");
    expect(response.status).toBe(200);
    const overview = (await response.json()) as {
      complete: boolean;
      sections: Array<{ category: string; items: Array<{ name: string }> }>;
    };
    expect(overview.complete).toBe(true);
    // Taxonomy order, with no row for personal or finance.
    expect(overview.sections.map((section) => section.category)).toEqual([
      "household",
      "entertainment",
      "productivity",
    ]);
    expect(overview.sections.flatMap((section) => section.items.map((item) => item.name))).toEqual([
      "@template-maker/meal-planner",
      "@template-maker/game-night",
      "@template-maker/day-planner",
    ]);
    const detail = await t.fetch("/api/v1/packages/@template-maker%2Fbudget-coach");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ package: { categories: ["finance"] } });
  });
});
