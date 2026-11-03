/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "progress-owner" });
    const otherId = await ctx.db.insert("users", { handle: "other-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "progress-owner",
      displayName: "Progress owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(userId, { personalPublisherId: publisherId });
    const skillId = await ctx.db.insert("skills", {
      slug: "progress",
      displayName: "Progress",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      moderationVerdict: "clean",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 2,
    });
    const common = {
      skillId,
      changelog: "Fixture",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
    };
    const publishedId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "1.0.0",
      publicationStatus: "published",
      createdAt: 1,
      llmAnalysis: { status: "clean", verdict: "clean", checkedAt: 1 },
    });
    await ctx.db.patch(skillId, { latestVersionId: publishedId });
    const versionId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "2.0.0",
      publicationStatus: "pending",
      fingerprint: "fixture-fingerprint",
      createdAt: 2,
    });
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "skill",
      status: "pending_checks",
      userId,
      ownerPublisherId: publisherId,
      skillId,
      skillVersionId: versionId,
      slug: "progress",
      displayName: "Progress",
      version: "2.0.0",
      idempotencyKey: `skill:publisher:${publisherId}:progress:2.0.0:fixture-fingerprint`,
      artifactFingerprint: "fixture-fingerprint",
      files: [],
      checks: { trufflehog: { status: "clean" }, clawscan: { status: "failed" } },
      checkClaimLastError: "PRIVATE-OPERATIONAL-ERROR",
      scanContext: { private: "PRIVATE-SCAN-CONTEXT" },
      createdAt: 2,
      updatedAt: 3,
      expiresAt: 100,
    });
    return { userId, otherId, publisherId, skillId, versionId, publishedId, attemptId };
  });
  const owner = t.withIdentity({ subject: ids.userId });
  const lookup = { ownerHandle: "progress-owner", slug: "progress" };
  return { t, owner, lookup, ...ids };
}

it("shows the owner failed candidate checks while preserving the clean public release", async () => {
  const f = await fixture();
  const result = await f.owner.query(api.skills.getBySlug, f.lookup);
  expect(result).toMatchObject({
    latestVersion: { _id: f.publishedId, version: "1.0.0", llmAnalysis: { verdict: "clean" } },
    publicationProgress: {
      version: "2.0.0",
      stage: "checks_failed",
      retrying: true,
      updatedAt: 3,
      checks: { trufflehog: "clean", clawscan: "failed" },
    },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  for (const client of [f.t, f.t.withIdentity({ subject: f.otherId })]) {
    const publicResult = await client.query(api.skills.getBySlug, f.lookup);
    expect(publicResult?.latestVersion?._id).toBe(f.publishedId);
    expect(publicResult).not.toMatchObject({ publicationProgress: { version: "2.0.0" } });
    expect(JSON.stringify(publicResult)).not.toContain("PRIVATE-");
    expect(await client.query(api.skills.getVersionById, { versionId: f.versionId })).toBeNull();
  }
});

it.each([
  ["pending_checks", "pending", "pending", undefined, "pending_checks", false],
  ["failed", "clean", "failed", "PRIVATE-ERROR", "checks_failed", false],
  ["pending_checks", "clean", "clean", "PRIVATE-MISSING-EVIDENCE", "checks_incomplete", true],
  ["ready_to_finalize", "clean", "clean", undefined, "ready_to_finalize", false],
  ["finalizing", "clean", "clean", undefined, "finalizing", false],
  ["failed", "clean", "clean", undefined, "failed", false],
  ["blocked", "clean", "blocked", undefined, "blocked", false],
  ["expired", "pending", "pending", undefined, "expired", false],
  ["finalized", "clean", "clean", undefined, "unavailable", false],
] as const)(
  "projects %s with %s/%s checks",
  async (status, trufflehog, clawscan, error, stage, retrying) => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.attemptId, {
        status,
        checks: { trufflehog: { status: trufflehog }, clawscan: { status: clawscan } },
        checkClaimLastError: error,
      }),
    );
    const result = await f.owner.query(api.skills.getBySlug, f.lookup);
    expect(result).toMatchObject({ publicationProgress: { stage, retrying, version: "2.0.0" } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  },
);

it("finds legacy personal attempts through the same producer identity", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.attemptId, {
      ownerPublisherId: undefined,
      idempotencyKey: `skill:user:${f.userId}:progress:2.0.0:fixture-fingerprint`,
    }),
  );
  expect(await f.owner.query(api.skills.getBySlug, f.lookup)).toMatchObject({
    publicationProgress: { stage: "checks_failed", version: "2.0.0" },
  });
});

it.each(["missing", "foreign-version", "changed-artifact"] as const)(
  "reports status unavailable for a %s attempt binding",
  async (kind) => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.versionId, { publishAttemptId: f.attemptId });
      if (kind === "missing") await ctx.db.delete(f.attemptId);
      else
        await ctx.db.patch(
          f.attemptId,
          kind === "foreign-version"
            ? { skillVersionId: f.publishedId }
            : { artifactFingerprint: "changed" },
        );
    });
    expect(await f.owner.query(api.skills.getBySlug, f.lookup)).toMatchObject({
      publicationProgress: { stage: "unavailable", version: "2.0.0" },
    });
  },
);

it("stops showing an older pending upload after a newer published upload", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.publishedId, { createdAt: 4 }));
  expect(await f.owner.query(api.skills.getBySlug, f.lookup)).toMatchObject({
    publicationProgress: null,
  });
});

it("uses the same safe status projection for staff and hides it from an inactive owner", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.otherId, { role: "moderator" }));
  expect(
    await f.t.withIdentity({ subject: f.otherId }).query(api.skills.getBySlugForStaff, f.lookup),
  ).toMatchObject({
    publicationProgress: { stage: "checks_failed", version: "2.0.0" },
  });
  await f.t.run((ctx) => ctx.db.patch(f.userId, { deactivatedAt: 4 }));
  expect(await f.owner.query(api.skills.getBySlug, f.lookup)).toMatchObject({
    publicationProgress: null,
  });
});

it.each(["owner", "admin", "publisher"] as const)(
  "respects current organization %s membership",
  async (role) => {
    const f = await fixture();
    const membershipId = await f.t.run(async (ctx) => {
      await ctx.db.patch(f.publisherId, { kind: "org", linkedUserId: undefined });
      return ctx.db.insert("publisherMembers", {
        publisherId: f.publisherId,
        userId: f.otherId,
        role,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const member = f.t.withIdentity({ subject: f.otherId });
    expect(await member.query(api.skills.getBySlug, f.lookup)).toMatchObject({
      publicationProgress: { stage: "checks_failed", version: "2.0.0" },
    });
    await f.t.run((ctx) => ctx.db.delete(membershipId));
    expect(await member.query(api.skills.getBySlug, f.lookup)).toMatchObject({
      publicationProgress: null,
    });
  },
);
