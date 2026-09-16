/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";
import { readCurrentResultsInternal } from "./searchInsights";

const modules = import.meta.glob("./**/*.ts");
const END = Date.UTC(2026, 8, 8);
const DAY = 86_400_000;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("staff search intelligence report", () => {
  it("preserves legacy buckets and cursor while separating skill, plugin, and scoped demand", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers();
    vi.setSystemTime(END);
    await t.run(async (ctx) => {
      await ctx.db.insert("pluginSearchObservations", {
        normalizedQuery: "notion",
        observedAt: END - DAY,
        source: "clawhub-web",
        artifactKind: "plugin",
        resultCount: 0,
        officialResultCount: 0,
      });
    });
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    const before = await t.run(async (ctx) => ({
      buckets: await ctx.db.query("searchDailyAggregates").collect(),
      state: await ctx.db.query("searchAggregateStates").unique(),
    }));
    await t.run(async (ctx) => {
      for (const artifactKind of ["plugin", "skill"] as const) {
        for (const scope of ["catalog", "shelf"] as const) {
          await ctx.db.insert("pluginSearchObservations", {
            normalizedQuery: "notion",
            observedAt: END - DAY,
            source: "clawhub-web",
            artifactKind,
            scope,
            resultCount: 0,
            officialResultCount: 0,
          });
        }
      }
    });
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    await t.mutation(internal.searchInsights.aggregateInternal, {});
    const after = await t.run(async (ctx) => ({
      buckets: await ctx.db.query("searchDailyAggregates").collect(),
      state: await ctx.db.query("searchAggregateStates").unique(),
    }));
    expect(after.buckets).toHaveLength(5);
    expect(after.buckets.find((row) => row._id === before.buckets[0]._id)).toEqual(
      before.buckets[0],
    );
    expect(after.state?._id).toBe(before.state?._id);
    expect(after.state?.cursor).not.toBe(before.state?.cursor);
    const plugin = await t.action(internal.searchInsights.getInternal, {
      endDay: END,
      includeCurrentResults: false,
    });
    const skill = await t.action(internal.searchInsights.getInternal, {
      artifactKind: "skill",
      endDay: END,
      includeCurrentResults: false,
    });
    expect(
      plugin.rows
        .map((row) => [row.scope, row.searches7d])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual([
      ["catalog", 1],
      ["legacy", 1],
      ["shelf", 1],
    ]);
    expect(
      skill.rows
        .map((row) => [row.artifactKind, row.scope, row.searches7d])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual([
      ["skill", "catalog", 1],
      ["skill", "shelf", 1],
    ]);
    expect(skill.coverage.collectionStartedAt).toBe(END - DAY);
    const catalog = await t.action(internal.searchInsights.getInternal, {
      artifactKind: "skill",
      scope: "catalog",
      endDay: END,
      includeCurrentResults: false,
    });
    expect(catalog.totalSearches7d).toBe(1);
  });

  it("partitions classification replacement by artifact and scope without promoting unknown history", async () => {
    const t = convexTest(schema, modules);
    const base = {
      weekStart: END - 7 * DAY,
      weekEnd: END,
      processedAt: END,
      model: "fixture",
      modelVersion: "v1",
    };
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      ...base,
      rows: [{ query: "notion", intentKind: "company_product", confidence: 0.99 }],
    });
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      ...base,
      artifactKind: "skill",
      rows: [
        { query: "notion", scope: "catalog", intentKind: "company_product", confidence: 0.99 },
        { query: "notion", scope: "shelf", intentKind: "company_product", confidence: 0.99 },
      ],
    });
    await t.run(async (ctx) => {
      for (const [artifactKind, scope] of [
        ["plugin", undefined],
        ["skill", "catalog"],
        ["skill", "shelf"],
      ] as const) {
        await ctx.db.insert("searchDailyAggregates", {
          dayStart: END - DAY,
          query: "notion",
          artifactKind,
          scope,
          source: "clawhub-web",
          category: "",
          intent: "",
          searches: 4,
          officialGaps: 4,
          zeroResults: 4,
          expirationTime: END + DAY,
        });
      }
    });
    const plugin = await t.action(internal.searchInsights.getInternal, {
      endDay: END,
      includeCurrentResults: false,
    });
    const skill = await t.action(internal.searchInsights.getInternal, {
      artifactKind: "skill",
      endDay: END,
      includeCurrentResults: false,
    });
    expect(plugin.rows[0]).toMatchObject({
      scope: "legacy",
      companyOpportunity: false,
      classification: { intentKind: "company_product" },
    });
    expect(skill.rows.find((row) => row.scope === "catalog")?.companyOpportunity).toBe(true);
    expect(skill.rows.find((row) => row.scope === "shelf")?.companyOpportunity).toBe(false);
    await t.mutation(internal.searchInsights.storeClassificationsInternal, {
      ...base,
      artifactKind: "skill",
      status: "unavailable",
      rows: [],
    });
    expect(
      (
        await t.action(internal.searchInsights.getInternal, {
          endDay: END,
          includeCurrentResults: false,
        })
      ).classificationStatus,
    ).toBe("available");
  });

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
          scope: "catalog",
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
          scope: "catalog",
          intentKind: "company_product",
          companyProductName: "Notion",
          confidence: 0.95,
        },
        { query: "memory", scope: "catalog", intentKind: "generic_capability", confidence: 0.99 },
        { query: "uncertain", scope: "catalog", intentKind: "company_product", confidence: 0.5 },
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

describe("current search metadata batching", () => {
  const handler = (
    readCurrentResultsInternal as unknown as {
      _handler: (
        ctx: unknown,
        args: unknown,
      ) => Promise<{ rows: Array<{ query: string; results: Array<{ id: string }> }> }>;
    }
  )._handler;
  it.each(["plugin", "skill"])(
    "hydrates shared identities once while preserving every %s query's order",
    async (artifactKind) => {
      const identity = (name: string) => `${artifactKind}:${name}`;
      const lookup = (query: string) =>
        query === "first"
          ? [identity("shared"), identity("first")]
          : [identity("second"), identity("shared")];
      const hydrate = vi.fn(async ({ identities }: { identities: string[] }) =>
        identities.map((id) => ({ id })),
      );
      const dispatch = vi.fn(async (ref, args) => {
        const name = getFunctionName(ref);
        if (name === "featuredArtifacts:readInternal") return hydrate(args);
        if (name.endsWith("searchPublicDiscoveryBatchInternal"))
          return args.queries.map((query: string) => ({ query, identities: lookup(query) }));
        // Baseline uses one search and hydration per query; preserve its IO contract for RED.
        if (name === "search:searchSkills") return lookup(args.query).map((id) => ({ id }));
        if (name === "packages:searchForViewerInternal")
          return args.family === "code-plugin"
            ? lookup(args.query).map((id, index) => ({
                package: { name: id.slice(7) },
                score: 10 - index,
              }))
            : [];
        throw new Error(`Unexpected query ${name}`);
      });
      const result = await handler(
        { runAction: dispatch, runQuery: dispatch },
        { queries: ["first", "second"], artifactKind },
      );
      expect(result.rows).toEqual([
        { query: "first", results: lookup("first").map((id) => ({ id })) },
        { query: "second", results: lookup("second").map((id) => ({ id })) },
      ]);
      expect(hydrate).toHaveBeenCalledTimes(1);
      expect(hydrate).toHaveBeenCalledWith({
        identities: [identity("shared"), identity("first"), identity("second")],
      });
    },
  );
  it.each(["plugin", "skill"])(
    "covers all 100 %s terms with bounded metadata transactions and fails atomically",
    async (artifactKind) => {
      const queries = Array.from({ length: 100 }, (_, index) => `term ${index}`);
      const matches = (query: string) =>
        [0, 1, 2].map((index) => `${artifactKind}:${query}/${index}`);
      const hydrate = vi.fn(async ({ identities }: { identities: string[] }) =>
        identities.map((id) => ({ id })),
      );
      const dispatch = vi.fn(async (ref, args) => {
        if (getFunctionName(ref) === "featuredArtifacts:readInternal") return hydrate(args);
        return args.queries.map((query: string) => ({ query, identities: matches(query) }));
      });
      const ctx = { runQuery: dispatch, runAction: dispatch };
      const result = await handler(ctx, { queries, artifactKind });
      expect(result.rows).toEqual(
        queries.map((query) => ({ query, results: matches(query).map((id) => ({ id })) })),
      );
      expect(hydrate.mock.calls.map(([args]) => args.identities.length)).toEqual([100, 100, 100]);
      hydrate.mockRejectedValueOnce(new Error("metadata unavailable"));
      await expect(handler(ctx, { queries, artifactKind })).rejects.toThrow("metadata unavailable");
    },
  );
});
