/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { normalizeThemeDefinition, THEME_COLOR_KEYS } from "clawhub-schema";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
import { internal } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const definition = {
  name: " Aurora ",
  description: " Calm night ",
  dark: Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, "#123456"])),
};

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const token = "local-theme-fixture";
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      handle: "theme-author",
      createdAt: 1,
      updatedAt: 1,
    });
    const tokenId = await ctx.db.insert("apiTokens", {
      userId,
      label: "test",
      prefix: "local",
      tokenHash: await hashToken(token),
      createdAt: 1,
    });
    return { userId, tokenId };
  });
  const publish = (changes: Record<string, unknown> = {}, bearer = token) =>
    t.fetch("/api/v1/themes", {
      method: "POST",
      headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
      body: JSON.stringify({
        owner: "theme-author",
        name: "aurora",
        version: "1.0.0",
        definition,
        ...changes,
      }),
    });
  return { t, publish, ...ids };
}

describe("data-only Themes HTTP registry", () => {
  it("publishes, lists, searches and reads immutable pinned releases without leaking to general registries", async () => {
    const { t, publish } = await fixture();
    expect((await t.fetch("/api/v1/themes")).status).toBe(200);
    const response = await publish();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "theme-author/aurora",
      version: "1.0.0",
      sha256: await hashToken(JSON.stringify(normalizeThemeDefinition(definition))),
    });
    const first = await (await t.fetch("/api/v1/themes/theme-author/aurora?version=1.0.0")).json();
    expect(first.item.definition.name).toBe("Aurora");
    expect(first.item).toMatchObject({ category: "themes", author: { handle: "theme-author" } });
    expect(
      (await publish({ version: "2.0.0", definition: { ...definition, name: "Aurora Two" } }))
        .status,
    ).toBe(200);
    expect((await publish({ version: "0.5.0" })).status).toBe(200);
    const latest = await (await t.fetch("/api/v1/themes/theme-author/aurora")).json();
    expect(latest.item.version).toBe("2.0.0");
    expect(
      await (await t.fetch("/api/v1/themes/theme-author/aurora?version=1.0.0")).json(),
    ).toEqual(first);
    for (const suffix of ["", "?q=Aurora", "?q=theme-author"]) {
      const listed = await (await t.fetch("/api/v1/themes" + suffix)).json();
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).not.toHaveProperty("definition");
      expect(listed.nextCursor).toBeNull();
    }
    for (const table of ["skills", "packages", "skillSearchDigest", "packageSearchDigest"] as const)
      expect(await t.run((ctx) => ctx.db.query(table).take(1))).toEqual([]);
    for (const path of [
      "/api/v1/plugins",
      "/api/v1/packages",
      "/api/v1/plugins/search?q=aurora",
      "/api/v1/skills",
      "/api/v1/search?q=aurora",
    ]) {
      const general = await t.fetch(path);
      expect(general.status, path + ": " + (await general.clone().text())).toBe(200);
      expect(await general.text()).not.toContain("aurora");
    }
    expect((await publish()).status).toBe(200);
    expect((await publish({ definition: { ...definition, name: "Changed" } })).status).toBe(409);
    expect((await t.fetch("/api/v1/themes/theme-author/aurora?version=9.0.0")).status).toBe(404);
  });
  it("paginates explicit theme queries without sharing general listings", async () => {
    const { t, publish } = await fixture();
    for (const name of ["one", "two", "three"]) expect((await publish({ name })).status).toBe(200);
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await (
        await t.fetch("/api/v1/themes?limit=1&cursor=" + encodeURIComponent(cursor ?? ""))
      ).json();
      expect(page.items).toHaveLength(1);
      seen.add(page.items[0].id);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(3);
  });
  it("rejects unsafe payloads, anonymous authors, cross-owner writes and revoked tokens", async () => {
    const { t, publish, tokenId } = await fixture();
    expect((await publish({}, "bad")).status).toBe(401);
    expect((await publish({ owner: "another-author" })).status).toBe(400);
    for (const changes of [
      { name: "../bad" },
      { version: "latest" },
      { package: "npm:evil" },
      { definition: { ...definition, css: "body{}" } },
      {
        definition: {
          ...definition,
          dark: { ...definition.dark, background: "url(https://evil.example/)" },
        },
      },
    ])
      expect((await publish(changes)).status).toBe(400);
    expect(
      (await publish({ definition: { ...definition, extra: "x".repeat(17000) } })).status,
    ).toBe(413);
    expect((await t.fetch("/api/v1/themes/theme-author%2Fother/aurora")).status).toBe(404);
    expect((await t.fetch("/api/v1/themes?limit=10000")).status).toBe(400);
    await t.run((ctx) => ctx.db.patch(tokenId, { revokedAt: 1 }));
    await expect(
      t.mutation(internal.themes.publishInternal, {
        apiTokenId: tokenId,
        owner: "theme-author",
        slug: "aurora",
        version: "1.0.0",
        definition,
      }),
    ).rejects.toThrow(/Unauthorized/);
    expect((await publish()).status).toBe(401);
  });
  it("uses current publisher membership and rejects another user's namespace", async () => {
    const { t, publish, userId } = await fixture();
    const memberId = await t.run(async (ctx) => {
      const other = await ctx.db.insert("users", { handle: "other", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("publishers", {
        kind: "user",
        handle: "other",
        displayName: "Other",
        linkedUserId: other,
        createdAt: 1,
        updatedAt: 1,
      });
      const org = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "theme-studio",
        displayName: "Theme Studio",
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("publisherMembers", {
        publisherId: org,
        userId,
        role: "publisher",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect((await publish({ owner: "other" })).status).toBe(403);
    expect((await publish({ owner: "theme-studio" })).status).toBe(200);
    await t.run((ctx) => ctx.db.delete(memberId));
    expect((await publish({ owner: "theme-studio", version: "2.0.0" })).status).toBe(403);
    expect((await t.fetch("/api/v1/themes/theme-studio/aurora?version=2.0.0")).status).toBe(404);
  });

  it("searches renamed dotted publishers without republishing or retaining stale owner text", async () => {
    const { t, publish, userId } = await fixture();
    const org = await t.run(async (ctx) => {
      const id = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "theme.studio",
        displayName: "Theme Studio",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("publisherMembers", {
        publisherId: id,
        userId,
        role: "publisher",
        createdAt: 1,
        updatedAt: 1,
      });
      return id;
    });
    expect((await publish({ owner: "theme.studio" })).status).toBe(200);
    const original = await (await t.fetch("/api/v1/themes?q=theme.studio")).json();
    expect(original.items.map((item: { id: string }) => item.id)).toEqual(["theme.studio/aurora"]);
    expect((await t.fetch("/api/v1/themes/theme.studio/aurora?version=1.0.0")).status).toBe(200);
    await t.run((ctx) => ctx.db.patch(org, { handle: "renamed.studio" }));
    const renamed = await (await t.fetch("/api/v1/themes?q=renamed.studio")).json();
    expect(renamed.items.map((item: { id: string }) => item.id)).toEqual(["renamed.studio/aurora"]);
    expect((await (await t.fetch("/api/v1/themes?q=theme.studio")).json()).items).toEqual([]);
    expect((await t.fetch("/api/v1/themes/renamed.studio/aurora?version=1.0.0")).status).toBe(200);
    expect((await t.fetch("/api/v1/themes?q=" + "x".repeat(200))).status).toBe(200);
    expect((await t.fetch("/api/v1/themes?q=" + "x".repeat(201))).status).toBe(400);
  });

  it("hides withdrawn themes/releases and inactive publisher accounts", async () => {
    const { t, publish, userId } = await fixture();
    expect((await publish()).status).toBe(200);
    await t.run(async (ctx) => {
      const release = await ctx.db.query("themeVersions").first();
      await ctx.db.patch(release!._id, { withdrawn: true });
    });
    expect((await t.fetch("/api/v1/themes/theme-author/aurora")).status).toBe(404);
    expect((await (await t.fetch("/api/v1/themes")).json()).items).toEqual([]);
    await t.run(async (ctx) => {
      const theme = await ctx.db.query("themes").first();
      await ctx.db.patch(theme!._id, { listed: false });
    });
    expect((await (await t.fetch("/api/v1/themes")).json()).items).toEqual([]);
    await t.run(async (ctx) => {
      const theme = await ctx.db.query("themes").first();
      await ctx.db.patch(theme!._id, { listed: true });
      await ctx.db.patch(userId, { deactivatedAt: 1 });
    });
    expect((await (await t.fetch("/api/v1/themes")).json()).items).toEqual([]);
    expect((await t.fetch("/api/v1/themes/theme-author/aurora")).status).toBe(404);
  });
});
