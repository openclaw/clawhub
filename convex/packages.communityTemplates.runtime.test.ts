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
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "maker", role: "user" });
    const outsiderUserId = await ctx.db.insert("users", { handle: "reader", role: "user" });
    const personalPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "maker",
      displayName: "Template Maker",
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

describe("community Template discovery", () => {
  it("returns the same public featured and category selection in one overview", async () => {
    const { t, personalPublisherId } = await fixture();
    const overview = await t.query(internal.templateOverview.get, { limit: 8 });
    expect(overview.complete).toBe(true);
    const response = await t.fetch("/api/v1/templates/overview?limit=8");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(overview);
    for (const limit of ["0", "9", "1.5", "invalid"]) {
      expect((await t.fetch(`/api/v1/templates/overview?limit=${limit}`)).status).toBe(400);
    }
    expect(overview.featured.map((entry) => entry.name).sort()).toEqual(expectedNames);
    expect(overview.sections).toHaveLength(1);
    expect(overview.sections[0].category).toBe("research");
    expect(overview.sections[0].items.map((entry) => entry.name).sort()).toEqual(expectedNames);
    expect(
      overview.sections[0].items.find((entry) => entry.name === expectedNames[0]),
    ).toMatchObject({ ownerHandle: "maker", ownerOfficial: false });
    await t.run(async (ctx) => {
      await ctx.db.patch(personalPublisherId, { deactivatedAt: 2 });
    });
    const deactivated = await t.query(internal.templateOverview.get, { limit: 8 });
    expect(deactivated.featured.map((entry) => entry.name)).toEqual([expectedNames[1]]);
    expect(deactivated.sections[0].items.map((entry) => entry.name)).toEqual([expectedNames[1]]);
  });

  it("uses current install counts and official badges, without a persistent cache", async () => {
    const { t } = await fixture();
    await t.run(async (ctx) => {
      const pkg = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", expectedNames[0]))
        .unique();
      if (!pkg) throw Error("Missing fixture");
      await ctx.db.patch(pkg._id, { stats: { ...pkg.stats, installs: 100 } });
      const badge = await ctx.db.query("officialPublishers").first();
      if (!badge) throw Error("Missing badge");
      await ctx.db.delete(badge._id);
    });
    const overview = await t.query(internal.templateOverview.get, { limit: 1 });
    expect(overview.sections[0].items.map((entry) => entry.name)).toEqual([expectedNames[0]]);
    expect(overview.featured.every((entry) => !entry.ownerOfficial)).toBe(true);
  });

  it("hydrates 1,000 genuinely visible templates at the supported cap", async () => {
    const { t } = await fixture();
    await t.run(async (ctx) => {
      const digests = await ctx.db.query("packageSearchDigest").collect();
      const template = digests.find((digest) => digest.name === expectedNames[0]);
      if (!template) throw Error("Missing fixture");
      const pkg = await ctx.db.get(template.packageId);
      if (!pkg) throw Error("Missing package");
      for (const digest of digests) await ctx.db.delete(digest._id);
      const { _id, _creationTime, ...fields } = pkg;
      for (let index = 0; index < 1000; index += 1) {
        const name = "@maker/full-cap-" + index.toString().padStart(4, "0");
        const packageId = await ctx.db.insert("packages", {
          ...fields,
          name,
          normalizedName: name,
        });
        await upsertPackageSearchDigest(ctx, {
          ...extractPackageDigestFields({ ...pkg, _id: packageId, name, normalizedName: name }),
          ownerHandle: "maker",
          ownerKind: "user",
        });
      }
    });
    const overview = await t.query(internal.templateOverview.get, { limit: 8 });
    expect(overview.complete).toBe(true);
    expect(overview.sections[0].items.map((item) => item.name)).toEqual(
      Array.from(
        { length: 8 },
        (_, index) => "@maker/full-cap-" + index.toString().padStart(4, "0"),
      ),
    );
  });

  it("requests legacy pagination rather than ranking an incomplete bounded catalog", async () => {
    const { t } = await fixture();
    await t.run(async (ctx) => {
      const digest = await ctx.db.query("packageSearchDigest").first();
      if (!digest) throw Error("Missing digest");
      const { _id, _creationTime, ...fields } = digest;
      for (let index = 0; index < 1001; index += 1) {
        await ctx.db.insert("packageSearchDigest", {
          ...fields,
          family: "claw",
          softDeletedAt: undefined,
          name: `@maker/overflow-${index}`,
          normalizedName: `@maker/overflow-${index}`,
        });
      }
    });
    expect(await t.query(internal.templateOverview.get, { limit: 8 })).toEqual({
      complete: false,
      featured: [],
      sections: [],
    });
  });

  it.each(["anonymous", "another user"] as const)(
    "lists and searches personal Templates with creator attribution for %s",
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
          family: "template",
          ...filters,
          paginationOpts: { cursor: null, numItems: 20 },
        });
        expect(listed.page.map((entry) => entry.name).sort()).toEqual(expectedNames);
        const searched = await client.query(api.packages.searchPublic, {
          query: "research",
          family: "template",
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
          family: "template",
          sort,
          paginationOpts: { cursor: null, numItems: 20 },
        });
        expect(listed.page.map((entry) => entry.name).sort()).toEqual(expectedNames);
      }
      expect(
        await client.query(api.packages.searchPublic, {
          family: "template",
          query: "research",
          channel: "private",
        }),
      ).toEqual([]);
    },
  );

  it("serves community discovery through HTTP without adding it to the official feed", async () => {
    const { t } = await fixture();
    for (const path of [
      "/api/v1/packages?family=template",
      "/api/v1/packages?family=template&sort=downloads",
      "/api/v1/packages/search?family=template&q=research",
    ]) {
      const response = await t.fetch(path);
      expect(response.status, path).toBe(200);
      const body = await response.json();
      const names = body.results
        ? body.results.map((entry: { package: { name: string } }) => entry.package.name)
        : body.items.map((entry: { name: string }) => entry.name);
      expect(names.sort(), path).toEqual(expectedNames);
    }
    const feed = await t.query(internal.catalogFeed.listOfficialTemplateEntries, { cursor: null });
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
          family: "template",
          ...filters,
          paginationOpts: { cursor: null, numItems: 20 },
        });
        expect(listed.page.map((entry) => entry.name)).toEqual([expectedNames[1]]);
      }
      const searched = await t.query(api.packages.searchPublic, {
        query: "research",
        family: "template",
      });
      expect(searched.map((entry) => entry.package.name)).toEqual([expectedNames[1]]);
    },
  );
});
