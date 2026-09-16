/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { syncPackageSearchDigestForPackageId } from "./functions";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
it("public Featured reads follow approved identity order and omit unbadged reservations", async () => {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "curator", role: "moderator" });
    const publisher = await ctx.db.insert("publishers", {
      kind: "user",
      displayName: "Curator",
      handle: "curator",
      linkedUserId: ownerUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(ownerUserId, { personalPublisherId: publisher });
    const items = [];
    for (const name of ["telemetry", "editorial", "manual"]) {
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: name,
        family: "code-plugin",
        ownerUserId,
        ownerPublisherId: publisher,
        channel: "community",
        isOfficial: false,
        categories: ["developer-tools"],
        tags: {},
        stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: name,
        displayName: name,
        ownerUserId,
        ownerPublisherId: publisher,
        moderationStatus: "active",
        tags: {},
        badges: {},
        stats: { comments: 0, downloads: 1, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const file = { path: "SKILL.md", size: 1, storageId, sha256: "a".repeat(64) };
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        changelog: "Fixture",
        distTags: ["latest"],
        files: [{ ...file, path: "index.js" }],
        integritySha256: "a".repeat(64),
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
        createdBy: ownerUserId,
        createdAt: 1,
      });
      await ctx.db.patch(packageId, {
        latestReleaseId: releaseId,
        scanStatus: "clean",
        tags: { latest: releaseId },
      });
      await syncPackageSearchDigestForPackageId(ctx, packageId);
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Fixture",
        files: [file],
        parsed: { frontmatter: {} },
        createdBy: ownerUserId,
        createdAt: 1,
        llmAnalysis: { status: "clean", checkedAt: 1 },
      });
      await ctx.db.patch(skillId, { latestVersionId: versionId, tags: { latest: versionId } });
      items.push({ name, packageId, skillId });
    }
    return { ownerUserId, items };
  });
  const staff = t.withIdentity({ subject: `${data.ownerUserId}|session` });
  for (const item of data.items) {
    await staff.mutation(api.packages.setBatch, {
      packageId: item.packageId,
      batch: "highlighted",
    });
    await staff.mutation(api.skills.setBatch, { skillId: item.skillId, batch: "highlighted" });
  }
  await t.run(async (ctx) => {
    for (const artifactKind of ["plugin", "skill"] as const) {
      await ctx.db.insert("featuredSelections", {
        artifactKind,
        revision: 1,
        editorial:
          artifactKind === "plugin"
            ? [
                {
                  id: "plugin:pending",
                  name: "pending",
                  displayName: "Pending",
                  reason: "Awaiting publication",
                },
              ]
            : [],
        updatedAt: 1,
        updatedBy: data.ownerUserId,
        published: {
          reportId: "retained-report-fixture",
          reportHash: "retained-evidence-hash",
          at: 1,
          byUserId: data.ownerUserId,
          periodStart: 0,
          periodEnd: 1,
          items: [data.items[1], data.items[0]].map((item) => ({
            id: artifactKind === "plugin" ? `plugin:${item.name}` : `clawhub:${item.skillId}`,
            version: "1.0.0",
            selectionBasis: "telemetry" as const,
            reason: "Reviewed",
          })),
        },
      });
    }
  });
  const expected = ["editorial", "telemetry", "manual"];
  const plugins = await t.query(api.packages.listPublicPage, {
    highlightedOnly: true,
    paginationOpts: { cursor: null, numItems: 16 },
  });
  expect(plugins.page.map((item) => item.name)).toEqual(expected);
  const skills = await t.query(api.skills.listPublicPageV4, {
    highlightedOnly: true,
    numItems: 16,
  });
  expect(skills.page.map((item) => item.skill.slug)).toEqual(expected);
  expect(
    (await t.query(api.skills.listHighlightedPublic, { limit: 16 })).map((item) => item.skill.slug),
  ).toEqual(expected);
  expect(
    (await t.query(api.skills.listWithLatest, { batch: "highlighted", limit: 16 })).map(
      (item) => item.skill.slug,
    ),
  ).toEqual(expected);
  const skillPackages = await t.query(api.skills.listPackageCatalogPage, {
    highlightedOnly: true,
    paginationOpts: { cursor: null, numItems: 16 },
  });
  expect(skillPackages.page.map((item) => item.name)).toEqual(expected);
  let cursor: string | null = null;
  const paginated: string[] = [];
  for (let index = 0; index < expected.length; index++) {
    const page: typeof skillPackages = await t.query(api.skills.listPackageCatalogPage, {
      highlightedOnly: true,
      paginationOpts: { cursor, numItems: 1 },
    });
    paginated.push(...page.page.map((item) => item.name));
    expect(page.isDone).toBe(index === expected.length - 1);
    cursor = page.continueCursor;
  }
  expect(paginated).toEqual(expected);
});
