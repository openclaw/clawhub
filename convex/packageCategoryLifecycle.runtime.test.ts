/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture(withOlder = true) {
  const t = convexTest({ schema, modules });
  const actor = await t.run(async (ctx) =>
    ctx.db.insert("users", { role: "admin", handle: "category-life" }),
  );
  const publish = async (version: string, category: string) =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: actor,
      ownerUserId: actor,
      name: "@category-life/tool",
      displayName: "Category lifecycle tool",
      family: "code-plugin",
      runtimeId: "category-life",
      version,
      changelog: "Local fixture",
      tags: ["latest"],
      categories: [category],
      summary: "Local fixture",
      files: [],
      integritySha256: version.padEnd(64, "0"),
      sha256hash: version.padEnd(64, "0"),
      extractedPluginManifest: { id: "category-life", categories: [category] },
      pluginManifestSummary: {
        schemaVersion: 1,
        categories: [category],
        configFields: [],
        mcpServers: [],
        bundledSkills: [],
      },
    });
  const older = withOlder ? await publish("1.0.0", "scheduling") : undefined;
  const latest = await publish("2.0.0", "channels");
  const read = () =>
    t.run(async (ctx) => {
      const pkg = await ctx.db.get(latest.packageId);
      const release = pkg?.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .unique();
      const categoryRows = await ctx.db
        .query("packagePluginCategorySearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .collect();
      return {
        latestReleaseId: pkg?.latestReleaseId,
        packageCategories: pkg?.categories,
        releaseCategories: release?.pluginManifestSummary?.categories,
        digestCategories: digest?.categories,
        categoryRows: categoryRows.map((row) => row.pluginCategory),
      };
    });
  const readDigest = () =>
    t.run((ctx) =>
      ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .unique(),
    );
  return { t, actor, older, latest, read, readDigest };
}

describe("latest release category lifecycle", () => {
  it("keeps quarantine's chosen survivor and both category projections aligned", async () => {
    const { t, older, latest, read } = await fixture();
    await t.mutation(internal.packages.updateReleaseLlmAnalysisInternal, {
      releaseId: latest.releaseId,
      llmAnalysis: {
        status: "malicious",
        verdict: "malicious",
        checkedAt: 1,
        summary: "Local fixture only",
      },
    });
    expect(await read()).toEqual({
      latestReleaseId: older!.releaseId,
      packageCategories: ["scheduling"],
      releaseCategories: ["scheduling"],
      digestCategories: ["scheduling"],
      categoryRows: ["scheduling"],
    });
  });

  it("restores categories from the fallback survivor when a hidden latest release was removed", async () => {
    const { t, actor, older, latest, read } = await fixture();
    await t.mutation(internal.packages.softDeletePackageInternal, {
      userId: actor,
      name: "@category-life/tool",
    });
    // Supported historical restore state: the old latest pointer no longer resolves.
    await t.run(async (ctx) => ctx.db.delete(latest.releaseId));
    await t.mutation(internal.packages.restorePackageInternal, {
      userId: actor,
      name: "@category-life/tool",
    });
    expect(await read()).toEqual({
      latestReleaseId: older!.releaseId,
      packageCategories: ["scheduling"],
      releaseCategories: ["scheduling"],
      digestCategories: ["scheduling"],
      categoryRows: ["scheduling"],
    });
    const digest = await t.run(async (ctx) =>
      ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .unique(),
    );
    expect(digest).toMatchObject({ ownerHandle: "category-life" });
    expect(digest).not.toHaveProperty("softDeletedBy");
    expect(digest).not.toHaveProperty("softDeletedByRole");
    expect(digest?.softDeletedAt).toBeUndefined();
  });

  it("removes a quarantined first release from public listing and both category indexes", async () => {
    const { t, latest, read } = await fixture(false);
    await t.mutation(internal.packages.updateReleaseLlmAnalysisInternal, {
      releaseId: latest.releaseId,
      llmAnalysis: { status: "malicious", verdict: "malicious", checkedAt: 1 },
    });
    expect(await read()).toEqual({
      latestReleaseId: undefined,
      packageCategories: undefined,
      releaseCategories: undefined,
      digestCategories: ["other"],
      categoryRows: ["other"],
    });
    const page = await t.query(api.packages.listPublicPage, {
      family: "code-plugin",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page).toEqual([]);
    const digest = await t.run(async (ctx) =>
      ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .unique(),
    );
    expect(digest?.latestVersion).toBeUndefined();
    expect(digest?.scanStatus).toBe("malicious");
  });

  it.each([
    { family: "code-plugin", categories: ["channels"] },
    { family: "code-plugin", categories: ["tools"] },
    { family: "bundle-plugin", categories: ["tools"] },
  ] as const)(
    "keeps the current release and $family categories $categories when editing a stale summary",
    async ({ family, categories }) => {
      const { t, actor, latest, readDigest } = await fixture(false);
      await t.run(async (ctx) => {
        const pkg = await ctx.db.get(latest.packageId);
        if (!pkg?.latestVersionSummary) throw new Error("Missing package summary");
        await ctx.db.patch(pkg._id, {
          latestVersionSummary: { ...pkg.latestVersionSummary, version: "1.0.0" },
          family,
          categories: [...categories],
        });
      });

      await t.withIdentity({ subject: actor }).mutation(api.packages.setPackageCatalogMetadata, {
        packageId: latest.packageId,
        categories: [...categories],
        topics: ["calendar"],
      });

      const digest = await readDigest();
      expect(digest?.latestVersion, "latestVersion").toBe("2.0.0");
      expect(digest?.topics).toEqual(["calendar"]);
      expect(digest?.categories).toEqual(categories);
    },
  );

  it("repairs the digest when the scan-status backfill leaves the package unchanged", async () => {
    const { t, latest } = await fixture(false);
    await t.mutation(internal.packages.backfillLatestPackageScanStatusInternal, {});
    const before = await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .unique();
      if (!digest) throw new Error("Missing package digest");
      await ctx.db.patch(digest._id, { latestVersion: "1.0.0" });
      return ctx.db.get(latest.packageId);
    });

    const result = await t.mutation(internal.packages.backfillLatestPackageScanStatusInternal, {});
    expect(result.patched).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(latest.packageId))).toEqual(before);
    const digest = await t.run((ctx) =>
      ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", latest.packageId))
        .unique(),
    );
    expect(digest?.latestVersion).toBe("2.0.0");
  });

  it("refreshes the digest when deleting a tagged release or package", async () => {
    const { t, actor, older, latest, readDigest } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.patch(latest.packageId, {
        tags: { latest: latest.releaseId, legacy: older!.releaseId },
      });
      await ctx.db.patch(older!.releaseId, { distTags: ["legacy"] });
    });
    await t.withIdentity({ subject: actor }).mutation(api.packages.deleteOwnedRelease, {
      name: "@category-life/tool",
      version: "1.0.0",
    });
    const pkg = await t.run((ctx) => ctx.db.get(latest.packageId));
    expect(pkg?.tags).toEqual({ latest: latest.releaseId });
    expect(await readDigest()).toMatchObject({
      latestVersion: "2.0.0",
      ownerHandle: "category-life",
      ownerKind: "user",
      updatedAt: pkg?.updatedAt,
    });

    await t.mutation(internal.packages.softDeletePackageInternal, {
      userId: actor,
      name: "@category-life/tool",
    });
    expect(await readDigest()).toMatchObject({
      softDeletedAt: expect.any(Number),
      ownerHandle: "category-life",
      latestVersion: "2.0.0",
    });
  });

  it("projects identity repairs, owner transfers and official normalization", async () => {
    const { t, actor, readDigest } = await fixture(false);
    await t.mutation(internal.packages.repairPackageIdentityInternal, {
      actorUserId: actor,
      name: "@category-life/tool",
      nextName: "projection-tool",
      nextRuntimeId: "projection-tool",
      reason: "Runtime regression fixture",
    });
    expect(await readDigest()).toMatchObject({
      name: "projection-tool",
      normalizedName: "projection-tool",
      runtimeId: "projection-tool",
      latestVersion: "2.0.0",
    });

    const publisherId = await t.run((ctx) =>
      ctx.db.insert("publishers", {
        kind: "org",
        handle: "projection-owner",
        displayName: "Projection owner",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.mutation(internal.packages.transferPackageOwnerInternal, {
      actorUserId: actor,
      name: "projection-tool",
      ownerUserId: actor,
      ownerPublisherId: publisherId,
    });
    expect(await readDigest()).toMatchObject({
      ownerPublisherId: publisherId,
      ownerHandle: "projection-owner",
      ownerKind: "org",
      channel: "community",
    });
    await t.run((ctx) =>
      ctx.db.insert("officialPublishers", { publisherId, createdAt: 1, updatedAt: 1 }),
    );
    await t.mutation(internal.packages.normalizeOfficialPublisherPackagesInternal, {
      dryRun: false,
    });
    expect(await readDigest()).toMatchObject({
      channel: "official",
      isOfficial: true,
      ownerHandle: "projection-owner",
      ownerKind: "org",
    });
  });
});
