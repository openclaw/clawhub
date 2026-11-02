/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const name = "@publisher/metadata-fixture";

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ownerUserId = await t.run(async (ctx) =>
    ctx.db.insert("users", { role: "admin", handle: "publisher" }),
  );
  const stage = (version: string, displayName: string, sourceRepo?: string) =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: ownerUserId,
      ownerUserId,
      name,
      displayName,
      sourceRepo,
      family: "code-plugin",
      runtimeId: "metadata-fixture",
      version,
      publicationStatus: "pending",
      changelog: "Release " + version,
      tags: ["latest"],
      summary: "Summary " + version,
      files: [],
      integritySha256: "a".repeat(64),
      sha256hash: "b".repeat(64),
    });
  const owner = t.withIdentity({ subject: ownerUserId });
  const readMetadata = async () => (await owner.query(api.packages.list, {}))[0];
  return { t, stage, readMetadata };
}

it.each(["https://github.com/publisher/original", undefined])(
  "preserves latest metadata when an older release with sourceRepo=%s finalizes late",
  async (sourceRepo) => {
    const { t, stage, readMetadata } = await fixture();
    const older = await stage("1.0.0", "Original name", sourceRepo);
    const newer = await stage("2.0.0", "Current name", "https://github.com/publisher/current");
    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: newer.releaseId,
    });
    const before = await readMetadata();
    expect(before).toMatchObject({
      displayName: "Current name",
      sourceRepo: "https://github.com/publisher/current",
    });

    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: older.releaseId,
    });
    const after = await t.query(api.packages.getByName, { name });
    expect(after?.latestRelease?._id).toBe(newer.releaseId);
    expect(after?.package.tags.latest).toBe(newer.releaseId);
    const publishedOlder = await t.run(async (ctx) => ctx.db.get(older.releaseId));
    expect(publishedOlder).toMatchObject({ publicationStatus: "published", distTags: [] });
    expect(publishedOlder?.sourceRepo).toBe(sourceRepo);
    expect(await readMetadata()).toMatchObject({
      displayName: before?.displayName,
      sourceRepo: before?.sourceRepo,
    });
    expect(after?.package.displayName).toBe(before?.displayName);
  },
);

it("keeps channel and official status when an older release finalizes late", async () => {
  const { t, stage } = await fixture();
  const older = await stage("1.0.0", "Original name");
  const newer = await stage("2.0.0", "Current name");
  await t.mutation(internal.packages.publishPendingReleaseInternal, {
    releaseId: newer.releaseId,
  });
  const packageId = await t.run(async (ctx) => (await ctx.db.get(newer.releaseId))!.packageId);
  await t.run(async (ctx) => {
    await ctx.db.patch(packageId, { channel: "official", isOfficial: true });
  });

  await t.mutation(internal.packages.publishPendingReleaseInternal, {
    releaseId: older.releaseId,
  });

  expect(await t.run(async (ctx) => ctx.db.get(packageId))).toMatchObject({
    channel: "official",
    isOfficial: true,
    latestReleaseId: newer.releaseId,
  });
  expect(await t.run(async (ctx) => ctx.db.get(older.releaseId))).toMatchObject({
    publicationStatus: "published",
  });
});

it("applies the staged channel when that release becomes latest", async () => {
  const { t, stage } = await fixture();
  const first = await stage("1.0.0", "First name");
  await t.run(async (ctx) => {
    const release = await ctx.db.get(first.releaseId);
    const pending = release?.pendingPublication;
    if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
      throw new Error("missing pending publication");
    }
    await ctx.db.patch(first.releaseId, {
      pendingPublication: { ...pending, channel: "private", isOfficial: false },
    });
  });

  await t.mutation(internal.packages.publishPendingReleaseInternal, {
    releaseId: first.releaseId,
  });

  const packageId = await t.run(async (ctx) => (await ctx.db.get(first.releaseId))!.packageId);
  expect(await t.run(async (ctx) => ctx.db.get(packageId))).toMatchObject({
    channel: "private",
    isOfficial: false,
    latestReleaseId: first.releaseId,
  });
});

it("sets the first published metadata and updates it when a newer release becomes latest", async () => {
  const { t, stage, readMetadata } = await fixture();
  // The package row starts with this pending release, not the first one finalized.
  await stage("0.9.0", "Staged name", "https://github.com/publisher/staged");
  const first = await stage("1.0.0", "First name", "https://github.com/publisher/first");
  await t.mutation(internal.packages.publishPendingReleaseInternal, { releaseId: first.releaseId });
  expect(await readMetadata()).toMatchObject({
    displayName: "First name",
    sourceRepo: "https://github.com/publisher/first",
    latestVersion: "1.0.0",
  });

  const next = await stage("2.0.0", "Next name", "https://github.com/publisher/next");
  await t.mutation(internal.packages.publishPendingReleaseInternal, { releaseId: next.releaseId });
  expect(await readMetadata()).toMatchObject({
    displayName: "Next name",
    sourceRepo: "https://github.com/publisher/next",
    latestVersion: "2.0.0",
  });
});
