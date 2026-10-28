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

// Mirrors the retained 2026.9.4/2026.9.8 attempts: scans completed, but
// finalization rejected the original failed parent run. They must stay failed.
async function failedHistory(f: Awaited<ReturnType<typeof fixture>>, version = "2026.9.8") {
  return f.t.run(async (ctx) => {
    const latest = (await ctx.db.get(f.latest))!;
    const pendingPublication = {
      family: "bundle-plugin",
      runtimeId: "acpx",
      ownerUserId: f.actor,
      ownerPublisherId: f.publisher,
      tags: ["latest"],
      trustedPublishAuthorizationVersion: 2,
      trustedPublishTokenId: "retained-original-token",
      trustedPublishInventoryDigest: "a".repeat(64),
    };
    const release = await ctx.db.insert("packageReleases", {
      packageId: f.pkg,
      version,
      publicationStatus: "pending",
      pendingPublication,
      runtimeId: "acpx",
      extractedPluginManifest: latest.extractedPluginManifest,
      files: latest.files,
      integritySha256: latest.integritySha256,
      createdAt: 1,
      createdBy: f.actor,
      distTags: ["latest"],
      changelog: "Retained original",
    });
    const attempt = await ctx.db.insert("publishAttempts", {
      kind: "package",
      status: "failed",
      userId: f.actor,
      ownerUserId: f.actor,
      ownerPublisherId: f.publisher,
      packageId: f.pkg,
      packageReleaseId: release,
      slug: "@openclaw/acpx",
      version,
      displayName: "ACPX Runtime",
      artifactFingerprint: latest.integritySha256,
      files: latest.files,
      checks: {
        trufflehog: { status: "clean", checkedAt: 2 },
        clawscan: {
          status: "clean",
          checkedAt: 2,
          redactedFindings: ["Retained suspicious finding"],
        },
      },
      finalizationLastError:
        "OpenClaw release parent terminal state completed/failure is not authorized by automated-detached",
      failedAt: 3,
      createdAt: 1,
      updatedAt: 3,
      expiresAt: 4,
      idempotencyKey: `retained-${version}`,
      packageFollowup: {
        trustedPublishAuthorizationVersion: 2,
        trustedPublishTokenId: pendingPublication.trustedPublishTokenId,
        trustedPublishInventoryDigest: pendingPublication.trustedPublishInventoryDigest,
      },
      packageInsertArgs: { llmAnalysis: { status: "suspicious" } },
    });
    await ctx.db.patch(release, { publishAttemptId: attempt });
    return { release, attempt };
  });
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

  it("preserves two failed pending originals without activating or reauthorizing them", async () => {
    const f = await fixture();
    const histories = [await failedHistory(f, "2026.9.4"), await failedHistory(f)];
    const snapshot = () =>
      f.t.run(async (ctx) => ({
        parent: await ctx.db.get(f.pkg),
        attempts: await Promise.all(histories.map((h) => ctx.db.get(h.attempt))),
        releases: await Promise.all(histories.map((h) => ctx.db.get(h.release))),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
    const before = await snapshot();
    const dry = await f.t.mutation(
      internal.maintenance.repairLegacyNativePluginFamilyInternal,
      f.args,
    );
    expect(dry).toMatchObject({ wouldSnapshot: 4, preservedFailedPending: 2 });
    expect(await snapshot()).toEqual(before);
    await f.t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
      ...f.args,
      dryRun: false,
      confirm,
      expectedRevision: dry.revision,
    });
    const after = await snapshot();
    expect(after.attempts).toEqual(before.attempts);
    expect(after.releases).toEqual(
      before.releases.map((r) => ({ ...r, pluginFamily: "bundle-plugin" })),
    );
    expect(after.parent).toEqual({
      ...before.parent,
      family: "code-plugin",
      updatedAt: expect.any(Number),
    });
    expect(after.scheduled).toEqual(before.scheduled);
    await expect(
      f.t.mutation(internal.packages.publishPendingReleaseInternal, {
        releaseId: histories[0].release,
      }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(after);
    expect(
      await f.t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, f.args),
    ).toMatchObject({ alreadyRepaired: true });
  });

  it("binds the complete failed attempt to the dry-run revision", async () => {
    const f = await fixture();
    const h = await failedHistory(f);
    const dry = await f.t.mutation(
      internal.maintenance.repairLegacyNativePluginFamilyInternal,
      f.args,
    );
    await f.t.run((ctx) => ctx.db.patch(h.attempt, { updatedAt: 99 }));
    await expect(
      f.t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
        ...f.args,
        dryRun: false,
        confirm,
        expectedRevision: dry.revision,
      }),
    ).rejects.toThrow("current dry-run revision");
    expect((await f.t.run((ctx) => ctx.db.get(h.release)))?.pluginFamily).toBeUndefined();
    expect((await f.t.run((ctx) => ctx.db.get(f.pkg)))?.family).toBe("bundle-plugin");
  });

  it.each([
    "unbound",
    "active",
    "check-claim",
    "finalization-claim",
    "unchecked",
    "missing-check-time",
    "failure",
    "missing-failed-time",
    "files",
    "fingerprint",
    "publisher",
    "owner",
    "release-binding",
    "runtime",
    "family",
    "newer",
    "latest-tag",
    "too-many",
    "retry",
  ])("rejects contradictory failed history: %s", async (kind) => {
    const f = await fixture();
    const h = await failedHistory(f);
    await f.t.run(async (ctx) => {
      const a = (await ctx.db.get(h.attempt))!;
      if (kind === "unbound") await ctx.db.patch(h.release, { publishAttemptId: undefined });
      if (kind === "active") await ctx.db.patch(h.attempt, { status: "finalizing" });
      if (kind === "check-claim") await ctx.db.patch(h.attempt, { checkClaimExpiresAt: 0 });
      if (kind === "finalization-claim")
        await ctx.db.patch(h.attempt, { finalizationClaimId: "old-claim" });
      if (kind === "unchecked")
        await ctx.db.patch(h.attempt, { checks: { ...a.checks, clawscan: { status: "failed" } } });
      if (kind === "missing-check-time")
        await ctx.db.patch(h.attempt, { checks: { ...a.checks, clawscan: { status: "clean" } } });
      if (kind === "failure") await ctx.db.patch(h.attempt, { finalizationLastError: "unrelated" });
      if (kind === "missing-failed-time") await ctx.db.patch(h.attempt, { failedAt: undefined });
      if (kind === "files") await ctx.db.patch(h.attempt, { files: [] });
      if (kind === "fingerprint")
        await ctx.db.patch(h.attempt, { artifactFingerprint: "different" });
      if (kind === "publisher") await ctx.db.patch(h.attempt, { ownerPublisherId: undefined });
      if (kind === "owner") await ctx.db.patch(h.attempt, { ownerUserId: undefined });
      if (kind === "release-binding") await ctx.db.patch(h.attempt, { packageReleaseId: f.latest });
      if (kind === "runtime") await ctx.db.patch(h.release, { runtimeId: "other" });
      if (kind === "family")
        await ctx.db.patch(h.release, { pendingPublication: { family: "code-plugin" } });
      if (kind === "newer") {
        await ctx.db.patch(h.release, { version: "2026.10.8" });
        await ctx.db.patch(h.attempt, { version: "2026.10.8" });
      }
      if (kind === "latest-tag") await ctx.db.patch(f.pkg, { tags: { latest: h.release } });
      if (kind === "retry")
        await ctx.db.patch(h.release, {
          operationalRetry: {
            attemptId: h.attempt,
            actorUserId: f.actor,
            ownerUserId: f.actor,
            ownerPublisherId: f.publisher,
          },
        });
    });
    if (kind === "too-many") {
      await failedHistory(f, "2026.9.4");
      await failedHistory(f, "2026.9.1");
    }
    await expect(
      f.t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, f.args),
    ).rejects.toThrow();
    expect((await f.t.run((ctx) => ctx.db.get(f.pkg)))?.family).toBe("bundle-plugin");
    expect((await f.t.run((ctx) => ctx.db.get(h.release)))?.pluginFamily).toBeUndefined();
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

  it.each(["administrator", "publisher", "owner"])(
    "rejects confirmed apply after %s authority changes without repair writes",
    async (kind) => {
      const { t, actor, publisher, pkg, args } = await fixture();
      const dry = await t.mutation(
        internal.maintenance.repairLegacyNativePluginFamilyInternal,
        args,
      );
      await t.run(async (ctx) => {
        if (kind === "administrator") await ctx.db.patch(actor, { role: "user" });
        if (kind === "publisher") {
          const official = await ctx.db
            .query("officialPublishers")
            .withIndex("by_publisher", (q) => q.eq("publisherId", publisher))
            .unique();
          await ctx.db.delete(official!._id);
        }
        if (kind === "owner") {
          const replacement = await ctx.db.insert("publishers", {
            kind: "org",
            handle: "replacement-owner",
            displayName: "Replacement owner",
            createdAt: 1,
            updatedAt: 1,
          });
          await ctx.db.patch(pkg, { ownerPublisherId: replacement });
        }
      });
      const readRepairState = () =>
        t.run(async (ctx) => ({
          parent: await ctx.db.get(pkg),
          releases: await ctx.db
            .query("packageReleases")
            .withIndex("by_package", (q) => q.eq("packageId", pkg))
            .collect(),
          audit: await ctx.db
            .query("auditLogs")
            .withIndex("by_target", (q) => q.eq("targetType", "package").eq("targetId", pkg))
            .collect(),
        }));
      const revoked = await readRepairState();
      await expect(
        t.mutation(internal.maintenance.repairLegacyNativePluginFamilyInternal, {
          ...args,
          dryRun: false,
          confirm,
          expectedRevision: dry.revision,
        }),
      ).rejects.toThrow();
      expect(await readRepairState()).toEqual(revoked);
      expect(revoked.parent?.family).toBe("bundle-plugin");
      expect(revoked.releases.every((release) => release.pluginFamily === undefined)).toBe(true);
      expect(revoked.audit).toEqual([]);
    },
  );

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
