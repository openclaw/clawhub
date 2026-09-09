/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("plugin publisher badges", () => {
  it.each(["code-plugin", "bundle-plugin"] as const)(
    "projects current publisher status for %s without changing package status",
    async (family) => {
      const t = convexTest(schema, modules);
      registerRateLimiter(t);
      const fixture = await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", { handle: "custodian" });
        const publisherId = await ctx.db.insert("publishers", {
          kind: "org",
          handle: "composio",
          displayName: "Composio",
          createdAt: 1,
          updatedAt: 1,
        });
        const badgeId = await ctx.db.insert("officialPublishers", {
          publisherId,
          createdAt: 1,
          updatedAt: 1,
        });
        const packageId = await ctx.db.insert("packages", {
          name: "@composio/composio",
          normalizedName: "@composio/composio",
          displayName: "Composio",
          ownerUserId,
          ownerPublisherId: publisherId,
          family,
          channel: "community",
          isOfficial: false,
          scanStatus: "clean",
          categories: ["integrations"],
          tags: {},
          stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
          createdAt: 1,
          updatedAt: 1,
        });
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          publicationStatus: "published",
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          integritySha256: "a".repeat(64),
          createdAt: 1,
          createdBy: ownerUserId,
        });
        await ctx.db.patch(packageId, {
          latestReleaseId: releaseId,
          latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Initial release" },
          tags: { latest: releaseId },
        });
        const pkg = await ctx.db.get(packageId);
        if (!pkg) throw new Error("Missing fixture");
        await upsertPackageSearchDigest(ctx, {
          ...extractPackageDigestFields(pkg),
          ownerHandle: "composio",
          ownerKind: "org",
        });
        return { publisherId, badgeId };
      });
      const assertCatalog = async (ownerOfficial: boolean) => {
        for (const route of [
          "/api/v1/plugins/search?q=composio",
          "/api/v1/plugins",
          "/api/v1/plugins?sort=downloads",
          "/api/v1/plugins?category=integrations",
        ]) {
          const response = await t.fetch(route);
          expect(response.status).toBe(200);
          const body = await response.json();
          const items =
            body.items ?? body.results.map((entry: { package: unknown }) => entry.package);
          expect(items).toEqual([
            expect.objectContaining({
              ownerHandle: "composio",
              ownerOfficial,
              isOfficial: false,
              channel: "community",
            }),
          ]);
        }
      };
      await assertCatalog(true);
      const officialOnly = await t.fetch("/api/v1/plugins/search?q=composio&isOfficial=true");
      expect((await officialOnly.json()).results).toEqual([]);
      // No package/digest write: revocation and grants must take effect immediately.
      await t.run(async (ctx) => {
        await ctx.db.delete(fixture.badgeId);
      });
      await assertCatalog(false);
      await t.run(async (ctx) => {
        await ctx.db.insert("officialPublishers", {
          publisherId: fixture.publisherId,
          createdAt: 2,
          updatedAt: 2,
        });
      });
      await assertCatalog(true);
    },
  );
});
