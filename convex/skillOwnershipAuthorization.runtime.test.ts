/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupOrganizationSkill() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const creatorId = await ctx.db.insert("users", { handle: "creator" });
    const recipientId = await ctx.db.insert("users", { handle: "recipient" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "organization",
      displayName: "Organization",
      createdAt: 1,
      updatedAt: 1,
    });
    const membershipId = await ctx.db.insert("publisherMembers", {
      publisherId,
      userId: creatorId,
      role: "admin",
      createdAt: 1,
      updatedAt: 1,
    });
    const skillId = await ctx.db.insert("skills", {
      slug: "organization-skill",
      displayName: "Organization skill",
      ownerUserId: creatorId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    return { creatorId, recipientId, publisherId, membershipId, skillId };
  });
  return { t, ...ids };
}

it.each(["removed", "downgraded"])(
  "rejects a transfer requested by a %s organization publisher",
  async (change) => {
    const { t, creatorId, membershipId, skillId } = await setupOrganizationSkill();
    await t.run(async (ctx) => {
      if (change === "removed") await ctx.db.delete(membershipId);
      else await ctx.db.patch(membershipId, { role: "publisher" });
    });
    await expect(
      t.mutation(internal.skillTransfers.requestTransferInternal, {
        actorUserId: creatorId,
        skillId,
        toUserHandle: "recipient",
      }),
    ).rejects.toThrow("Forbidden");
  },
);

it("allows current organization admins to complete a transfer", async () => {
  const { t, creatorId, recipientId, skillId } = await setupOrganizationSkill();
  const request = await t.mutation(internal.skillTransfers.requestTransferInternal, {
    actorUserId: creatorId,
    skillId,
    toUserHandle: "recipient",
  });
  await expect(
    t.mutation(internal.skillTransfers.acceptTransferInternal, {
      actorUserId: recipientId,
      transferId: request.transferId,
    }),
  ).resolves.toMatchObject({ ok: true, skillSlug: "organization-skill" });
});

it("allows current organization admins to delete and restore their skill", async () => {
  const { t, creatorId } = await setupOrganizationSkill();
  for (const deleted of [true, false]) {
    await expect(
      t.mutation(internal.skills.setSkillSoftDeletedInternal, {
        userId: creatorId,
        slug: "organization-skill",
        ownerHandle: "organization",
        deleted,
      }),
    ).resolves.toMatchObject({ ok: true });
  }
});

it.each(["removed", "downgraded"])(
  "cancels a pending transfer after its requester is %s",
  async (change) => {
    const { t, creatorId, recipientId, membershipId, skillId, publisherId } =
      await setupOrganizationSkill();
    const request = await t.mutation(internal.skillTransfers.requestTransferInternal, {
      actorUserId: creatorId,
      skillId,
      toUserHandle: "recipient",
    });
    await t.run(async (ctx) => {
      if (change === "removed") await ctx.db.delete(membershipId);
      else await ctx.db.patch(membershipId, { role: "publisher" });
    });
    await expect(
      t.mutation(internal.skillTransfers.acceptTransferInternal, {
        actorUserId: recipientId,
        transferId: request.transferId,
      }),
    ).resolves.toEqual({ ok: false, error: "Transfer is no longer valid" });
    const state = await t.run(async (ctx) => ({
      skill: await ctx.db.get(skillId),
      transfer: await ctx.db.get(request.transferId),
    }));
    expect(state.skill?.ownerPublisherId).toBe(publisherId);
    expect(state.transfer?.status).toBe("cancelled");
  },
);

it.each([true, false])(
  "rejects a former publisher's lifecycle change (deleted=%s)",
  async (deleted) => {
    const { t, creatorId, membershipId, skillId } = await setupOrganizationSkill();
    await t.run(async (ctx) => {
      await ctx.db.delete(membershipId);
      if (!deleted)
        await ctx.db.patch(skillId, {
          softDeletedAt: 2,
          moderationStatus: "hidden",
          hiddenBy: creatorId,
        });
    });
    await expect(
      t.mutation(internal.skills.setSkillSoftDeletedInternal, {
        userId: creatorId,
        slug: "organization-skill",
        ownerHandle: "organization",
        deleted,
      }),
    ).rejects.toThrow("Forbidden");
  },
);
