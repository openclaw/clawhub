/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it("reports only active duplicate slugs within the same publisher", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "owner",
      displayName: "Owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    const otherPublisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "other",
      displayName: "Other",
      createdAt: 1,
      updatedAt: 1,
    });
    const makeSkill = (ownerPublisherId: typeof publisherId, softDeletedAt?: number) =>
      ctx.db.insert("skills", {
        slug: "same-slug",
        displayName: "Skill",
        ownerUserId: userId,
        ownerPublisherId,
        tags: {},
        badges: {},
        moderationStatus: softDeletedAt ? "hidden" : "active",
        softDeletedAt,
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
    const first = await makeSkill(publisherId);
    const second = await makeSkill(publisherId);
    await makeSkill(publisherId, 1);
    await makeSkill(otherPublisherId);
    return { publisherId, first, second };
  });

  const result = await t.action(internal.maintenance.scanActivePublisherSlugDuplicatesInternal, {
    batchSize: 1,
    maxBatches: 10,
  });

  expect(result.isDone).toBe(true);
  expect(result.duplicateGroupsFound).toBe(1);
  expect(result.findings).toEqual([
    expect.objectContaining({
      ownerPublisherId: ids.publisherId,
      slug: "same-slug",
      activeSkillIds: expect.arrayContaining([ids.first, ids.second]),
    }),
  ]);
});

it("merges an explicitly selected same-publisher duplicate by id", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      handle: "owner",
      publishedSkills: 2,
    });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "owner",
      displayName: "Owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(userId, { personalPublisherId: publisherId });
    const baseSkill = {
      slug: "duplicate",
      displayName: "Duplicate",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      moderationStatus: "active" as const,
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    };
    const sourceSkillId = await ctx.db.insert("skills", baseSkill);
    const targetSkillId = await ctx.db.insert("skills", baseSkill);
    const sourceVersionId = await ctx.db.insert("skillVersions", {
      skillId: sourceSkillId,
      version: "1.0.0",
      changelog: "old",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: 1,
    });
    const targetVersionId = await ctx.db.insert("skillVersions", {
      skillId: targetSkillId,
      version: "2.0.0",
      changelog: "latest",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: 2,
    });
    await ctx.db.patch(sourceSkillId, { latestVersionId: sourceVersionId });
    await ctx.db.patch(targetSkillId, { latestVersionId: targetVersionId });
    return { sourceSkillId, targetSkillId, sourceVersionId, targetVersionId, userId };
  });

  const result = await t.mutation(internal.skills.mergeSamePublisherDuplicateSkillByIdInternal, {
    sourceSkillId: ids.sourceSkillId,
    targetSkillId: ids.targetSkillId,
    expectedSlug: "duplicate",
    expectedSourceVersionId: ids.sourceVersionId,
    expectedTargetVersionId: ids.targetVersionId,
    expectedTargetVersion: "2.0.0",
  });

  expect(result).toMatchObject({ ok: true, alreadyMerged: false });
  const state = await t.run(async (ctx) => ({
    source: await ctx.db.get(ids.sourceSkillId),
    target: await ctx.db.get(ids.targetSkillId),
    user: await ctx.db.get(ids.userId),
  }));
  expect(state.source).toMatchObject({
    softDeletedAt: expect.any(Number),
    canonicalSkillId: ids.targetSkillId,
    moderationReason: "owner.merged",
  });
  expect(state.target?.softDeletedAt).toBeUndefined();
  expect(state.user?.publishedSkills).toBe(1);
});
