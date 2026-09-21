/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "selection-owner" });
    const parent = {
      slug: "selection",
      displayName: "Selection",
      ownerUserId: userId,
      tags: {},
      badges: {},
      moderationStatus: "active" as const,
      stats: { comments: 0, downloads: 0, stars: 0, versions: 2 },
      createdAt: 1,
      updatedAt: 1,
    };
    const skillId = await ctx.db.insert("skills", parent);
    const foreignSkillId = await ctx.db.insert("skills", { ...parent, slug: "foreign" });
    const common = {
      skillId,
      changelog: "Fixture",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: 1,
    };
    const publishedId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "1.0.0",
      publicationStatus: "published",
    });
    const legacyId = await ctx.db.insert("skillVersions", { ...common, version: "0.9.0" });
    const pendingId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "2.0.0",
      publicationStatus: "pending",
    });
    const blockedId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "3.0.0",
      publicationStatus: "blocked",
    });
    const deletedId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "4.0.0",
      publicationStatus: "published",
      softDeletedAt: 2,
    });
    const withdrawnId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "5.0.0",
      publicationStatus: "published",
      ownerDeletedAt: 2,
    });
    const foreignId = await ctx.db.insert("skillVersions", {
      ...common,
      skillId: foreignSkillId,
      version: "1.0.0",
      publicationStatus: "published",
    });
    await ctx.db.patch(skillId, {
      latestVersionId: publishedId,
      tags: { latest: publishedId, withheld: pendingId, foreign: foreignId, legacy: legacyId },
    });
    return {
      skillId,
      foreignSkillId,
      userId,
      publishedId,
      legacyId,
      pendingId,
      blockedId,
      deletedId,
      withdrawnId,
      foreignId,
    };
  });
  return { t, ...ids };
}

it("selects published and legacy versions by current version, tag, latest, and ID", async () => {
  const f = await fixture();
  for (const selector of [
    {},
    { version: "1.0.0" },
    { tag: "latest" },
    { versionId: f.publishedId },
  ]) {
    expect(
      await f.t.query(internal.skills.getPublicVersionSelectionInternal, {
        skillId: f.skillId,
        ...selector,
      }),
    ).toMatchObject({
      status: "available",
      skill: { _id: f.skillId },
      version: { _id: f.publishedId },
    });
  }
  expect(
    await f.t.query(internal.skills.getPublicVersionSelectionInternal, {
      skillId: f.skillId,
      tag: "legacy",
    }),
  ).toMatchObject({ status: "available", version: { _id: f.legacyId } });
});

it("withholds unpublished and foreign selections without exposing a version document", async () => {
  const f = await fixture();
  for (const selector of [
    { version: "2.0.0" },
    { versionId: f.blockedId },
    { tag: "withheld" },
    { tag: "foreign" },
    { versionId: f.foreignId },
    { tag: "missing" },
  ]) {
    expect(
      await f.t.query(internal.skills.getPublicVersionSelectionInternal, {
        skillId: f.skillId,
        ...selector,
      }),
    ).toEqual({ status: "not_found" });
  }
  await f.t.run((ctx) => ctx.db.patch(f.skillId, { latestVersionId: f.pendingId }));
  expect(
    await f.t.query(internal.skills.getPublicVersionSelectionInternal, { skillId: f.skillId }),
  ).toEqual({ status: "not_found" });
});

it("retains the deleted outcome only for published withdrawn versions", async () => {
  const f = await fixture();
  for (const versionId of [f.deletedId, f.withdrawnId]) {
    expect(
      await f.t.query(internal.skills.getPublicVersionSelectionInternal, {
        skillId: f.skillId,
        versionId,
      }),
    ).toEqual({ status: "deleted" });
  }
  await f.t.run((ctx) => ctx.db.patch(f.pendingId, { softDeletedAt: 2 }));
  expect(
    await f.t.query(internal.skills.getPublicVersionSelectionInternal, {
      skillId: f.skillId,
      versionId: f.pendingId,
    }),
  ).toEqual({ status: "not_found" });
});

it("binds each batch pair, preserves order, and checks the current parent", async () => {
  const f = await fixture();
  const results = await f.t.query(internal.skills.getPublicVersionSelectionsInternal, {
    selections: [
      { skillId: f.skillId, versionId: f.publishedId },
      { skillId: f.skillId, versionId: f.foreignId },
      { skillId: f.skillId, versionId: f.pendingId },
      { skillId: f.foreignSkillId, versionId: f.foreignId },
      { skillId: f.skillId, versionId: f.deletedId },
    ],
  });
  expect(results.map((result) => result.status)).toEqual([
    "available",
    "not_found",
    "not_found",
    "available",
    "deleted",
  ]);
  await f.t.run((ctx) => ctx.db.patch(f.skillId, { softDeletedAt: 3 }));
  expect(
    await f.t.query(internal.skills.getPublicVersionSelectionInternal, {
      skillId: f.skillId,
      versionId: f.publishedId,
    }),
  ).toEqual({ status: "not_found" });
  expect(
    await f.t.query(internal.skills.getPublicVersionSelectionsInternal, {
      selections: [{ skillId: f.skillId, versionId: f.publishedId }],
    }),
  ).toEqual([{ status: "not_found" }]);
});

it("keeps current moderation in the snapshot for inspection and download adapters", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.skillId, { moderationStatus: "hidden", moderationVerdict: "malicious" }),
  );
  expect(
    await f.t.query(internal.skills.getPublicVersionSelectionInternal, { skillId: f.skillId }),
  ).toMatchObject({
    status: "available",
    skill: { moderationStatus: "hidden", moderationVerdict: "malicious" },
    version: { _id: f.publishedId },
  });
  // Publication selection must not replace the existing owner-preview/raw-read path.
  expect(
    await f.t.query(internal.skills.getVersionByIdInternal, { versionId: f.pendingId }),
  ).toMatchObject({ publicationStatus: "pending" });
  expect(await f.t.query(api.skills.getVersionById, { versionId: f.pendingId })).toBeNull();
});

it("bounds batch reads before loading records", async () => {
  const f = await fixture();
  await expect(
    f.t.query(internal.skills.getPublicVersionSelectionsInternal, {
      selections: Array.from({ length: 251 }, () => ({
        skillId: f.skillId,
        versionId: f.publishedId,
      })),
    }),
  ).rejects.toThrow("At most 250");
});

it("preserves authenticated owner preview of pending bytes while anonymous preview is withheld", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const blob = new Blob(["# Pending owner preview"], { type: "text/markdown" });
    const storageId = await ctx.storage.store(blob);
    await ctx.db.patch(f.pendingId, {
      files: [
        {
          path: "SKILL.md",
          storageId,
          size: blob.size,
          sha256: "a".repeat(64),
          contentType: "text/markdown",
        },
      ],
    });
  });
  const owner = f.t.withIdentity({ subject: f.userId });
  expect(await owner.action(api.skills.getReadme, { versionId: f.pendingId })).toEqual({
    path: "SKILL.md",
    text: "# Pending owner preview",
  });
  await expect(f.t.action(api.skills.getReadme, { versionId: f.pendingId })).rejects.toThrow(
    "Version not available",
  );
});

async function publicVersionMetadata(f: Awaited<ReturnType<typeof fixture>>) {
  const [byId, byVersion, page, list] = await Promise.all([
    f.t.query(api.skills.getVersionById, { versionId: f.publishedId }),
    f.t.query(api.skills.getVersionBySkillAndVersion, { skillId: f.skillId, version: "1.0.0" }),
    f.t.query(api.skills.listVersionsPage, { skillId: f.skillId }),
    f.t.query(api.skills.listVersions, { skillId: f.skillId }),
  ]);
  return {
    byId: byId?.version ?? null,
    byVersion: byVersion?.version ?? null,
    page: page.items.map((version) => version.version),
    list: list.map((version) => version.version),
  };
}

it.each(["hidden", "removed"] as const)(
  "hides direct public version metadata for a %s parent",
  async (moderationStatus) => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.skillId, { moderationStatus, moderationReason: "manual.review" }),
    );
    expect(await publicVersionMetadata(f)).toEqual({
      byId: null,
      byVersion: null,
      page: [],
      list: [],
    });
  },
);

it("hides direct public version metadata after parent deletion", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.skillId, { softDeletedAt: 3 }));
  expect(await publicVersionMetadata(f)).toEqual({
    byId: null,
    byVersion: null,
    page: [],
    list: [],
  });
});

it("hides direct public version metadata for an inactive legacy owner", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.userId, { deactivatedAt: 3 }));
  expect(await publicVersionMetadata(f)).toEqual({
    byId: null,
    byVersion: null,
    page: [],
    list: [],
  });
});

it("preserves published metadata transparency for a malware-blocked parent", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.skillId, { moderationStatus: "hidden", moderationVerdict: "malicious" }),
  );
  const metadata = await publicVersionMetadata(f);
  expect(metadata.byId).toBe("1.0.0");
  expect(metadata.byVersion).toBe("1.0.0");
  expect(metadata.page.sort()).toEqual(["0.9.0", "1.0.0"]);
  expect(metadata.list.sort()).toEqual(["0.9.0", "1.0.0"]);
});

it.each(["owner", "moderator"] as const)(
  "preserves the %s version-list preview under a hidden parent",
  async (actorKind) => {
    const f = await fixture();
    const actorId = await f.t.run(async (ctx) => {
      await ctx.db.patch(f.skillId, { moderationStatus: "hidden" });
      return actorKind === "owner"
        ? f.userId
        : ctx.db.insert("users", { handle: "moderator", role: "moderator" });
    });
    const versions = await f.t
      .withIdentity({ subject: actorId })
      .query(api.skills.listVersions, { skillId: f.skillId });
    expect(versions.map((version) => version.version)).toContain("2.0.0");
  },
);
