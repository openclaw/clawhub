/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

// Verified ingress is a system boundary; exercise the real HTTP, query, storage,
// visibility, and security paths below. Ingress verification has its own tests.
vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");
const bytes = new TextEncoder().encode("exact uploaded tarball bytes");
const sha256 = "2a7ec85db396a77bdeb7507bf0823d7599cc437bdd892d27b46a4aa40b26d6b9";

type TestRuntime = ReturnType<typeof runtime>;

async function fixture(t: TestRuntime, versions = 1, manifestBytes = 40_000) {
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([bytes])));
  return await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "npm-owner" });
    const packageId = await ctx.db.insert("packages", {
      name: "@community/history",
      normalizedName: "@community/history",
      displayName: "History",
      ownerUserId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      scanStatus: "suspicious",
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions },
      createdAt: 1,
      updatedAt: 1,
    });
    let releaseId;
    let firstReleaseId;
    for (let i = 0; i < versions; i += 1) {
      releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: `1.0.${i}`,
        publicationStatus: "published",
        changelog: "Published release",
        distTags: i === versions - 1 ? ["latest"] : [],
        files: [],
        integritySha256: sha256,
        artifactKind: "npm-pack",
        clawpackStorageId: storageId,
        clawpackSha256: sha256,
        clawpackSize: bytes.length,
        npmIntegrity:
          "sha512-R64GtgV7bL+WWbIuVk8R6DYJvrnOkF2b4qFreQ8z7PERKk44uynj04Kq5G6POLKBnmGDx8Lw+egDSuQbkIH3oQ==",
        npmShasum: "ca01b988f7c479c77b17e274b5ec67b9b8735139",
        npmTarballName: `community-history-1.0.${i}.tgz`,
        extractedPackageJson: { dependencies: { semver: "^7.0.0" } },
        // Legal stored payload, irrelevant to npm metadata. Production failed
        // while decoding/projecting a 100-release, ~11 MiB history page.
        extractedPluginManifest: { description: "x".repeat(manifestBytes) },
        llmAnalysis: { status: "suspicious", checkedAt: 1 },
        createdAt: i + 1,
        createdBy: ownerUserId,
      });
      firstReleaseId ??= releaseId;
    }
    if (!releaseId) throw new Error("Missing fixture release");
    await ctx.db.patch(packageId, {
      latestReleaseId: releaseId,
      latestVersionSummary: {
        version: `1.0.${versions - 1}`,
        changelog: "Published release",
        createdAt: versions,
      },
      tags: { latest: releaseId },
    });
    return { packageId, releaseId, firstReleaseId: firstReleaseId!, ownerUserId };
  });
}

function runtime(bounded = false) {
  const t = convexTest({
    schema,
    modules,
    // Enforce a deterministic headroom budget rather than depending on the
    // test machine's CPU speed to reproduce Convex's one-second query timeout.
    transactionLimits: bounded ? { bytesRead: 2 * 1024 * 1024 } : false,
  });
  registerRateLimiter(t, "rateLimiterV2");
  return t;
}

const tarball = (version: string) =>
  `/api/npm/@community/history/-/community-history-${version}.tgz`;

describe("npm delivery through real HTTP and release queries", () => {
  it("delivers complete metadata and old/current exact bytes within per-query budgets", async () => {
    const t = runtime(true);
    await fixture(t, 120);
    for (const name of ["@community/history", "@community%2fhistory", "@community%2Fhistory"]) {
      const response = await t.fetch(`/api/npm/${name}`);
      expect(response.status).toBe(200);
      const metadata = await response.json();
      expect(Object.keys(metadata.versions)).toHaveLength(120);
      expect(metadata["dist-tags"]).toEqual({ latest: "1.0.119" });
      expect(metadata.versions["1.0.0"]).toMatchObject({
        dependencies: { semver: "^7.0.0" },
        dist: {
          integrity:
            "sha512-R64GtgV7bL+WWbIuVk8R6DYJvrnOkF2b4qFreQ8z7PERKk44uynj04Kq5G6POLKBnmGDx8Lw+egDSuQbkIH3oQ==",
          shasum: "ca01b988f7c479c77b17e274b5ec67b9b8735139",
        },
      });
    }
    for (const version of ["1.0.0", "1.0.119"]) {
      for (const route of [
        tarball(version),
        `/api/v1/packages/@community/history/versions/${version}/artifact/download`,
      ]) {
        const response = await t.fetch(route);
        expect(response.status).toBe(200);
        const downloaded = new Uint8Array(await response.arrayBuffer());
        expect(downloaded).toEqual(bytes);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", downloaded));
        expect(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(
          sha256,
        );
        expect(response.headers.get("X-ClawHub-Artifact-Sha256")).toBe(sha256);
        expect(response.headers.get("ETag")).toBe(`"sha256:${sha256}"`);
      }
    }
  });

  it("continues byte-limited short pages instead of truncating at twenty pages", async () => {
    const t = runtime(true);
    await fixture(t, 25, 600_000);
    const response = await t.fetch("/api/npm/@community/history");
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()).versions)).toHaveLength(25);
    expect((await t.fetch(tarball("1.0.0"))).status).toBe(200);
  });

  it("allows the private owner, rejects outsiders, and rechecks token revocation", async () => {
    const t = runtime();
    const { packageId, ownerUserId } = await fixture(t);
    const tokenId = await t.run(async (ctx) => {
      await ctx.db.patch(packageId, { channel: "private" });
      const outsider = await ctx.db.insert("users", { handle: "npm-outsider" });
      await ctx.db.insert("apiTokens", {
        userId: outsider,
        label: "fixture",
        prefix: "fixture",
        tokenHash: await hashToken("npm-outsider-fixture"),
        createdAt: 1,
      });
      return await ctx.db.insert("apiTokens", {
        userId: ownerUserId,
        label: "fixture",
        prefix: "fixture",
        tokenHash: await hashToken("npm-owner-fixture"),
        createdAt: 1,
      });
    });
    for (const route of ["/api/npm/@community/history", tarball("1.0.0")]) {
      expect(
        (await t.fetch(route, { headers: { authorization: "Bearer npm-outsider-fixture" } }))
          .status,
      ).toBe(404);
      expect(
        (await t.fetch(route, { headers: { authorization: "Bearer npm-owner-fixture" } })).status,
      ).toBe(200);
    }
    await t.run(async (ctx) => await ctx.db.patch(tokenId, { revokedAt: 1 }));
    for (const route of ["/api/npm/@community/history", tarball("1.0.0")]) {
      expect(
        (await t.fetch(route, { headers: { authorization: "Bearer npm-owner-fixture" } })).status,
      ).toBe(404);
    }
  });

  it.each(["private", "soft-deleted", "malicious"] as const)(
    "does not expose %s packages through metadata or tarballs",
    async (state) => {
      const t = runtime();
      const { packageId, releaseId } = await fixture(t);
      await t.run(async (ctx) => {
        if (state === "private") await ctx.db.patch(packageId, { channel: "private" });
        if (state === "soft-deleted") await ctx.db.patch(packageId, { softDeletedAt: 1 });
        if (state === "malicious") {
          await ctx.db.patch(packageId, { scanStatus: "malicious" });
          await ctx.db.patch(releaseId, { llmAnalysis: { status: "malicious", checkedAt: 1 } });
        }
      });
      expect((await t.fetch("/api/npm/@community/history")).status).toBe(404);
      expect((await t.fetch(tarball("1.0.0"))).status).toBe(404);
    },
  );

  it.each(["pending", "blocked", "soft-deleted", "owner-deleted"] as const)(
    "does not list or download %s releases",
    async (state) => {
      const t = runtime();
      const { firstReleaseId } = await fixture(t, 2);
      await t.run(async (ctx) => {
        const patch: Partial<Doc<"packageReleases">> =
          state === "soft-deleted"
            ? { softDeletedAt: 1 }
            : state === "owner-deleted"
              ? { ownerDeletedAt: 1 }
              : { publicationStatus: state };
        await ctx.db.patch(firstReleaseId, patch);
      });
      const metadata = await t.fetch("/api/npm/@community/history");
      expect(metadata.status).toBe(200);
      expect(Object.keys((await metadata.json()).versions)).toEqual(["1.0.1"]);
      expect((await t.fetch(tarball("1.0.0"))).status).toBe(404);
    },
  );

  it.each(["quarantined", "revoked", "malicious"] as const)(
    "preserves the %s release download prohibition",
    async (state) => {
      const t = runtime();
      const { releaseId, ownerUserId } = await fixture(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(
          releaseId,
          state === "malicious"
            ? { llmAnalysis: { status: "malicious", checkedAt: 1 } }
            : {
                manualModeration: {
                  state,
                  reason: "Fixture policy hold",
                  reviewerUserId: ownerUserId,
                  updatedAt: 1,
                },
              },
        );
      });
      expect((await t.fetch(tarball("1.0.0"))).status).toBe(403);
    },
  );
});
