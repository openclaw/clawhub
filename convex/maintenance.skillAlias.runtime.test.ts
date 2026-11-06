/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const actorUserId = await ctx.db.insert("users", { role: "admin" });
    const ownerUserId = await ctx.db.insert("users", { handle: "alias-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "alias-owner",
      displayName: "Owner",
      linkedUserId: ownerUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(ownerUserId, { personalPublisherId: publisherId });
    const base = {
      displayName: "Alias fixture",
      ownerUserId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      stats: { comments: 0, downloads: 4, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    };
    const targetSkillId = await ctx.db.insert("skills", {
      ...base,
      slug: "live-target",
      moderationStatus: "active",
    });
    const sourceSkillId = await ctx.db.insert("skills", {
      ...base,
      slug: "unwanted-alias",
      canonicalSkillId: targetSkillId,
      forkOf: { skillId: targetSkillId, kind: "duplicate", at: 10 },
      moderationStatus: "hidden",
      moderationReason: "owner.merged",
      softDeletedAt: 10,
    });
    const bytes = new TextEncoder().encode("# Original retained artifact\n");
    const storageId = await ctx.storage.store(new Blob([bytes]));
    const files = [{ path: "SKILL.md", size: bytes.length, storageId, sha256: "a".repeat(64) }];
    const sourceVersionId = await ctx.db.insert("skillVersions", {
      skillId: sourceSkillId,
      version: "0.1.0",
      publicationStatus: "pending",
      changelog: "Retain hidden history",
      files,
      parsed: { frontmatter: {} },
      createdBy: ownerUserId,
      createdAt: 1,
    });
    const targetVersionId = await ctx.db.insert("skillVersions", {
      skillId: targetSkillId,
      version: "0.5.3",
      publicationStatus: "published",
      changelog: "Live target",
      files,
      parsed: { frontmatter: {} },
      createdBy: ownerUserId,
      createdAt: 1,
    });
    await ctx.db.patch(targetSkillId, { latestVersionId: targetVersionId });
    const aliasId = await ctx.db.insert("skillSlugAliases", {
      slug: "unwanted-alias",
      skillId: targetSkillId,
      ownerUserId,
      ownerPublisherId: publisherId,
      createdAt: 10,
      updatedAt: 10,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: ownerUserId,
      action: "skill.merge",
      targetType: "skill",
      targetId: sourceSkillId,
      createdAt: 10,
      metadata: { from: "unwanted-alias", to: "live-target", targetSkillId },
    });
    return {
      actorUserId,
      ownerUserId,
      publisherId,
      sourceSkillId,
      targetSkillId,
      sourceVersionId,
      targetVersionId,
      storageId,
      aliasId,
    };
  });
  const args = {
    aliasId: ids.aliasId,
    sourceSkillId: ids.sourceSkillId,
    targetSkillId: ids.targetSkillId,
    expectedSlug: "unwanted-alias",
    expectedOwnerUserId: ids.ownerUserId,
    expectedOwnerPublisherId: ids.publisherId,
    expectedUpdatedAt: 10,
    actorUserId: ids.actorUserId,
    reason: "Owner requested removal of the historical redirect",
  };
  const snapshot = () =>
    t.run(async (ctx) => ({
      source: await ctx.db.get(ids.sourceSkillId),
      target: await ctx.db.get(ids.targetSkillId),
      sourceVersion: await ctx.db.get(ids.sourceVersionId),
      targetVersion: await ctx.db.get(ids.targetVersionId),
      alias: await ctx.db.get(ids.aliasId),
      audits: await ctx.db.query("auditLogs").collect(),
      artifact: await (await ctx.storage.get(ids.storageId))?.text(),
    }));
  return { t, ids, args, snapshot };
}

describe("guarded removal of an owner-merged skill alias", () => {
  it("defaults to dry-run and changes only the exact alias with an audit on apply", async () => {
    const { t, ids, args, snapshot } = await fixture();
    const before = await snapshot();
    // This is the reported routing symptom, independent of the repair operation.
    const resolved = await t.query(api.skills.getBySlug, {
      slug: args.expectedSlug,
      ownerHandle: "alias-owner",
    });
    expect(resolved?.skill?.slug).toBe("live-target");
    expect(
      await t.mutation(internal.maintenance.removeMergedSkillSlugAliasInternal, args),
    ).toMatchObject({ eligible: true, removed: false, dryRun: true });
    expect(await snapshot()).toEqual(before);
    expect(
      await t.mutation(internal.maintenance.removeMergedSkillSlugAliasInternal, {
        ...args,
        dryRun: false,
      }),
    ).toMatchObject({ eligible: true, removed: true, dryRun: false });
    const after = await snapshot();
    expect(after.alias).toBeNull();
    for (const key of ["source", "target", "sourceVersion", "targetVersion", "artifact"] as const)
      expect(after[key]).toEqual(before[key]);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after.audits[0]).toEqual(before.audits[0]);
    expect(after.audits[1]).toMatchObject({
      actorUserId: ids.actorUserId,
      action: "maintenance.skill.alias.remove",
      targetType: "skillSlugAlias",
      targetId: ids.aliasId,
      metadata: { reason: args.reason, alias: before.alias, sourceSkillId: ids.sourceSkillId },
    });
    expect(
      await t.query(api.skills.getBySlug, { slug: args.expectedSlug, ownerHandle: "alias-owner" }),
    ).toBeNull();
    expect(
      (await t.query(api.skills.getBySlug, { slug: "live-target", ownerHandle: "alias-owner" }))
        ?.skill?.slug,
    ).toBe("live-target");
    const applied = await snapshot();
    expect(
      await t.mutation(internal.maintenance.removeMergedSkillSlugAliasInternal, {
        ...args,
        dryRun: false,
      }),
    ).toMatchObject({ eligible: false, removed: false });
    expect(await snapshot()).toEqual(applied);
  });

  it.each(["stale-time", "wrong-slug", "wrong-target", "wrong-owner", "wrong-publisher"] as const)(
    "rejects %s without changing any record",
    async (change) => {
      const { t, ids, args, snapshot } = await fixture();
      const before = await snapshot();
      const changed: FunctionArgs<typeof internal.maintenance.removeMergedSkillSlugAliasInternal> =
        {
          ...args,
          dryRun: false,
        };
      if (change === "stale-time") changed.expectedUpdatedAt--;
      if (change === "wrong-slug") changed.expectedSlug = "live-target";
      if (change === "wrong-target") changed.targetSkillId = ids.sourceSkillId;
      if (change === "wrong-owner") changed.expectedOwnerUserId = ids.actorUserId;
      if (change === "wrong-publisher") changed.expectedOwnerPublisherId = undefined;
      expect(
        await t.mutation(internal.maintenance.removeMergedSkillSlugAliasInternal, changed),
      ).toMatchObject({ eligible: false, removed: false });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    "source-restored",
    "source-repointed",
    "target-deleted",
    "target-owner-changed",
    "owner-deactivated",
    "duplicate-alias",
  ] as const)("rejects changed lineage: %s", async (change) => {
    const { t, ids, args, snapshot } = await fixture();
    await t.run(async (ctx) => {
      if (change === "source-restored")
        await ctx.db.patch(ids.sourceSkillId, { softDeletedAt: undefined });
      if (change === "source-repointed")
        await ctx.db.patch(ids.sourceSkillId, { canonicalSkillId: ids.sourceSkillId });
      if (change === "target-deleted") await ctx.db.patch(ids.targetSkillId, { softDeletedAt: 0 });
      if (change === "target-owner-changed")
        await ctx.db.patch(ids.targetSkillId, { ownerUserId: ids.actorUserId });
      if (change === "owner-deactivated") await ctx.db.patch(ids.ownerUserId, { deactivatedAt: 1 });
      if (change === "duplicate-alias")
        await ctx.db.insert("skillSlugAliases", {
          slug: args.expectedSlug,
          skillId: ids.targetSkillId,
          ownerUserId: ids.ownerUserId,
          ownerPublisherId: ids.publisherId,
          createdAt: 11,
          updatedAt: 11,
        });
    });
    const before = await snapshot();
    expect(
      await t.mutation(internal.maintenance.removeMergedSkillSlugAliasInternal, {
        ...args,
        dryRun: false,
      }),
    ).toMatchObject({ eligible: false, removed: false });
    expect(await snapshot()).toEqual(before);
  });

  it("requires a live admin actor even for dry-run", async () => {
    const { t, ids, args, snapshot } = await fixture();
    const before = await snapshot();
    await expect(
      t.mutation(internal.maintenance.removeMergedSkillSlugAliasInternal, {
        ...args,
        actorUserId: ids.ownerUserId,
      }),
    ).rejects.toThrow("Forbidden");
    expect(await snapshot()).toEqual(before);
  });
});
