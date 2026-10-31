/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { getPluginDiscoveryPins } from "./lib/pluginDiscovery";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ownerUserId = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { handle: "category-owner" });
    const names = [
      ...getPluginDiscoveryPins("channels"),
      ...Array.from({ length: 35 }, (_, i) => `tail-${String(i).padStart(2, "0")}`),
    ];
    for (const [i, name] of names.entries()) {
      const id = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: name,
        family: i % 2 ? "code-plugin" : "bundle-plugin",
        ownerUserId: owner,
        channel: name === "tail-00" ? "private" : "community",
        scanStatus: name === "tail-01" ? "malicious" : "clean",
        softDeletedAt: name === "tail-02" ? 1 : undefined,
        latestVersionSummary:
          name === "tail-03" ? undefined : { version: "1.0.0", changelog: "Fixture", createdAt: 1 },
        categories: ["channels"],
        tags: {},
        isOfficial: false,
        stats: {
          downloads: name.startsWith("tail-") ? 1000 : 1,
          installs: 0,
          stars: 0,
          versions: 1,
        },
        createdAt: i + 1,
        updatedAt: i + 1,
      });
      const pkg = await ctx.db.get(id);
      if (!pkg) throw new Error("Fixture package missing");
      await upsertPackageSearchDigest(ctx, extractPackageDigestFields(pkg));
    }
    return owner;
  });
  return { t, ownerUserId };
}

it("preserves anonymous curated pins, tied ordering, visibility and continuation", async () => {
  const { t } = await fixture();
  const page = await t.query(api.publicPluginDiscovery.listInitialPage, { category: "channels" });
  expect(page).toEqual(
    await t.query(internal.publicPluginDiscovery.listPluginDiscoveryCategoryInternal, {
      category: "channels",
      paginationOpts: { cursor: null, numItems: 25 },
    }),
  );
  expect(page.page).toHaveLength(25);
  const pins = getPluginDiscoveryPins("channels");
  expect(page.page.slice(0, pins.length).map((p) => p.name)).toEqual(pins);
  expect(page.page.slice(pins.length).map((p) => p.name)).toEqual(
    Array.from({ length: 25 - pins.length }, (_, i) => `tail-${String(i + 4).padStart(2, "0")}`),
  );
  expect(page.isDone).toBe(false);
  const next = await t.query(internal.publicPluginDiscovery.listPluginDiscoveryCategoryInternal, {
    category: "channels",
    paginationOpts: { cursor: page.continueCursor, numItems: 25 },
  });
  const names = [...page.page, ...next.page].map((p) => p.name);
  expect(new Set(names).size).toBe(names.length);
  for (const hidden of ["tail-00", "tail-01", "tail-02", "tail-03"])
    expect(names).not.toContain(hidden);
});

it("keeps the owner's private packages hidden even when authenticated", async () => {
  const { t, ownerUserId } = await fixture();
  const args = { category: "channels" };
  const anonymous = await t.query(api.publicPluginDiscovery.listInitialPage, args);
  expect(
    await t
      .withIdentity({ subject: `${ownerUserId}|session` })
      .query(api.publicPluginDiscovery.listInitialPage, args),
  ).toEqual(anonymous);
  await expect(
    t.query(api.publicPluginDiscovery.listInitialPage, {
      ...args,
      viewerUserId: ownerUserId,
    } as typeof args),
  ).rejects.toThrow();
  await expect(
    t.query(api.publicPluginDiscovery.listInitialPage, {
      ...args,
      cursor: anonymous.continueCursor,
    } as typeof args),
  ).rejects.toThrow();
});

it.each(["other", "not-a-category", "constructor", "toString", "models"])(
  "returns an empty page for %s without widening the browse scope",
  async (category) => {
    const { t } = await fixture();
    expect(await t.query(api.publicPluginDiscovery.listInitialPage, { category })).toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
  },
);
