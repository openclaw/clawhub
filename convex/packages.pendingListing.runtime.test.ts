/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const listing = api.packages.getPendingListingForViewer;

async function fixture(
  family: "code-plugin" | "bundle-plugin" | "claw" = "code-plugin",
  scoped = true,
  org = false,
) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const maker = await t.run((ctx) =>
    ctx.db.insert("users", { handle: "maker", displayName: "Maker" }),
  );
  const viewer = t.withIdentity({ subject: maker });
  const handle = org ? "workshop" : "maker";
  const ownerPublisherId = org
    ? await t.run(async (ctx) => {
        const id = await ctx.db.insert("publishers", {
          kind: "org",
          handle,
          displayName: "Workshop",
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("publisherMembers", {
          publisherId: id,
          userId: maker,
          role: "owner",
          createdAt: 1,
          updatedAt: 1,
        });
        return id;
      })
    : undefined;
  const name = scoped ? "@" + handle + "/brief" : "brief";
  const args = {
    owner: handle,
    slug: "brief",
    routeKind: family === "claw" ? ("template" as const) : ("plugin" as const),
  };
  const stage = async (
    version: string,
    tags = ["latest"],
    stagedPublisherId = ownerPublisherId,
  ) => {
    const { packageId, releaseId } = await t.mutation(internal.packages.insertReleaseInternal, {
      ownerUserId: maker,
      ownerPublisherId: stagedPublisherId,
      actorUserId: maker,
      name,
      family,
      displayName: "Brief " + version,
      summary: "Summary " + version,
      version,
      publicationStatus: "pending",
      tags,
      files: [],
      sha256hash: "b".repeat(64),
      changelog: "private changelog",
      sourceRepo: "https://example.com/private",
      integritySha256: "a".repeat(64),
    });
    const { attemptId } = await t.mutation(
      internal.publishAttempts.createPackagePublishAttemptInternal,
      {
        userId: maker,
        ownerUserId: maker,
        ownerPublisherId: stagedPublisherId,
        name,
        displayName: "Brief " + version,
        version,
        packageId,
        packageReleaseId: releaseId,
        idempotencyKey: name + version,
        artifactFingerprint: "a".repeat(64),
        files: [],
        packageFollowup: {},
      },
    );
    return { packageId, releaseId, attemptId };
  };
  return { t, maker, viewer, args, name, stage, ownerPublisherId };
}

it("shows only shell metadata for the publisher's first staged plugin", async () => {
  const { t, viewer, args, stage, name } = await fixture();
  await stage("1.0.0");
  expect(await viewer.query(listing, args)).toEqual({
    name,
    displayName: "Brief 1.0.0",
    summary: "Summary 1.0.0",
    version: "1.0.0",
    owner: { handle: "maker", displayName: "Maker", image: null },
  });
  expect(await t.query(listing, args)).toBeNull();
  expect(await viewer.query(api.packages.getByName, { name })).toBeNull();
});

it("does not substitute a local dev impersonation for an authenticated viewer", async () => {
  const { t, maker, args, stage } = await fixture("code-plugin", false);
  await stage("1.0.0");
  await t.run((ctx) => ctx.db.patch(maker, { handle: "local" }));
  vi.stubEnv("CONVEX_DEPLOYMENT", "local:listing-test");
  vi.stubEnv("CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE", "local");
  try {
    expect(await t.query(listing, { ...args, owner: "local" })).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each(["code-plugin", "bundle-plugin", "claw"] as const)(
  "resolves unscoped %s only at its actual publisher and route family",
  async (family) => {
    const { viewer, args, stage } = await fixture(family, false);
    await stage("1.0.0");
    expect(await viewer.query(listing, args)).toMatchObject({ name: "brief", version: "1.0.0" });
    for (const invalid of [
      { owner: "other" },
      { owner: "maker/other" },
      { slug: "@maker/brief" },
      { routeKind: family === "claw" ? ("plugin" as const) : ("template" as const) },
    ]) {
      expect(await viewer.query(listing, { ...args, ...invalid })).toBeNull();
    }
  },
);

it("respects a live exact scoped name and ignores its tombstone when resolving an unscoped Template", async () => {
  const { t, viewer, args, stage } = await fixture("claw", false);
  const { packageId } = await stage("1.0.0");
  const scoped = await t.run(async (ctx) => {
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("missing fixture");
    return ctx.db.insert("packages", {
      name: "@maker/brief",
      normalizedName: "@maker/brief",
      displayName: "Exact name",
      family: "claw",
      channel: "community",
      isOfficial: false,
      ownerUserId: pkg.ownerUserId,
      tags: {},
      stats: pkg.stats,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  expect(await viewer.query(listing, args)).toBeNull();
  await t.run((ctx) => ctx.db.patch(scoped, { softDeletedAt: 1 }));
  expect(await viewer.query(listing, args)).toMatchObject({ name: "brief" });
});

it("requires current org publishing authority or active platform staff, not upload attribution", async () => {
  const { t, maker, args, stage, ownerPublisherId } = await fixture("claw", false, true);
  await stage("1.0.0");
  const staff = await t.run(async (ctx) => {
    const outsider = await ctx.db.insert("users", { handle: "outsider", role: "user" });
    const moderator = await ctx.db.insert("users", { handle: "mod", role: "moderator" });
    const admin = await ctx.db.insert("users", { handle: "admin", role: "admin" });
    const member = await ctx.db.insert("users", { handle: "member", role: "user" });
    await ctx.db.insert("publisherMembers", {
      userId: member,
      publisherId: ownerPublisherId!,
      role: "publisher",
      createdAt: 1,
      updatedAt: 1,
    });
    // Simulate the original uploader leaving the org.
    const membership = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (q) =>
        q.eq("publisherId", ownerPublisherId!).eq("userId", maker),
      )
      .unique();
    await ctx.db.delete(membership!._id);
    return { outsider, moderator, admin, member };
  });
  for (const subject of [staff.moderator, staff.admin, staff.member]) {
    expect(await t.withIdentity({ subject }).query(listing, args)).toMatchObject({
      owner: { handle: "workshop", displayName: "Workshop" },
    });
  }
  for (const subject of [staff.outsider, maker])
    expect(await t.withIdentity({ subject }).query(listing, args)).toBeNull();
  expect(
    await t.withIdentity({ subject: staff.admin }).query(listing, { ...args, owner: "maker" }),
  ).toBeNull();
  await t.run((ctx) => ctx.db.patch(staff.moderator, { deactivatedAt: 1 }));
  expect(await t.withIdentity({ subject: staff.moderator }).query(listing, args)).toBeNull();
  await t.run((ctx) => ctx.db.patch(ownerPublisherId!, { deletedAt: 1 }));
  expect(await t.withIdentity({ subject: staff.admin }).query(listing, args)).toBeNull();
});

it.each(["code-plugin", "bundle-plugin", "claw"] as const)(
  "shows a newly staged %s update without replacing the public release",
  async (family) => {
    const { t, viewer, args, name, stage } = await fixture(family);
    const first = await stage("1.0.0");
    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: first.releaseId,
    });
    await stage("1.1.0");
    const next = await stage("2.0.0");
    expect(await viewer.query(listing, args)).toMatchObject({
      version: "2.0.0",
      displayName: "Brief 2.0.0",
      summary: "Summary 2.0.0",
    });
    expect(await t.query(api.packages.getByName, { name })).toMatchObject({
      latestRelease: { version: "1.0.0" },
    });
    expect(
      await viewer.query(api.packages.getVersionByName, { name, version: "2.0.0" }),
    ).toBeNull();
    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: next.releaseId,
    });
    expect(await viewer.query(listing, args)).toBeNull();
    if (family !== "bundle-plugin") {
      await stage("1.5.0"); // A later-submitted semver backport is not the incoming latest.
      expect(await viewer.query(listing, args)).toBeNull();
    }
  },
);

it("accepts only the current personal publisher on a staged update to a legacy user-owned package", async () => {
  const { t, maker, viewer, args, stage } = await fixture("claw", false);
  const first = await stage("1.0.0");
  await t.mutation(internal.packages.publishPendingReleaseInternal, { releaseId: first.releaseId });
  const ids = await t.run(async (ctx) => {
    const mod = await ctx.db.insert("users", { role: "moderator" });
    const outsider = await ctx.db.insert("users", { handle: "outsider" });
    const fields = { displayName: "Maker", createdAt: 1, updatedAt: 1 };
    const personal = await ctx.db.insert("publishers", {
      ...fields,
      handle: "maker",
      kind: "user",
      linkedUserId: maker,
    });
    await ctx.db.patch(maker, { personalPublisherId: personal });
    const foreign = await ctx.db.insert("publishers", {
      ...fields,
      handle: "other",
      kind: "user",
      linkedUserId: outsider,
    });
    const org = await ctx.db.insert("publishers", { ...fields, handle: "org", kind: "org" });
    return { mod, outsider, personal, foreign, org };
  });
  const next = await stage("2.0.0", ["latest"], ids.personal);
  expect((await t.run((ctx) => ctx.db.get(next.packageId)))?.ownerPublisherId).toBeUndefined();
  const viewers = [viewer, t.withIdentity({ subject: ids.mod })];
  for (const authorized of viewers) {
    expect(await authorized.query(listing, args)).toMatchObject({
      version: "2.0.0",
      owner: { handle: "maker" },
    });
  }
  expect(await t.withIdentity({ subject: ids.outsider }).query(listing, args)).toBeNull();
  await t.run((ctx) => ctx.db.patch(next.attemptId, { ownerUserId: ids.outsider }));
  for (const authorized of viewers) expect(await authorized.query(listing, args)).toBeNull();
  await t.run((ctx) => ctx.db.patch(next.attemptId, { ownerUserId: maker }));
  for (const ownerPublisherId of [ids.foreign, ids.org]) {
    await t.run((ctx) => ctx.db.patch(next.attemptId, { ownerPublisherId }));
    for (const authorized of viewers) expect(await authorized.query(listing, args)).toBeNull();
  }
  // A deactivated row can still supply a legacy display fallback, but not publish authority.
  await t.run(async (ctx) => {
    await ctx.db.patch(next.attemptId, { ownerPublisherId: ids.personal });
    await ctx.db.patch(ids.personal, { deactivatedAt: 1 });
  });
  for (const authorized of viewers) expect(await authorized.query(listing, args)).toBeNull();
});

it("uses the active linked personal publisher rather than stale legacy attribution", async () => {
  const { t, maker, viewer, args, stage } = await fixture("code-plugin", false);
  const { packageId, attemptId } = await stage("1.0.0");
  const users = await t.run(async (ctx) => {
    const linked = await ctx.db.insert("users", { handle: "linked-user" });
    const mod = await ctx.db.insert("users", { role: "moderator" });
    const publisher = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "publisher-handle",
      displayName: "Published By",
      linkedUserId: linked,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(packageId, { ownerUserId: maker, ownerPublisherId: publisher });
    await ctx.db.patch(attemptId, { ownerUserId: linked, ownerPublisherId: publisher });
    return { linked, mod };
  });
  const route = { ...args, owner: "publisher-handle" };
  expect(await viewer.query(listing, route)).toBeNull();
  expect(await t.withIdentity({ subject: users.linked }).query(listing, route)).toMatchObject({
    name: "brief",
    owner: { handle: "publisher-handle" },
  });
  await t.run((ctx) => ctx.db.patch(users.linked, { deletedAt: 1 }));
  expect(await t.withIdentity({ subject: users.mod }).query(listing, route)).toBeNull();
});

it("recognizes an incoming prerelease without treating its tag as a public latest pointer", async () => {
  const { t, viewer, args, stage } = await fixture();
  const first = await stage("1.0.0");
  await t.mutation(internal.packages.publishPendingReleaseInternal, { releaseId: first.releaseId });
  await stage("2.0.0-beta.1", ["beta"]);
  expect(await viewer.query(listing, args)).toMatchObject({ version: "2.0.0-beta.1" });
});

it("withholds missing, removed, malicious, private and blocked candidates instead of falling back to old pending releases", async () => {
  const { t, maker, args, viewer, stage } = await fixture();
  await stage("1.0.0");
  const { releaseId, packageId, attemptId } = await stage("2.0.0");
  const moderation = { reason: "internal", reviewerUserId: maker, updatedAt: 1 };
  for (const patch of [
    { softDeletedAt: 0 },
    { ownerDeletedAt: 0 },
    { publicationStatus: "blocked" },
    { publicationStatus: undefined },
    { publicationStatus: "published" },
    { publishAttemptId: undefined },
    { manualModeration: { ...moderation, state: "revoked" } },
    { manualModeration: { ...moderation, state: "quarantined" } },
    { verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "malicious" } },
    { pendingPublication: { family: "code-plugin", channel: "private" } },
  ] satisfies Array<Partial<Doc<"packageReleases">>>) {
    const before = await t.run((ctx) => ctx.db.get(releaseId));
    await t.run((ctx) => ctx.db.patch(releaseId, patch));
    expect(await viewer.query(listing, args), JSON.stringify(patch)).toBeNull();
    const key = Object.keys(patch)[0] as keyof typeof patch;
    await t.run((ctx) => ctx.db.patch(releaseId, { [key]: before![key] }));
  }
  for (const status of ["blocked", "failed", "expired", "finalized"] as const) {
    await t.run((ctx) => ctx.db.patch(attemptId, { status }));
    expect(await viewer.query(listing, args)).toBeNull();
  }
  await t.run((ctx) => ctx.db.patch(attemptId, { status: "pending_checks", version: "wrong" }));
  expect(await viewer.query(listing, args)).toBeNull();
  await t.run((ctx) => ctx.db.patch(attemptId, { version: "2.0.0" }));
  expect(await viewer.query(listing, args)).toMatchObject({ version: "2.0.0" });
  await t.run((ctx) => ctx.db.patch(packageId, { scanStatus: "malicious" }));
  expect(await viewer.query(listing, args)).toBeNull();
  await t.run((ctx) => ctx.db.patch(packageId, { scanStatus: "pending", softDeletedAt: 0 }));
  expect(await viewer.query(listing, args)).toBeNull();
});
