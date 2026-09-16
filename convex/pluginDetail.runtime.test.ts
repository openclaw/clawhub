/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { MAX_RAW_FILE_BYTES } from "./httpApiV1/shared";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");
const path = "/api/v1/packages/%40fixture%2Fplugin";

async function fixture(family: "code-plugin" | "bundle-plugin" = "code-plugin") {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const token = "local-plugin-detail-owner";
  const tokenHash = await hashToken(token);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "fixture" });
    await ctx.db.insert("apiTokens", {
      userId: ownerUserId,
      label: "fixture",
      prefix: "fixture",
      tokenHash,
      createdAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob(["# Plugin README"]));
    const packageId = await ctx.db.insert("packages", {
      name: "@fixture/plugin",
      normalizedName: "@fixture/plugin",
      displayName: "Plugin",
      ownerUserId,
      family,
      channel: "community",
      isOfficial: false,
      scanStatus: "clean",
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 12 },
      createdAt: 1,
      updatedAt: 12,
    });
    const releaseIds = [];
    for (let i = 1; i <= 12; i++) {
      releaseIds.push(
        await ctx.db.insert("packageReleases", {
          packageId,
          version: `${i}.0.0`,
          publicationStatus: "published",
          changelog: `Release ${i}`,
          distTags: i === 12 ? ["latest"] : [],
          files: [
            {
              path: "README.md",
              size: 15,
              storageId,
              sha256: "a".repeat(64),
              contentType: "text/markdown",
            },
          ],
          source: { path: "/plugins/fixture/" },
          integritySha256: "b".repeat(64),
          createdAt: i,
          createdBy: ownerUserId,
          llmAnalysis: { status: "clean", checkedAt: 1 },
          verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
        }),
      );
    }
    const latestReleaseId = releaseIds[11]!;
    const olderReleaseId = releaseIds[0]!;
    await ctx.db.patch(packageId, { latestReleaseId, tags: { latest: latestReleaseId } });
    return { packageId, latestReleaseId, olderReleaseId };
  });
  const ownerHeaders = { authorization: `Bearer ${token}` };
  return { t, ...ids, ownerHeaders };
}

describe("plugin detail snapshot", () => {
  it.each(["code-plugin", "bundle-plugin"] as const)(
    "matches the five existing responses for %s and keeps history bounded",
    async (family) => {
      const { t } = await fixture(family);
      for (const version of [undefined, "1.0.0"]) {
        const selected = version ?? "12.0.0";
        const metadata = await (await t.fetch(path)).json();
        const versions = await (await t.fetch(`${path}/versions?limit=10`)).json();
        const release = await (await t.fetch(`${path}/versions/${selected}`)).json();
        const security = await (await t.fetch(`${path}/versions/${selected}/security`)).json();
        const readme = await (
          await t.fetch(`${path}/file?path=README.md&preview=1&version=${selected}`)
        ).text();
        const response = await t.fetch(`${path}/detail${version ? `?version=${version}` : ""}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const detail = await response.json();
        expect(detail).toEqual({
          ...metadata,
          versions,
          version: release.version,
          readme,
          security,
        });
        expect(detail.versions.items).toHaveLength(10);
        expect(JSON.stringify(detail)).not.toContain("storageId");
      }
    },
  );

  it("keeps private packages scoped to their owner and public malware security readable", async () => {
    const { t, packageId, ownerHeaders } = await fixture();
    await t.run((ctx) => ctx.db.patch(packageId, { channel: "private" }));
    expect((await t.fetch(`${path}/detail`)).status).toBe(404);
    expect((await t.fetch(`${path}/detail`, { headers: ownerHeaders })).status).toBe(200);
    await t.run((ctx) =>
      ctx.db.patch(packageId, { channel: "community", scanStatus: "malicious" }),
    );
    await t.run(async (ctx) => {
      const pkg = await ctx.db.get(packageId);
      await ctx.db.patch(pkg!.latestReleaseId!, {
        manualModeration: {
          state: "quarantined",
          reason: "fixture",
          updatedAt: 1,
          reviewerUserId: pkg!.ownerUserId,
        },
      });
    });
    expect((await t.fetch(`${path}/detail`)).status).toBe(404);
    expect((await t.fetch(`${path}/detail?version=1.0.0`)).status).toBe(404);
    const olderReadmePath = `${path}/file?path=README.md&preview=1&version=1.0.0`;
    expect((await t.fetch(olderReadmePath)).status).toBe(404);
    expect((await t.fetch(`${path}/versions/12.0.0/security`)).status).toBe(200);
    const detail = await (await t.fetch(`${path}/detail`, { headers: ownerHeaders })).json();
    expect(detail.readme).toBeNull();
    expect(detail.security.trust.blockedFromDownload).toBe(true);
    const olderDetail = await (
      await t.fetch(`${path}/detail?version=1.0.0`, { headers: ownerHeaders })
    ).json();
    const olderReadme = await t.fetch(olderReadmePath, { headers: ownerHeaders });
    expect(olderReadme.status).toBe(200);
    expect(olderDetail.readme).toBe(await olderReadme.text());
    expect(olderDetail.security.trust.blockedFromDownload).toBe(false);
  });

  it.each(["pending", "deleted", "missing"] as const)(
    "rejects %s exact releases",
    async (state) => {
      const { t, olderReleaseId } = await fixture();
      if (state === "pending")
        await t.run((ctx) => ctx.db.patch(olderReleaseId, { publicationStatus: "pending" }));
      if (state === "deleted")
        await t.run((ctx) => ctx.db.patch(olderReleaseId, { softDeletedAt: 1 }));
      const version = state === "missing" ? "99.0.0" : "1.0.0";
      expect((await t.fetch(`${path}/detail?version=${version}`)).status).toBe(404);
    },
  );

  it.each(["missing", "binary", "oversized"] as const)(
    "preserves %s README behavior",
    async (state) => {
      const { t, latestReleaseId } = await fixture();
      await t.run(async (ctx) => {
        const release = await ctx.db.get(latestReleaseId);
        const storageId = await ctx.storage.store(new Blob([new Uint8Array([255, 0])]));
        await ctx.db.patch(latestReleaseId, {
          files:
            state === "missing"
              ? []
              : release!.files.map((file) => ({
                  ...file,
                  storageId,
                  size: state === "oversized" ? MAX_RAW_FILE_BYTES + 1 : 2,
                })),
        });
      });
      const response = await t.fetch(`${path}/detail`);
      expect(response.status).toBe(state === "oversized" ? 413 : 200);
      if (response.ok) expect((await response.json()).readme).toBeNull();
    },
  );

  it("keeps a published package without a latest selection readable", async () => {
    const { t, packageId } = await fixture();
    await t.run((ctx) => ctx.db.patch(packageId, { latestReleaseId: undefined, tags: {} }));
    const response = await t.fetch(`${path}/detail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: null, security: null, readme: null });
  });
});
