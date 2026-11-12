/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const description = "Carbon-black panels and sage-green signals.";
const darkTheme = JSON.stringify({
  name: "Artemis Canopy",
  description,
  dark: Object.fromEntries(
    [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "destructive",
      "destructive-foreground",
      "border",
      "input",
      "ring",
    ].map((key) => [key, key === "primary" ? "#e6c178" : "#061009"]),
  ),
});
// pluginManifestSummary exactly as current main stores it: no themes field.
const mainShapeSummary = {
  schemaVersion: 1 as const,
  categories: ["other"],
  configFields: [],
  mcpServers: [],
  bundledSkills: [],
};

// Rows in the shape current main writes, before this change: no summary themes, no themePreview.
async function mainShapeFixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "maintainer" });
    const ownerPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "maintainer",
      displayName: "Maintainer",
      createdAt: 1,
      updatedAt: 1,
    });
    const insert = async (
      name: string,
      manifest: Record<string, unknown>,
      files: Array<{ path: string; size: number; sha256: string; storageId: Id<"_storage"> }>,
    ) => {
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: name,
        summary: `${name} summary`,
        ownerUserId,
        ownerPublisherId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        scanStatus: "clean",
        categories: ["other"],
        stats: { downloads: 1, installs: 0, stars: 0, versions: 1 },
        tags: {},
        createdAt: 1,
        updatedAt: 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: "Initial release",
        distTags: ["latest"],
        files,
        integritySha256: "b".repeat(64),
        createdAt: 1,
        createdBy: ownerUserId,
        extractedPluginManifest: manifest,
        pluginManifestSummary: mainShapeSummary,
      });
      await ctx.db.patch(packageId, {
        latestReleaseId: releaseId,
        latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Initial release" },
        tags: { latest: releaseId },
      });
      await upsertPackageSearchDigest(ctx, {
        ...extractPackageDigestFields((await ctx.db.get(packageId))!),
        ownerHandle: "maintainer",
        ownerKind: "user",
      });
    };
    const storageId = await ctx.storage.store(new Blob([darkTheme]));
    await insert("ordinary-plugin", { id: "ordinary-plugin" }, []);
    await insert(
      "canopy-theme",
      {
        id: "canopy-theme",
        themes: [
          {
            id: "canopy-dark",
            name: "Artemis Canopy",
            description,
            source: "themes/canopy-dark.json",
          },
        ],
      },
      [
        {
          path: "themes/canopy-dark.json",
          size: darkTheme.length,
          sha256: "d".repeat(64),
          storageId,
        },
      ],
    );
  });
  return t;
}

async function snapshot(t: Awaited<ReturnType<typeof mainShapeFixture>>) {
  return await t.run(async (ctx) => {
    const packages = await ctx.db.query("packages").collect();
    const releases = await ctx.db.query("packageReleases").collect();
    return Object.fromEntries(
      packages.map((pkg) => [
        pkg.name,
        {
          latestVersionSummary: pkg.latestVersionSummary,
          pluginManifestSummary: releases.find((release) => release.packageId === pkg._id)
            ?.pluginManifestSummary,
        },
      ]),
    );
  });
}

async function catalogItems(t: Awaited<ReturnType<typeof mainShapeFixture>>) {
  const list = await (await t.fetch("/api/v1/plugins")).json();
  const search = await (await t.fetch("/api/v1/plugins/search?q=canopy")).json();
  return {
    list: Object.fromEntries(list.items.map((item: { name: string }) => [item.name, item])),
    search: search.results.map((entry: { package: unknown }) => entry.package),
  };
}

describe("existing-data compatibility for theme previews", () => {
  it("reads current-main rows unchanged, then backfills only the theme plugin", async () => {
    const t = await mainShapeFixture();
    const before = await snapshot(t);

    // (a) Old rows load through the public catalog, search, and detail paths unchanged.
    const catalog = await catalogItems(t);
    expect(Object.keys(catalog.list).sort()).toEqual(["canopy-theme", "ordinary-plugin"]);
    for (const item of [...Object.values(catalog.list), ...catalog.search]) {
      expect(item).not.toHaveProperty("themePreview");
    }
    expect(catalog.search.map((item: { name: string }) => item.name)).toContain("canopy-theme");
    for (const name of ["ordinary-plugin", "canopy-theme"]) {
      const response = await t.fetch(`/api/v1/packages/${name}/detail?version=1.0.0`);
      expect(response.status).toBe(200);
      expect((await response.json()).version.pluginManifestSummary).toEqual(mainShapeSummary);
    }

    // (b) Dry run reports only the theme plugin and writes nothing.
    const args = { family: "code-plugin" as const };
    expect(
      await t.action(internal.migrations.runPluginManifestSummaryBackfillPage, args),
    ).toMatchObject({
      eligibleReleases: 2,
      changedReleases: 1,
      unchangedReleases: 1,
      patchedReleases: 0,
    });
    expect(await snapshot(t)).toEqual(before);

    const apply = { ...args, dryRun: false, confirm: "backfill-plugin-manifest-summaries" };
    expect(
      await t.action(internal.migrations.runPluginManifestSummaryBackfillPage, apply),
    ).toMatchObject({ changedReleases: 1, patchedReleases: 1 });
    const after = await snapshot(t);
    expect(after["ordinary-plugin"]).toEqual(before["ordinary-plugin"]);
    expect(after["canopy-theme"]?.pluginManifestSummary).toEqual({
      ...mainShapeSummary,
      themes: [expect.objectContaining({ id: "canopy-dark", dark: expect.any(Object) })],
    });
    expect(after["canopy-theme"]?.latestVersionSummary).toEqual({
      ...before["canopy-theme"]?.latestVersionSummary,
      themePreview: expect.objectContaining({ id: "canopy-dark", name: "Artemis Canopy" }),
    });
    const upgraded = await catalogItems(t);
    expect(upgraded.list["canopy-theme"].themePreview.dark.primary).toBe("#e6c178");
    expect(upgraded.list["ordinary-plugin"]).toEqual(catalog.list["ordinary-plugin"]);

    // Re-running is a no-op.
    expect(
      await t.action(internal.migrations.runPluginManifestSummaryBackfillPage, apply),
    ).toMatchObject({ changedReleases: 0, unchangedReleases: 2, patchedReleases: 0 });
    expect(await snapshot(t)).toEqual(after);
  });
});
