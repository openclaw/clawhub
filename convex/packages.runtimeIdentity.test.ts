/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type Backend = ReturnType<typeof convexTest>;
type Owner = { ownerUserId: Id<"users">; ownerPublisherId?: Id<"publishers"> };

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const owners = await t.run(async (ctx) => {
    const admin = await ctx.db.insert("users", { role: "admin", handle: "operator" });
    const user = await ctx.db.insert("users", { handle: "community" });
    const personal = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "community",
      displayName: "Community",
      linkedUserId: user,
      createdAt: 1,
      updatedAt: 1,
    });
    const org = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "canonical",
      displayName: "Canonical",
      createdAt: 1,
      updatedAt: 1,
    });
    const secondOrg = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "another",
      displayName: "Another",
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      admin,
      community: { ownerUserId: user, ownerPublisherId: personal },
      legacy: { ownerUserId: user },
      canonical: { ownerUserId: admin, ownerPublisherId: org },
      another: { ownerUserId: admin, ownerPublisherId: secondOrg },
    };
  });
  return { t, ...owners };
}

async function publish(
  t: Backend,
  actorUserId: Id<"users">,
  owner: Owner,
  name: string,
  options: { runtimeId?: string; version?: string; pending?: boolean } = {},
) {
  return await t.mutation(internal.packages.insertReleaseInternal, {
    actorUserId,
    ...owner,
    name,
    displayName: name,
    family: "code-plugin",
    version: options.version ?? "1.0.0",
    runtimeId: options.runtimeId ?? "voice",
    publicationStatus: options.pending ? "pending" : "published",
    changelog: "Initial release",
    tags: ["latest"],
    summary: "Voice plugin",
    files: [],
    integritySha256: "a".repeat(64),
    sha256hash: "b".repeat(64),
    extractedPluginManifest: { id: options.runtimeId ?? "voice" },
  });
}

describe("owner-scoped package runtime identity", () => {
  it("separates organizations even when the uploader is the same", async () => {
    const { t, admin, canonical, another } = await fixture();
    await publish(t, admin, canonical, "@canonical/voice-provider");
    await expect(publish(t, admin, another, "@another/voice-provider")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("keeps one organization namespace when a different admin uploads", async () => {
    const { t, admin, canonical } = await fixture();
    await publish(t, admin, canonical, "@canonical/voice-one");
    const secondAdmin = await t.run(async (ctx) => ctx.db.insert("users", { role: "admin" }));
    await expect(
      publish(t, secondAdmin, { ...canonical, ownerUserId: secondAdmin }, "@canonical/voice-two"),
    ).rejects.toThrow("already claimed");
  });

  it("publishes different owners' same runtime without changing either artifact identity", async () => {
    const { t, admin, community, canonical } = await fixture();
    const original = await publish(t, admin, community, "@community/voice-tools");
    const before = await t.run(async (ctx) => ctx.db.get(original.releaseId));
    const official = await publish(t, admin, canonical, "@canonical/voice-provider");
    const rows = await t.run(async (ctx) => ({
      community: await ctx.db.get(original.packageId),
      canonical: await ctx.db.get(official.packageId),
      originalRelease: await ctx.db.get(original.releaseId),
    }));
    expect(rows.community).toMatchObject({
      name: "@community/voice-tools",
      runtimeId: "voice",
      ...community,
    });
    expect(rows.canonical).toMatchObject({
      name: "@canonical/voice-provider",
      runtimeId: "voice",
      ...canonical,
    });
    expect(rows.originalRelease).toEqual(before);
  });

  it.each(["personal-first", "legacy-first"])(
    "keeps personal and legacy user ownership in one namespace (%s)",
    async (order) => {
      const { t, admin, community, legacy } = await fixture();
      const [first, second] =
        order === "personal-first" ? [community, legacy] : [legacy, community];
      await publish(t, admin, first, "@community/voice-one");
      await expect(publish(t, admin, second, "@community/voice-two")).rejects.toThrow(
        "already claimed",
      );
    },
  );

  it("retains package ownership and runtime immutability", async () => {
    const { t, admin, community, canonical } = await fixture();
    await publish(t, admin, community, "@community/voice-tools");
    await expect(
      publish(t, admin, canonical, "@community/voice-tools", { version: "1.0.1" }),
    ).rejects.toThrow("belongs to another publisher");
    await expect(
      publish(t, admin, community, "@community/voice-tools", {
        version: "1.0.1",
        runtimeId: "different",
      }),
    ).rejects.toThrow("runtime id changes are not allowed");
  });

  it("rejects a transfer into an occupied owner namespace without changing ownership", async () => {
    const { t, admin, community, canonical } = await fixture();
    const first = await publish(t, admin, community, "@community/voice-tools");
    await publish(t, admin, canonical, "@canonical/voice-provider");
    await expect(
      t.mutation(internal.packages.transferPackageOwnerInternal, {
        actorUserId: admin,
        name: "@community/voice-tools",
        ...canonical,
        reason: "Move publisher namespace",
      }),
    ).rejects.toThrow("already claimed");
    expect(await t.run(async (ctx) => ctx.db.get(first.packageId))).toMatchObject(community);
  });

  it("rejects undelete after another package in the same owner namespace claims the runtime", async () => {
    const { t, admin, community } = await fixture();
    const original = await publish(t, admin, community, "@community/voice-old");
    await t.mutation(internal.packages.softDeletePackageInternal, {
      userId: admin,
      name: "@community/voice-old",
    });
    await publish(t, admin, community, "@community/voice-new");
    await expect(
      t.mutation(internal.packages.restorePackageInternal, {
        userId: admin,
        name: "@community/voice-old",
      }),
    ).rejects.toThrow("already claimed");
    const rows = await t.run(async (ctx) => [
      await ctx.db.get(original.packageId),
      await ctx.db.get(original.releaseId),
    ]);
    expect(rows.every((row) => typeof row?.softDeletedAt === "number")).toBe(true);
  });

  it("restores a community package without disturbing another publisher's runtime claim", async () => {
    const { t, admin, community, canonical } = await fixture();
    const original = await publish(t, admin, community, "@community/voice-tools");
    await t.mutation(internal.packages.softDeletePackageInternal, {
      userId: admin,
      name: "@community/voice-tools",
    });
    await publish(t, admin, canonical, "@canonical/voice-provider");
    await t.mutation(internal.packages.restorePackageInternal, {
      userId: admin,
      name: "@community/voice-tools",
    });
    const restored = await t.run(async (ctx) => ctx.db.get(original.packageId));
    expect(restored).toMatchObject({
      ...community,
      runtimeId: "voice",
    });
    expect(restored?.softDeletedAt).toBeUndefined();
  });

  it("scopes an admin runtime repair by owner and rejects same-owner collisions", async () => {
    const { t, admin, community, canonical } = await fixture();
    await publish(t, admin, community, "@community/voice-tools");
    const repaired = await publish(t, admin, canonical, "@canonical/voice-provider", {
      runtimeId: "wrong-id",
    });
    await t.mutation(internal.packages.repairPackageIdentityInternal, {
      actorUserId: admin,
      name: "@canonical/voice-provider",
      nextRuntimeId: "voice",
      reason: "Correct registry identity",
    });
    expect(await t.run(async (ctx) => ctx.db.get(repaired.packageId))).toMatchObject({
      runtimeId: "voice",
    });
    await publish(t, admin, canonical, "@canonical/other-provider", { runtimeId: "other" });
    await expect(
      t.mutation(internal.packages.repairPackageIdentityInternal, {
        actorUserId: admin,
        name: "@canonical/other-provider",
        nextRuntimeId: "voice",
        reason: "Conflicting repair",
      }),
    ).rejects.toThrow("already claimed");
  });

  it.each(["first release", "older release"])(
    "rechecks a staged %s after the package identity was administratively changed",
    async (kind) => {
      const { t, admin, community } = await fixture();
      if (kind === "older release") {
        await publish(t, admin, community, "@community/staged", { version: "2.0.0" });
      }
      const staged = await publish(t, admin, community, "@community/staged", { pending: true });
      await t.mutation(internal.packages.repairPackageIdentityInternal, {
        actorUserId: admin,
        name: "@community/staged",
        nextRuntimeId: "repaired",
        reason: "Move existing claim",
      });
      await publish(t, admin, community, "@community/other");
      await expect(
        t.mutation(internal.packages.publishPendingReleaseInternal, {
          releaseId: staged.releaseId,
        }),
      ).rejects.toThrow("already claimed");
      expect(await t.run(async (ctx) => ctx.db.get(staged.releaseId))).toMatchObject({
        publicationStatus: "pending",
      });
    },
  );
});
