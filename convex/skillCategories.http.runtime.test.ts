/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import {
  ApiV1SkillCategoriesResponseSchema,
  ApiV1SkillListResponseSchema,
  parseArk,
} from "clawhub-schema";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { SKILL_CATEGORIES } from "../src/lib/categories";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");

function registry() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  return t;
}

it("serves the website's ordered category metadata without taking the categories skill slug", async () => {
  const t = registry();
  const response = await t.fetch("/api/v1/skills/-/categories");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("s-maxage=");
  const { categories } = parseArk(
    ApiV1SkillCategoriesResponseSchema,
    await response.json(),
    "Skill categories",
  );
  expect(categories).toEqual(
    SKILL_CATEGORIES.map(({ slug, label, icon }) => ({
      slug,
      label,
      icon,
      description: expect.any(String),
    })),
  );
  expect((await t.fetch("/api/v1/skills/categories")).status).toBe(404);
});

it("pages public category matches with the existing list response and scopes exact search", async () => {
  const t = registry();
  await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "discovery-lab" });
    for (const [i, [slug, categories]] of (
      [
        ["field-notes", ["knowledge", "research"]],
        ["literature-digest", ["research"]],
        ["weekly-budget", ["finance"]],
        ["archived-field-notes", ["research"]],
      ] as const
    ).entries()) {
      const skillId = await ctx.db.insert("skills", {
        slug,
        displayName: slug,
        categories: [...categories],
        ownerUserId,
        tags: {},
        moderationStatus: "active",
        stats: { downloads: 5, stars: 1, comments: 0, versions: 1 },
        createdAt: i + 1,
        updatedAt: i + 1,
        ...(i === 3 ? { softDeletedAt: 5 } : {}),
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Initial public release",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: ownerUserId,
        publicationStatus: "published",
        llmAnalysis: { status: "clean", checkedAt: 1 },
        createdAt: i + 1,
      });
      await ctx.db.patch(skillId, { tags: { latest: versionId }, latestVersionId: versionId });
      await syncSkillSearchDigestForSkill(ctx, await ctx.db.get(skillId));
    }
  });
  const page = async (params: string) => {
    const response = await t.fetch("/api/v1/skills?" + params);
    expect(response.status).toBe(200);
    return parseArk(ApiV1SkillListResponseSchema, await response.json(), "Skill list");
  };
  const first = await page("category=research&limit=1");
  expect(first.items.map((i) => i.slug)).toEqual(["literature-digest"]);
  expect(first.nextCursor).toBeTypeOf("string");
  const second = await page(
    "category=research&limit=1&cursor=" + encodeURIComponent(first.nextCursor!),
  );
  expect(second.items.map((i) => i.slug)).toEqual(["field-notes"]);
  expect(second.nextCursor).toBeNull();
  expect((await page("limit=3")).items.map((i) => i.slug)).toEqual([
    "weekly-budget",
    "literature-digest",
    "field-notes",
  ]);
  const search = async (category: string) =>
    (await (await t.fetch("/api/v1/search?mode=exact&q=weekly-budget&category=" + category)).json())
      .results;
  expect(await search("finance")).toEqual([expect.objectContaining({ slug: "weekly-budget" })]);
  expect(await search("research")).toEqual([]);
  expect((await t.fetch("/api/v1/skills?category=unknown")).status).toBe(400);
  expect((await t.fetch("/api/v1/skills?category=research&prefix=field")).status).toBe(400);
  expect((await page("category=research&sort=trending")).items.map((i) => i.slug)).toEqual([
    "literature-digest",
    "field-notes",
  ]);
});
