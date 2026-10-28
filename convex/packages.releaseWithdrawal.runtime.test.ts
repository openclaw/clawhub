/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const name = "withdrawal-fixture";
const replacementError =
  "Publish a replacement release before deleting the current latest release.";

async function fixture() {
  const t = convexTest(schema, modules);
  const actor = await t.run((ctx) =>
    ctx.db.insert("users", { handle: "withdrawal-owner", role: "user" }),
  );
  const insert = (version: string, publicationStatus: "pending" | "published") =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: actor,
      ownerUserId: actor,
      name,
      displayName: "Withdrawal fixture",
      family: "code-plugin",
      version,
      publicationStatus,
      verification:
        publicationStatus === "published"
          ? { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" }
          : undefined,
      changelog: "Fixture release",
      tags: ["latest"],
      summary: "Withdrawal regression fixture",
      files: [],
      integritySha256: version.padEnd(64, "0"),
      sha256hash: version.padEnd(64, "0"),
    });
  const older = await insert("1.2.5", "pending");
  const pending = await insert("1.2.6", "pending");
  const owner = t.withIdentity({ subject: actor });
  const read = () =>
    t.run(async (ctx) => ({
      pkg: await ctx.db.get(older.packageId),
      older: await ctx.db.get(older.releaseId),
      pending: await ctx.db.get(pending.releaseId),
      withdrawals: await ctx.db
        .query("auditLogs")
        .filter((q) => q.eq(q.field("action"), "package.release.delete"))
        .collect(),
    }));
  return { t, actor, owner, older, pending, insert, read };
}

it.each(["pending", "blocked"] as const)(
  "withdraws %s latest tags after restore and a different published latest",
  async (publicationStatus) => {
    const f = await fixture();
    const staged = await f.read();
    // Staging stores requested tags without ever assigning the package's public latest pointers.
    expect(staged.pkg?.latestReleaseId).toBeUndefined();
    expect(staged.pkg?.tags).toEqual({});
    for (const release of [staged.older, staged.pending]) {
      expect(release).toMatchObject({ publicationStatus: "pending", distTags: ["latest"] });
    }

    await f.t.mutation(internal.packages.softDeletePackageInternal, { userId: f.actor, name });
    await f.t.mutation(internal.packages.restorePackageInternal, { userId: f.actor, name });
    const latest = await f.insert("1.2.8", "published");
    if (publicationStatus === "blocked") {
      await f.t.run(async (ctx) => {
        await ctx.db.patch(f.older.releaseId, { publicationStatus });
        await ctx.db.patch(f.pending.releaseId, { publicationStatus });
      });
    }
    const latestBefore = await f.t.run((ctx) => ctx.db.get(latest.releaseId));
    const before = await f.read();
    expect(before.pkg).toMatchObject({
      latestReleaseId: latest.releaseId,
      tags: { latest: latest.releaseId },
      latestVersionSummary: { version: "1.2.8" },
    });
    for (const release of [before.older, before.pending]) {
      expect(release).toMatchObject({ publicationStatus, distTags: ["latest"] });
      expect(release?.softDeletedAt).toBeUndefined();
    }

    for (const version of ["1.2.5", "1.2.6"]) {
      await expect(
        f.owner.mutation(api.packages.deleteOwnedRelease, { name, version }),
      ).resolves.toMatchObject({
        ok: true,
      });
    }
    const after = await f.read();
    for (const release of [after.older, after.pending]) {
      expect(release).toMatchObject({
        publicationStatus,
        softDeletedAt: expect.any(Number),
        ownerDeletedAt: expect.any(Number),
        ownerDeletedBy: f.actor,
      });
      expect(release?.softDeletedAt).toBe(release?.ownerDeletedAt);
    }
    expect(after.pkg).toEqual(before.pkg);
    expect(await f.t.run((ctx) => ctx.db.get(latest.releaseId))).toEqual(latestBefore);
    expect(after.withdrawals.map((entry) => entry.targetId).sort()).toEqual(
      [f.older.releaseId, f.pending.releaseId].sort(),
    );
  },
);

it.each(["latestReleaseId", "tags.latest", "latestVersionSummary"] as const)(
  "still refuses an unpublished release identified by %s",
  async (pointer) => {
    const f = await fixture();
    await f.insert("1.2.8", "published");
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.older.packageId, {
        ...(pointer === "latestReleaseId" ? { latestReleaseId: f.older.releaseId } : {}),
        ...(pointer === "tags.latest" ? { tags: { latest: f.older.releaseId } } : {}),
        ...(pointer === "latestVersionSummary"
          ? { latestVersionSummary: { version: "1.2.5", createdAt: 1, changelog: "Fixture" } }
          : {}),
      });
    });
    const before = await f.read();
    await expect(
      f.owner.mutation(api.packages.deleteOwnedRelease, { name, version: "1.2.5" }),
    ).rejects.toThrow(replacementError);
    expect(await f.read()).toEqual(before);
  },
);

it("still refuses the real latest release", async () => {
  const f = await fixture();
  const latest = await f.insert("1.2.8", "published");
  const before = await f.read();
  const latestBefore = await f.t.run((ctx) => ctx.db.get(latest.releaseId));
  await expect(
    f.owner.mutation(api.packages.deleteOwnedRelease, { name, version: "1.2.8" }),
  ).rejects.toThrow(replacementError);
  expect(await f.read()).toEqual(before);
  expect(await f.t.run((ctx) => ctx.db.get(latest.releaseId))).toEqual(latestBefore);
});

it("still requires an available survivor when an unpublished latest tag is ignored", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.pending.releaseId, { softDeletedAt: 1 }));
  const before = await f.read();
  await expect(
    f.owner.mutation(api.packages.deleteOwnedRelease, { name, version: "1.2.5" }),
  ).rejects.toThrow(replacementError);
  expect(await f.read()).toEqual(before);
});

it.each(["published", undefined] as const)(
  "preserves the release-tag safety fallback for publicationStatus=%s",
  async (publicationStatus) => {
    const f = await fixture();
    // Legacy rows without publicationStatus are published, not abandoned candidates.
    await f.t.run((ctx) =>
      ctx.db.patch(f.older.releaseId, { publicationStatus, pendingPublication: undefined }),
    );
    const before = await f.read();
    await expect(
      f.owner.mutation(api.packages.deleteOwnedRelease, { name, version: "1.2.5" }),
    ).rejects.toThrow(replacementError);
    expect(await f.read()).toEqual(before);
  },
);

it("does not let another user withdraw an unpublished release", async () => {
  const f = await fixture();
  await f.insert("1.2.8", "published");
  const outsider = await f.t.run((ctx) => ctx.db.insert("users", { role: "user" }));
  const before = await f.read();
  await expect(
    f.t.withIdentity({ subject: outsider }).mutation(api.packages.deleteOwnedRelease, {
      name,
      version: "1.2.5",
    }),
  ).rejects.toThrow("Forbidden");
  expect(await f.read()).toEqual(before);
});
