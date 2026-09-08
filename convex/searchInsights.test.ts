/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const END = Date.UTC(2026, 8, 8);
const DAY = 86_400_000;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("staff search intelligence report", () => {
  it("serves deterministic 7-day, previous-week and 30-day aggregate facts without raw rows", async () => {
    const t = convexTest(schema, modules);
    const staffId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { role: "moderator", handle: "staff" });
      for (const row of [
        { query: "notion", day: 1, source: "clawhub-web" as const, searches: 3, officialGaps: 3 },
        {
          query: "notion",
          day: 2,
          source: "openclaw-control-ui" as const,
          searches: 2,
          officialGaps: 0,
        },
        { query: "notion", day: 8, source: "clawhub-web" as const, searches: 2, officialGaps: 2 },
        { query: "notion", day: 29, source: "clawhub-web" as const, searches: 4, officialGaps: 4 },
        { query: "memory", day: 1, source: "clawhub-web" as const, searches: 5, officialGaps: 5 },
        {
          query: "excluded",
          day: 31,
          source: "clawhub-web" as const,
          searches: 10,
          officialGaps: 10,
        },
      ]) {
        await ctx.db.insert("searchDailyAggregates", {
          dayStart: END - row.day * DAY,
          query: row.query,
          source: row.source,
          artifactKind: "plugin",
          category: "",
          intent: "",
          searches: row.searches,
          officialGaps: row.officialGaps,
          zeroResults: 0,
          expirationTime: END + 360 * DAY,
        });
      }
      return id;
    });
    const report = await t
      .withIdentity({ subject: staffId })
      .action(api.searchInsights.get, { endDay: END });
    expect(report.rows.map((row) => row.query)).toEqual(["memory", "notion"]);
    expect(report.rows[1]).toMatchObject({
      query: "notion",
      searches7d: 5,
      searchesPrevious7d: 2,
      searches30d: 11,
      change7d: 3,
      changePercent: 150,
      officialGaps7d: 3,
      sources7d: { "clawhub-web": 3, "openclaw-control-ui": 2 },
      classification: null,
    });
    expect(report.window).toMatchObject({ endDay: END, start7d: Date.UTC(2026, 8, 1) });
    expect(JSON.stringify(report)).not.toMatch(/staff|userId|_id|_creationTime|observations/);
  });
  it("keeps official gaps deterministic while filtering only fresh high-confidence company opportunities", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { role: "admin" });
      for (const query of ["notion", "memory", "uncertain", "stale"]) {
        await ctx.db.insert("searchDailyAggregates", {
          dayStart: END - DAY,
          query,
          source: "clawhub-web",
          artifactKind: "plugin",
          category: "",
          intent: "",
          searches: 5,
          officialGaps: 4,
          zeroResults: 0,
          expirationTime: END + DAY * 360,
        });
      }
      return userId;
    });
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      weekStart: END - 8 * DAY,
      weekEnd: END - DAY,
      model: "fixture-model",
      modelVersion: "v1",
      processedAt: END,
      expectedQualified: 4,
      rows: [
        {
          query: "notion",
          intentKind: "company_product",
          companyProductName: "Notion",
          confidence: 0.95,
        },
        { query: "memory", intentKind: "generic_capability", confidence: 0.99 },
        { query: "uncertain", intentKind: "company_product", confidence: 0.5 },
      ],
    });
    const staff = t.withIdentity({ subject: id });
    const filtered = await staff.action(api.searchInsights.get, {
      endDay: END,
      officialGap: true,
      intentKind: "company_product",
    });
    expect(filtered.rows.map((row) => row.query)).toEqual(["notion"]);
    expect(filtered.rows[0]).toMatchObject({
      officialGaps7d: 4,
      companyOpportunity: true,
      classification: { model: "fixture-model", modelVersion: "v1", companyProductName: "Notion" },
    });
    const all = await staff.action(api.searchInsights.get, { endDay: END, officialGap: true });
    expect(all.rows).toHaveLength(4);
    expect(all.classificationStatus).toBe("partial");
  });
  it("reports capped weekly classification scope as partial even when the cohort is complete", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      weekStart: END - 8 * DAY,
      weekEnd: END - DAY,
      processedAt: END,
      model: "fixture-model",
      modelVersion: "v1",
      expectedQualified: 1,
      truncated: true,
      rows: [{ query: "notion", intentKind: "company_product", confidence: 0.95 }],
    });
    const report = await t.action(internal.searchInsights.getInternal, { endDay: END });
    expect(report.classificationStatus).toBe("partial");
    expect(report.classificationRun).toMatchObject({
      expectedQualified: 1,
      classifiedCount: 1,
      truncated: true,
    });
  });
  it("materializes each raw fact once across batch retries and advances after new arrivals", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers();
    vi.setSystemTime(END);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++)
        await ctx.db.insert("pluginSearchObservations", {
          normalizedQuery: "notion",
          observedAt: END - DAY,
          source: "clawhub-web",
          artifactKind: "plugin",
          resultCount: 2,
          officialResultCount: i === 0 ? 1 : 0,
        });
    });
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    let report = await t.action(internal.searchInsights.getInternal, { endDay: END });
    expect(report.rows[0]).toMatchObject({ searches7d: 3, officialGaps7d: 2 });
    await t.run(
      async (ctx) =>
        await ctx.db.insert("pluginSearchObservations", {
          normalizedQuery: "notion",
          observedAt: END - DAY,
          source: "openclaw-control-ui",
          artifactKind: "plugin",
          resultCount: 0,
          officialResultCount: 0,
        }),
    );
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    report = await t.action(internal.searchInsights.getInternal, { endDay: END });
    expect(report.rows[0]).toMatchObject({ searches7d: 4, officialGaps7d: 3, zeroResults7d: 1 });
    vi.useRealTimers();
  });

  it("denies anonymous and non-staff reports and serves the same facts over the authenticated HTTP boundary", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const token = "search-insights-contract-fixture";
    const ids = await t.run(async (ctx) => {
      const staff = await ctx.db.insert("users", { role: "moderator" });
      const user = await ctx.db.insert("users", { role: "user" });
      await ctx.db.insert("apiTokens", {
        userId: staff,
        label: "fixture",
        prefix: "fixture",
        tokenHash: await hashToken(token),
        createdAt: END,
      });
      return { staff, user };
    });
    await expect(t.action(api.searchInsights.get, { endDay: END })).rejects.toThrow("Unauthorized");
    await expect(
      t.withIdentity({ subject: ids.user }).action(api.searchInsights.get, { endDay: END }),
    ).rejects.toThrow("Forbidden");
    expect((await t.fetch("/api/v1/search-insights")).status).toBe(401);
    const response = await t.fetch(
      `/api/v1/search-insights?endDay=${END}&source=clawhub-web&window=30&officialGap=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(response.status).toBe(200);
    const report = await response.json();
    const dashboard = await t.withIdentity({ subject: ids.staff }).action(api.searchInsights.get, {
      endDay: END,
      source: "clawhub-web",
      window: 30,
      officialGap: true,
    });
    expect(report).toEqual({ ...dashboard, generatedAt: report.generatedAt });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps visible suspicious metadata for intent but recommends only clean public installs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", { handle: "fixture" });
      for (const [name, channel, scanStatus] of [
        ["notion-clean", "community", "clean"],
        ["notion-private", "private", "clean"],
        ["notion-unsafe", "community", "suspicious"],
      ] as const) {
        const packageId = await ctx.db.insert("packages", {
          name,
          normalizedName: name,
          displayName: name,
          ownerUserId,
          family: "code-plugin",
          channel,
          isOfficial: false,
          tags: {},
          scanStatus,
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: END,
          updatedAt: END,
        });
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          changelog: "fixture",
          distTags: ["latest"],
          files: [
            {
              path: "index.js",
              size: 1,
              storageId: await ctx.storage.store(new Blob(["x"])),
              sha256: "a".repeat(64),
            },
          ],
          integritySha256: "a".repeat(64),
          verification: { scanStatus, tier: "structural", scope: "artifact-only" },
          createdBy: ownerUserId,
          createdAt: END,
        });
        await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
        await ctx.db.insert("packageSearchDigest", {
          packageId,
          name,
          normalizedName: name,
          displayName: name,
          ownerUserId,
          family: "code-plugin",
          channel,
          isOfficial: false,
          latestVersion: "1.0.0",
          scanStatus,
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: END,
          updatedAt: END,
        });
      }
    });
    const results = await t.action(internal.searchInsights.readCurrentResultsInternal, {
      queries: ["notion"],
    });
    expect(results.rows[0].results.map((item) => item.name)).toEqual([
      "notion-clean",
      "notion-unsafe",
    ]);
    expect(results.rows[0].results[1]).toMatchObject({
      name: "notion-unsafe",
      eligibleForFeatured: false,
    });
    expect(results.rows[0].results[0]).toMatchObject({
      eligibleForFeatured: true,
      isOfficial: false,
      version: "1.0.0",
    });
    expect(JSON.stringify(results)).not.toMatch(/ownerUserId|storageId|_id|integritySha256/);
  });

  it("expires daily totals after exactly 13 calendar months at clamped month-end", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 30));
    await t.run(async (ctx) => {
      for (const [normalizedQuery, observedAt] of [
        ["expired", Date.UTC(2025, 7, 31)],
        ["retained", Date.UTC(2025, 8, 1)],
      ] as const) {
        await ctx.db.insert("pluginSearchObservations", {
          normalizedQuery,
          observedAt,
          source: "clawhub-web",
          artifactKind: "plugin",
          resultCount: 0,
          officialResultCount: 0,
        });
      }
    });
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    await t.mutation(internal.searchInsights.pruneExpiredInternal, {});
    const report = await t.action(internal.searchInsights.getInternal, {
      endDay: Date.UTC(2025, 8, 2),
      includeCurrentResults: false,
    });
    expect(report.rows.map((row) => row.query)).toEqual(["retained"]);
  });

  it("reports coverage loss after a 30-day aggregation outage without retaining raw searches", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers();
    vi.setSystemTime(END);
    await t.run(
      async (ctx) =>
        await ctx.db.insert("searchAggregateStates", {
          key: "plugin",
          cursor: null,
          processedThrough: END - 40 * DAY,
          revision: 1,
          coverageStart: END - 50 * DAY,
        }),
    );
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    const report = await t.action(internal.searchInsights.getInternal, { endDay: END });
    expect(report.coverage).toMatchObject({
      gapStart: END - 40 * DAY,
      gapEnd: END - 30 * DAY,
      dataThrough: END,
    });
  });

  it("hides previous successful intent classifications when this week's provider fails", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      weekStart: END - 7 * DAY,
      weekEnd: END,
      processedAt: END,
      model: "fixture",
      modelVersion: "v1",
      rows: [{ query: "notion", intentKind: "company_product", confidence: 0.99 }],
    });
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      weekStart: END - 7 * DAY,
      weekEnd: END,
      processedAt: END + 1,
      model: "fixture",
      modelVersion: "v1",
      status: "unavailable",
      expectedQualified: 1,
      failureCode: "provider_unavailable",
      rows: [],
    });
    const report = await t.action(internal.searchInsights.getInternal, { endDay: END });
    expect(report.classificationStatus).toBe("unavailable");
    expect(report.classificationRun).toMatchObject({
      failureCode: "provider_unavailable",
      classifiedCount: 0,
    });
  });
  it("includes demand that fell to zero when ranking the largest week-over-week movers", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [query, day, searches] of [
        ["vanished", 8, 20],
        ["active", 1, 5],
      ] as const) {
        await ctx.db.insert("searchDailyAggregates", {
          query,
          dayStart: END - day * DAY,
          source: "clawhub-web",
          artifactKind: "plugin",
          category: "",
          intent: "",
          searches,
          officialGaps: searches,
          zeroResults: 0,
          expirationTime: END + DAY,
        });
      }
    });
    const report = await t.action(internal.searchInsights.getInternal, {
      endDay: END,
      order: "change",
      includeCurrentResults: false,
    });
    expect(report.rows[0]).toMatchObject({
      query: "vanished",
      searches7d: 0,
      change7d: -20,
      changePercent: -100,
    });
  });
});
