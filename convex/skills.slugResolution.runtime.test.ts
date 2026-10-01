/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createPublisherSlugFixture(options: {
  activeCount: number;
  softDeletedCount: number;
}) {
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
    await ctx.db.patch(userId, { personalPublisherId: publisherId });

    const activeSkillIds = [];
    for (let index = 0; index < options.activeCount; index += 1) {
      activeSkillIds.push(
        await ctx.db.insert("skills", {
          slug: "same-slug",
          displayName: `Active ${index}`,
          ownerUserId: userId,
          ownerPublisherId: publisherId,
          tags: {},
          badges: {},
          moderationStatus: "active",
          stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
          createdAt: index + 1,
          updatedAt: index + 1,
        }),
      );
    }

    const softDeletedSkillIds = [];
    for (let index = 0; index < options.softDeletedCount; index += 1) {
      const canonicalSkillId = activeSkillIds[0];
      softDeletedSkillIds.push(
        await ctx.db.insert("skills", {
          slug: "same-slug",
          displayName: `History ${index}`,
          ownerUserId: userId,
          ownerPublisherId: publisherId,
          canonicalSkillId,
          forkOf: canonicalSkillId
            ? { skillId: canonicalSkillId, kind: "duplicate", at: 10 + index }
            : undefined,
          tags: {},
          badges: {},
          moderationStatus: "hidden",
          moderationReason: "owner.merged",
          softDeletedAt: 10 + index,
          stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
          createdAt: 10 + index,
          updatedAt: 10 + index,
        }),
      );
    }

    return { activeSkillIds, softDeletedSkillIds };
  });
  return { t, ...ids };
}

async function createOwnerCollisionVerdictFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owners = [];
    for (const handle of ["alice", "bob"] as const) {
      const userId = await ctx.db.insert("users", { handle });
      const publisherId = await ctx.db.insert("publishers", {
        kind: "user",
        handle,
        displayName: handle,
        linkedUserId: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(userId, { personalPublisherId: publisherId });
      const skillId = await ctx.db.insert("skills", {
        slug: "shared-skill",
        displayName: `${handle} skill`,
        ownerUserId: userId,
        ownerPublisherId: publisherId,
        tags: {},
        badges: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.2.3",
        changelog: "Initial",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
      });
      await ctx.db.patch(skillId, { latestVersionId: versionId });
      owners.push({ handle, skillId, versionId });
    }
    return owners;
  });
  return { t, owners: ids };
}

it("resolves the active skill when retained same-publisher history shares its slug", async () => {
  const fixture = await createPublisherSlugFixture({ activeCount: 1, softDeletedCount: 2 });

  const result = await fixture.t.query(api.skills.getBySlug, {
    ownerHandle: "owner",
    slug: "same-slug",
  });

  expect(result?.skill?._id).toBe(fixture.activeSkillIds[0]);
});

it("fails closed when a publisher has multiple active skills with the same slug", async () => {
  const fixture = await createPublisherSlugFixture({ activeCount: 2, softDeletedCount: 1 });

  await expect(
    fixture.t.query(api.skills.getBySlug, { ownerHandle: "owner", slug: "same-slug" }),
  ).rejects.toThrow(/active publisher slug invariant/i);
});

it("preserves a single soft-deleted skill for restore and reclaim flows", async () => {
  const fixture = await createPublisherSlugFixture({ activeCount: 0, softDeletedCount: 1 });

  const result = await fixture.t.query(internal.skills.getSkillBySlugIncludingSoftDeletedInternal, {
    ownerHandle: "owner",
    slug: "same-slug",
  });

  expect(result?._id).toBe(fixture.softDeletedSkillIds[0]);
});

it("fails closed when only multiple soft-deleted skills share a publisher slug", async () => {
  const fixture = await createPublisherSlugFixture({ activeCount: 0, softDeletedCount: 2 });

  await expect(
    fixture.t.query(internal.skills.getSkillBySlugIncludingSoftDeletedInternal, {
      ownerHandle: "owner",
      slug: "same-slug",
    }),
  ).rejects.toThrow(/soft-deleted publisher slug history is ambiguous/i);
});

it("resolves security verdict targets by owner when slug and version collide", async () => {
  const fixture = await createOwnerCollisionVerdictFixture();

  for (const owner of fixture.owners) {
    const verdictTarget = await fixture.t.query(internal.skills.getSecurityVerdictTargetInternal, {
      slug: "shared-skill",
      ownerHandle: owner.handle,
      version: "1.2.3",
    });
    const verifyTarget = await fixture.t.query(internal.skills.getVerifyTargetBySlugInternal, {
      slug: "shared-skill",
      ownerHandle: owner.handle,
    });

    expect(verdictTarget).toMatchObject({
      skill: { _id: owner.skillId },
      owner: { handle: owner.handle },
      version: { _id: owner.versionId, version: "1.2.3" },
    });
    expect(verifyTarget).toMatchObject({
      skill: { _id: owner.skillId },
      owner: { handle: owner.handle },
    });
  }

  await expect(
    fixture.t.query(internal.skills.getSecurityVerdictTargetInternal, {
      slug: "shared-skill",
      version: "1.2.3",
    }),
  ).resolves.toBeNull();
});
