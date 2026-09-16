/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

it("uses the public version and current badge owner to require clean native skills independently of Featured membership", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "author" });
    const identities = [];
    for (const status of [
      "clean",
      "suspicious",
      "pending",
      "unscanned",
      "featured",
      "hidden",
      "unpublished",
      "github-missing-source",
    ] as const) {
      const skillId = await ctx.db.insert("skills", {
        slug: status,
        displayName: status,
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
        ...(status === "github-missing-source" ? { installKind: "github" as const } : {}),
        ...(status === "hidden" ? { moderationStatus: "hidden" as const } : {}),
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Initial",
        files: [
          {
            path: "SKILL.md",
            size: 1,
            storageId: await ctx.storage.store(new Blob(["x"])),
            sha256: "a".repeat(64),
          },
        ],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
        ...(status !== "unscanned"
          ? {
              llmAnalysis: {
                status: status === "suspicious" || status === "pending" ? status : "clean",
                checkedAt: 1,
              },
            }
          : {}),
        ...(status === "unpublished" ? { publicationStatus: "pending" as const } : {}),
      });
      await ctx.db.patch(skillId, { latestVersionId: versionId });
      if (status === "featured")
        await ctx.db.insert("skillBadges", {
          skillId,
          kind: "highlighted",
          byUserId: userId,
          at: 1,
        });
      identities.push(`clawhub:${skillId}`);
    }
    return identities;
  });
  const results = await t.query(internal.featuredArtifacts.readInternal, { identities: ids });
  expect(results.map((row) => row.name)).not.toContain("hidden");
  expect(results.filter((row) => row.eligibleForFeatured).map((row) => row.name)).toEqual([
    "clean",
    "featured",
  ]);
  expect(results.find((row) => row.name === "featured")).toMatchObject({
    isFeatured: true,
    eligibilityReasons: [],
  });
  expect(results.find((row) => row.name === "unscanned")?.eligibilityReasons).toContain(
    "security-not-clean",
  );
  expect(results.find((row) => row.name === "unpublished")?.eligibilityReasons).toContain(
    "no-public-version",
  );
  expect(JSON.stringify(results)).not.toMatch(/storageId|ownerUserId|sha256/);
});
