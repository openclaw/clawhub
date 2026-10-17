/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));
import { api, internal } from "./_generated/api";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const expectedNames = ["@maker/research-claw", "@openclaw/research-claw"];

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "maker", role: "user" });
    const outsiderUserId = await ctx.db.insert("users", { handle: "reader", role: "user" });
    const personalPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "maker",
      displayName: "Claw Maker",
      linkedUserId: ownerUserId,
      image: "https://example.invalid/maker.png",
      createdAt: 1,
      updatedAt: 1,
    });
    const officialPublisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("officialPublishers", {
      publisherId: officialPublisherId,
      createdAt: 1,
      updatedAt: 1,
    });
    const variants = [
      { name: expectedNames[0] },
      { name: expectedNames[1], official: true },
      { name: "@openclaw/research-spoof" },
      { name: "@maker/research-private", channel: "private" },
      { name: "@maker/research-hidden", softDeletedAt: 1 },
      { name: "@maker/research-blocked", scanStatus: "malicious" },
      { name: "@maker/research-pending", published: false },
    ] as const;
    for (const variant of variants) {
      const options = variant as {
        name: string;
        official?: boolean;
        channel?: "private";
        softDeletedAt?: number;
        scanStatus?: "malicious";
        published?: boolean;
      };
      const ownerPublisherId = options.official ? officialPublisherId : personalPublisherId;
      const packageId = await ctx.db.insert("packages", {
        name: options.name,
        normalizedName: options.name,
        displayName: options.name,
        summary: "Research assistant",
        family: "claw",
        ownerUserId,
        ownerPublisherId,
        channel: options.channel ?? (options.official ? "official" : "community"),
        isOfficial: Boolean(options.official),
        scanStatus: options.scanStatus ?? "clean",
        softDeletedAt: options.softDeletedAt,
        categories: ["research"],
        topics: ["Research"],
        tags: {},
        stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: options.published === false ? "pending" : "published",
        changelog: "Initial release",
        distTags: ["latest"],
        files: [],
        integritySha256: "a".repeat(64),
        clawpackSha256: "a".repeat(64),
        artifactKind: "npm-pack",
        clawManifestSummary: {
          schemaVersion: 1,
          agent: { id: "research", name: "Research assistant" },
          workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
          packages: { skillCount: 0, pluginCount: 0 },
          mcpServerCount: 0,
          cronJobCount: 0,
        },
        createdAt: 1,
        createdBy: ownerUserId,
        verification: {
          tier: "source-linked",
          scope: "artifact-only",
          scanStatus: options.scanStatus ?? "clean",
        },
      });
      if (options.published !== false) {
        await ctx.db.patch(packageId, {
          latestReleaseId: releaseId,
          latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Initial release" },
          tags: { latest: releaseId },
        });
      }
      const pkg = await ctx.db.get(packageId);
      if (!pkg) throw new Error("Missing fixture package");
      await upsertPackageSearchDigest(ctx, {
        ...extractPackageDigestFields(pkg),
        ownerHandle: options.official ? "openclaw" : "maker",
        ownerKind: options.official ? "org" : "user",
      });
      await ctx.db.insert("packageBadges", {
        packageId,
        kind: "highlighted",
        byUserId: ownerUserId,
        at: 1,
      });
    }
    return { personalPublisherId, outsiderUserId };
  });
  return { t, ...ids };
}

describe("community Claw discovery", () => {
  it.each(["anonymous", "another user"] as const)(
    "lists and searches personal Claws with creator attribution for %s",
    async (viewer) => {
      const { t, outsiderUserId } = await fixture();
      const client = viewer === "anonymous" ? t : t.withIdentity({ subject: outsiderUserId });
      for (const filters of [
        {},
        { category: "research" },
        { topic: "research" },
        { highlightedOnly: true },
      ]) {
        const listed = await client.query(api.packages.listPublicPage, {
          family: "claw",
          ...filters,
          paginationOpts: { cursor: null, numItems: 20 },
        });
        expect(listed.page.map((entry) => entry.name).sort()).toEqual(expectedNames);
        const searched = await client.query(api.packages.searchPublic, {
          query: "research",
          family: "claw",
          ...filters,
        });
        expect(searched.map((entry) => entry.package.name).sort()).toEqual(expectedNames);
        for (const entries of [listed.page, searched.map((entry) => entry.package)]) {
          expect(entries.find((entry) => entry.name === expectedNames[0])).toMatchObject({
            ownerHandle: "maker",
            ownerImage: "https://example.invalid/maker.png",
            ownerOfficial: false,
            channel: "community",
            isOfficial: false,
          });
        }
      }
      for (const sort of ["downloads", "installs", "recommended"] as const) {
        const listed = await client.query(api.packages.listPublicPage, {
          family: "claw",
          sort,
          paginationOpts: { cursor: null, numItems: 20 },
        });
        expect(listed.page.map((entry) => entry.name).sort()).toEqual(expectedNames);
      }
      expect(
        await client.query(api.packages.searchPublic, {
          family: "claw",
          query: "research",
          channel: "private",
        }),
      ).toEqual([]);
    },
  );

  it("serves community discovery through HTTP without adding it to the official feed", async () => {
    const { t } = await fixture();
    for (const path of [
      "/api/v1/packages?family=claw",
      "/api/v1/packages?family=claw&sort=downloads",
      "/api/v1/packages/search?family=claw&q=research",
    ]) {
      const response = await t.fetch(path);
      expect(response.status, path).toBe(200);
      const body = await response.json();
      const names = body.results
        ? body.results.map((entry: { package: { name: string } }) => entry.package.name)
        : body.items.map((entry: { name: string }) => entry.name);
      expect(names.sort(), path).toEqual(expectedNames);
    }
    const feed = await t.query(internal.catalogFeed.listOfficialClawEntries, { cursor: null });
    expect(feed.entries.map((entry) => entry.id)).toEqual(["@openclaw/research-claw"]);
  });

  it.each(["deletedAt", "deactivatedAt"] as const)(
    "removes a personal publisher with %s from every catalog path without digest backfills",
    async (field) => {
      const { t, personalPublisherId } = await fixture();
      await t.run(async (ctx) => {
        await ctx.db.patch(personalPublisherId, { [field]: 123 });
      });
      for (const filters of [{}, { highlightedOnly: true }, { sort: "downloads" as const }]) {
        const listed = await t.query(api.packages.listPublicPage, {
          family: "claw",
          ...filters,
          paginationOpts: { cursor: null, numItems: 20 },
        });
        expect(listed.page.map((entry) => entry.name)).toEqual([expectedNames[1]]);
      }
      const searched = await t.query(api.packages.searchPublic, {
        query: "research",
        family: "claw",
      });
      expect(searched.map((entry) => entry.package.name)).toEqual([expectedNames[1]]);
    },
  );
});
