/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { createPackageSeedDefaults } from "../src/__tests__/helpers/packageSeed";
import type { Doc } from "./_generated/dataModel";
import { sha256Hex } from "./lib/hash";
import { MAX_RAW_FILE_BYTES } from "./lib/storageText";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
const name = "detail-fixture";
const version = "2.0.1";
const scoped = "/api/v1/packages/@detail-owner/" + name;
const view = "?view=template-detail";
const path = "nested/CLAW.md";
const contents = "# Authored entry point 🦞\n";
const llmAnalysis = {
  status: "completed",
  verdict: "benign",
  summary: "release-specific",
  checkedAt: 3,
};
const envelope = { name, version, openclaw: { template: path } };

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { handle: "detail-owner", role: "user" });
    await ctx.db.insert("apiTokens", {
      userId: owner,
      label: "detail",
      prefix: "detail",
      tokenHash: await hashToken("detail-owner-token"),
      createdAt: 1,
    });
    const files = await Promise.all(
      Object.entries({
        [path]: contents,
        "CLAW.md": "decoy root body",
        "package.json": JSON.stringify(envelope),
        "workspace/AGENTS.md": "another unopened body",
      }).map(async ([filename, body]) => {
        const blob = new Blob([body]);
        return {
          path: filename,
          sha256: await sha256Hex(new Uint8Array(await blob.arrayBuffer())),
          size: blob.size,
          storageId: await ctx.storage.store(blob),
        };
      }),
    );
    const pkg = await ctx.db.insert("packages", {
      ...createPackageSeedDefaults(),
      family: "claw",
      name,
      normalizedName: name,
      displayName: "Detail fixture",
      ownerUserId: owner,
      scanStatus: "clean",
      stats: { versions: 2, downloads: 0, stars: 0, installs: 0 },
    });
    const common = {
      packageId: pkg,
      version,
      files,
      changelog: "release-changelog-marker",
      distTags: [],
      createdAt: 1,
      createdBy: owner,
      integritySha256: "a".repeat(64),
      extractedPackageJson: envelope,
      publicationStatus: "published" as const,
    };
    const prior = await ctx.db.insert("packageReleases", {
      ...common,
      version: "1.0.0",
      llmAnalysis: { ...llmAnalysis, summary: "prior analysis" },
    });
    const release = await ctx.db.insert("packageReleases", {
      ...common,
      llmAnalysis,
      source: { branch: "release-source-marker" },
      aigAnalysis: {
        status: "clean",
        findings: [],
        issueCount: 0,
        summary: "separate-audit-marker",
        checkedAt: 1,
      },
    });
    await ctx.db.patch(pkg, { latestReleaseId: release, tags: { latest: release, stable: prior } });
    return { pkg, owner, release, files };
  });
  return { t, ...ids };
}

describe("website Template detail projection", () => {
  it("matches exact published metadata, file preview and public LLM analysis in either HTTP router", async () => {
    const { t, files } = await fixture();
    const metadata = await (await t.fetch(scoped)).json();
    expect(metadata).toMatchObject({
      package: { name, latestVersion: version, tags: { latest: version, stable: "1.0.0" } },
      owner: { handle: "detail-owner" },
    });
    expect(metadata).not.toHaveProperty("templateRelease");
    const exact = (await (await t.fetch(scoped + "/versions/" + version)).json()).version;
    const preview = await (
      await t.fetch(scoped + "/file?preview=1&version=" + version + "&path=" + path)
    ).text();
    expect(preview).toBe(contents);
    for (const headers of [
      {},
      { Cookie: "unrelated=1" },
      { Authorization: "Bearer detail-owner-token" },
    ] as HeadersInit[]) {
      const response = await t.fetch(scoped + view + "&path=workspace/AGENTS.md&version=1.0.0", {
        headers,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.json();
      expect(body).toEqual({
        ...metadata,
        templateRelease: { version, contents: preview, llmAnalysis: exact.llmAnalysis },
      });
      for (const marker of [
        "decoy root body",
        "another unopened body",
        "prior analysis",
        "separate-audit-marker",
        "release-source-marker",
        "release-changelog-marker",
        path,
        ...files.map((f) => f.storageId),
      ])
        expect(JSON.stringify(body)).not.toContain(marker);
    }
    expect((await t.fetch(scoped.replace("detail-owner", "wrong-owner") + view)).status).toBe(404);
    expect(await (await t.fetch(scoped + "?view=unrecognized")).json()).toEqual(metadata);
    expect(
      await (await t.fetch(scoped + "/file?path=workspace/AGENTS.md&version=" + version)).text(),
    ).toBe("another unopened body");
  });

  it("leaves plugin metadata unchanged when a caller opts in", async () => {
    const { t, pkg } = await fixture();
    await t.run((ctx) => ctx.db.patch(pkg, { family: "code-plugin" }));
    const url = "/api/v1/packages/" + name;
    const ordinary = await t.fetch(url);
    const response = await t.fetch(url + view);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(await ordinary.json());
  });

  it("never attaches private release data, even if the viewer may read its metadata", async () => {
    const { t, pkg } = await fixture();
    await t.run((ctx) => ctx.db.patch(pkg, { channel: "private" }));
    expect((await t.fetch(scoped + view)).status).toBe(404);
    const response = await t.fetch(scoped + view, {
      headers: { Authorization: "Bearer detail-owner-token" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).templateRelease).toEqual({
      version,
      contents: null,
      llmAnalysis: null,
    });
  });

  it.each(["quarantined", "revoked", "malicious"] as const)(
    "does not expose %s content, even with stale clean package metadata",
    async (state) => {
      const { t, owner, release } = await fixture();
      await t.run((ctx) =>
        ctx.db.patch(
          release,
          state === "malicious"
            ? { llmAnalysis: { ...llmAnalysis, verdict: "malicious" } }
            : {
                manualModeration: {
                  state,
                  reviewerUserId: owner,
                  reason: "private review note",
                  updatedAt: 1,
                },
              },
        ),
      );
      const response = await t.fetch(scoped + view);
      expect((await response.json()).templateRelease).toEqual({
        version,
        contents: null,
        llmAnalysis: null,
      });
      expect((await t.fetch(scoped + "/file?preview=1&path=" + path)).status).toBe(403);
    },
  );

  it.each([
    { publicationStatus: "pending" },
    { publicationStatus: "blocked" },
    { ownerDeletedAt: 0 },
    { softDeletedAt: 0 },
  ] satisfies Array<Partial<Doc<"packageReleases">>>)(
    "keeps unpublished or deleted releases outside the expansion (%j)",
    async (patch) => {
      const { t, release } = await fixture();
      await t.run((ctx) => ctx.db.patch(release, patch));
      const ordinary = await t.fetch(scoped);
      const expanded = await t.fetch(scoped + view);
      expect(expanded.status).toBe(ordinary.status);
      expect(await expanded.text()).toBe(await ordinary.text());
    },
  );
  it("does not follow a cross-package latest pointer", async () => {
    const { t, owner, release } = await fixture();
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("packages", {
        ...createPackageSeedDefaults(),
        name: "other",
        normalizedName: "other",
        displayName: "Other",
        stats: { versions: 1, installs: 0, downloads: 0, stars: 0 },
        ownerUserId: owner,
      });
      await ctx.db.patch(release, { packageId: other });
    });
    expect((await t.fetch(scoped + view)).status).toBe(404);
  });
  it.each([
    undefined,
    { ...envelope, name: "other" },
    { ...envelope, version: "1.0.0" },
    ...["../CLAW.md", "workspace/AGENTS.md", "nested/claw.md"].map((template) => ({
      ...envelope,
      openclaw: { template },
    })),
  ])(
    "omits the expansion if historical metadata cannot identify the canonical file (%j)",
    async (extractedPackageJson) => {
      const { t, release } = await fixture();
      await t.run((ctx) => ctx.db.patch(release, { extractedPackageJson }));
      expect(await (await t.fetch(scoped + view)).json()).not.toHaveProperty("templateRelease");
    },
  );
  it("does not use case-insensitive aliases or the decoy root when the authored path is absent", async () => {
    const { t, release, files } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch(release, {
        files: files.map((f) => (f.path === path ? { ...f, path: path.toUpperCase() } : f)),
      }),
    );
    expect((await (await t.fetch(scoped + view)).json()).templateRelease).toEqual({
      version,
      contents: null,
      llmAnalysis,
    });
  });
  it("rejects oversized previews and integrity mismatches; legitimate missing or non-text files remain nullable", async () => {
    const { t, release, files } = await fixture();
    const original = files.find((f) => f.path === path)!;
    const update = (patch: Partial<typeof original>) =>
      t.run((ctx) => ctx.db.patch(release, { files: [{ ...original, ...patch }] }));
    await update({ size: MAX_RAW_FILE_BYTES + 1 });
    expect((await t.fetch(scoped + view)).status).toBe(413);
    await update({ sha256: "0".repeat(64) });
    expect((await t.fetch(scoped + view)).status).toBe(503);
    await update({ size: original.size - 1 });
    expect((await t.fetch(scoped + view)).status).toBe(503);
    const bytes = new Uint8Array([0xff]);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes])));
    await update({ size: 1, storageId, sha256: await sha256Hex(bytes) });
    expect((await (await t.fetch(scoped + view)).json()).templateRelease.contents).toBeNull();
    await t.run((ctx) => ctx.storage.delete(storageId));
    expect((await (await t.fetch(scoped + view)).json()).templateRelease.contents).toBeNull();
  });
});
