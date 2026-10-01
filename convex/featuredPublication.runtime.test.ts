/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const actorUserId = await ctx.db.insert("users", { handle: "curator", role: "moderator" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "curator",
      displayName: "Curator",
      linkedUserId: actorUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(actorUserId, { personalPublisherId: publisherId });
    const items = [];
    for (let i = 0; i < 17; i++) {
      const name = `workflow-${i}`;
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: name,
        family: "code-plugin",
        ownerUserId: actorUserId,
        ownerPublisherId: publisherId,
        channel: "community",
        isOfficial: false,
        categories: ["developer-tools"],
        tags: {},
        stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: name,
        displayName: name,
        ownerUserId: actorUserId,
        ownerPublisherId: publisherId,
        tags: {},
        badges: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 1, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      items.push({ name, packageId, skillId });
    }
    return { actorUserId, items };
  });
  return { t, ...data };
}

describe("Featured publication", () => {
  it("restores over-cap legacy membership without admitting new selections", async () => {
    const { t, actorUserId, items } = await fixture();
    const newSkillId = await t.run(async (ctx) => {
      for (const [index, item] of items.entries()) {
        await ctx.db.patch(
          item.skillId,
          index % 2 === 0
            ? { badges: { highlighted: { byUserId: actorUserId, at: 1 } } }
            : { batch: "highlighted" },
        );
      }
      const original = await ctx.db.get(items[0].skillId);
      if (!original) throw new Error("Missing fixture");
      const { _id, _creationTime, ...fields } = original;
      return ctx.db.insert("skills", {
        ...fields,
        slug: "new-selection",
        badges: { official: { byUserId: actorUserId, at: 1 } },
      });
    });
    const runBackfill = () => t.action(internal.maintenance.backfillSkillBadgeTableInternal, {});
    expect((await runBackfill()).stats).toEqual({ skillsScanned: 18, recordsInserted: 18 });
    const before = await t.run((ctx) => ctx.db.query("skillBadges").collect());
    expect(before.filter((badge) => badge.kind === "highlighted")).toHaveLength(17);
    expect((await runBackfill()).stats.recordsInserted).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("skillBadges").collect())).toEqual(before);
    await expect(
      t.mutation(internal.maintenance.upsertSkillBadgeRecordInternal, {
        skillId: newSkillId,
        kind: "highlighted",
        byUserId: actorUserId,
        at: 2,
      }),
    ).rejects.toThrow(/sixteen|16/i);
    await expect(
      t
        .withIdentity({ subject: `${actorUserId}|test-session` })
        .mutation(api.skills.setBatch, { skillId: newSkillId, batch: "highlighted" }),
    ).rejects.toThrow(/sixteen|16/i);
  });

  it("limits each catalog to sixteen through both UI and admin entry points, and allows replacement", async () => {
    const { t, actorUserId, items } = await fixture();
    const staff = t.withIdentity({ subject: `${actorUserId}|test-session` });
    const clawId = await t.run(async (ctx) => {
      const original = await ctx.db.get(items[0].packageId);
      if (!original) throw new Error("Missing fixture");
      const { _id, _creationTime, ...fields } = original;
      return ctx.db.insert("packages", {
        ...fields,
        name: "companion-claw",
        normalizedName: "companion-claw",
        family: "claw",
      });
    });
    await staff.mutation(api.packages.setBatch, { packageId: clawId, batch: "highlighted" });
    for (const item of items.slice(0, 16)) {
      await staff.mutation(api.packages.setBatch, {
        packageId: item.packageId,
        batch: "highlighted",
      });
      await staff.mutation(api.skills.setBatch, { skillId: item.skillId, batch: "highlighted" });
    }
    const seventeenth = items[16];
    for (const operation of [
      () =>
        staff.mutation(api.packages.setBatch, {
          packageId: seventeenth.packageId,
          batch: "highlighted",
        }),
      () =>
        staff.mutation(api.skills.setBatch, { skillId: seventeenth.skillId, batch: "highlighted" }),
      () =>
        t.mutation(internal.packages.setPackageFeaturedForUserInternal, {
          actorUserId,
          name: seventeenth.name,
          featured: true,
        }),
      () =>
        t.mutation(internal.skills.setSkillFeaturedForUserInternal, {
          actorUserId,
          slug: seventeenth.name,
          ownerHandle: "curator",
          featured: true,
        }),
      () =>
        t.mutation(internal.maintenance.upsertSkillBadgeRecordInternal, {
          skillId: seventeenth.skillId,
          kind: "highlighted",
          byUserId: actorUserId,
          at: 2,
        }),
    ])
      await expect(operation()).rejects.toThrow(/sixteen|16/i);

    await t.mutation(internal.packages.setPackageFeaturedForUserInternal, {
      actorUserId,
      name: items[0].name,
      featured: false,
    });
    await t.mutation(internal.skills.setSkillFeaturedForUserInternal, {
      actorUserId,
      slug: items[0].name,
      ownerHandle: "curator",
      featured: false,
    });
    await t.mutation(internal.packages.setPackageFeaturedForUserInternal, {
      actorUserId,
      name: seventeenth.name,
      featured: true,
    });
    await t.mutation(internal.skills.setSkillFeaturedForUserInternal, {
      actorUserId,
      slug: seventeenth.name,
      ownerHandle: "curator",
      featured: true,
    });
    const counts = await t.run(async (ctx) => ({
      plugins: (await ctx.db.query("packageBadges").collect()).length,
      skills: (await ctx.db.query("skillBadges").collect()).length,
    }));
    // Claws use the same badge table but are a separate catalog.
    expect(counts).toEqual({ plugins: 17, skills: 16 });
  });

  it("rejects excluded install purposes through UI and admin publication while allowing removal", async () => {
    const { t, actorUserId, items } = await fixture();
    const staff = t.withIdentity({ subject: `${actorUserId}|test-session` });
    for (const [index, category] of ["channels", "models", "agent-runtimes"].entries()) {
      const item = items[index];
      await t.run((ctx) => ctx.db.patch(item.packageId, { categories: [category] }));
      await expect(
        staff.mutation(api.packages.setBatch, { packageId: item.packageId, batch: "highlighted" }),
      ).rejects.toThrow(/discovery/i);
      await expect(
        t.mutation(internal.packages.setPackageFeaturedForUserInternal, {
          actorUserId,
          name: item.name,
          featured: true,
        }),
      ).rejects.toThrow(/discovery/i);
      await t.run((ctx) =>
        ctx.db.insert("packageBadges", {
          packageId: item.packageId,
          kind: "highlighted",
          byUserId: actorUserId,
          at: 1,
        }),
      );
      await t.mutation(internal.packages.setPackageFeaturedForUserInternal, {
        actorUserId,
        name: item.name,
        featured: false,
      });
    }
    expect(await t.run((ctx) => ctx.db.query("packageBadges").collect())).toEqual([]);
  });

  it("retains badge timestamps, audit history and skill update time when keeping existing selections", async () => {
    const { t, actorUserId, items } = await fixture();
    const item = items[0];
    await t.run(async (ctx) => {
      await ctx.db.insert("packageBadges", {
        packageId: item.packageId,
        kind: "highlighted",
        byUserId: actorUserId,
        at: 1,
      });
      await ctx.db.insert("skillBadges", {
        skillId: item.skillId,
        kind: "highlighted",
        byUserId: actorUserId,
        at: 1,
      });
      await ctx.db.patch(item.skillId, {
        batch: "highlighted",
        badges: { highlighted: { byUserId: actorUserId, at: 1 } },
      });
    });
    const snapshot = () =>
      t.run(async (ctx) => ({
        plugins: await ctx.db.query("packageBadges").collect(),
        skills: await ctx.db.query("skillBadges").collect(),
        skill: await ctx.db.get(item.skillId),
        audits: await ctx.db.query("auditLogs").collect(),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
    const before = await snapshot();
    await t.mutation(internal.packages.setPackageFeaturedForUserInternal, {
      actorUserId,
      name: item.name,
      featured: true,
    });
    await t.mutation(internal.skills.setSkillFeaturedForUserInternal, {
      actorUserId,
      slug: item.name,
      ownerHandle: "curator",
      featured: true,
    });
    expect(await snapshot()).toEqual(before);
  });
});
