/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { createPackageSeedDefaults } from "../src/__tests__/helpers/packageSeed";
import { api, internal } from "./_generated/api";
import { upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { extractPackageDigestFields } from "./lib/packageSearchDigestProjection";
import schema from "./schema";

// Test the anonymous catalog endpoints, not the separately tested ingress trust boundary.
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const agentMail = "@agentmail/agentmail";
const modules = import.meta.glob("./**/*.ts");

async function fixture(setupCount = 0, workflowCategories = ["documents-files"]) {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "discovery-author" });
    const storageId = await ctx.storage.store(new Blob(["export default {}"]));
    const ids = [];
    const variants = [
      ...Array.from(
        { length: setupCount },
        (_, index) => [`setup-${index}`, "models", true] as const,
      ),
      [agentMail, "channels", false],
      ["inference", "models", false],
      ["engine", "agent-runtimes", true],
      ["official-workflow", "documents-files", true],
      ["community-workflow", "scheduling", false],
      ["media-workflow", "media", true],
      ["search-tool", "web", false],
    ] as const;
    for (const [name, category, isOfficial] of variants) {
      const packageId = await ctx.db.insert("packages", {
        ...createPackageSeedDefaults(),
        name,
        normalizedName: name,
        displayName: name,
        summary:
          "Search the web and summarize research findings with citations to original sources.",
        ownerUserId,
        channel: isOfficial ? "official" : "community",
        isOfficial,
        categories: name === "official-workflow" ? workflowCategories : [category],
        scanStatus: "clean",
        stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: "Initial",
        distTags: ["latest"],
        files: [{ path: "index.js", size: 17, storageId, sha256: "a".repeat(64) }],
        integritySha256: "b".repeat(64),
        createdAt: 1,
        createdBy: ownerUserId,
        verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
      });
      await ctx.db.patch(packageId, {
        latestReleaseId: releaseId,
        latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Initial" },
        tags: { latest: releaseId },
      });
      const pkg = await ctx.db.get(packageId);
      await upsertPackageSearchDigest(ctx, extractPackageDigestFields(pkg!));
      ids.push({ name, packageId });
    }
    await ctx.db.insert("packageLeaderboards", {
      kind: "package_trending_24h",
      generatedAt: 1,
      rangeStartDay: 0,
      rangeEndDay: 1,
      items: ids.map(({ packageId }, index) => ({
        packageId,
        score: 20 - index,
        downloads: 20 - index,
        installs: 0,
      })),
    });
    return { ids, ownerUserId };
  });
  return { t, ...seeded };
}

it("serves a staff-featured channel on the public Featured list and overview, but not Trending", async () => {
  const { t, ids } = await fixture();
  registerRateLimiter(t, "rateLimiterV2");
  const moderator = await t.run((ctx) => ctx.db.insert("users", { role: "moderator" }));
  const packageId = ids.find(({ name }) => name === agentMail)!.packageId;
  const ordinarySearch = () => t.query(api.packages.searchPublic, { query: "agentmail" });
  const before = await ordinarySearch();
  expect(before.map((entry) => entry.package.name)).toEqual([agentMail]);
  await t.withIdentity({ subject: moderator }).mutation(api.packages.setBatch, {
    packageId,
    batch: "highlighted",
  });
  const list = await t.fetch("/api/v1/plugins?featured=true");
  expect(list.status).toBe(200);
  expect((await list.json()).items).toMatchObject([{ name: agentMail }]);
  const overview = await t.fetch("/api/v1/plugins/overview");
  expect(overview.status).toBe(200);
  const channel = (await overview.json()).items.find(
    (item: { name: string }) => item.name === agentMail,
  );
  expect(channel).toMatchObject({ featured: true, featuredRank: 0 });
  expect(channel.trending).not.toBe(true);
  // A manual badge must not give the channel extra recall or rank in ordinary search.
  expect(await ordinarySearch()).toEqual(before);
});

it("keeps setup purposes out of automatic discovery and serves only allowed explicit badges", async () => {
  const { t, ids, ownerUserId } = await fixture();
  const trending = await t.query(api.packages.listPublicPage, {
    sort: "trending",
    paginationOpts: { cursor: null, numItems: 2 },
  });
  expect(trending.page.map((row) => row.name)).toEqual(["official-workflow", "community-workflow"]);
  const next = await t.query(api.packages.listPublicPage, {
    sort: "trending",
    paginationOpts: { cursor: trending.continueCursor, numItems: 2 },
  });
  expect(next.page.map((row) => row.name)).toEqual(["media-workflow", "search-tool"]);
  expect(next.isDone).toBe(true);
  const metadata = await t.query(internal.featuredArtifacts.readInternal, {
    identities: ids.map(({ name }) => `plugin:${name}`),
  });
  expect(metadata.slice(0, 3).map((row) => row.eligibilityReasons)).toEqual([
    ["discovery-excluded:channels"],
    ["discovery-excluded:models"],
    ["discovery-excluded:agent-runtimes"],
  ]);
  expect(metadata.slice(3).every((row) => row.eligibleForFeatured)).toBe(true);
  const all = await t.query(api.packages.listPublicPage, {
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(all.page.map((row) => row.name).sort()).toEqual(ids.map((row) => row.name).sort());
  expect(
    (await t.query(api.packages.searchPublic, { query: "agentmail" })).map(
      (row) => row.package.name,
    ),
  ).toEqual([agentMail]);
  await t.run(async (ctx) => {
    for (const { packageId } of ids)
      await ctx.db.insert("packageBadges", {
        packageId,
        kind: "highlighted",
        byUserId: ownerUserId,
        at: 1,
      });
  });
  const featured = await t.query(api.packages.listPublicPage, {
    highlightedOnly: true,
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(featured.page.map((row) => row.name).sort()).toEqual([
    agentMail,
    "community-workflow",
    "media-workflow",
    "official-workflow",
    "search-tool",
  ]);
});

it("continues a pre-Template unfiltered catalog cursor instead of restarting the page", async () => {
  const { t } = await fixture();
  const first = await t.query(api.packages.listPublicNewPluginsPage, {
    createdAfter: 0,
    paginationOpts: { cursor: null, numItems: 1 },
  });
  const second = await t.query(api.packages.listPublicNewPluginsPage, {
    createdAfter: 0,
    paginationOpts: { cursor: first.continueCursor, numItems: 1 },
  });
  expect(first.continueCursor).toMatch(/^pkgstable:/);
  expect(second.page).toHaveLength(1);

  // These fixture rows have identical createdAt and updatedAt values, so the
  // source keys from the created feed also describe a legacy updated feed.
  const cursor = JSON.parse(first.continueCursor.slice("pkgstable:".length));
  cursor.sort = "updated";
  cursor.sources.skill.done = false;
  const resumed = await t.query(api.packages.listPublicPage, {
    paginationOpts: { cursor: `pkgstable:${JSON.stringify(cursor)}`, numItems: 1 },
  });

  expect(resumed.page.map((row) => row.name)).toEqual(second.page.map((row) => row.name));
  expect(resumed.page.map((row) => row.name)).not.toEqual(first.page.map((row) => row.name));
  expect(resumed.continueCursor).toMatch(/^pkgstable:/);
});

it("selects adoption leaders after discovery eligibility, so higher setup adoption cannot consume the limit", async () => {
  const { t, ids, ownerUserId } = await fixture(205);
  await t.run(async (ctx) => {
    for (const { packageId, name } of ids) {
      // Every excluded setup plugin outranks the eligible plugins before filtering.
      for (
        let eventIndex = 0;
        eventIndex < (name.startsWith("setup-") ? 6 : name === "official-workflow" ? 3 : 2);
        eventIndex++
      ) {
        await ctx.db.insert("packageStatEvents", {
          packageId,
          kind: "download",
          occurredAt: Math.floor(Date.now() / 3600000) * 3600000 - 1,
        });
      }
      await ctx.db.insert("packageBadges", {
        packageId,
        kind: "highlighted",
        byUserId: ownerUserId,
        at: name.startsWith("setup-") ? 10 : 1,
      });
    }
  });
  expect(
    await t.action(internal.packageLeaderboards.rebuildTrendingLeaderboardAction, { limit: 1 }),
  ).toEqual({ ok: true, count: 1 });
  const page = await t.query(api.packages.listPublicPage, {
    sort: "trending",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(page.page.map((row) => row.name)).toEqual(["official-workflow"]);
  const featured = await t.query(api.packages.listPublicPage, {
    highlightedOnly: true,
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(featured.page.map((row) => row.name).sort()).toEqual([
    agentMail,
    "community-workflow",
    "media-workflow",
    "official-workflow",
    "search-tool",
  ]);
});

it.each([{ categories: ["channels", "scheduling"] }, { categories: ["scheduling", "channels"] }])(
  "does not invent a primary purpose from legacy category order: $categories",
  async ({ categories }) => {
    const { t } = await fixture(0, categories);
    const page = await t.query(api.packages.listPublicPage, {
      sort: "trending",
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(page.page.map((row) => row.name)).toEqual(["official-workflow", "community-workflow"]);
    const [metadata] = await t.query(internal.featuredArtifacts.readInternal, {
      identities: ["plugin:official-workflow"],
    });
    expect(metadata.eligibleForFeatured).toBe(true);
  },
);
