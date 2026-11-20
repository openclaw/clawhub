/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { ApiV1PluginOverviewResponseSchema, parseArk } from "clawhub-schema";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
import { internal } from "./_generated/api";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { isEnglishPluginListing } from "./lib/pluginDiscovery";
import { hashToken } from "./lib/tokens";
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
  registerRateLimiter(t, "rateLimiterV2");
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
  it.each(["plugins", "code-plugins", "bundle-plugins"])(
    "makes anonymous curated %s pages cacheable without exposing private or blocked entries",
    async (route) => {
      const t = await setup([
        { name: "public-code", downloads: 3 },
        { name: "public-bundle", downloads: 2, family: "bundle-plugin" },
        { name: "private", downloads: 100, private: true },
        { name: "blocked", downloads: 99, blocked: true },
      ]);
      const response = await t.fetch(
        `/api/v1/${route}?curated=true&category=memory&sort=downloads&limit=1`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      );
      const payload = await response.json();
      expect(payload.items.map((item: { name: string }) => item.name)).toEqual([
        route === "bundle-plugins" ? "public-bundle" : "public-code",
      ]);
    },
  );

  it.each<{ headers: Record<string, string>; query: string }>([
    { headers: { Authorization: "Bearer invalid-fixture-token" }, query: "" },
    { headers: { Cookie: "fixture=session" }, query: "" },
    { headers: {}, query: "&channel=private" },
  ])("does not share curated responses with credentials or private filters: %j", async (input) => {
    const t = await setup([{ name: "public", downloads: 1 }]);
    const response = await t.fetch(
      `/api/v1/plugins?curated=true&category=memory&sort=downloads${input.query}`,
      { headers: input.headers },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps non-curated requests and invalid curated requests uncacheable", async () => {
    const t = await setup([{ name: "public", downloads: 1 }]);
    for (const [query, status] of [
      ["category=memory&sort=downloads", 200],
      ["curated=true&category=memory&sort=trending", 400],
    ] as const) {
      const response = await t.fetch(`/api/v1/plugins?${query}`);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("keeps authenticated curated reads fresh and public-only even for the private package owner", async () => {
    const t = await setup([
      { name: "public", downloads: 1 },
      { name: "private", downloads: 100, private: true },
    ]);
    const token = "clh_disposable-curated-cache-fixture";
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      if (!user) throw new Error("Missing fixture owner");
      await ctx.db.insert("apiTokens", {
        userId: user._id,
        label: "Fixture",
        prefix: token.slice(0, 12),
        tokenHash: await hashToken(token),
        createdAt: Date.now(),
      });
    });
    const response = await t.fetch("/api/v1/plugins?curated=true&category=memory&sort=downloads", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Admitted requests carry no rate-limit headers.
    expect(response.headers.get("RateLimit-Limit")).toBeNull();
    expect((await response.json()).items.map((item: { name: string }) => item.name)).toEqual([
      "public",
    ]);
  });

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
    expect(first.headers.get("Cache-Control")).toContain("s-maxage=300");
    const payload = await first.json();
    expect(payload.items.map((item: { name: string }) => item.name)).toEqual(["first"]);
    const second = await t.fetch(url + "&cursor=" + encodeURIComponent(payload.nextCursor));
    expect(second.status).toBe(200);
    expect(second.headers.get("Cache-Control")).toBe(first.headers.get("Cache-Control"));
    expect((await second.json()).items.map((item: { name: string }) => item.name)).toEqual([
      "second",
    ]);
  });

  it("still reads pre-overview curated cursors as multilingual and bound to their category", async () => {
    const t = await setup([
      { name: "first", downloads: 10, category: "research" },
      { name: "second", title: "社媒数据助手", downloads: 9, category: "research" },
    ]);
    // The unversioned payload before preview cursors; don't use the current encoder here.
    const cursor = btoa(
      encodeURIComponent(
        JSON.stringify({
          scope: '["research",null,null,null,null,null,false]',
          pinOffset: 0,
          downloads: 10,
          name: "first",
        }),
      ),
    );
    const url =
      "/api/v1/plugins?curated=true&sort=downloads&category=research&cursor=" +
      encodeURIComponent(cursor);
    const response = await t.fetch(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ name: "second" }], nextCursor: null });
    await expect(
      t.query(internal.packages.listPluginDiscoveryCategoryInternal, {
        category: "memory",
        paginationOpts: { cursor, numItems: 100 },
      }),
    ).rejects.toThrow("Invalid curated category cursor");
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
    const { page } = await t.query(internal.packages.listPluginOverviewCategoryInternal, {
      category: "memory",
      numItems: 8,
    });
    expect(page.map((row) => row.name)).toEqual([
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

  it("continues a public English overview shelf without changing multilingual category browse", async () => {
    const pin = "@honcho-ai/openclaw-honcho";
    const t = await setup([
      { name: pin, downloads: 0 },
      ...Array.from({ length: 10 }, (_, i) => ({ name: `item-${9 - i}`, downloads: 10 })),
      { name: "item-6a", downloads: 10, title: "社媒数据助手" },
      { name: "item-7a", downloads: 10, private: true },
      { name: "item-8a", downloads: 10, blocked: true },
      { name: "item-8b", downloads: 10, title: "社媒数据助手" },
      { name: "small-shelf", downloads: 1, category: "research" },
    ]);
    // The published v1 schema rejects unknown category fields. Older readers keep its shape.
    const original = await (await t.fetch("/api/v1/plugins/overview")).json();
    expect(
      original.categories.find((category: { slug: string }) => category.slug === "memory"),
    ).not.toHaveProperty("previewCursor");
    const overview = await t.fetch("/api/v1/plugins/overview?previewCursors=true");
    expect(overview.status).toBe(200);
    const { categories, items } = parseArk(
      ApiV1PluginOverviewResponseSchema,
      await overview.json(),
      "overview",
    );
    const firstShelf = [pin, ...Array.from({ length: 7 }, (_, i) => "item-" + i)];
    expect(
      items.filter((item) => item.categories?.includes("memory")).map((item) => item.name),
    ).toEqual(firstShelf);
    const category = (slug: string) => categories.find((entry) => entry.slug === slug);
    expect(category("research")).not.toHaveProperty("previewCursor");
    const cursor = category("memory")?.previewCursor;
    expect(cursor).toEqual(expect.any(String));
    const list = async (limit: number, after?: string) => {
      const query = new URLSearchParams({
        curated: "true",
        category: "memory",
        sort: "downloads",
        limit: String(limit),
      });
      if (after) query.set("cursor", after);
      const response = await t.fetch("/api/v1/plugins?" + query);
      expect(response.status).toBe(200);
      const { items: pageItems, nextCursor } = await response.json();
      return { names: pageItems.map((item: { name: string }) => item.name), nextCursor };
    };
    expect(await list(100, cursor)).toEqual({
      names: ["item-7", "item-8", "item-9"],
      nextCursor: null,
    });
    const second = await list(1, cursor);
    expect(second.names).toEqual(["item-7"]);
    expect(second.nextCursor).toEqual(expect.any(String));
    expect(await list(100, second.nextCursor)).toEqual({
      names: ["item-8", "item-9"],
      nextCursor: null,
    });
    const browse = await list(8);
    expect(browse.names).toEqual(firstShelf);
    expect(await list(100, browse.nextCursor)).toEqual({
      names: ["item-6a", "item-7", "item-8", "item-8b", "item-9"],
      nextCursor: null,
    });
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
