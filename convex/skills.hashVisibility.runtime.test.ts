/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
// Exercise the registered query with persisted publication states and file fingerprints.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { hashSkillFiles } from "./lib/skills";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pendingHash = "a".repeat(64);
const publishedHash = "b".repeat(64);

type Branch = "index" | "stored-fallback" | "computed-fallback";
async function fixture(branch: Branch, shadow = false, status: "pending" | "blocked" = "pending") {
  const t = convexTest(schema, modules);
  const content =
    "---\nname: rca-hash-visibility\ndescription: Harmless RCA fixture\n---\n# RCA fixture\n";
  const blob = new Blob([content], { type: "text/markdown" });
  const fileHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const storageId = await t.run((ctx) => ctx.storage.store(blob));
  const files = [
    {
      path: "SKILL.md",
      size: blob.size,
      storageId,
      sha256: fileHash,
      contentType: "text/markdown",
    },
  ];
  const calculatedHash = await hashSkillFiles(files);
  const hash = branch === "computed-fallback" ? calculatedHash : pendingHash;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "rca-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "rca-owner",
      displayName: "RCA owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(userId, { personalPublisherId: publisherId });
    const skillId = await ctx.db.insert("skills", {
      slug: "rca-hash-visibility",
      displayName: "RCA hash visibility",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const common = {
      skillId,
      changelog: "Fixture",
      files,
      parsed: { frontmatter: {} },
      createdBy: userId,
    };
    const publishedId = await ctx.db.insert("skillVersions", {
      ...common,
      files: branch === "computed-fallback" ? [] : files,
      version: "1.0.0",
      publicationStatus: "published",
      fingerprint: shadow ? hash : publishedHash,
      createdAt: 1,
    });
    const pendingId = await ctx.db.insert("skillVersions", {
      ...common,
      version: "2.0.0",
      publicationStatus: status,
      ...(branch === "computed-fallback" ? {} : { fingerprint: hash }),
      createdAt: 2,
    });
    await ctx.db.patch(skillId, { latestVersionId: publishedId, tags: { latest: publishedId } });
    if (branch === "index") {
      await ctx.db.insert("skillVersionFingerprints", {
        skillId,
        versionId: publishedId,
        fingerprint: shadow ? hash : publishedHash,
        kind: "source",
        createdAt: 1,
      });
      await ctx.db.insert("skillVersionFingerprints", {
        skillId,
        versionId: pendingId,
        fingerprint: hash,
        kind: "source",
        createdAt: 2,
      });
    }
    return { skillId, publishedId, pendingId };
  });
  return { t, hash, ...ids };
}

it("published control resolves and is available through the public version query", async () => {
  const f = await fixture("index");
  const resolved = await f.t.query(api.skills.resolveVersionByHash, {
    slug: "rca-hash-visibility",
    ownerHandle: "rca-owner",
    hash: publishedHash,
  });
  const version = await f.t.query(api.skills.getVersionBySkillAndVersion, {
    skillId: f.skillId,
    version: "1.0.0",
  });
  expect(resolved).toEqual({ match: { version: "1.0.0" }, latestVersion: { version: "1.0.0" } });
  expect(version?.version).toBe("1.0.0");
});

for (const branch of ["index", "stored-fallback", "computed-fallback"] as const) {
  it(`hides an unpublished version from ${branch}`, async () => {
    const f = await fixture(branch);
    const resolved = await f.t.query(api.skills.resolveVersionByHash, {
      slug: "rca-hash-visibility",
      ownerHandle: "rca-owner",
      hash: f.hash,
    });
    const visible = await f.t.query(api.skills.getVersionBySkillAndVersion, {
      skillId: f.skillId,
      version: "2.0.0",
    });
    const persisted = await f.t.run((ctx) => ctx.db.get(f.pendingId));
    expect(persisted?.publicationStatus).toBe("pending");
    expect(visible).toBeNull();
    expect(resolved).toEqual({ match: null, latestVersion: { version: "1.0.0" } });
  });
}

it("finds the published match behind a newer pending fingerprint", async () => {
  const f = await fixture("index", true);
  const resolved = await f.t.query(api.skills.resolveVersionByHash, {
    slug: "rca-hash-visibility",
    ownerHandle: "rca-owner",
    hash: f.hash,
  });
  const published = await f.t.query(api.skills.getVersionBySkillAndVersion, {
    skillId: f.skillId,
    version: "1.0.0",
  });
  const rows = await f.t.run((ctx) =>
    ctx.db
      .query("skillVersionFingerprints")
      .withIndex("by_skill_fingerprint", (q) =>
        q.eq("skillId", f.skillId).eq("fingerprint", f.hash),
      )
      .collect(),
  );
  expect(rows).toHaveLength(2);
  expect(published?.version).toBe("1.0.0");
  expect(resolved?.match?.version).toBe("1.0.0");
});

it("hides a blocked stored fingerprint", async () => {
  const f = await fixture("index", false, "blocked");
  const resolved = await f.t.query(api.skills.resolveVersionByHash, {
    slug: "rca-hash-visibility",
    hash: f.hash,
  });
  const visible = await f.t.query(api.skills.getVersionBySkillAndVersion, {
    skillId: f.skillId,
    version: "2.0.0",
  });
  expect(visible).toBeNull();
  expect(resolved?.match).toBeNull();
});

it("retains legacy publication semantics in indexed hash lookup", async () => {
  const f = await fixture("index");
  await f.t.run((ctx) => ctx.db.patch(f.publishedId, { publicationStatus: undefined }));
  expect(
    await f.t.query(api.skills.resolveVersionByHash, {
      slug: "rca-hash-visibility",
      hash: publishedHash,
    }),
  ).toEqual({ match: { version: "1.0.0" }, latestVersion: { version: "1.0.0" } });
});

it("does not match an owner-withdrawn fingerprint even without its soft-delete marker", async () => {
  const f = await fixture("index");
  await f.t.run((ctx) => ctx.db.patch(f.publishedId, { ownerDeletedAt: 2 }));
  expect(
    await f.t.query(api.skills.resolveVersionByHash, {
      slug: "rca-hash-visibility",
      hash: publishedHash,
    }),
  ).toEqual({ match: null, latestVersion: null });
});

it("rejects a fingerprint and latest pointer whose version belongs to a different skill", async () => {
  const f = await fixture("index");
  await f.t.run(async (ctx) => {
    const skill = await ctx.db.get(f.skillId);
    if (!skill) throw new Error("Missing fixture skill");
    const foreignSkillId = await ctx.db.insert("skills", {
      slug: "foreign",
      displayName: "Foreign",
      ownerUserId: skill.ownerUserId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(f.publishedId, { skillId: foreignSkillId });
  });
  expect(
    await f.t.query(api.skills.resolveVersionByHash, {
      slug: "rca-hash-visibility",
      hash: publishedHash,
    }),
  ).toEqual({ match: null, latestVersion: null });
});

it.each(["hidden", "removed"] as const)(
  "does not resolve hashes under a %s parent",
  async (moderationStatus) => {
    const f = await fixture("index");
    await f.t.run((ctx) =>
      ctx.db.patch(f.skillId, { moderationStatus, moderationReason: "manual.review" }),
    );
    expect(await f.t.query(api.skills.getBySlug, { slug: "rca-hash-visibility" })).toBeNull();
    expect(
      await f.t.query(api.skills.resolveVersionByHash, {
        slug: "rca-hash-visibility",
        hash: publishedHash,
      }),
    ).toBeNull();
  },
);

it("does not resolve hashes for a deactivated legacy owner", async () => {
  const f = await fixture("index");
  await f.t.run(async (ctx) => {
    const skill = await ctx.db.get(f.skillId);
    if (!skill) throw new Error("Missing fixture skill");
    await ctx.db.patch(skill._id, { ownerPublisherId: undefined });
    await ctx.db.patch(skill.ownerUserId, { deactivatedAt: 2 });
  });
  expect(await f.t.query(api.skills.getBySlug, { slug: "rca-hash-visibility" })).toBeNull();
  expect(
    await f.t.query(api.skills.resolveVersionByHash, {
      slug: "rca-hash-visibility",
      hash: publishedHash,
    }),
  ).toBeNull();
});

it("keeps published hash inspection separate from per-version download scan policy", async () => {
  const f = await fixture("index");
  await f.t.run((ctx) =>
    ctx.db.patch(f.publishedId, {
      llmAnalysis: { status: "malicious", verdict: "malicious", checkedAt: 2 },
    }),
  );
  expect(
    await f.t.query(api.skills.resolveVersionByHash, {
      slug: "rca-hash-visibility",
      ownerHandle: "rca-owner",
      hash: publishedHash,
    }),
  ).toEqual({ match: { version: "1.0.0" }, latestVersion: { version: "1.0.0" } });
});

it.each(["malicious", "blocked.malware"] as const)(
  "preserves published hash inspection for a parent hidden by %s",
  async (reason) => {
    const f = await fixture(reason === "malicious" ? "index" : "stored-fallback");
    await f.t.run((ctx) =>
      ctx.db.patch(f.skillId, {
        moderationStatus: "hidden",
        ...(reason === "malicious"
          ? { moderationVerdict: "malicious" as const }
          : { moderationFlags: ["blocked.malware"] }),
      }),
    );
    const resolve = (hash: string) =>
      f.t.query(api.skills.resolveVersionByHash, { slug: "rca-hash-visibility", hash });

    expect(await resolve(publishedHash)).toEqual({
      match: { version: "1.0.0" },
      latestVersion: { version: "1.0.0" },
    });
    for (const publicationStatus of ["pending", "blocked"] as const) {
      await f.t.run((ctx) => ctx.db.patch(f.pendingId, { publicationStatus }));
      expect(await resolve(f.hash)).toEqual({
        match: null,
        latestVersion: { version: "1.0.0" },
      });
    }
    await f.t.run((ctx) => ctx.db.patch(f.skillId, { softDeletedAt: 2 }));
    expect(await resolve(publishedHash)).toBeNull();
  },
);
