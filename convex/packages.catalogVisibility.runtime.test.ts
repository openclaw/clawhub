/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { hashToken } from "./lib/tokens";
import { PACKAGE_TRENDING_LEADERBOARD_KIND } from "./packageLeaderboards";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const bearer = "local-catalog-visibility-fixture";

async function fixture(role: "user" | "admin" = "admin") {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const fixtureOwnerUserId = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "maintainer", role });
    await ctx.db.insert("apiTokens", {
      userId: ownerUserId,
      label: "local fixture",
      prefix: "local",
      tokenHash: await hashToken(bearer),
      createdAt: Date.now(),
    });
    const storageId = await ctx.storage.store(new Blob(["fixture plugin"]));
    const variants = [
      { name: "whatsapp", channel: "private", published: false },
      { name: "whatsapp-reserved", published: false },
      { name: "whatsapp-pending", published: false, pending: true },
      { name: "whatsapp-empty-version", emptyVersion: true },
      { name: "whatsapp-private", channel: "private" },
      { name: "whatsapp-hidden", softDeletedAt: 1 },
      { name: "whatsapp-blocked", scanStatus: "malicious" },
      { name: "@openclaw/whatsapp" },
      { name: "whatsapp-bundle", family: "bundle-plugin" },
    ] as const;
    const leaderboardItems = [];
    for (const variant of variants) {
      const options = variant as {
        name: string;
        channel?: "private";
        published?: boolean;
        pending?: boolean;
        emptyVersion?: boolean;
        softDeletedAt?: number;
        scanStatus?: "malicious";
        family?: "bundle-plugin";
      };
      const published = options.published !== false;
      const version = options.emptyVersion ? "" : "1.0.0";
      const packageId = await ctx.db.insert("packages", {
        name: options.name,
        normalizedName: options.name,
        displayName: options.name,
        ownerUserId,
        family: options.family ?? "code-plugin",
        channel: options.channel ?? "official",
        isOfficial: !options.channel,
        scanStatus: options.scanStatus ?? "clean",
        softDeletedAt: options.softDeletedAt,
        categories: ["channels"],
        topics: ["WhatsApp"],
        tags: {},
        stats: { downloads: 1, installs: 1, stars: 0, versions: published ? 1 : 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      if (published || options.pending) {
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version,
          publicationStatus: published ? "published" : "pending",
          changelog: "Initial release",
          distTags: ["latest"],
          files: [{ path: "index.js", size: 14, storageId, sha256: "a".repeat(64) }],
          integritySha256: "b".repeat(64),
          createdAt: 1,
          createdBy: ownerUserId,
          verification: {
            tier: "source-linked",
            scope: "artifact-only",
            scanStatus: options.scanStatus ?? "clean",
          },
        });
        if (published) {
          await ctx.db.patch(packageId, {
            latestReleaseId: releaseId,
            latestVersionSummary: { version, createdAt: 1, changelog: "Initial release" },
            tags: { latest: releaseId },
          });
        }
      }
      leaderboardItems.push({ packageId, score: 1, installs: 1, downloads: 1 });
      const pkg = await ctx.db.get(packageId);
      if (!pkg) throw new Error("Missing fixture");
      await upsertPackageSearchDigest(ctx, extractPackageDigestFields(pkg));
      await ctx.db.insert("packageBadges", {
        packageId,
        kind: "highlighted",
        byUserId: ownerUserId,
        at: 1,
      });
    }
    await ctx.db.insert("packageLeaderboards", {
      kind: PACKAGE_TRENDING_LEADERBOARD_KIND,
      generatedAt: 1,
      rangeStartDay: 0,
      rangeEndDay: 1,
      items: leaderboardItems,
    });
    return ownerUserId;
  });
  return { t, ownerUserId: fixtureOwnerUserId };
}

const expectedNames = ["@openclaw/whatsapp", "whatsapp-bundle"];
const routes = [
  "/api/v1/plugins/search?q=whatsapp",
  "/api/v1/packages/search?q=whatsapp",
  "/api/v1/plugins/search?q=whatsapp&highlightedOnly=true",
  "/api/v1/plugins/search?q=whatsapp&category=channels",
  "/api/v1/plugins/search?q=whatsapp&topic=whatsapp&createdAfter=0",
  "/api/v1/plugins",
  "/api/v1/packages",
  "/api/v1/plugins?highlightedOnly=true",
  "/api/v1/plugins?category=channels&officialFirst=true",
  "/api/v1/plugins?topic=whatsapp",
  "/api/v1/plugins?sort=downloads",
  "/api/v1/plugins?sort=installs",
  "/api/v1/plugins?sort=recommended",
  "/api/v1/plugins?sort=trending",
  "/api/v1/code-plugins",
  "/api/v1/code-plugins?sort=downloads",
  "/api/v1/bundle-plugins",
  "/api/v1/plugins?channel=private",
  "/api/v1/plugins/search?q=whatsapp&channel=private",
];

describe("normal plugin catalog visibility", () => {
  it.each(["anonymous", "user", "admin"] as const)(
    "only discovers published public plugins as %s",
    async (viewer) => {
      const { t, ownerUserId } = await fixture(viewer === "user" ? "user" : "admin");
      const headers: Record<string, string> =
        viewer === "anonymous" ? {} : { Authorization: `Bearer ${bearer}` };
      for (const route of routes) {
        const response = await t.fetch(route, { headers });
        expect(response.status, route).toBe(200);
        const body = await response.json();
        const names = body.results
          ? body.results.map((entry: { package: { name: string } }) => entry.package.name)
          : body.items.map((entry: { name: string }) => entry.name);
        const expected = route.includes("channel=private")
          ? []
          : route.includes("/code-plugins")
            ? ["@openclaw/whatsapp"]
            : route.includes("/bundle-plugins")
              ? ["whatsapp-bundle"]
              : expectedNames;
        expect(names.sort(), route).toEqual(expected);
      }
      const browser = viewer === "anonymous" ? t : t.withIdentity({ subject: ownerUserId });
      expect(
        (await browser.query(api.packages.searchPublic, { query: "whatsapp" }))
          .map((entry) => entry.package.name)
          .sort(),
      ).toEqual(expectedNames);
      expect(
        (
          await browser.query(api.packages.listPublicPage, {
            paginationOpts: { cursor: null, numItems: 20 },
          })
        ).page
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(expectedNames);
    },
  );

  it.each([false, true])(
    "paginates past placeholders without losing public plugins (authenticated=%s)",
    async (authenticated) => {
      const { t } = await fixture();
      const headers: Record<string, string> = authenticated
        ? { Authorization: `Bearer ${bearer}` }
        : {};
      for (const sort of ["updated", "downloads", "installs", "recommended", "trending"]) {
        const names: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 12; page += 1) {
          const query = new URLSearchParams({ limit: "1", sort, ...(cursor ? { cursor } : {}) });
          const response = await t.fetch(`/api/v1/plugins?${query}`, { headers });
          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.items.length).toBeLessThanOrEqual(1);
          names.push(...body.items.map((entry: { name: string }) => entry.name));
          cursor = body.nextCursor;
          if (!cursor) break;
        }
        expect(cursor, sort).toBeFalsy();
        expect(names.sort(), sort).toEqual(expectedNames);
      }
    },
  );

  it("keeps blocked releases visible to the staff-only moderation queue", async () => {
    const { t } = await fixture();
    const route = "/api/v1/packages/moderation/queue?status=blocked";
    expect((await t.fetch(route)).status).toBe(401);
    const response = await t.fetch(route, { headers: { Authorization: `Bearer ${bearer}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).items.map((entry: { name: string }) => entry.name)).toEqual([
      "whatsapp-blocked",
    ]);
  });
});
