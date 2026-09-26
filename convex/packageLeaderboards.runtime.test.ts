/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
import { api, internal } from "./_generated/api";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const now = Date.UTC(2026, 8, 26, 12, 30);

async function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  await t.mutation(internal.devSeedPackageTrending.seedInternal, {});
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("CONVEX_DEPLOYMENT", "local:plugin-trending-test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("24-hour plugin Trending", () => {
  it("keeps the oldest completed hour when maintenance requests minimum retention", async () => {
    const t = await setup();
    const { startAt } = getCompletedRolling24HourWindow(now);
    const id = await t.run(async (ctx) => {
      const event = await ctx.db.query("packageStatEvents").withIndex("by_occurred_at").first();
      if (!event) throw new Error("Missing fixture event");
      await ctx.db.patch(event._id, { occurredAt: startAt, processedAt: startAt });
      return event._id;
    });
    const result = await t.action(internal.packages.pruneProcessedPackageStatEventsInternal, {
      retentionDays: 1,
      confirmationToken: "PRUNE_PROCESSED_PACKAGE_STAT_EVENTS",
    });
    expect(result.retentionDays).toBe(2);
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  });

  it("uses the same completed hours as Skills and preserves cursor order with 24-hour counts", async () => {
    const t = await setup();
    const window = getCompletedRolling24HourWindow(now);
    await t.action(internal.packageLeaderboards.rebuildTrendingLeaderboardAction, {});
    const response = await t.fetch("/api/v1/plugins?sort=trending&limit=20");
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toMatchObject({
      name: "trending-proof-00",
      stats: { downloads: 1000 },
      trending24h: {
        downloads: 25,
        installs: 0,
        windowStart: window.startAt,
        windowEnd: window.endAt,
      },
    });
    const next = await t.fetch(
      `/api/v1/plugins?sort=trending&limit=20&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    const second = await next.json();
    expect(second.items.map((item: { name: string }) => item.name)).toEqual(
      Array.from({ length: 5 }, (_, index) => `trending-proof-${index + 20}`),
    );
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.items, ...second.items].some(
        (item) => item.name === "trending-proof-weekly-leader",
      ),
    ).toBe(false);
  });

  it("includes the start boundary and unprocessed events, excludes the current hour, and paginates raw events", async () => {
    const t = await setup();
    const { startAt, endAt } = getCompletedRolling24HourWindow(now);
    const id = await t.run(async (ctx) => {
      const pkg = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", "trending-proof-00"))
        .unique();
      if (!pkg) throw new Error("Missing fixture");
      // Force the rebuild through multiple real cursor pages.
      for (let index = 0; index < 1001; index++)
        await ctx.db.insert("packageStatEvents", {
          packageId: pkg._id,
          kind: "download",
          occurredAt: endAt - 1,
        });
      for (const occurredAt of [startAt - 1, endAt, now])
        await ctx.db.insert("packageStatEvents", {
          packageId: pkg._id,
          kind: "download",
          occurredAt,
        });
      return pkg._id;
    });
    await t.action(internal.packageLeaderboards.rebuildTrendingLeaderboardAction, {});
    const page = await t.query(api.packages.listPublicPage, {
      sort: "trending",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(page.page[0].trending24h?.downloads).toBe(1026);
    const first = await t.query(internal.packageLeaderboards.getStatEventsPage, {
      startAt,
      endAt,
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toEqual({ packageId: id, kind: "download" });
  });

  it("keeps net installs nonnegative and excludes private plugins before the top-N limit", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const first = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", "trending-proof-00"))
        .unique();
      const second = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", "trending-proof-01"))
        .unique();
      if (!first || !second) throw new Error("Missing fixture");
      await ctx.db.patch(first._id, { channel: "private" });
      // t.run has raw DB semantics; keep the fixture digest consistent with the real trigger.
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", first._id))
        .unique();
      if (digest) await ctx.db.patch(digest._id, { channel: "private" });
      await ctx.db.insert("packageStatEvents", {
        packageId: second._id,
        kind: "install_clear",
        occurredAt: now - 3600000,
      });
    });
    await t.action(internal.packageLeaderboards.rebuildTrendingLeaderboardAction, { limit: 1 });
    const page = await t.query(api.packages.listPublicPage, {
      sort: "trending",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(page.page.map((item) => item.name)).toEqual(["trending-proof-01"]);
    expect(page.page[0].trending24h).toMatchObject({ downloads: 24, installs: 0 });
  });

  it("keeps the legacy feed during upgrade, then switches atomically to 24-hour counts", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const pkg = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", "trending-proof-weekly-leader"))
        .unique();
      if (!pkg) throw new Error("Missing fixture");
      await ctx.db.insert("packageLeaderboards", {
        kind: "package_trending",
        generatedAt: now,
        rangeStartDay: 1,
        rangeEndDay: 7,
        items: [{ packageId: pkg._id, score: 10000, downloads: 10000, installs: 0 }],
      });
    });
    const page = () =>
      t.query(api.packages.listPublicPage, {
        sort: "trending",
        paginationOpts: { cursor: null, numItems: 20 },
      });
    const legacy = await page();
    expect(legacy.page[0].name).toBe("trending-proof-weekly-leader");
    expect(legacy.page[0].trending24h).toBeUndefined();
    await t.action(internal.packageLeaderboards.rebuildTrendingLeaderboardAction, {});
    const current = await page();
    expect(current.page[0].name).toBe("trending-proof-00");
    expect(current.page[0].trending24h?.downloads).toBe(25);
    // A genuinely empty 24-hour window must not revive the legacy feed.
    const { startAt, endAt } = getCompletedRolling24HourWindow(now);
    await t.mutation(internal.packageLeaderboards.writeTrendingLeaderboard, {
      items: [],
      startAt,
      endAt,
    });
    expect((await page()).page).toEqual([]);
  });

  it("keeps the development fixture idempotent and refuses production seeding", async () => {
    const t = await setup();
    await t.mutation(internal.devSeedPackageTrending.seedInternal, {});
    await t.action(internal.packageLeaderboards.rebuildTrendingLeaderboardAction, {});
    const page = await t.query(api.packages.listPublicPage, {
      sort: "trending",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(page.page[0].trending24h?.downloads).toBe(25);
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:example");
    await expect(t.mutation(internal.devSeedPackageTrending.seedInternal, {})).rejects.toThrow(
      "disabled outside local/dev",
    );
  });
});
