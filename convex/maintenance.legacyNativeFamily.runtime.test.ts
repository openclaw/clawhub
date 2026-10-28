/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { sha256Hex } from "./lib/clawpack";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const confirm = "repair-verified-legacy-native-plugin-family";

async function fixture() {
  const t = convexTest(schema, modules);
  const nativeManifestText = JSON.stringify({ id: "acpx", configSchema: { type: "object" } });
  const sha256 = await sha256Hex(new TextEncoder().encode(nativeManifestText));
  const bundleText = '{"name":"old-bundle"}';
  const bundleSha256 = await sha256Hex(new TextEncoder().encode(bundleText));
  const ids = await t.run(async (ctx) => {
    const actor = await ctx.db.insert("users", { handle: "repair-admin", role: "admin" });
    const publisher = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("officialPublishers", {
      publisherId: publisher,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("publisherMembers", {
      publisherId: publisher,
      userId: actor,
      role: "owner",
      createdAt: 1,
      updatedAt: 1,
    });
    const nativeStorageId = await ctx.storage.store(new Blob([nativeManifestText]));
    const bundleStorageId = await ctx.storage.store(new Blob([bundleText]));
    const pkg = await ctx.db.insert("packages", {
      name: "@openclaw/acpx",
      normalizedName: "@openclaw/acpx",
      displayName: "acpx",
      ownerUserId: actor,
      ownerPublisherId: publisher,
      family: "bundle-plugin",
      runtimeId: "acpx",
      channel: "official",
      isOfficial: true,
      scanStatus: "suspicious",
      tags: {},
      stats: { downloads: 7, installs: 3, stars: 2, versions: 2 },
      createdAt: 1,
      updatedAt: 1,
    });
    const base = {
      packageId: pkg,
      changelog: "Original",
      distTags: [],
      integritySha256: sha256,
      createdAt: 1,
      createdBy: actor,
      verification: {
        tier: "source-linked" as const,
        scope: "artifact-only" as const,
        scanStatus: "suspicious" as const,
      },
      publicationStatus: "published" as const,
    };
    const old = await ctx.db.insert("packageReleases", {
      ...base,
      version: "1.0.0",
      files: [
        {
          path: ".claude-plugin/plugin.json",
          size: new TextEncoder().encode(bundleText).length,
          storageId: bundleStorageId,
          sha256: bundleSha256,
        },
      ],
      extractedPluginManifest: { name: "old-bundle" },
    });
    const latest = await ctx.db.insert("packageReleases", {
      ...base,
      version: "2026.10.7",
      files: [
        {
          path: "openclaw.plugin.json",
          size: new TextEncoder().encode(nativeManifestText).length,
          storageId: nativeStorageId,
          sha256,
        },
      ],
      runtimeId: "acpx",
      extractedPluginManifest: JSON.parse(nativeManifestText),
    });
    await ctx.db.patch(pkg, {
      latestReleaseId: latest,
      tags: { latest },
      latestVersionSummary: { version: "2026.10.7", createdAt: 1, changelog: "Original" },
    });
    return { actor, publisher, pkg, old, latest };
  });
  const args = {
    actorUserId: ids.actor,
    packageId: ids.pkg,
    expectedOwnerPublisherId: ids.publisher,
    expectedLatestReleaseId: ids.latest,
    nativeManifestText,
    reason: "Recover verified original native publication",
  };
  return { t, ...ids, args };
}

describe("guarded legacy native plugin family repair", () => {
  it("repairs a persisted admission dead end while preserving bundle history and original bytes", async () => {
    const { t, actor, publisher, pkg, old, latest, args } = await fixture();
    const before = await t.run(async (ctx) => ({
      pkg: await ctx.db.get(pkg),
      old: await ctx.db.get(old),
      latest: await ctx.db.get(latest),
    }));
    const publish = {
      actorUserId: actor,
      ownerUserId: actor,
      ownerPublisherId: publisher,
      name: "@openclaw/acpx",
      displayName: "acpx",
      family: "code-plugin" as const,
      version: "2026.10.8",
      publicationStatus: "pending" as const,
      changelog: "Release",
      tags: ["latest"],
      summary: "Native",
      runtimeId: "acpx",
      channel: "official" as const,
      files: before.latest!.files,
      integritySha256: before.latest!.integritySha256,
      sha256hash: before.latest!.integritySha256,
      extractedPluginManifest: JSON.parse(args.nativeManifestText),
    };
    await expect(t.mutation(internal.packages.insertReleaseInternal, publish)).rejects.toThrow(
      "family changes are not allowed",
    );
    const dry = await t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, args);
    expect(dry).toMatchObject({
      dryRun: true,
      isDone: true,
      wouldSnapshot: 2,
      wouldChangeParent: true,
    });
    expect(await t.run((ctx) => ctx.db.get(pkg))).toEqual(before.pkg);
    const applied = await t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
      ...args,
      dryRun: false,
      confirm,
      expectedRevision: dry.revision,
    });
    expect(applied).toMatchObject({ changedParent: true, snapshotted: 2 });
    const after = await t.run(async (ctx) => ({
      pkg: await ctx.db.get(pkg),
      old: await ctx.db.get(old),
      latest: await ctx.db.get(latest),
    }));
    expect(after.old).toEqual({ ...before.old, pluginFamily: "bundle-plugin" });
    expect(after.latest).toEqual({ ...before.latest, pluginFamily: "bundle-plugin" });
    expect(after.pkg).toEqual({
      ...before.pkg,
      family: "code-plugin",
      updatedAt: expect.any(Number),
    });
    const oldVersion = await t.query(internal.packages.getVersionByNameForViewerInternal, {
      name: "@openclaw/acpx",
      version: "1.0.0",
    });
    expect(oldVersion?.package.family).toBe("bundle-plugin");
    expect(
      await t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
        ...args,
        expectedLatestReleaseId: latest,
      }),
    ).toMatchObject({ alreadyRepaired: true, changedParent: false });
    const admitted = await t.mutation(internal.packages.insertReleaseInternal, publish);
    expect(await t.run((ctx) => ctx.db.get(admitted.releaseId))).toMatchObject({
      publicationStatus: "pending",
      pluginFamily: "code-plugin",
      files: publish.files,
    });
  });

  it("rejects a stale revision without snapshotting any release", async () => {
    const { t, old, args } = await fixture();
    const dry = await t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, args);
    await t.run((ctx) => ctx.db.patch(old, { changelog: "Changed after dry run" }));
    await expect(
      t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
        ...args,
        dryRun: false,
        confirm,
        expectedRevision: dry.revision,
      }),
    ).rejects.toThrow("current dry-run revision");
    expect((await t.run((ctx) => ctx.db.get(old)))?.pluginFamily).toBeUndefined();
  });

  it.each(["active", "runtime-collision", "oversized"])("rejects %s inventories", async (kind) => {
    const { t, actor, publisher, pkg, latest, args } = await fixture();
    await t.run(async (ctx) => {
      if (kind === "active")
        await ctx.db.insert("publishAttempts", {
          kind: "package",
          userId: actor,
          ownerUserId: actor,
          ownerPublisherId: publisher,
          slug: "@openclaw/acpx",
          version: "2026.10.8",
          packageId: pkg,
          packageReleaseId: latest,
          displayName: "acpx",
          status: "pending_checks",
          checks: { trufflehog: { status: "pending" }, clawscan: { status: "pending" } },
          artifactFingerprint: "a".repeat(64),
          idempotencyKey: "fixture-active",
          files: [],
          createdAt: 1,
          updatedAt: 1,
          expiresAt: 9_999_999_999_999,
        });
      if (kind === "runtime-collision") {
        const original = (await ctx.db.get(pkg))!;
        const { _id, _creationTime, ...values } = original;
        await ctx.db.insert("packages", {
          ...values,
          name: "@openclaw/collision",
          normalizedName: "@openclaw/collision",
          family: "code-plugin",
        });
      }
      if (kind === "oversized") {
        const original = (await ctx.db.get(latest))!;
        const { _id, _creationTime, ...values } = original;
        for (let n = 0; n < 149; n++)
          await ctx.db.insert("packageReleases", { ...values, version: `0.0.${n}` });
      }
    });
    await expect(
      t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, args),
    ).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(pkg)))?.family).toBe("bundle-plugin");
  });

  it("requires a current dry-run binding and confirmation and rolls back rejected applies", async () => {
    const { t, pkg, args } = await fixture();
    const dry = await t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, args);
    for (const extra of [{}, { confirm }, { confirm: "wrong", expectedRevision: dry.revision }]) {
      await expect(
        t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
          ...args,
          dryRun: false,
          ...extra,
        }),
      ).rejects.toThrow("current dry-run revision");
    }
    await t.run((ctx) => ctx.db.patch(pkg, { runtimeId: "changed" }));
    await expect(
      t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
        ...args,
        dryRun: false,
        confirm,
        expectedRevision: dry.revision,
      }),
    ).rejects.toThrow("identity changed");
  });

  it.each([
    "native-bytes",
    "admin",
    "owner",
    "official",
    "pending",
    "snapshot",
    "scope",
    "deleted",
  ])("rejects changed %s evidence", async (kind) => {
    const { t, actor, publisher, pkg, latest, args } = await fixture();
    if (kind === "native-bytes") args.nativeManifestText = '{"id":"companion-name"}';
    await t.run(async (ctx) => {
      if (kind === "admin") await ctx.db.patch(actor, { role: "user" });
      if (kind === "owner") await ctx.db.patch(publisher, { handle: "other" });
      if (kind === "official") {
        const row = await ctx.db.query("officialPublishers").first();
        await ctx.db.delete(row!._id);
      }
      if (kind === "pending") await ctx.db.patch(latest, { publicationStatus: "pending" });
      if (kind === "snapshot") await ctx.db.patch(latest, { pluginFamily: "code-plugin" });
      if (kind === "scope") await ctx.db.patch(pkg, { normalizedName: "@openclaw/other" });
      if (kind === "deleted") await ctx.db.patch(pkg, { softDeletedAt: 0 });
    });
    await expect(
      t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, args),
    ).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(pkg)))?.family).toBe("bundle-plugin");
  });
});
