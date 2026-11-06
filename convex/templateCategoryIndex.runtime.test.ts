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
  const publish = (version: string, categories: string[]) =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: userId,
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      name: "@template-maker/travel-planner",
      displayName: "Travel planner",
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
        agent: { id: "travel-planner", name: "Travel planner" },
        workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
        packages: { skillCount: 0, pluginCount: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      },
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
  return { t, publish };
}

describe("Template publication category indexing", () => {
  it("preserves assigned categories through real publication triggers and public HTTP discovery", async () => {
    const { t, publish } = await fixture();
    const { packageId } = await publish("1.0.0", ["travel", "personal"]);
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
    expect(before.pkg?.categories).toEqual(["travel", "personal"]);
    expect(before.digest?.categories).toEqual(before.pkg?.categories);
    expect(before.digest?.pluginCategoryTags).toEqual([]);
    expect(before.pluginFacets).toEqual([]);

    for (const category of ["travel", "personal"]) {
      const response = await t.fetch("/api/v1/packages?family=template&category=" + category);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        items: [
          {
            name: "@template-maker/travel-planner",
            categories: ["travel", "personal"],
          },
        ],
      });
      const search = await t.fetch(
        "/api/v1/packages/search?family=template&q=travel&category=" + category,
      );
      expect(search.status).toBe(200);
      expect(await search.json()).toMatchObject({
        results: [
          {
            package: {
              name: "@template-maker/travel-planner",
              categories: ["travel", "personal"],
            },
          },
        ],
      });
    }
    const other = await t.query(api.packages.listPublicPage, {
      family: "template",
      category: "other",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(other.page).toEqual([]);

    await publish("1.1.0", ["finance"]);
    expect((await readProjection()).digest?.categories).toEqual(["finance"]);
    const oldCategory = await t.query(api.packages.listPublicPage, {
      family: "template",
      category: "travel",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(oldCategory.page).toEqual([]);
    const newCategory = await t.query(api.packages.listPublicPage, {
      family: "template",
      category: "finance",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(newCategory.page.map((entry) => entry.name)).toEqual(["@template-maker/travel-planner"]);
  });
});
