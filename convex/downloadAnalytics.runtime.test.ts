/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const now = Date.UTC(2026, 10, 5, 0, 7, 23);
const day = 86_400_000;
async function setup(role: "admin" | "moderator" | "user" = "admin") {
  const t = convexTest({ schema, modules, transactionLimits: true });
  registerRateLimiter(t, "rateLimiterV2");
  const owner = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "metrics", role });
    await ctx.db.insert("apiTokens", {
      userId,
      label: "analytics test",
      prefix: "metrics",
      tokenHash: await hashToken("metrics-token"),
      createdAt: now,
    });
    return userId;
  });
  return { t, owner, admin: t.withIdentity({ subject: owner + "|session" }) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("admin Template download analytics", () => {
  it("distinguishes unbuilt from a real zero and exposes exact rolling boundaries", async () => {
    const { t, admin } = await setup();
    expect(await admin.query(api.downloadAnalytics.getSummary, {})).toMatchObject({
      scope: "templates",
      status: "pending",
      downloadsLast24h: null,
      downloadsAllTime: null,
      generatedAt: null,
      windowStartAt: null,
      windowEndAt: null,
    });
    await admin.mutation(api.downloadAnalytics.refresh, {});
    for (let page = 0; page < 200; page++) {
      await vi.advanceTimersByTimeAsync(1);
      await t.finishInProgressScheduledFunctions();
      if (!(await admin.query(api.downloadAnalytics.getSummary, {})).refreshInProgress) break;
    }
    expect(await admin.query(api.downloadAnalytics.getSummary, {})).toMatchObject({
      status: "ready",
      downloadsLast24h: 0,
      downloadsAllTime: 0,
      windowStartAt: now - day,
      windowEndAt: now,
    });
  });
  it("rejects anonymous, ordinary users and moderators through public refs and HTTP", async () => {
    for (const role of ["user", "moderator"] as const) {
      const { t, admin } = await setup(role);
      await expect(t.query(api.downloadAnalytics.getSummary, {})).rejects.toThrow("Unauthorized");
      await expect(t.mutation(api.downloadAnalytics.refresh, {})).rejects.toThrow("Unauthorized");
      await expect(admin.query(api.downloadAnalytics.getSummary, {})).rejects.toThrow("Forbidden");
      await expect(admin.mutation(api.downloadAnalytics.refresh, {})).rejects.toThrow("Forbidden");
      for (const method of ["GET", "POST"]) {
        expect((await t.fetch("/api/v1/admin/download-analytics", { method })).status).toBe(401);
        expect(
          (
            await t.fetch("/api/v1/admin/download-analytics", {
              method,
              headers: { Authorization: "Bearer metrics-token" },
            })
          ).status,
        ).toBe(403);
      }
    }
  });
});

function fixturePackage(
  ownerUserId: Id<"users">,
  name: string,
  overrides: Partial<Pick<Doc<"packages">, "family" | "channel" | "softDeletedAt">> = {},
) {
  return {
    name,
    normalizedName: name,
    displayName: name,
    ownerUserId,
    family: "claw" as const,
    channel: "community" as const,
    isOfficial: false,
    tags: {},
    stats: { downloads: 100000, installs: 999, stars: 0, versions: 1 },
    createdAt: now - 20 * day,
    updatedAt: now,
    ...overrides,
  };
}
async function finishReport(
  t: Awaited<ReturnType<typeof setup>>["t"],
  admin: Awaited<ReturnType<typeof setup>>["admin"],
) {
  for (let page = 0; page < 200; page++) {
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    const summary = await admin.query(api.downloadAnalytics.getSummary, {});
    if (!summary.refreshInProgress) return summary;
  }
  throw new Error("Report did not finish within fixture page budget");
}
describe("report boundaries, sources and bounded work", () => {
  it("scans every canonical counter and only exact-window downloads of eligible Templates", async () => {
    const { t, owner, admin } = await setup();
    const cutoff = now + 10000;
    await t.run(async (ctx) => {
      const ids: Id<"packages">[] = [];
      for (let i = 0; i < 205; i++)
        ids.push(await ctx.db.insert("packages", fixturePackage(owner, "template-" + i)));
      for (const [name, overrides] of [
        ["private", { channel: "private" }],
        ["deleted", { softDeletedAt: now - day }],
        ["plugin", { family: "code-plugin" }],
      ] as const) {
        const packageId = await ctx.db.insert("packages", fixturePackage(owner, name, overrides));
        await ctx.db.insert("packageStatEvents", {
          packageId,
          kind: "download",
          occurredAt: cutoff - 100,
        });
      }
      const packageId = ids[0]!;
      for (const occurredAt of [
        cutoff - day,
        cutoff - 1,
        ...Array.from({ length: 23 }, () => cutoff - 100),
      ])
        await ctx.db.insert("packageStatEvents", { packageId, kind: "download", occurredAt });
      // Midnight buckets would include the old entry and/or omit yesterday's
      // partial UTC day; [now-24h, now) includes exactly the intended boundaries.
      for (const occurredAt of [cutoff - day - 1, cutoff, cutoff + 1])
        await ctx.db.insert("packageStatEvents", { packageId, kind: "download", occurredAt });
      for (const kind of ["install", "install_clear"] as const)
        await ctx.db.insert("packageStatEvents", { packageId, kind, occurredAt: cutoff - 1 });
    });
    vi.setSystemTime(cutoff);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const summary = await finishReport(t, admin);
    expect(summary).toMatchObject({
      status: "ready",
      downloadsLast24h: 25,
      downloadsAllTime: 20500000,
      windowStartAt: cutoff - day,
      windowEndAt: cutoff,
      scan: { packagesScanned: 208, eligiblePackages: 205, eventsScanned: 30 },
    });
    expect(summary.scan!.pages).toBeGreaterThan(5);
    expect(summary.scan!.eligibilityReads).toBeLessThanOrEqual(30);
    expect(summary.staleAfterAt).toBe(cutoff + 30 * 60000);
    expect(summary.consistencyNote).toContain("not an atomic snapshot");
    // Summary reads fit a tiny nested DB budget regardless of corpus size.
    const bounded = await t
      .withIdentity({ subject: owner + "|session" })
      .run(async (ctx) =>
        ctx.runQuery(
          api.downloadAnalytics.getSummary,
          {},
          { transactionLimits: { documentsRead: 3 } },
        ),
      );
    expect(bounded.downloadsAllTime).toBe(20500000);
  });
  it("uses the same authenticated result over GET and POST, and coalesces refreshes", async () => {
    const { t, admin } = await setup();
    const headers = { Authorization: "Bearer metrics-token" };
    const initial = await t.fetch("/api/v1/admin/download-analytics", { headers });
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toEqual(await admin.query(api.downloadAnalytics.getSummary, {}));
    for (let i = 0; i < 3; i++) {
      const res = await t.fetch("/api/v1/admin/download-analytics", { method: "POST", headers });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "pending", refreshInProgress: true });
    }
    const state = await t.run((ctx) => ctx.db.query("downloadAnalyticsReports").unique());
    expect(state!.revision).toBe(1);
    const ready = await finishReport(t, admin);
    const response = await t.fetch("/api/v1/admin/download-analytics", { headers });
    expect(await response.json()).toEqual(ready);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    expect((await t.run((ctx) => ctx.db.get(state!._id)))!.revision).toBe(1);
  });
  it("preserves metering dedupe, excludes installs, and never double-processes or replays a report page", async () => {
    const { t, owner, admin } = await setup();
    const cutoff = now + 10000;
    const packageId = await t.run((ctx) =>
      ctx.db.insert("packages", fixturePackage(owner, "dedupe")),
    );
    for (const occurredAt of [cutoff - day, cutoff - 1, cutoff - 1]) {
      await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
        target: { kind: "package", id: packageId },
        identityKind: "user",
        identityHash: "fixture",
        dayStart: Math.floor(occurredAt / day) * day,
        occurredAt,
      });
    }
    const first = await t.mutation(internal.packages.processPackageStatEventsInternal, {});
    expect(first.processed).toBe(2);
    expect(
      (await t.mutation(internal.packages.processPackageStatEventsInternal, {})).processed,
    ).toBe(0);
    vi.setSystemTime(cutoff);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const report = await t.run((ctx) => ctx.db.query("downloadAnalyticsReports").unique());
    const args = { reportId: report!._id, revision: report!.revision, pageNumber: 0 };
    await t.mutation(internal.downloadAnalytics.buildPageInternal, args);
    const once = await t.run((ctx) => ctx.db.get(report!._id));
    await t.mutation(internal.downloadAnalytics.buildPageInternal, args);
    expect(await t.run((ctx) => ctx.db.get(report!._id))).toEqual(once);
    const summary = await finishReport(t, admin);
    expect(summary).toMatchObject({ downloadsLast24h: 2, downloadsAllTime: 100002 });
    vi.stubEnv("CLAWHUB_DOWNLOAD_METRICS_PAUSED", "1");
    await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
      target: { kind: "package", id: packageId },
      identityKind: "user",
      identityHash: "paused-fixture",
      dayStart: Math.floor(now / day) * day,
      occurredAt: now - 1,
    });
    expect(await admin.query(api.downloadAnalytics.getSummary, {})).toMatchObject({
      countingPaused: true,
      downloadsLast24h: 2,
    });
    expect(await t.run((ctx) => ctx.db.query("packageStatEvents").take(10))).toHaveLength(2);
  });
  it("retains processed raw events for 7 days without deriving lifetime from retention", async () => {
    const { t, owner, admin } = await setup();
    const ids = await t.run(async (ctx) => {
      const packageId = await ctx.db.insert("packages", fixturePackage(owner, "durable"));
      const old = await ctx.db.insert("packageStatEvents", {
        packageId,
        kind: "download",
        occurredAt: now - 8 * day,
        processedAt: now - 8 * day,
      });
      const recent = await ctx.db.insert("packageStatEvents", {
        packageId,
        kind: "download",
        occurredAt: now - 6 * day,
        processedAt: now - 6 * day,
      });
      const unprocessed = await ctx.db.insert("packageStatEvents", {
        packageId,
        kind: "download",
        occurredAt: now - 8 * day,
      });
      return { old, recent, unprocessed };
    });
    const result = await t.action(internal.packages.pruneProcessedPackageStatEventsInternal, {
      confirmationToken: "PRUNE_PROCESSED_PACKAGE_STAT_EVENTS",
    });
    expect(result).toMatchObject({ retentionDays: 7, deleted: 1 });
    expect(await t.run((ctx) => ctx.db.get(ids.old))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids.recent))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids.unprocessed))).not.toBeNull();
    await admin.mutation(api.downloadAnalytics.refresh, {});
    expect(await finishReport(t, admin)).toMatchObject({
      downloadsLast24h: 0,
      downloadsAllTime: 100000,
    });
  });
  it("keeps previous values and timestamps on failure, then permits a new bounded refresh", async () => {
    const { t, admin } = await setup();
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const baseline = await finishReport(t, admin);
    vi.setSystemTime(now + 31 * 60000);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const report = await t.run((ctx) => ctx.db.query("downloadAnalyticsReports").unique());
    await t.mutation(internal.downloadAnalytics.failBuildInternal, {
      reportId: report!._id,
      revision: report!.revision,
      pageNumber: report!.build!.pageNumber,
    });
    const failed = await admin.query(api.downloadAnalytics.getSummary, {});
    expect(failed).toMatchObject({
      status: "ready",
      generatedAt: baseline.generatedAt,
      downloadsLast24h: 0,
      downloadsAllTime: 0,
      refreshInProgress: false,
    });
    expect(failed.lastError).toContain("failed");
    expect(failed.staleAfterAt!).toBeLessThan(Date.now());
    const retry = await admin.mutation(api.downloadAnalytics.refresh, {});
    expect(retry).toMatchObject({ refreshInProgress: true, lastError: null });
    expect((await finishReport(t, admin)).windowEndAt).toBe(retry.refreshStartedAt);
  });
  it("expires abandoned builds honestly without fabricating zeros", async () => {
    const { t, admin } = await setup();
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const report = await t.run((ctx) => ctx.db.query("downloadAnalyticsReports").unique());
    vi.setSystemTime(now + 30 * 60000);
    await t.mutation(internal.downloadAnalytics.expireBuildInternal, {
      reportId: report!._id,
      revision: report!.revision,
    });
    expect(await admin.query(api.downloadAnalytics.getSummary, {})).toMatchObject({
      status: "pending",
      downloadsLast24h: null,
      downloadsAllTime: null,
      refreshInProgress: false,
      lastError: expect.stringContaining("timed out"),
    });
  });
});

describe("report failure and eventual counters", () => {
  it("records a real worker pagination error without publishing partial sums", async () => {
    const { t, admin } = await setup();
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const report = await t.run(async (ctx) => {
      const row = await ctx.db.query("downloadAnalyticsReports").unique();
      await ctx.db.patch(row!._id, { build: { ...row!.build!, cursor: "invalid-cursor" } });
      return row!;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await t.action(internal.downloadAnalytics.buildPageActionInternal, {
        reportId: report._id,
        revision: report.revision,
        pageNumber: 0,
      });
      expect(errorLog).toHaveBeenCalled();
      expect(await admin.query(api.downloadAnalytics.getSummary, {})).toMatchObject({
        status: "pending",
        downloadsLast24h: null,
        downloadsAllTime: null,
        refreshInProgress: false,
        lastError: expect.stringContaining("failed"),
      });
    } finally {
      errorLog.mockRestore();
    }
  });
  it("shows unprocessed downloads immediately in the window but not invented lifetime counts", async () => {
    const { t, owner, admin } = await setup();
    await t.run(async (ctx) => {
      const packageId = await ctx.db.insert("packages", fixturePackage(owner, "counter-lag"));
      await ctx.db.insert("packageStatEvents", {
        packageId,
        kind: "download",
        occurredAt: now - 1,
      });
    });
    vi.setSystemTime(now + 10000);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    const summary = await finishReport(t, admin);
    expect(summary).toMatchObject({ downloadsLast24h: 1, downloadsAllTime: 100000 });
    expect(summary.counterLagNote).toContain("processing backlog");
    await t.mutation(internal.packages.processPackageStatEventsInternal, {});
    // A background counter patch does not pretend the old report was regenerated.
    expect((await admin.query(api.downloadAnalytics.getSummary, {})).downloadsAllTime).toBe(100000);
    vi.setSystemTime(now + 120000);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    expect(await finishReport(t, admin)).toMatchObject({
      downloadsLast24h: 1,
      downloadsAllTime: 100001,
    });
  });
  it("rechecks current admin role for both sessions and existing API tokens", async () => {
    const { t, owner, admin } = await setup();
    await t.run((ctx) => ctx.db.patch(owner, { role: "user" }));
    await expect(admin.query(api.downloadAnalytics.getSummary, {})).rejects.toThrow("Forbidden");
    expect(
      (
        await t.fetch("/api/v1/admin/download-analytics", {
          headers: { Authorization: "Bearer metrics-token" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("local analytics proof fixture", () => {
  it("is idempotent, proves eligible totals and refuses production seeding", async () => {
    const { t, admin } = await setup();
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:admin-download-analytics-proof");
    const fixture = await t.mutation(internal.devSeedDownloadAnalytics.seedInternal, {});
    expect(fixture).toMatchObject({
      packageCount: 5,
      expectedDownloadsLast24h: 17,
      expectedDownloadsAllTime: 19134,
    });
    await t.mutation(internal.devSeedDownloadAnalytics.seedInternal, {});
    vi.setSystemTime(now + 10000);
    await admin.mutation(api.downloadAnalytics.refresh, {});
    expect(await finishReport(t, admin)).toMatchObject({
      downloadsLast24h: 17,
      downloadsAllTime: 19134,
      scan: { eventsScanned: 54, packagesScanned: 5, eligiblePackages: 2 },
    });
    // Seeded events already belong to the synthetic durable counters.
    expect(
      (await t.mutation(internal.packages.processPackageStatEventsInternal, {})).processed,
    ).toBe(0);
    vi.stubEnv("CONVEX_DEPLOYMENT", "dev:example");
    await expect(t.mutation(internal.devSeedDownloadAnalytics.seedInternal, {})).rejects.toThrow(
      "local-only",
    );
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:example");
    await expect(t.mutation(internal.devSeedDownloadAnalytics.seedInternal, {})).rejects.toThrow(
      "disabled outside local/dev",
    );
  });
});
