/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");
const bearer = "publication-selection-owner";
const name = "visibility-plugin";

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("globalStats", {
      key: "default",
      activeSkillsCount: 0,
      activePluginsCount: 0,
      updatedAt: 1,
    });
    const owner = await ctx.db.insert("users", { handle: "visibility-owner", role: "user" });
    const outsider = await ctx.db.insert("users", { handle: "outsider", role: "user" });
    await ctx.db.insert("apiTokens", {
      userId: owner,
      label: "fixture",
      prefix: "fixture",
      tokenHash: await hashToken(bearer),
      createdAt: Date.now(),
    });
    const storageId = await ctx.storage.store(new Blob(["visible bytes"]));
    const pkg = await ctx.db.insert("packages", {
      name,
      normalizedName: name,
      displayName: name,
      ownerUserId: owner,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      scanStatus: "clean",
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 2 },
      createdAt: 1,
      updatedAt: 1,
    });
    const values = {
      packageId: pkg,
      changelog: "release notes",
      distTags: [],
      files: [{ path: "index.js", size: 13, storageId, sha256: "a".repeat(64) }],
      integritySha256: "b".repeat(64),
      createdAt: 1,
      createdBy: owner,
      verification: {
        tier: "source-linked" as const,
        scope: "artifact-only" as const,
        scanStatus: "clean" as const,
      },
    };
    const latest = await ctx.db.insert("packageReleases", { ...values, version: "1.0.0" });
    const selected = await ctx.db.insert("packageReleases", {
      ...values,
      version: "2.0.0",
      publicationStatus: "published",
    });
    const foreignPackage = await ctx.db.insert("packages", {
      name: "foreign-plugin",
      normalizedName: "foreign-plugin",
      displayName: "foreign",
      ownerUserId: owner,
      family: "code-plugin",
      channel: "private",
      isOfficial: false,
      scanStatus: "clean",
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const foreign = await ctx.db.insert("packageReleases", {
      ...values,
      packageId: foreignPackage,
      version: "secret",
    });
    await ctx.db.patch(pkg, {
      latestReleaseId: latest,
      latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "release notes" },
      tags: { latest, candidate: selected, alias: selected, foreign },
    });
    await upsertPackageSearchDigest(ctx, extractPackageDigestFields((await ctx.db.get(pkg))!));
    return { pkg, owner, outsider, latest, selected, foreign, foreignPackage };
  });
  return { t, ...ids };
}

const withheld = [
  { publicationStatus: "pending" },
  { publicationStatus: "blocked" },
  { softDeletedAt: 0 },
  { ownerDeletedAt: 0 },
] satisfies Array<Partial<Doc<"packageReleases">>>;

describe("checked package release selections", () => {
  it.each(withheld)("withholds %j across version, tag, bytes and metadata", async (patch) => {
    const { t, selected, pkg } = await fixture();
    await t.run((ctx) => ctx.db.patch(selected, patch));
    for (const selector of [{ version: "2.0.0" }, { tag: "candidate" }]) {
      expect(
        await t.query(internal.packages.getReleaseForViewerInternal, { name, ...selector }),
      ).toBeNull();
    }
    expect(
      await t.query(internal.packages.getVersionByNameForViewerInternal, {
        name,
        version: "2.0.0",
      }),
    ).toBeNull();
    expect(await t.query(internal.packages.getTagsForViewerInternal, { name })).toEqual({
      latest: "1.0.0",
    });
    const detail = await t.query(internal.packages.getPluginDetailForViewerInternal, {
      name,
      version: "2.0.0",
    });
    expect(detail?.release).toBeNull();
    expect(detail?.tags).toEqual({ latest: "1.0.0" });
    for (const route of [
      "file?path=index.js&version=2.0.0",
      "file?path=index.js&tag=candidate",
      "download?version=2.0.0",
      "download?tag=candidate",
      "versions/2.0.0",
    ]) {
      expect((await t.fetch(`/api/v1/packages/${name}/${route}`)).status, route).toBe(404);
    }
    await t.run((ctx) => ctx.db.patch(pkg, { latestReleaseId: selected }));
    expect(await t.query(internal.packages.getReleaseForViewerInternal, { name })).toBeNull();
  });

  it("does not re-expose withheld and foreign versions through root or detail tag metadata", async () => {
    const { t, selected } = await fixture();
    await t.run((ctx) => ctx.db.patch(selected, { publicationStatus: "pending" }));
    const metadata = await t.fetch(`/api/v1/packages/${name}`);
    expect(metadata.status).toBe(200);
    expect((await metadata.json()).package.tags).toEqual({ latest: "1.0.0" });
    const detail = await t.query(internal.packages.getPluginDetailForViewerInternal, { name });
    expect(detail?.tags).toEqual({ latest: "1.0.0" });
  });

  it("exports no bytes from a stale pending latest pointer", async () => {
    const { t, pkg, selected } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.patch(selected, { publicationStatus: "pending" });
      await ctx.db.patch(pkg, { latestReleaseId: selected });
    });
    const response = await t.fetch("/api/v1/plugins/export?startDate=0&endDate=10&limit=5", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Total-Returned")).toBe("0");
    expect(response.headers.get("X-Export-Errors")).toBe("1");
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const contents = Object.values(archive)
      .map((bytes) => new TextDecoder().decode(bytes))
      .join("\n");
    expect(contents).not.toContain(String(selected));
    expect(contents).not.toContain("visible bytes");
  });

  it("preserves legacy and published releases while rejecting a foreign parent pointer", async () => {
    const { t, pkg, selected, foreign } = await fixture();
    expect(
      (await t.query(internal.packages.getReleaseForViewerInternal, { name }))?.release.version,
    ).toBe("1.0.0");
    expect(
      (await t.query(internal.packages.getReleaseForViewerInternal, { name, tag: "candidate" }))
        ?.release._id,
    ).toBe(selected);
    expect(
      await t.query(internal.packages.getReleaseForViewerInternal, { name, tag: "foreign" }),
    ).toBeNull();
    const metadata = await t.fetch(`/api/v1/packages/${name}`);
    expect((await metadata.json()).package.tags).toEqual({
      latest: "1.0.0",
      candidate: "2.0.0",
      alias: "2.0.0",
    });
    const file = await t.fetch(`/api/v1/packages/${name}/file?path=index.js&version=2.0.0`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("visible bytes");
    expect((await t.fetch(`/api/v1/packages/${name}/download?version=2.0.0`)).status).toBe(200);
    await t.run((ctx) => ctx.db.patch(pkg, { latestReleaseId: foreign }));
    expect(await t.query(internal.packages.getReleaseForViewerInternal, { name })).toBeNull();
    expect(
      await t.query(internal.packages.getVersionByNameForViewerInternal, {
        name,
        version: "1.0.0",
      }),
    ).toBeNull();
  });

  it("preserves authorized private reads without making pending releases owner-readable", async () => {
    const { t, pkg, owner, outsider, selected } = await fixture();
    await t.run((ctx) => ctx.db.patch(pkg, { channel: "private" }));
    expect(await t.query(internal.packages.getReleaseForViewerInternal, { name })).toBeNull();
    expect(
      await t.query(internal.packages.getReleaseForViewerInternal, {
        name,
        viewerUserId: outsider,
      }),
    ).toBeNull();
    expect(
      (await t.query(internal.packages.getReleaseForViewerInternal, { name, viewerUserId: owner }))
        ?.release.version,
    ).toBe("1.0.0");
    const headers = { Authorization: `Bearer ${bearer}` };
    expect((await t.fetch(`/api/v1/packages/${name}/file?path=index.js`, { headers })).status).toBe(
      200,
    );
    await t.run((ctx) => ctx.db.patch(selected, { publicationStatus: "pending" }));
    expect(
      (await t.fetch(`/api/v1/packages/${name}/file?path=index.js&version=2.0.0`, { headers }))
        .status,
    ).toBe(404);
  });

  it.each(["pending", "quarantined", "revoked"] as const)(
    "keeps %s download policy separate from published metadata",
    async (state) => {
      const { t, selected, owner } = await fixture();
      await t.run((ctx) =>
        ctx.db.patch(
          selected,
          state === "pending"
            ? {
                verification: {
                  tier: "source-linked",
                  scope: "artifact-only",
                  scanStatus: "pending",
                },
              }
            : {
                manualModeration: { state, reason: "fixture", updatedAt: 1, reviewerUserId: owner },
              },
        ),
      );
      expect((await t.fetch(`/api/v1/packages/${name}/versions/2.0.0`)).status).toBe(200);
      expect(
        (await t.fetch(`/api/v1/packages/${name}/file?path=index.js&version=2.0.0`)).status,
      ).toBe(state === "pending" ? 200 : 403);
      expect((await t.fetch(`/api/v1/packages/${name}/download?version=2.0.0`)).status).toBe(
        state === "pending" ? 200 : 403,
      );
    },
  );

  it("revalidates export parent and publication state after an earlier public read", async () => {
    const { t, pkg, selected, foreign } = await fixture();
    const selections = [{ packageId: pkg, releaseId: selected }];
    expect(
      (await t.query(internal.packages.getPublicReleaseSelectionsInternal, { selections }))[0]?._id,
    ).toBe(selected);
    expect(
      await t.query(internal.packages.getPublicReleaseSelectionsInternal, {
        selections: [{ packageId: pkg, releaseId: foreign }],
      }),
    ).toEqual([null]);
    for (const patch of withheld) {
      await t.run((ctx) =>
        ctx.db.patch(selected, {
          publicationStatus: "published",
          softDeletedAt: undefined,
          ownerDeletedAt: undefined,
          ...patch,
        }),
      );
      expect(
        await t.query(internal.packages.getPublicReleaseSelectionsInternal, { selections }),
      ).toEqual([null]);
    }
    await t.run((ctx) =>
      ctx.db.patch(selected, {
        publicationStatus: "published",
        softDeletedAt: undefined,
        ownerDeletedAt: undefined,
      }),
    );
    for (const patch of [
      { channel: "private" as const },
      { channel: "community" as const, softDeletedAt: 0 },
      { softDeletedAt: undefined, scanStatus: "malicious" as const },
    ]) {
      await t.run((ctx) => ctx.db.patch(pkg, patch));
      expect(
        await t.query(internal.packages.getPublicReleaseSelectionsInternal, { selections }),
      ).toEqual([null]);
    }
    await expect(
      t.query(internal.packages.getPublicReleaseSelectionsInternal, {
        selections: Array.from({ length: 6 }, () => selections[0]),
      }),
    ).rejects.toThrow("At most 5");
  });
  it("uses the checked skill selection for package alias files and metadata", async () => {
    const { t, owner } = await fixture();
    const selected = await t.run(async (ctx) => {
      const skillId = await ctx.db.insert("skills", {
        slug: "skill-alias",
        displayName: "Skill alias",
        ownerUserId: owner,
        tags: {},
        badges: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 2 },
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["# Skill alias"]));
      const base = {
        skillId,
        changelog: "skill release",
        files: [{ path: "SKILL.md", size: 13, storageId, sha256: "c".repeat(64) }],
        parsed: { frontmatter: {} },
        createdBy: owner,
        createdAt: 1,
      };
      const latest = await ctx.db.insert("skillVersions", { ...base, version: "1.0.0" });
      const candidate = await ctx.db.insert("skillVersions", {
        ...base,
        version: "2.0.0",
        publicationStatus: "pending",
      });
      await ctx.db.patch(skillId, { latestVersionId: latest, tags: { latest, candidate } });
      return candidate;
    });
    const filePath = "/api/v1/packages/skill-alias/file?path=README.md&tag=candidate";
    expect((await t.fetch(filePath)).status).toBe(404);
    expect((await t.fetch("/api/v1/packages/skill-alias/versions/2.0.0")).status).toBe(404);
    await t.run((ctx) => ctx.db.patch(selected, { publicationStatus: "published" }));
    const response = await t.fetch(filePath);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Skill alias");
    expect((await t.fetch("/api/v1/packages/skill-alias/versions/2.0.0")).status).toBe(200);
    await t.run((ctx) => ctx.db.patch(selected, { ownerDeletedAt: 1 }));
    expect((await t.fetch(filePath)).status).toBe(404);
  });
});
