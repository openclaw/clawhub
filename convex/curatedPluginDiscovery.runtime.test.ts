/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
import { internal } from "./_generated/api";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { isEnglishPluginListing } from "./lib/pluginDiscovery";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type Fixture = {
  name: string;
  downloads: number;
  category?: string;
  official?: boolean;
  family?: "code-plugin" | "bundle-plugin";
  title?: string;
  private?: boolean;
  blocked?: boolean;
  topic?: string;
};

async function setup(fixtures: Fixture[]) {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "fixture-publisher" });
    for (const [index, fixture] of fixtures.entries()) {
      const packageId = await ctx.db.insert("packages", {
        name: fixture.name,
        normalizedName: fixture.name,
        displayName: fixture.title ?? "Research assistant",
        summary:
          "Search the web and summarize research findings with citations to the original sources.",
        family: fixture.family ?? "code-plugin",
        ownerUserId,
        channel: fixture.private ? "private" : fixture.official ? "official" : "community",
        isOfficial: fixture.official ?? false,
        scanStatus: fixture.blocked ? "malicious" : "clean",
        categories: [fixture.category ?? "memory"],
        topics: fixture.topic ? [fixture.topic] : undefined,
        tags: {},
        stats: { downloads: fixture.downloads, installs: 0, stars: 0, versions: 1 },
        latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Fixture" },
        createdAt: index + 1,
        updatedAt: index + 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: "Fixture",
        distTags: ["latest"],
        files: [],
        integritySha256: "a".repeat(64),
        createdAt: 1,
        createdBy: ownerUserId,
        verification: {
          tier: "source-linked",
          scope: "artifact-only",
          scanStatus: fixture.blocked ? "malicious" : "clean",
        },
      });
      await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
      const pkg = await ctx.db.get(packageId);
      if (!pkg) throw new Error("Missing fixture");
      await upsertPackageSearchDigest(ctx, extractPackageDigestFields(pkg));
    }
  });
  return t;
}

describe("curated plugin discovery", () => {
  it("round-trips a Unicode topic through the public curated cursor", async () => {
    const t = await setup([
      { name: "first", downloads: 2, topic: "研究" },
      { name: "second", downloads: 1, topic: "研究" },
    ]);
    const url =
      "/api/v1/plugins?curated=true&category=memory&sort=downloads&limit=1&topic=" +
      encodeURIComponent("研究");
    const first = await t.fetch(url);
    expect(first.status).toBe(200);
    const payload = await first.json();
    expect(payload.items.map((item: { name: string }) => item.name)).toEqual(["first"]);
    const second = await t.fetch(url + "&cursor=" + encodeURIComponent(payload.nextCursor));
    expect(second.status).toBe(200);
    expect((await second.json()).items.map((item: { name: string }) => item.name)).toEqual([
      "second",
    ]);
  });

  it("resolves low-download pins before the shelf limit, then ranks community and official together", async () => {
    const t = await setup([
      ...Array.from({ length: 12 }, (_, index) => ({
        name: `community-${index}`,
        downloads: 1000 - index,
      })),
      { name: "@honcho-ai/openclaw-honcho", downloads: 1 },
      { name: "@mem0/openclaw-mem0", downloads: 2 },
      { name: "official-tail", downloads: 3, official: true },
    ]);
    const rows = await t.query(internal.packages.listPluginOverviewCategoryInternal, {
      category: "memory",
      numItems: 8,
    });
    expect(rows.map((row) => row.name)).toEqual([
      "@honcho-ai/openclaw-honcho",
      "@mem0/openclaw-mem0",
      ...Array.from({ length: 6 }, (_, index) => `community-${index}`),
    ]);
  });

  it("keeps canonical-name ties and pins stable across HTTP pages and both plugin families", async () => {
    const t = await setup([
      { name: "z-last", downloads: 10, family: "bundle-plugin" },
      { name: "a-first", downloads: 10, official: true },
      { name: "b-middle", downloads: 10 },
      { name: "@honcho-ai/openclaw-honcho", downloads: 0 },
      { name: "@mem0/openclaw-mem0", downloads: 10000, private: true },
      { name: "@supermemory/openclaw-supermemory", downloads: 10000, blocked: true },
    ]);
    const names: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const response = await t.fetch(
        `/api/v1/plugins?curated=true&category=memory&sort=downloads&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.categories[0].pinnedPackages[0]).toBe("@honcho-ai/openclaw-honcho");
      names.push(...payload.items.map((item: { name: string }) => item.name));
      cursor = payload.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(names).toEqual(["@honcho-ai/openclaw-honcho", "a-first", "b-middle", "z-last"]);
  });

  it("filters homepage language before backfilling eight research cards while keeping category browse complete", async () => {
    const t = await setup([
      { name: "non-english", title: "社媒数据助手", downloads: 10000, category: "research" },
      ...Array.from({ length: 10 }, (_, index) => ({
        name: `research-${index}`,
        downloads: 100 - index,
        category: "research",
      })),
      { name: "misc", downloads: 20000, category: "other" },
    ]);
    const response = await t.fetch("/api/v1/plugins/overview");
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.categories.map((category: { slug: string }) => category.slug)).not.toContain(
      "other",
    );
    expect(payload.categories.map((category: { slug: string }) => category.slug)).toContain(
      "computer-use",
    );
    expect(
      payload.categories.find((category: { slug: string }) => category.slug === "models")
        .pinnedPackages,
    ).toEqual([
      "@openclaw/openai-provider",
      "@openclaw/anthropic-provider",
      "@openclaw/google-plugin",
    ]);
    expect(
      payload.items
        .filter((item: { categories: string[] }) => item.categories.includes("research"))
        .map((item: { name: string }) => item.name),
    ).toEqual(Array.from({ length: 8 }, (_, index) => `research-${index}`));
    expect((await t.fetch("/api/v1/packages/non-english")).status).toBe(200);
    const browse = await t.fetch(
      "/api/v1/plugins?curated=true&category=research&sort=downloads&limit=100",
    );
    expect(browse.status).toBe(200);
    expect((await browse.json()).items.map((item: { name: string }) => item.name)).toEqual([
      "non-english",
      ...Array.from({ length: 10 }, (_, index) => `research-${index}`),
    ]);
  });

  it("expires a reviewed short English listing exception when its text changes", () => {
    const listing = {
      name: "@openclaw/zoom-meetings",
      displayName: "Zoom meetings",
      summary: "OpenClaw Zoom browser meeting participant plugin.",
    };
    expect(isEnglishPluginListing(listing)).toBe(true);
    expect(isEnglishPluginListing({ ...listing, displayName: "会议助手" })).toBe(false);
    expect(isEnglishPluginListing({ ...listing, summary: "会议助手支持会议工作流" })).toBe(false);
    expect(isEnglishPluginListing({ ...listing, name: "unreviewed-copy" })).toBe(false);
  });
});
