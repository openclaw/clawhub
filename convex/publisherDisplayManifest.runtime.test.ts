/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it("omits a hidden skill repo from the public display manifest", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "catalog-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "catalog-org",
      displayName: "Catalog Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const publicSourceId = await ctx.db.insert("githubSkillSources", {
      repo: "catalog-org/public-skills",
      ownerPublisherId: publisherId,
      displayManifestStatus: "ok",
      displayManifest: {
        notGrouped: "bottom",
        groupings: [{ title: "Public", skills: ["visible-skill"] }],
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const hiddenSourceId = await ctx.db.insert("githubSkillSources", {
      repo: "catalog-org/hidden-skills",
      ownerPublisherId: publisherId,
      displayManifestStatus: "ok",
      displayManifest: {
        notGrouped: "bottom",
        groupings: [{ title: "Hidden", skills: ["secret-skill"] }],
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const skill = {
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      tags: {},
      stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
      createdAt: 1,
      updatedAt: 1,
    };
    await ctx.db.insert("skills", {
      ...skill,
      slug: "visible-skill",
      displayName: "Visible Skill",
      moderationStatus: "active",
      installKind: "github",
      githubSourceId: publicSourceId,
    });
    await ctx.db.insert("skills", {
      ...skill,
      slug: "secret-skill",
      displayName: "Secret Skill",
      moderationStatus: "hidden",
      moderationReason: "security.redaction",
      installKind: "github",
      githubSourceId: hiddenSourceId,
    });
  });

  const display = await t.query(api.publishers.getPublishedDisplayManifest, {
    handle: "catalog-org",
    kind: "skill",
  });

  expect(display?.sourceRepos).toEqual(["catalog-org/public-skills"]);
  expect(JSON.stringify(display)).not.toContain("catalog-org/hidden-skills");
  expect(display?.sections.map((section) => section.title)).toEqual(["Public"]);
});
