/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const token = "synthetic-card-worker";

afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { handle: "card-fixture" });
    const skillId = await ctx.db.insert("skills", {
      slug: "card-fixture",
      displayName: "Card fixture",
      ownerUserId: ownerId,
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const sourceId = await ctx.storage.store(new Blob(["# Source\n"]));
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Initial",
      parsed: { frontmatter: {} },
      files: [{ path: "SKILL.md", size: 9, storageId: sourceId, sha256: "a".repeat(64) }],
      createdBy: ownerId,
      createdAt: 1,
    });
    const jobId = await ctx.db.insert("skillCardGenerationJobs", {
      skillId,
      skillVersionId: versionId,
      status: "running",
      source: "manual",
      priority: 1,
      nextRunAt: 1,
      attempts: 1,
      leaseToken: "current-lease",
      leaseExpiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
    });
    return { sourceId, versionId, jobId };
  });
  return { t, ...ids };
}

it.each(["stale-lease", "deleted-version", "missing-version"])(
  "removes the new blob after a %s attachment rejection",
  async (failure) => {
    const { t, sourceId, versionId, jobId } = await fixture();
    await t.run(async (ctx) => {
      if (failure === "deleted-version") await ctx.db.patch(versionId, { softDeletedAt: 2 });
      if (failure === "missing-version") await ctx.db.delete(versionId);
    });
    await expect(
      t.action(api.skillCards.completeSkillCardJob, {
        token,
        jobId,
        leaseToken: failure === "stale-lease" ? "expired-lease" : "current-lease",
        markdown: "# Rejected card\n",
      }),
    ).rejects.toThrow(failure === "stale-lease" ? "Lease mismatch" : "Skill version not found");
    const blobs = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(blobs.map((blob) => blob._id)).toEqual([sourceId]);
    expect(await t.run(async (ctx) => (await ctx.storage.get(sourceId))?.text())).toBe(
      "# Source\n",
    );
    expect(await t.run(async (ctx) => (await ctx.db.get(jobId))?.status)).toBe("running");
  },
);

it("retains successful cards and historical fingerprints when a later card replaces them", async () => {
  const { t, versionId, jobId } = await fixture();
  await t.action(api.skillCards.completeSkillCardJob, {
    token,
    jobId,
    leaseToken: "current-lease",
    markdown: "# First card\n",
  });
  const firstVersion = await t.run((ctx) => ctx.db.get(versionId));
  const firstFingerprints = await t.run((ctx) =>
    ctx.db.query("skillVersionFingerprints").collect(),
  );
  expect(firstFingerprints).toHaveLength(1);
  const firstCard = firstVersion!.files.find((file) => file.path === "skill-card.md")!;
  expect(await t.run(async (ctx) => (await ctx.storage.get(firstCard.storageId))?.text())).toBe(
    "# First card\n",
  );
  await t.run((ctx) => ctx.db.patch(jobId, { status: "running", leaseToken: "next-lease" }));
  await t.action(api.skillCards.completeSkillCardJob, {
    token,
    jobId,
    leaseToken: "next-lease",
    markdown: "# Second card\n",
  });
  const version = await t.run((ctx) => ctx.db.get(versionId));
  const currentCard = version!.files.find((file) => file.path === "skill-card.md")!;
  expect(currentCard.storageId).not.toBe(firstCard.storageId);
  expect(await t.run(async (ctx) => (await ctx.storage.get(currentCard.storageId))?.text())).toBe(
    "# Second card\n",
  );
  expect(await t.run(async (ctx) => (await ctx.storage.get(firstCard.storageId))?.text())).toBe(
    "# First card\n",
  );
  const fingerprints = await t.run((ctx) => ctx.db.query("skillVersionFingerprints").collect());
  expect(fingerprints).toHaveLength(2);
  expect(fingerprints.map((entry) => entry.fingerprint)).toEqual(
    expect.arrayContaining(firstFingerprints.map((entry) => entry.fingerprint)),
  );
  expect(await t.run(async (ctx) => (await ctx.db.get(jobId))?.status)).toBe("succeeded");
});
