/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it("preserves publisher-scoped slug uniqueness when accepting a transfer", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const sourceUserId = await ctx.db.insert("users", {
      handle: "source",
      displayName: "Source",
    });
    const sourcePublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "source",
      displayName: "Source",
      linkedUserId: sourceUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(sourceUserId, { personalPublisherId: sourcePublisherId });

    const destinationUserId = await ctx.db.insert("users", {
      handle: "destination",
      displayName: "Destination",
    });
    const destinationPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "destination",
      displayName: "Destination",
      linkedUserId: destinationUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(destinationUserId, { personalPublisherId: destinationPublisherId });

    const transferredSkillId = await ctx.db.insert("skills", {
      slug: "same-slug",
      displayName: "Transferred lineage",
      ownerUserId: sourceUserId,
      ownerPublisherId: sourcePublisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("skills", {
      slug: "same-slug",
      displayName: "Existing destination lineage",
      ownerUserId: destinationUserId,
      ownerPublisherId: destinationPublisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 2,
      updatedAt: 2,
    });
    const transferId = await ctx.db.insert("skillOwnershipTransfers", {
      skillId: transferredSkillId,
      fromUserId: sourceUserId,
      toUserId: destinationUserId,
      status: "pending",
      requestedAt: 3,
      expiresAt: Date.now() + 60_000,
    });
    return { destinationPublisherId, destinationUserId, transferId, transferredSkillId };
  });

  const result = await t.mutation(internal.skillTransfers.acceptTransferInternal, {
    actorUserId: ids.destinationUserId,
    transferId: ids.transferId,
  });
  expect(result).toMatchObject({ ok: false });

  const destinationMatches = await t.run(async (ctx) =>
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_slug", (q) =>
        q.eq("ownerPublisherId", ids.destinationPublisherId).eq("slug", "same-slug"),
      )
      .collect(),
  );
  expect(destinationMatches).toHaveLength(1);
  const unchanged = await t.run(async (ctx) => ({
    skill: await ctx.db.get(ids.transferredSkillId),
    transfer: await ctx.db.get(ids.transferId),
  }));
  expect(unchanged.skill?.ownerPublisherId).not.toBe(ids.destinationPublisherId);
  expect(unchanged.transfer?.status).toBe("pending");
});

it("rejects a transfer when one of its redirects collides at the destination", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const sourceUserId = await ctx.db.insert("users", { handle: "source" });
    const sourcePublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "source",
      displayName: "Source",
      linkedUserId: sourceUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(sourceUserId, { personalPublisherId: sourcePublisherId });
    const destinationUserId = await ctx.db.insert("users", { handle: "destination" });
    const destinationPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "destination",
      displayName: "Destination",
      linkedUserId: destinationUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(destinationUserId, { personalPublisherId: destinationPublisherId });
    const transferredSkillId = await ctx.db.insert("skills", {
      slug: "new-name",
      displayName: "Transferred",
      ownerUserId: sourceUserId,
      ownerPublisherId: sourcePublisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("skillSlugAliases", {
      slug: "old-name",
      skillId: transferredSkillId,
      ownerUserId: sourceUserId,
      ownerPublisherId: sourcePublisherId,
      createdAt: 1,
      updatedAt: 1,
    });
    const destinationSkillId = await ctx.db.insert("skills", {
      slug: "destination-skill",
      displayName: "Destination",
      ownerUserId: destinationUserId,
      ownerPublisherId: destinationPublisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("skillSlugAliases", {
      slug: "old-name",
      skillId: destinationSkillId,
      ownerUserId: destinationUserId,
      ownerPublisherId: destinationPublisherId,
      createdAt: 1,
      updatedAt: 1,
    });
    const transferId = await ctx.db.insert("skillOwnershipTransfers", {
      skillId: transferredSkillId,
      fromUserId: sourceUserId,
      toUserId: destinationUserId,
      status: "pending",
      requestedAt: 3,
      expiresAt: Date.now() + 60_000,
    });
    return { destinationUserId, transferId, transferredSkillId, sourcePublisherId };
  });

  const result = await t.mutation(internal.skillTransfers.acceptTransferInternal, {
    actorUserId: ids.destinationUserId,
    transferId: ids.transferId,
  });
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("redirect") });
  const unchanged = await t.run(async (ctx) => ({
    skill: await ctx.db.get(ids.transferredSkillId),
    transfer: await ctx.db.get(ids.transferId),
  }));
  expect(unchanged.skill?.ownerPublisherId).toBe(ids.sourcePublisherId);
  expect(unchanged.transfer?.status).toBe("pending");
});
