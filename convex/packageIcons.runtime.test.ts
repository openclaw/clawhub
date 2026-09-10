/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { derivePluginManifestSummary } from "./lib/packageRegistry";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const icon = `/api/v1/skill-icons/${"a".repeat(64)}`;
async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "maintainer" });
    const ownerPublisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    const packageId = await ctx.db.insert("packages", {
      name: "@openclaw/whatsapp",
      normalizedName: "@openclaw/whatsapp",
      displayName: "WhatsApp",
      ownerUserId,
      ownerPublisherId,
      family: "code-plugin",
      channel: "official",
      isOfficial: true,
      scanStatus: "clean",
      categories: ["channels"],
      topics: ["WhatsApp"],
      stats: { downloads: 100, installs: 1, stars: 0, versions: 1 },
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
      files: [],
      integritySha256: "b".repeat(64),
      createdAt: 1,
      createdBy: ownerUserId,
      pluginManifestSummary: derivePluginManifestSummary({
        pluginManifest: { id: "whatsapp" },
        files: [],
      }),
    });
    await ctx.db.patch(packageId, {
      latestReleaseId: releaseId,
      latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Initial release" },
      tags: { latest: releaseId },
    });
    const pkg = (await ctx.db.get(packageId))!;
    await upsertPackageSearchDigest(ctx, {
      ...extractPackageDigestFields(pkg),
      ownerHandle: "openclaw",
      ownerKind: "org",
    });
    return { packageId, releaseId, ownerPublisherId };
  });
  return { t, ...ids };
}

describe("plugin icon repair", () => {
  it("updates the release, latest summary, and every public catalog projection atomically and idempotently", async () => {
    const { t, ...ids } = await fixture();
    const before = await t.fetch("/api/v1/plugins");
    expect((await before.json()).items[0].icon).toBeNull();
    expect(
      await t.mutation(internal.maintenance.applyPluginIconRepairInternal, { ...ids, icon }),
    ).toBe(true);
    await t.run(async (ctx) => {
      const pkg = await ctx.db.get(ids.packageId);
      const release = await ctx.db.get(ids.releaseId);
      expect(pkg?.icon).toBe(icon);
      expect(pkg?.latestVersionSummary?.icon).toBe(icon);
      expect(release?.icon).toBe(icon);
      expect(release?.pluginManifestSummary?.icon).toBe(icon);
      expect(pkg?.updatedAt).toBe(1);
    });
    for (const route of [
      "/api/v1/plugins",
      "/api/v1/plugins?category=channels",
      "/api/v1/plugins?topic=whatsapp",
      "/api/v1/plugins/search?q=whatsapp",
    ]) {
      const response = await t.fetch(route);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(
        (data.items ?? data.results.map((entry: { package: unknown }) => entry.package))[0].icon,
      ).toBe(icon);
    }
    expect(
      await t.mutation(internal.maintenance.applyPluginIconRepairInternal, { ...ids, icon }),
    ).toBe(false);
  });
  it("previews without writing, applies, and skips already repaired records", async () => {
    const { t, ...ids } = await fixture();
    await t.run(async (ctx) => ctx.db.patch(ids.releaseId, { icon }));
    expect(await t.action(internal.maintenance.repairPluginIconsInternal, {})).toMatchObject({
      dryRun: true,
      matched: 1,
      patched: 0,
    });
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.packageId))?.icon).toBeUndefined();
    });
    expect(
      await t.action(internal.maintenance.repairPluginIconsInternal, { dryRun: false }),
    ).toMatchObject({ matched: 1, patched: 1 });
    expect(
      await t.action(internal.maintenance.repairPluginIconsInternal, { dryRun: false }),
    ).toMatchObject({ matched: 0, patched: 0 });
  });
  it("does not accept external URLs or reuse legacy release icon URLs", async () => {
    const { t, ...ids } = await fixture();
    const externalIcon = "https://example.com/icon.png";
    await expect(
      t.mutation(internal.maintenance.applyPluginIconRepairInternal, {
        ...ids,
        icon: externalIcon,
      }),
    ).rejects.toThrow("Invalid plugin icon");
    await t.run(async (ctx) =>
      ctx.db.patch(ids.releaseId, {
        icon: externalIcon,
        extractedPluginManifest: { icon: externalIcon },
      }),
    );
    expect(
      await t.action(internal.maintenance.repairPluginIconsInternal, { dryRun: false }),
    ).toMatchObject({ matched: 0, patched: 0 });
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.packageId))?.icon).toBeUndefined();
    });
  });
  it("replaces legacy package URLs with the hosted bundled asset", async () => {
    const { t, ...ids } = await fixture();
    const externalIcon = "https://example.com/icon.png";
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.packageId, { icon: externalIcon });
      await ctx.db.patch(ids.releaseId, { icon });
    });
    expect(await t.action(internal.maintenance.repairPluginIconsInternal, {})).toMatchObject({
      matched: 1,
      patched: 0,
    });
    expect(
      await t.action(internal.maintenance.repairPluginIconsInternal, { dryRun: false }),
    ).toMatchObject({ matched: 1, patched: 1 });
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.packageId))?.icon).toBe(icon);
    });
  });
  it("paginates without skipping candidates and restricts source recovery to the active OpenClaw owner", async () => {
    const { t, ...ids } = await fixture();
    const args = { family: "code-plugin" as const, cursor: null, limit: 1 };
    const page = await t.query(internal.maintenance.listPluginIconRepairCandidatesInternal, args);
    expect(page.candidates).toMatchObject([{ trustedSource: true }]);
    const end = await t.query(internal.maintenance.listPluginIconRepairCandidatesInternal, {
      ...args,
      cursor: page.cursor,
    });
    expect(end.candidates).toEqual([]);
    expect(end.isDone).toBe(true);
    await t.run(async (ctx) => ctx.db.patch(ids.ownerPublisherId, { deactivatedAt: 2 }));
    expect(
      (await t.query(internal.maintenance.listPluginIconRepairCandidatesInternal, args)).candidates,
    ).toMatchObject([{ trustedSource: false }]);
  });
  it("does not overwrite icons or repair a deleted, pending, transferred, or superseded release", async () => {
    for (const change of ["icon", "deleted", "pending", "owner", "latest"] as const) {
      const { t, ...ids } = await fixture();
      await t.run(async (ctx) => {
        if (change === "icon")
          await ctx.db.patch(ids.packageId, { icon: "https://example.com/new.png" });
        if (change === "deleted") await ctx.db.patch(ids.packageId, { softDeletedAt: 2 });
        if (change === "pending")
          await ctx.db.patch(ids.releaseId, { publicationStatus: "pending" });
        if (change === "owner") await ctx.db.patch(ids.packageId, { ownerPublisherId: undefined });
        if (change === "latest") await ctx.db.patch(ids.packageId, { latestReleaseId: undefined });
      });
      expect(
        await t.mutation(internal.maintenance.applyPluginIconRepairInternal, { ...ids, icon }),
      ).toBe(false);
    }
  });
});
