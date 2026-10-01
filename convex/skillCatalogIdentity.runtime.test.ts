/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { ApiV1SkillListResponseSchema as CliListSchema } from "../packages/clawhub/src/schema/schemas";
import { parseArk } from "../packages/schema/src/ark";
import { ApiV1SkillListResponseSchema } from "../packages/schema/src/schemas";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.10",
}));

const modules = import.meta.glob("./**/*.ts");

it.each(["updated", "newest"])(
  "preserves complete skill identities and metadata across tied %s cursor pages",
  async (sort) => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const expected = await t.run(async (ctx) => {
      const owners = await Promise.all(
        ["fixture-owner-a", "fixture-owner-b"].map(async (handle) => ({
          handle,
          id: await ctx.db.insert("users", { handle }),
        })),
      );
      const items = [];
      for (let index = 0; index < 10; index += 1) {
        const owner = owners[index === 1 ? 1 : 0];
        const slug = index < 2 ? "shared-fixture-slug" : `fixture-${index}`;
        const displayName = `Fixture ${index}`;
        const summary = `Metadata for fixture ${index}`;
        const version = index === 9 ? null : index === 0 ? "1.2.3+fixture.01" : `1.0.${index}`;
        const skillId = await ctx.db.insert("skills", {
          slug,
          displayName,
          summary,
          ownerUserId: owner.id,
          tags: {},
          stats: { comments: 0, downloads: 0, stars: 0, versions: version ? 1 : 0 },
          moderationStatus: "active",
          createdAt: 1,
          updatedAt: 2,
        });
        if (version) {
          const versionId = await ctx.db.insert("skillVersions", {
            skillId,
            version,
            publicationStatus: "published",
            changelog: `Release ${index}`,
            parsed: { frontmatter: {}, license: "MIT-0" },
            files: [],
            createdBy: owner.id,
            createdAt: 3,
          });
          await ctx.db.patch(skillId, { latestVersionId: versionId, tags: { latest: versionId } });
        }
        await syncSkillSearchDigestForSkill(ctx, await ctx.db.get(skillId));
        items.push({
          ownerHandle: owner.handle,
          slug,
          displayName,
          summary,
          createdAt: 1,
          updatedAt: 2,
          tags: version ? { latest: version } : {},
          latestVersion: version
            ? { version, createdAt: 3, changelog: `Release ${index}`, license: "MIT-0" }
            : null,
        });
      }
      return items;
    });

    const identities = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      expect(pages).toBeLessThan(20);
      const query = new URLSearchParams({ sort, limit: "2" });
      if (cursor) query.set("cursor", cursor);
      const response = await t.fetch(`/api/v1/skills?${query}`);
      expect(response.status).toBe(200);
      const raw = await response.json();
      const page = parseArk(ApiV1SkillListResponseSchema, raw, "public catalog page");
      expect(parseArk(CliListSchema, raw, "CLI catalog page")).toEqual(page);
      for (const item of page.items) {
        const identity = `${item.ownerHandle}/${item.slug}`;
        expect(identities.has(identity)).toBe(false);
        identities.add(identity);
        const fixture = expected.find(
          (candidate) => candidate.ownerHandle === item.ownerHandle && candidate.slug === item.slug,
        );
        expect(fixture).toBeDefined();
        expect(item).toMatchObject(fixture!);
        expect(Object.hasOwn(item, "latestVersion")).toBe(true);
        if (item.latestVersion === null) {
          const { latestVersion: _omitted, ...withoutVersion } = item;
          const legacyPage = { items: [withoutVersion], nextCursor: null };
          expect(() =>
            parseArk(ApiV1SkillListResponseSchema, legacyPage, "omitted version"),
          ).toThrow();
          expect(
            parseArk(CliListSchema, legacyPage, "legacy registry").items[0]?.latestVersion,
          ).toBeUndefined();
        }
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(identities).toEqual(new Set(expected.map((item) => `${item.ownerHandle}/${item.slug}`)));

    const trending = await t.fetch("/api/v1/skills?sort=trending&limit=20");
    expect(trending.status).toBe(200);
    const trendingPage = parseArk(
      ApiV1SkillListResponseSchema,
      await trending.json(),
      "trending catalog",
    );
    expect(new Set(trendingPage.items.map((item) => `${item.ownerHandle}/${item.slug}`))).toEqual(
      identities,
    );
  },
);
