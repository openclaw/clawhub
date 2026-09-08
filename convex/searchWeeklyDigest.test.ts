/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { buildSearchDigest } from "./lib/searchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const weekEnd = Date.parse("2026-09-07T00:00:00Z");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("ships deterministic gaps when classification is unavailable, freezing one payload across retries", async () => {
  let now = weekEnd + 17 * 3_600_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("CLAWHUB_HERMIT_TOKEN", "test-only-token");
  vi.stubEnv("SITE_URL", "http://localhost:3250");
  const delivered: unknown[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (typeof init?.body !== "string") throw new Error("Expected JSON body");
    delivered.push(JSON.parse(init.body));
    return delivered.length === 1
      ? new Response("unavailable", { status: 503 })
      : Response.json({ ok: true, delivered: true, weekEnd });
  });
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [query, day, searches] of [
      ["notion", 1, 4],
      ["notion", 8, 2],
      ["dropped", 8, 9],
    ] as const) {
      await ctx.db.insert("searchDailyAggregates", {
        query,
        dayStart: weekEnd - day * 86_400_000,
        source: "clawhub-web",
        artifactKind: "plugin",
        category: "",
        intent: "",
        searches,
        officialGaps: searches,
        zeroResults: 0,
        expirationTime: weekEnd + 400 * 86_400_000,
      });
    }
  });
  await t.action(internal.searchWeeklyDigest.deliverInternal, { weekEnd });
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({
    totalSearches: 4,
    sourceCounts: { clawhubWeb: 4, openclawControlUi: 0 },
    classificationStatus: "unavailable",
    companyOpportunities: [],
    officialGaps: [{ query: "notion", searches: 4, officialGaps: 4 }],
    movers: [{ query: "dropped", searches: 0, previousSearches: 9 }, { query: "notion" }],
  });
  expect(
    await t.query(internal.searchInsights.getClassificationRunInternal, { endDay: weekEnd }),
  ).toMatchObject({ status: "unavailable", failureCode: "missing_provider_configuration" });
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("searchDailyAggregates").collect();
    for (const row of rows) await ctx.db.delete(row._id);
  });
  now += 3 * 60_000;
  await t.action(internal.searchWeeklyDigest.deliverInternal, { weekEnd });
  expect(delivered[1]).toEqual(delivered[0]);
  await t.action(internal.searchWeeklyDigest.deliverInternal, { weekEnd });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await t.query(internal.searchWeeklyDigest.getStatusInternal, { weekEnd })).toMatchObject({
    status: "sent",
    attempts: 2,
    failureCode: null,
  });
});

it("removes exhausted and crashed final attempts from the due queue without starving later weeks", async () => {
  vi.spyOn(Date, "now").mockReturnValue(weekEnd + 17 * 3_600_000);
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 10; i++)
      await ctx.db.insert("searchWeeklyDigests", {
        weekEnd: weekEnd - i * 7 * 86_400_000,
        status: "claimed",
        attempts: i < 9 ? 8 : 1,
        claimedUntil: 0,
        nextAttemptAt: i,
        expirationTime: weekEnd + 400 * 86_400_000,
      });
  });
  await t.mutation(internal.searchWeeklyDigest.recoverDueInternal, {});
  const due = await t.mutation(internal.searchWeeklyDigest.recoverDueInternal, {});
  expect(due).toContain(weekEnd - 9 * 7 * 86_400_000);
  const exhausted = await t.query(internal.searchWeeklyDigest.getStatusInternal, { weekEnd });
  expect(exhausted).toMatchObject({ status: "exhausted", exhausted: true });
});

it("classifies only the bounded aggregate gap cohort and shares the exact persisted classifications with the digest", async () => {
  vi.spyOn(Date, "now").mockReturnValue(weekEnd + 17 * 3_600_000);
  vi.stubEnv("OPENAI_API_KEY", "test-only-provider-key");
  vi.stubEnv("CLAWHUB_HERMIT_TOKEN", "test-only-token");
  const providerInputs: Array<
    Array<{ query: string; searches: number; officialGaps: number; topResults: unknown[] }>
  > = [];
  const deliveries: Array<ReturnType<typeof buildSearchDigest>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected JSON body");
      const body = JSON.parse(init.body);
      if (url.includes("api.openai.com")) {
        const inputs = JSON.parse(body.input);
        providerInputs.push(inputs);
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    rows: inputs.map((row: { query: string }) => ({
                      query: row.query,
                      intentKind: "company_product",
                      companyProductName: "Synthetic Product",
                      confidence: 0.9,
                    })),
                  }),
                },
              ],
            },
          ],
        });
      }
      deliveries.push(body);
      return Response.json({ ok: true, delivered: true, weekEnd });
    }),
  );
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 102; i++)
      await ctx.db.insert("searchDailyAggregates", {
        query: `synthetic ${String(i).padStart(3, "0")}`,
        dayStart: weekEnd - 86_400_000,
        source: "clawhub-web",
        artifactKind: "plugin",
        category: "",
        intent: "",
        searches: 5,
        officialGaps: 4,
        zeroResults: 0,
        expirationTime: weekEnd + 400 * 86_400_000,
      });
    await ctx.db.insert("searchDailyAggregates", {
      query: "low volume",
      dayStart: weekEnd - 86_400_000,
      source: "openclaw-control-ui",
      artifactKind: "plugin",
      category: "",
      intent: "",
      searches: 2,
      officialGaps: 2,
      zeroResults: 0,
      expirationTime: weekEnd + 400 * 86_400_000,
    });
  });
  await t.action(internal.searchWeeklyDigest.deliverInternal, { weekEnd });
  expect(providerInputs).toHaveLength(1);
  expect(providerInputs[0]).toHaveLength(100);
  expect(
    providerInputs[0].every(
      (row) => Object.keys(row).sort().join(",") === "officialGaps,query,searches,topResults",
    ),
  ).toBe(true);
  expect(providerInputs[0].some((row) => row.query === "low volume")).toBe(false);
  expect(deliveries[0]).toMatchObject({
    totalSearches: 512,
    classificationStatus: "partial",
    truncated: true,
  });
  expect(deliveries[0].companyOpportunities).toHaveLength(5);
  const report = await t.action(internal.searchInsights.getInternal, {
    endDay: weekEnd,
    includeCurrentResults: false,
    intentKind: "company_product",
  });
  expect(report.classificationRun).toMatchObject({
    expectedQualified: 100,
    classifiedCount: 100,
    truncated: true,
  });
  expect(report.rows[0].classification).toMatchObject({
    companyProductName: "Synthetic Product",
    confidence: 0.9,
  });
  const raw = await t.run((ctx) => ctx.db.query("pluginSearchObservations").collect());
  expect(raw).toEqual([]);
});

it("schedules new weeks only at Monday 09:00 Pacific and deduplicates overlapping ticks", async () => {
  let now = Date.parse("2026-09-07T15:59:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const t = convexTest(schema, modules);
  expect(await t.mutation(internal.searchWeeklyDigest.tickInternal, {})).toEqual({ scheduled: 0 });
  now += 60_000;
  expect(await t.mutation(internal.searchWeeklyDigest.tickInternal, {})).toEqual({ scheduled: 1 });
  // Scheduled actions themselves acquire the atomic week claim; duplicate ticks are harmless.
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].args).toEqual([{ weekEnd }]);
});

it("claims one weekly delivery, rejects overlapping claims, fences stale attempts and never reclaims sent weeks", async () => {
  let now = weekEnd + 17 * 3_600_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(first).toMatchObject({ attempt: 1 });
  expect(await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd })).toBeNull();
  now += 6 * 60_000;
  const second = await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(second).toMatchObject({ attempt: 2 });
  expect(
    await t.mutation(internal.searchWeeklyDigest.finishInternal, {
      weekEnd,
      attempt: 1,
      delivered: true,
    }),
  ).toEqual({ applied: false });
  expect(
    await t.mutation(internal.searchWeeklyDigest.finishInternal, {
      weekEnd,
      attempt: 2,
      delivered: true,
    }),
  ).toEqual({ applied: true });
  now += 24 * 3_600_000;
  expect(await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd })).toBeNull();
  const records = await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect());
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ status: "sent", attempts: 2 });
});

it("freezes one identity-free payload for retries and records query-free delivery failures", async () => {
  let now = weekEnd + 17 * 3_600_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const t = convexTest(schema, modules);
  const payload = buildSearchDigest({
    weekEnd,
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 0,
    sources7d: { "clawhub-web": 0, "openclaw-control-ui": 0 },
    rows: [],
    classificationStatus: "unavailable",
    currentMetadataStatus: "unavailable",
    truncated: false,
  });
  await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(
    await t.mutation(internal.searchWeeklyDigest.savePayloadInternal, {
      weekEnd,
      attempt: 1,
      payload,
    }),
  ).toEqual({ applied: true });
  await expect(
    t.mutation(internal.searchWeeklyDigest.savePayloadInternal, {
      weekEnd,
      attempt: 1,
      payload: { ...payload, userId: "disallowed" },
    } as never),
  ).rejects.toThrow();
  await t.mutation(internal.searchWeeklyDigest.finishInternal, {
    weekEnd,
    attempt: 1,
    delivered: false,
    failureCode: "hermit_http_failure",
  });
  expect(await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd })).toBeNull();
  now += 3 * 60_000;
  const retry = await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(retry).toMatchObject({ attempt: 2, payload });
  expect(
    await t.mutation(internal.searchWeeklyDigest.savePayloadInternal, {
      weekEnd,
      attempt: 2,
      payload: { ...payload, totalSearches: 1 },
    }),
  ).toEqual({ applied: false });
});

it("prunes only expired weekly payloads at the indexed retention boundary", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(Date, "now").mockReturnValue(weekEnd);
  await t.run(async (ctx) => {
    for (const expirationTime of [weekEnd - 1, weekEnd, weekEnd + 1]) {
      await ctx.db.insert("searchWeeklyDigests", {
        weekEnd,
        status: "sent",
        attempts: 1,
        claimedUntil: 0,
        nextAttemptAt: 0,
        expirationTime,
      });
    }
  });
  expect(await t.mutation(internal.searchWeeklyDigest.pruneExpiredInternal, {})).toEqual({
    deleted: 2,
  });
  expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toHaveLength(1);
});
