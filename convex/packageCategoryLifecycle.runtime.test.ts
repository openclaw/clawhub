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
  return { t, actor, older, latest, read };
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
});
