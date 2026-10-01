/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { SearchReportResponseSchema } from "../packages/clawhub/src/schema/searchReports";
import { api, internal } from "./_generated/api";
import { syncPackageSearchDigestForPackageId } from "./functions";
import { REPORT_TTL_MS, REPORT_CHUNK_BYTES } from "./lib/searchReportContract";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

it("returns a durable staff report handle immediately and deduplicates the real queued generation", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 16));
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerWorkpool(t, "searchReports");
  const staff = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { role: "moderator" });
    await ctx.db.insert("apiTokens", {
      userId,
      label: "report-test",
      prefix: "report-test",
      tokenHash: await hashToken("report-test-token"),
      createdAt: Date.now(),
    });
    return userId;
  });
  const response = await t.fetch("/api/v1/search-insights/reports", {
    method: "POST",
    headers: { Authorization: "Bearer report-test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ view: "recommendations", artifactKind: "plugin" }),
  });
  expect(response.status).toBe(202);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const queued = await response.json();
  expect(queued).toMatchObject({ status: "pending", view: "recommendations", completedAt: null });
  const same = await t.withIdentity({ subject: staff }).mutation(api.searchReports.start, {
    view: "recommendations",
    artifactKind: "plugin",
  });
  expect(same.reportId).toBe(queued.reportId);
  expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toEqual([]);
  expect((await t.fetch(`/api/v1/search-insights/reports/${queued.reportId}`)).status).toBe(401);
});

async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 16));
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerWorkpool(t, "searchReports");
  const staff = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { role: "moderator", handle: "reviewer" });
    await ctx.db.insert("apiTokens", {
      userId: id,
      label: "fixture",
      prefix: "fixture",
      tokenHash: await hashToken("async-report-fixture"),
      createdAt: Date.now(),
    });
    return id;
  });
  return { t, staff, signed: t.withIdentity({ subject: staff }) };
}
const authHeaders = {
  Authorization: "Bearer async-report-fixture",
  "Content-Type": "application/json",
};

it("completes the real component job, keeps final GET compatibility, and reuses ready admission without embedding its report", async () => {
  const { t, signed } = await setup();
  const request = { view: "recommendations" as const, artifactKind: "plugin" as const };
  const queued = await signed.mutation(api.searchReports.start, request);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const ready = SearchReportResponseSchema.assert(
    await signed.action(api.searchReports.get, { reportId: queued.reportId }),
  );
  expect(ready.status).toBe("ready");
  if (ready.status !== "ready" || ready.view !== "recommendations")
    throw new Error("Expected ready plugin report");
  expect(ready.report.recommendations.lineup).toMatchObject({
    targetSize: 16,
    proposed: [],
    shortfall: 16,
  });
  const compatible = await t.fetch("/api/v1/search-insights?view=recommendations", {
    headers: authHeaders,
  });
  expect((await compatible.json()).recommendations).toEqual(ready.report.recommendations);
  const reused = await t.fetch("/api/v1/search-insights/reports", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(request),
  });
  expect(await reused.json()).toMatchObject({ reportId: queued.reportId, status: "ready" });
  const chunks = await t.run((ctx) => ctx.db.query("searchReportChunks").collect());
  expect(chunks.length).toBe(1);
  expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toEqual([]);
  const refreshed = await signed.mutation(api.searchReports.start, {
    view: "recommendations",
    refreshOf: queued.reportId,
  });
  const retry = await signed.mutation(api.searchReports.start, {
    view: "recommendations",
    refreshOf: queued.reportId,
  });
  expect(refreshed.reportId).not.toBe(queued.reportId);
  expect(retry.reportId).toBe(refreshed.reportId);
});

it.each(["plugin", "skill"] as const)(
  "retains all 100 %s demand rows through real queue and byte chunks",
  async (artifactKind) => {
    const { t, signed } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index++)
        await ctx.db.insert("searchDailyAggregates", {
          artifactKind,
          scope: "catalog",
          source: "clawhub-web",
          query: `calendar ${index}`,
          dayStart: Date.now() - REPORT_TTL_MS,
          category: "",
          intent: "",
          searches: index + 1,
          officialGaps: 0,
          zeroResults: 0,
          expirationTime: Date.now() + REPORT_TTL_MS,
        });
    });
    const queued = await signed.mutation(api.searchReports.start, {
      view: "demand",
      artifactKind,
      limit: 100,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const result = await signed.action(api.searchReports.get, { reportId: queued.reportId });
    expect(result.status).toBe("ready");
    if (result.status !== "ready" || result.view !== "demand")
      throw new Error("Expected full demand report");
    expect(result.report.rows).toHaveLength(100);
    expect(result.report.totalSearches7d).toBe(5050);
    expect(result.report.rows.map((row) => row.query)).toEqual(
      Array.from({ length: 100 }, (_, index) => `calendar ${99 - index}`),
    );
    expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toEqual([]);
  },
);

it("lets Workpool retry a real bounded classification failure and exposes only the query-free terminal phase", async () => {
  const { t, signed } = await setup();
  await t.run(async (ctx) => {
    const weekEnd = Date.now();
    await ctx.db.insert("searchClassificationRuns", {
      artifactKind: "plugin",
      weekStart: weekEnd - 7 * REPORT_TTL_MS,
      weekEnd,
      processedAt: weekEnd,
      status: "available",
      expectedQualified: 201,
      classifiedCount: 201,
      model: "fixture",
      modelVersion: "fixture",
      expirationTime: weekEnd + REPORT_TTL_MS,
    });
    for (let index = 0; index < 201; index++)
      await ctx.db.insert("searchWeeklyClassifications", {
        artifactKind: "plugin",
        scope: "catalog",
        weekStart: weekEnd - 7 * REPORT_TTL_MS,
        weekEnd,
        processedAt: weekEnd,
        query: `private fixture ${index}`,
        intentKind: "ambiguous",
        confidence: 0,
        model: "fixture",
        modelVersion: "fixture",
        expirationTime: weekEnd + REPORT_TTL_MS,
      });
  });
  const queued = await signed.mutation(api.searchReports.start, { view: "demand" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const result = await signed.action(api.searchReports.get, { reportId: queued.reportId });
  expect(result).toMatchObject({
    status: "failed",
    failureCode: "report_collection_failed",
    previousAttempts: 3,
  });
  expect(JSON.stringify(result)).not.toContain("private fixture");
  expect(await t.run((ctx) => ctx.db.query("searchReportChunks").collect())).toEqual([]);
});

it("expires private evidence after 24h, deletes chunks before their parent, and refuses late completion", async () => {
  const { t, signed } = await setup();
  const queued = await signed.mutation(api.searchReports.start, { view: "demand" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.setSystemTime(queued.expirationTime);
  expect(await signed.action(api.searchReports.get, { reportId: queued.reportId })).toMatchObject({
    status: "expired",
    failureCode: "report_expired",
  });
  const saved = await t.query(internal.searchReports.readInternal, {
    reportId: queued.reportId,
    now: Date.now(),
  });
  await t.mutation(internal.searchReports.pruneExpiredInternal, {});
  expect(await t.run((ctx) => ctx.db.query("searchReportChunks").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("searchReportRuns").collect())).toEqual([]);
  await expect(
    t.mutation(internal.searchReports.commitInternal, {
      reportId: saved.row._id,
      chunks: [new ArrayBuffer(0)],
      resultBytes: 0,
      resultHash: "late",
      sourceRevision: "late",
    }),
  ).rejects.toThrow("report_expired");
});

it("fails explicitly instead of truncating oversized multibyte evidence", async () => {
  const { t, signed } = await setup();
  await t.run(async (ctx) => {
    const weekEnd = Date.now();
    await ctx.db.insert("searchClassificationRuns", {
      artifactKind: "plugin",
      weekStart: weekEnd - 7 * REPORT_TTL_MS,
      weekEnd,
      processedAt: weekEnd,
      status: "available",
      expectedQualified: 6,
      classifiedCount: 6,
      model: "fixture",
      modelVersion: "fixture",
      expirationTime: weekEnd + REPORT_TTL_MS,
    });
    for (let index = 0; index < 6; index++) {
      const query = `calendar ${index}`;
      await ctx.db.insert("searchDailyAggregates", {
        artifactKind: "plugin",
        scope: "catalog",
        source: "clawhub-web",
        query,
        dayStart: weekEnd - REPORT_TTL_MS,
        category: "",
        intent: "",
        searches: 1,
        officialGaps: 0,
        zeroResults: 0,
        expirationTime: weekEnd + REPORT_TTL_MS,
      });
      await ctx.db.insert("searchWeeklyClassifications", {
        artifactKind: "plugin",
        scope: "catalog",
        weekStart: weekEnd - 7 * REPORT_TTL_MS,
        weekEnd,
        processedAt: weekEnd,
        query,
        intentKind: "ambiguous",
        confidence: 0,
        companyProductName: "界".repeat(REPORT_CHUNK_BYTES / 2),
        model: "fixture",
        modelVersion: "fixture",
        expirationTime: weekEnd + REPORT_TTL_MS,
      });
    }
  });
  const queued = await signed.mutation(api.searchReports.start, { view: "demand" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await signed.action(api.searchReports.get, { reportId: queued.reportId })).toMatchObject({
    status: "failed",
    failureCode: "report_too_large",
    previousAttempts: 1,
  });
  expect(await t.run((ctx) => ctx.db.query("searchReportChunks").collect())).toEqual([]);
});

it("returns actionable staff errors for missing/mismatched refresh and null status after retention", async () => {
  const { t, signed } = await setup();
  const missing = await t.fetch("/api/v1/search-insights/reports", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ view: "demand", refreshOf: "missing" }),
  });
  expect(missing.status).toBe(404);
  const queued = await signed.mutation(api.searchReports.start, {
    view: "demand",
    artifactKind: "skill",
  });
  const mismatch = await t.fetch("/api/v1/search-insights/reports", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ view: "recommendations", refreshOf: queued.reportId }),
  });
  expect(mismatch.status).toBe(409);
  expect(
    await signed.query(api.searchReports.status, { reportId: "missing", now: Date.now() }),
  ).toBeNull();
  expect(
    await signed.query(api.searchReports.status, {
      reportId: queued.reportId,
      now: queued.expirationTime,
    }),
  ).toMatchObject({ status: "expired" });
  const ordinary = await t.run((ctx) => ctx.db.insert("users", { role: "user" }));
  await expect(
    t
      .withIdentity({ subject: ordinary })
      .query(api.searchReports.status, { reportId: queued.reportId, now: Date.now() }),
  ).rejects.toThrow();
  await expect(
    t
      .withIdentity({ subject: ordinary })
      .action(api.searchReports.get, { reportId: queued.reportId }),
  ).rejects.toThrow();
  await expect(
    t.withIdentity({ subject: ordinary }).mutation(api.searchReports.start, { view: "demand" }),
  ).rejects.toThrow();
});

it("bounds cleanup by bytes for maximum-size reports, including queued work and late callbacks", async () => {
  const { t, signed } = await setup();
  const ids = [];
  for (let index = 0; index < 4; index++) {
    const queued = await signed.mutation(api.searchReports.start, {
      view: "demand",
      endDay: Date.now() - index * REPORT_TTL_MS,
    });
    const saved = await t.query(internal.searchReports.readInternal, {
      reportId: queued.reportId,
      now: Date.now(),
    });
    await t.mutation(internal.searchReports.commitInternal, {
      reportId: saved.row._id,
      chunks: Array.from({ length: 8 }, () => new ArrayBuffer(REPORT_CHUNK_BYTES)),
      resultBytes: REPORT_CHUNK_BYTES * 8,
      resultHash: "cleanup fixture",
      sourceRevision: "fixture",
    });
    ids.push(saved.row._id);
  }
  vi.setSystemTime(Date.now() + REPORT_TTL_MS);
  expect(await t.mutation(internal.searchReports.pruneExpiredInternal, {})).toBe(3);
  expect(await t.run((ctx) => ctx.db.query("searchReportChunks").collect())).toHaveLength(8);
  expect(await t.run((ctx) => ctx.db.query("searchReportRuns").collect())).toHaveLength(1);
  expect(
    await signed.query(api.searchReports.status, { reportId: ids[0]!, now: Date.now() }),
  ).toBeNull();
  expect(await t.mutation(internal.searchReports.pruneExpiredInternal, {})).toBe(1);
});

it("rechecks the entire saved adoption cohort beyond displayed cards and current Featured membership", async () => {
  const { t, staff, signed } = await setup();
  const ids = await t.run(async (ctx) => {
    const result = [];
    for (const [index, name] of ["calendar", "notes"].entries()) {
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: name,
        ownerUserId: staff,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        categories: ["productivity"],
        tags: {},
        scanStatus: "clean",
        stats: { downloads: 40, installs: 3, stars: 0, versions: 1 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const release = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        changelog: "Initial",
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
        verification: {
          tier: "structural",
          scope: "artifact-only",
          scanStatus: index ? "pending" : "clean",
        },
        createdBy: staff,
        createdAt: Date.now(),
      });
      await ctx.db.patch(packageId, { latestReleaseId: release, tags: { latest: release } });
      result.push({ packageId, release });
    }
    for (const [index, { packageId }] of result.entries())
      await ctx.db.insert("packageDailyStats", {
        packageId,
        day: Math.floor(Date.now() / REPORT_TTL_MS) - 1,
        installs: 4 - index,
        downloads: 40 - index,
        updatedAt: Date.now(),
      });
    return result;
  });
  const queued = await signed.mutation(api.searchReports.start, {
    view: "recommendations",
    artifactKind: "plugin",
    limit: 1,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const original = await signed.action(api.searchReports.get, { reportId: queued.reportId });
  if (original.status !== "ready" || original.view !== "recommendations")
    throw new Error("Expected original evidence");
  expect(original.report.recommendations.candidates.map((entry) => entry.id)).toEqual([
    "plugin:calendar",
  ]);
  await t.run(async (ctx) => {
    await ctx.db.patch(ids[0]!.packageId, { categories: ["channels"] });
    await ctx.db.patch(ids[1]!.release, {
      verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
    });
    await ctx.db.insert("packageBadges", {
      packageId: ids[1]!.packageId,
      kind: "highlighted",
      byUserId: staff,
      at: Date.now(),
    });
  });
  vi.setSystemTime(Date.now() + 1000);
  const current = await signed.action(api.searchReports.get, { reportId: queued.reportId });
  if (current.status !== "ready" || current.view !== "recommendations")
    throw new Error("Expected refreshed eligibility");
  expect(current.report.searchReport.generatedAt).toBe(original.report.searchReport.generatedAt);
  expect(current.report.adoption.generatedAt).toBe(original.report.adoption.generatedAt);
  expect(current.report.metadataCheckedAt).toBeGreaterThan(original.report.metadataCheckedAt!);
  expect(current.report.recommendations.lineup.proposed).toMatchObject([
    { id: "plugin:notes", change: "retain", adoption: { rank: 2 } },
  ]);
  expect(current.report.recommendations.excluded).toMatchObject([
    { id: "plugin:calendar", reasons: ["discovery-excluded:channels"] },
  ]);
  await t.run((ctx) => ctx.db.patch(ids[1]!.packageId, { softDeletedAt: Date.now() }));
  const hidden = await signed.action(api.searchReports.get, { reportId: queued.reportId });
  if (hidden.status !== "ready" || hidden.view !== "recommendations")
    throw new Error("Expected current membership review");
  expect(hidden.report.recommendations.lineup.proposed).toEqual([]);
  expect(hidden.report.recommendations.lineup.removals).toMatchObject([
    { id: "plugin:notes", reasons: ["no-public-version"] },
  ]);
});

it("retries failed nonempty catalog associations instead of permanently caching an empty candidate set", async () => {
  const { t, staff, signed } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 2; index++) {
      const packageId = await ctx.db.insert("packages", {
        name: "calendar",
        normalizedName: "calendar",
        displayName: "Calendar",
        ownerUserId: staff,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        tags: {},
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const release = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        changelog: "Initial",
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
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
        createdBy: staff,
        createdAt: Date.now(),
      });
      await ctx.db.patch(packageId, { latestReleaseId: release, tags: { latest: release } });
      await syncPackageSearchDigestForPackageId(ctx, packageId);
    }
    await ctx.db.insert("searchDailyAggregates", {
      artifactKind: "plugin",
      scope: "catalog",
      source: "clawhub-web",
      query: "calendar",
      dayStart: Date.now() - REPORT_TTL_MS,
      category: "",
      intent: "",
      searches: 4,
      officialGaps: 0,
      zeroResults: 0,
      expirationTime: Date.now() + REPORT_TTL_MS,
    });
  });
  const legacy = await t.action(internal.searchInsights.getInternal, { artifactKind: "plugin" });
  expect(legacy).toMatchObject({ totalSearches7d: 4, currentMetadataStatus: "unavailable" });
  const queued = await signed.mutation(api.searchReports.start, { view: "recommendations" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await signed.action(api.searchReports.get, { reportId: queued.reportId })).toMatchObject({
    status: "failed",
    failureCode: "report_catalog_unavailable",
    previousAttempts: 3,
  });
  expect(await t.run((ctx) => ctx.db.query("searchReportChunks").collect())).toEqual([]);
});

it("does not reinterpret retained v1 evidence and refreshes it explicitly under the current report version", async () => {
  const { t, signed } = await setup();
  const queued = await signed.mutation(api.searchReports.start, { view: "demand" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.run((ctx) =>
    ctx.db.patch(queued.reportId as import("./_generated/dataModel").Id<"searchReportRuns">, {
      reportVersion: "search-report-v1",
      requestKey: "old-v1-hash",
    }),
  );
  expect(await signed.action(api.searchReports.get, { reportId: queued.reportId })).toMatchObject({
    status: "incomplete",
    reportVersion: "search-report-v1",
    failureCode: "report_version_unsupported",
  });
  const fresh = await signed.mutation(api.searchReports.start, {
    view: "demand",
    refreshOf: queued.reportId,
  });
  expect(fresh).toMatchObject({ status: "pending", reportVersion: "search-report-v2" });
  expect(fresh.reportId).not.toBe(queued.reportId);
});
