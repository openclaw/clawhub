/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { ApiV1SkillPublicationResponseSchema, parseArk } from "clawhub-schema";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const path = "/api/v1/skills/progress/versions/2.0.0/publication?ownerHandle=progress-owner";
const headers = { Authorization: "Bearer owner-publication-status-fixture" };

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "progress-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "progress-owner",
      displayName: "Progress owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(userId, { personalPublisherId: publisherId });
    const tokenId = await ctx.db.insert("apiTokens", {
      userId,
      label: "fixture",
      prefix: "fixture",
      tokenHash: await hashToken("owner-publication-status-fixture"),
      createdAt: 1,
    });
    const skillId = await ctx.db.insert("skills", {
      slug: "progress",
      displayName: "Progress",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      moderationStatus: "hidden",
      moderationReason: "pending.scan",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 2,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "2.0.0",
      changelog: "Fixture",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
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
    return { userId, publisherId, tokenId, skillId, versionId, attemptId };
  });
  return { t, ...ids };
}

it("lets the authenticated owner inspect a retained version's failed checks over HTTP", async () => {
  const f = await fixture();
  const response = await f.t.fetch(path, { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Vary")).toContain("Authorization");
  const payload = await response.json();
  expect(parseArk(ApiV1SkillPublicationResponseSchema, payload, "Publication status")).toEqual(
    payload,
  );
  expect(payload).toMatchObject({
    skill: { slug: "progress", displayName: "Progress" },
    publication: {
      version: "2.0.0",
      stage: "checks_failed",
      retrying: true,
      checks: { trufflehog: "clean", clawscan: "failed" },
    },
  });
  expect(JSON.stringify(payload)).not.toMatch(/PRIVATE-|fingerprint|storageId|attemptId|files/);
  const publicRead = await f.t.fetch(
    "/api/v1/skills/progress/versions/2.0.0?ownerHandle=progress-owner",
    { headers },
  );
  expect(publicRead.status, await publicRead.text()).toBe(404);
});

it("reports publication completion without reusing an earlier failed check status", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.versionId, { publicationStatus: "published" }));
  const response = await f.t.fetch(path, { headers });
  expect(response.status).toBe(200);
  expect((await response.json()).publication).toEqual({
    version: "2.0.0",
    stage: "published",
    retrying: false,
    updatedAt: 2,
  });
});

it("rejects anonymous, invalid and revoked credentials without revealing candidate status", async () => {
  const f = await fixture();
  expect((await f.t.fetch(path)).status).toBe(401);
  expect(
    (await f.t.fetch(path, { headers: { Authorization: "Bearer invalid-fixture" } })).status,
  ).toBe(401);
  await f.t.run((ctx) => ctx.db.patch(f.tokenId, { revokedAt: 4 }));
  expect((await f.t.fetch(path, { headers })).status).toBe(401);
});

it("rejects a different publisher even when the URL supplies the owner's user ID", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const otherId = await ctx.db.insert("users", { handle: "other-publisher" });
    await ctx.db.patch(f.tokenId, { userId: otherId });
  });
  expect((await f.t.fetch(`${path}&userId=${f.userId}`, { headers })).status).toBe(404);
});

it.each(["deactivatedAt", "deletedAt"] as const)("rejects an owner with %s set", async (field) => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.userId, { [field]: 4 }));
  expect((await f.t.fetch(path, { headers })).status).toBe(401);
});

it.each(["softDeletedAt", "ownerDeletedAt"] as const)(
  "does not return private status for a version with %s set",
  async (field) => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.versionId, { [field]: 4 }));
    expect((await f.t.fetch(path, { headers })).status).toBe(404);
  },
);

it("selects the requested retained version after a newer release supersedes it", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const newerId = await ctx.db.insert("skillVersions", {
      skillId: f.skillId,
      version: "3.0.0",
      changelog: "Newer release",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: f.userId,
      publicationStatus: "published",
      createdAt: 10,
    });
    await ctx.db.patch(f.skillId, { latestVersionId: newerId, moderationStatus: "active" });
  });
  expect(await (await f.t.fetch(path, { headers })).json()).toMatchObject({
    publication: { version: "2.0.0", stage: "checks_failed" },
  });
  expect((await f.t.fetch(path.replace("2.0.0", "9.9.9"), { headers })).status).toBe(404);
});

it.each(["owner", "admin", "publisher"] as const)(
  "requires current organization %s membership rather than original creator identity",
  async (role) => {
    const f = await fixture();
    const membershipId = await f.t.run(async (ctx) => {
      await ctx.db.patch(f.publisherId, { kind: "org", linkedUserId: undefined });
      return ctx.db.insert("publisherMembers", {
        publisherId: f.publisherId,
        userId: f.userId,
        role,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect((await f.t.fetch(path, { headers })).status).toBe(200);
    await f.t.run((ctx) => ctx.db.delete(membershipId));
    expect((await f.t.fetch(path, { headers })).status).toBe(404);
  },
);

it("authorizes an active moderator and still withholds raw worker diagnostics", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const staffId = await ctx.db.insert("users", { handle: "staff", role: "moderator" });
    await ctx.db.patch(f.tokenId, { userId: staffId });
  });
  const response = await f.t.fetch(path, { headers });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("PRIVATE-");
});
