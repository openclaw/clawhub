/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturedIntelligenceReportSchema } from "../packages/clawhub/src/schema/searchInsights";
import { api } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const END = Date.UTC(2026, 8, 16);
const END_DAY = END / DAY;
afterEach(() => vi.useRealTimers());
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(END + 12 * 3_600_000);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerWorkpool(t, "searchReports");
  const staff = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { handle: "reviewer", role: "moderator" });
    await ctx.db.insert("apiTokens", {
      userId: id,
      label: "fixture",
      prefix: "fixture",
      tokenHash: await hashToken("monthly-report-fixture"),
      createdAt: Date.now(),
    });
    return id;
  });
  return { t, staff, signed: t.withIdentity({ subject: staff }) };
}

it("serves the full monthly install order independently of Trending, partial days, downloads and existing badges", async () => {
  const { t, staff } = await setup();
  await t.run(async (ctx) => {
    const items = [
      { name: "month-winner", day: END_DAY - 30, installs: 20 },
      { name: "week-winner", day: END_DAY - 7, installs: 10 },
      { name: "tie-a", day: END_DAY - 8, installs: 10 },
      { name: "tie-b", day: END_DAY - 8, installs: 10 },
      { name: "too-old", day: END_DAY - 31, installs: 999 },
      { name: "partial-day", day: END_DAY, installs: 999 },
      { name: "channel", day: END_DAY - 1, installs: 999, categories: ["channels"] },
    ];
    for (const item of items) {
      const packageId = await ctx.db.insert("packages", {
        name: item.name,
        normalizedName: item.name,
        displayName: item.name,
        ownerUserId: staff,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        tags: {},
        categories: item.categories ?? ["productivity"],
        scanStatus: "clean",
        stats: { downloads: 999999, installs: 1, stars: 0, versions: 1 },
        createdAt: END - DAY,
        updatedAt: END,
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
        createdAt: END,
      });
      await ctx.db.patch(packageId, { latestReleaseId: release, tags: { latest: release } });
      await ctx.db.insert("packageDailyStats", {
        packageId,
        day: item.day,
        installs: item.installs,
        downloads: 0,
        updatedAt: END,
        ...(item.name === "month-winner"
          ? { rankingDatasetVersion: "import-fixture", rankingImportedAt: END - 1 }
          : {}),
      });
      if (item.name === "tie-b") {
        await ctx.db.insert("packageBadges", {
          packageId,
          kind: "highlighted",
          byUserId: staff,
          at: END,
        });
        await ctx.db.insert("packageLeaderboards", {
          kind: "package_trending",
          generatedAt: END,
          rangeStartDay: END_DAY - 6,
          rangeEndDay: END_DAY,
          items: [{ packageId, score: 999999, downloads: 999999, installs: 1 }],
        });
      }
    }
  });
  const response = await t.fetch(
    "/api/v1/search-insights?view=recommendations&artifactKind=plugin",
    {
      headers: { Authorization: "Bearer monthly-report-fixture" },
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const report = FeaturedIntelligenceReportSchema.assert(await response.json());
  expect(report.recommendations.lineup.proposed.map((entry) => entry.id)).toEqual([
    "plugin:month-winner",
    "plugin:week-winner",
    "plugin:tie-a",
    "plugin:tie-b",
  ]);
  expect(report.adoption).toMatchObject({
    status: "available",
    periodStart: END - 30 * DAY,
    periodStart7d: END - 7 * DAY,
    periodEnd: END,
    scannedRows: 5,
    totalItems: 5,
    inspectedItems: 5,
    importedRows: 1,
    importDatasetVersions: ["import-fixture"],
  });
  expect(report.recommendations.lineup.proposed[0].adoption).toMatchObject({
    installs30d: 20,
    installs7d: 0,
  });
  expect(report.recommendations.lineup.proposed[1].adoption).toMatchObject({
    installs30d: 10,
    installs7d: 10,
  });
  expect(report.recommendations.excluded).toMatchObject([
    { id: "plugin:channel", reasons: ["discovery-excluded:channels"] },
  ]);
  expect(report.recommendations.lineup).toMatchObject({
    pendingCount: 8,
    telemetryShortfall: 4,
    shortfall: 12,
  });
  expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toEqual([]);
});

it("reads sparse native skill installs across raw pages and freezes monthly evidence while refreshing public eligibility and editorial revision", async () => {
  const { t, staff, signed } = await setup();
  const ids = await t.run(async (ctx) => {
    const skillId = await ctx.db.insert("skills", {
      slug: "calendar",
      displayName: "Calendar",
      summary: "Calendar tool",
      ownerUserId: staff,
      tags: {},
      stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
      createdAt: END,
      updatedAt: END,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Initial",
      files: [
        {
          path: "SKILL.md",
          size: 1,
          storageId: await ctx.storage.store(new Blob(["x"])),
          sha256: "a".repeat(64),
        },
      ],
      parsed: { frontmatter: {} },
      createdBy: staff,
      createdAt: END,
      llmAnalysis: { status: "clean", checkedAt: END },
    });
    await ctx.db.patch(skillId, { latestVersionId: versionId });
    for (let index = 0; index < 5001; index++)
      await ctx.db.insert("skillDailyStats", {
        skillId,
        day: END_DAY - 1,
        installs: index === 5000 ? 7 : 0,
        downloads: 0,
        updatedAt: END,
      });
    return { skillId, versionId };
  });
  const queued = await signed.mutation(api.searchReports.start, {
    view: "recommendations",
    artifactKind: "skill",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const ready = await signed.action(api.searchReports.get, { reportId: queued.reportId });
  if (ready.status !== "ready" || ready.view !== "recommendations")
    throw new Error("Expected ready skill report");
  expect(ready.report.adoption).toMatchObject({ scannedRows: 5001, totalItems: 1 });
  expect(ready.report.recommendations.lineup.proposed).toMatchObject([
    { id: `clawhub:${ids.skillId}`, adoption: { installs30d: 7, installs7d: 7 } },
  ]);
  expect(ready.report.recommendations.lineup).toMatchObject({
    reservedSlots: 0,
    telemetryTarget: 16,
    shortfall: 15,
  });
  await t.run((ctx) =>
    ctx.db.patch(ids.versionId, { llmAnalysis: { status: "suspicious", checkedAt: END + 1 } }),
  );
  vi.setSystemTime(Date.now() + 3 * 3_600_000);
  const changed = await signed.action(api.searchReports.get, { reportId: queued.reportId });
  if (changed.status !== "ready" || changed.view !== "recommendations")
    throw new Error("Expected frozen report");
  expect(changed.report.adoption).toEqual(ready.report.adoption);
  expect(changed.report.recommendations.lineup.proposed).toEqual([]);
  const plugin = await signed.mutation(api.searchReports.start, {
    view: "recommendations",
    artifactKind: "plugin",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await signed.mutation(api.featuredSelections.saveEditorial, {
    expectedRevision: 0,
    items: [
      {
        id: "plugin:pending",
        name: "pending",
        displayName: "Pending",
        reason: "Awaiting public release",
      },
    ],
  });
  const stale = await signed.action(api.searchReports.get, { reportId: plugin.reportId });
  if (stale.status !== "ready" || stale.view !== "recommendations")
    throw new Error("Expected frozen editorial report");
  expect(stale.report.recommendations.lineup).toMatchObject({
    editorialRevision: 0,
    currentEditorialRevision: 1,
    staleEditorial: true,
  });
  expect(stale.report.recommendations.lineup.reservations[0].id).toBeNull();
  const refresh = await signed.mutation(api.searchReports.start, {
    view: "recommendations",
    refreshOf: plugin.reportId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const current = await signed.action(api.searchReports.get, { reportId: refresh.reportId });
  if (current.status !== "ready" || current.view !== "recommendations")
    throw new Error("Expected regenerated editorial report");
  expect(current.report.recommendations.lineup.reservations[0]).toMatchObject({
    id: "plugin:pending",
    status: "pending",
    artifact: null,
  });
  expect(current.report.recommendations.lineup.staleEditorial).toBe(false);
});

it("denies anonymous and ordinary users access to evidence", async () => {
  const { t } = await setup();
  expect((await t.fetch("/api/v1/search-insights?view=recommendations")).status).toBe(401);
  await expect(
    t.action(api.featuredIntelligence.get, { artifactKind: "plugin" }),
  ).rejects.toThrow();
  const user = await t.run((ctx) => ctx.db.insert("users", { role: "user" }));
  await expect(
    t
      .withIdentity({ subject: user })
      .action(api.featuredIntelligence.get, { artifactKind: "skill" }),
  ).rejects.toThrow();
});
