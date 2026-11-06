/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const cleanStaticScan = {
  status: "clean" as const,
  reasonCodes: [],
  findings: [],
  summary: "Fixture",
  engineVersion: "fixture",
  checkedAt: 1,
};

async function stageSkill(args: {
  version: string;
  latestVersion?: string;
  icon?: string;
  moderationStatus?: "active" | "hidden" | "removed";
  moderationReason?: string;
  moderationNotes?: string;
  softDeletedAt?: number;
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "publisher" });
    const bytes = new TextEncoder().encode("# Pending finalization fixture\n");
    const storageId = await ctx.storage.store(new Blob([bytes]));
    const sha256 = "c".repeat(64);
    const files = [{ path: "SKILL.md", size: bytes.length, storageId, sha256 }];
    const skillId = await ctx.db.insert("skills", {
      slug: "pending-finalization",
      displayName: "Live name",
      summary: "Live summary",
      icon: args.icon,
      ownerUserId: userId,
      tags: {},
      moderationStatus: args.moderationStatus ?? "active",
      moderationReason: args.moderationReason,
      moderationNotes: args.moderationNotes,
      softDeletedAt: args.softDeletedAt,
      stats: { downloads: 0, stars: 0, comments: 0, versions: args.latestVersion ? 1 : 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    let latestVersionId: Id<"skillVersions"> | undefined;
    if (args.latestVersion) {
      latestVersionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: args.latestVersion,
        publicationStatus: "published",
        fingerprint: sha256,
        changelog: "Live",
        files,
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
      });
      await ctx.db.patch(skillId, {
        latestVersionId,
        latestVersionSummary: { version: args.latestVersion, createdAt: 1, changelog: "Live" },
        tags: { latest: latestVersionId },
      });
    }
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: args.version,
      publicationStatus: "pending",
      fingerprint: sha256,
      changelog: "Pending",
      files,
      parsed: { frontmatter: { description: "Pending summary" } },
      createdBy: userId,
      createdAt: 2,
    });
    return { userId, skillId, versionId, files };
  });
  const publish = (icon?: string) =>
    t.mutation(internal.skills.publishPendingVersionInternal, {
      versionId: ids.versionId,
      publishArgs: {
        userId: ids.userId,
        displayName: "Pending name",
        icon,
        version: args.version,
        changelog: "Pending",
        files: ids.files,
        parsed: { frontmatter: { description: "Pending summary" } },
        embedding: [0],
        llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 2 },
        staticScan: cleanStaticScan,
      },
    });
  const read = () => t.run(async (ctx) => ctx.db.get(ids.skillId));
  const readVersion = () => t.run(async (ctx) => ctx.db.get(ids.versionId));
  return { t, ids, publish, read, readVersion };
}

it("refuses to clear a soft-deleted skill when a staged version finalizes", async () => {
  const staged = await stageSkill({
    version: "1.0.0",
    moderationStatus: "hidden",
    softDeletedAt: 50,
  });
  await expect(staged.publish()).rejects.toThrow("Pending skill publication is held.");
  expect(await staged.read()).toMatchObject({ softDeletedAt: 50, moderationStatus: "hidden" });
  expect(await staged.readVersion()).toMatchObject({ publicationStatus: "pending" });
});

it("refuses to restore a removed skill", async () => {
  const staged = await stageSkill({ version: "1.0.0", moderationStatus: "removed" });
  await expect(staged.publish()).rejects.toThrow("Pending skill publication is held.");
  expect(await staged.read()).toMatchObject({ moderationStatus: "removed" });
  expect(await staged.readVersion()).toMatchObject({ publicationStatus: "pending" });
});

it.each(["security.redaction", "user.banned", "publisher.deleted", "manual.review"])(
  "refuses to lift a %s hold",
  async (moderationReason) => {
    const staged = await stageSkill({
      version: "1.2.0",
      latestVersion: "1.0.0",
      moderationStatus: "hidden",
      moderationReason,
      moderationNotes: "staff hold",
    });
    await expect(staged.publish("/icons/new.png")).rejects.toThrow(
      "Pending skill publication is held.",
    );
    expect(await staged.read()).toMatchObject({
      moderationStatus: "hidden",
      moderationReason,
      moderationNotes: "staff hold",
    });
    expect(await staged.readVersion()).toMatchObject({ publicationStatus: "pending" });
  },
);

it("publishes the first version that is only hidden for pending publication", async () => {
  const staged = await stageSkill({
    version: "1.0.0",
    moderationStatus: "hidden",
    moderationReason: "pending.publication",
  });
  await staged.publish("/icons/first.png");
  expect(await staged.readVersion()).toMatchObject({ publicationStatus: "published" });
  const skill = await staged.read();
  expect(skill?.moderationReason).not.toBe("pending.publication");
  expect(skill?.moderationStatus).toBe("active");
  expect(skill?.icon).toBe("/icons/first.png");
  expect(skill?.softDeletedAt).toBeUndefined();
});

it.each(["scanner.llm.malicious", "quality.low", "user.moderation", "manual.version_revoked"])(
  "lets a newer version replace a %s hold",
  async (moderationReason) => {
    const staged = await stageSkill({
      version: "2.0.0",
      latestVersion: moderationReason === "manual.version_revoked" ? undefined : "1.0.0",
      moderationStatus: "hidden",
      moderationReason,
      icon: "/icons/old.png",
    });
    await staged.publish("/icons/fixed.png");
    const skill = await staged.read();
    expect(skill?.moderationStatus).toBe("active");
    expect(skill?.moderationReason).not.toBe(moderationReason);
    expect(skill?.icon).toBe("/icons/fixed.png");
    expect(skill?.latestVersionSummary?.version).toBe("2.0.0");
  },
);

it("does not replace live moderation or the icon when an older version finalizes", async () => {
  const staged = await stageSkill({
    version: "1.0.0",
    latestVersion: "2.0.0",
    icon: "/icons/live.png",
    moderationStatus: "active",
    moderationReason: "scanner.aggregate.clean",
    moderationNotes: "keep-live",
  });
  await staged.publish("/icons/old-release.png");
  expect(await staged.readVersion()).toMatchObject({ publicationStatus: "published" });
  expect(await staged.read()).toMatchObject({
    icon: "/icons/live.png",
    displayName: "Live name",
    moderationStatus: "active",
    moderationReason: "scanner.aggregate.clean",
    moderationNotes: "keep-live",
    latestVersionSummary: { version: "2.0.0" },
  });
});

it("copies a new icon onto the skill when the pending version becomes latest", async () => {
  const hosted = `/api/v1/skill-icons/${"a".repeat(64)}`;
  const replaced = await stageSkill({
    version: "2.0.0",
    latestVersion: "1.0.0",
    icon: "/icons/previous.png",
  });
  await replaced.publish("/icons/next.png");
  expect(await replaced.read()).toMatchObject({ icon: "/icons/next.png" });

  const cleared = await stageSkill({
    version: "2.0.0",
    latestVersion: "1.0.0",
    icon: hosted,
  });
  await cleared.publish(undefined);
  expect((await cleared.read())?.icon).toBeUndefined();
});
