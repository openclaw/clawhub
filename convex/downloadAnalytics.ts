import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, requireActiveUserById, requireUser } from "./lib/access";
import { analyticsSummaryValidator } from "./lib/downloadAnalytics";
import { areDownloadMetricsPaused } from "./lib/downloadMetricsSwitch";

const DAY_MS = 86_400_000;
const CADENCE_MS = 15 * 60_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
const REFRESH_COOLDOWN_MS = 60_000;
// Eligibility hydrates canonical package documents (up to 1 MiB each). Ten
// distinct lookups leave ample space below the 16 MiB transaction read limit.
const EVENTS_PAGE_SIZE = 10;
const PACKAGES_PAGE_SIZE = 100;
const PAGE_BYTES = 1024 * 1024;

function isEligible(pkg: Doc<"packages"> | null) {
  return pkg?.family === "claw" && pkg.channel !== "private" && !pkg.softDeletedAt;
}
async function readReport(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("downloadAnalyticsReports")
    .withIndex("by_scope", (q) => q.eq("scope", "templates"))
    .unique();
}
async function readSummary(ctx: QueryCtx | MutationCtx) {
  const report = await readReport(ctx);
  const snapshot = report?.snapshot;
  return {
    scope: "templates" as const,
    status: snapshot ? ("ready" as const) : ("pending" as const),
    generatedAt: snapshot?.generatedAt ?? null,
    windowStartAt: snapshot?.windowStartAt ?? null,
    windowEndAt: snapshot?.windowEndAt ?? null,
    downloadsLast24h: snapshot?.downloadsLast24h ?? null,
    downloadsAllTime: snapshot?.downloadsAllTime ?? null,
    countingPaused: areDownloadMetricsPaused(),
    refreshInProgress: !!report?.build,
    refreshStartedAt: report?.build?.startedAt ?? null,
    refreshExpiresAt: report?.build?.expiresAt ?? null,
    // A query must not read the clock: consumers compare these deadlines locally.
    staleAfterAt: snapshot ? snapshot.windowEndAt + 2 * CADENCE_MS : null,
    lastError: report?.lastError ?? null,
    scan: snapshot?.scan ?? null,
    counterLagNote:
      "Lifetime uses canonical package download counters, normally processed every 15 minutes; processing backlog and report cadence add lag. Paused downloads are not recorded or reconstructed.",
    eligibilityNote:
      "Public, undeleted Templates (family claw), checked as each page is read. Lifetime includes all recorded history of those listings, not deleted/private listings or only a top-N list.",
    consistencyNote:
      "Bounded multi-page observation, not an atomic snapshot. The rolling window is [windowStartAt, windowEndAt); late-arriving events, eligibility changes and counter processing during the scan can appear on the next refresh. Lifetime counters are observed during the scan, not frozen at windowEndAt.",
  };
}
export const getSummary = query({
  args: {},
  returns: analyticsSummaryValidator,
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    return readSummary(ctx);
  },
});
export const getSummaryForAdminInternal = internalQuery({
  args: { actorUserId: v.id("users") },
  returns: analyticsSummaryValidator,
  handler: async (ctx, args) => {
    assertAdmin(await requireActiveUserById(ctx, args.actorUserId));
    return readSummary(ctx);
  },
});
async function startRefresh(ctx: MutationCtx) {
  const report = await readReport(ctx);
  const now = Date.now();
  if (report?.build && report.build.expiresAt > now) return readSummary(ctx);
  if (!report?.build && report?.snapshot && now - report.snapshot.generatedAt < REFRESH_COOLDOWN_MS)
    return readSummary(ctx);
  const revision = (report?.revision ?? 0) + 1;
  const build = {
    startedAt: now,
    expiresAt: now + BUILD_TIMEOUT_MS,
    phase: "events" as const,
    cursor: null,
    pageNumber: 0,
    downloadsLast24h: 0,
    downloadsAllTime: 0,
    scan: {
      eventsScanned: 0,
      packagesScanned: 0,
      eligiblePackages: 0,
      eligibilityReads: 0,
      pages: 0,
    },
  };
  const reportId =
    report?._id ??
    (await ctx.db.insert("downloadAnalyticsReports", { scope: "templates", revision }));
  await ctx.db.patch(reportId, { revision, build, lastError: undefined });
  await ctx.scheduler.runAfter(0, internal.downloadAnalytics.buildPageActionInternal, {
    reportId,
    revision,
    pageNumber: 0,
  });
  // A failed scheduler/worker cannot leave a silently pending report forever.
  await ctx.scheduler.runAfter(BUILD_TIMEOUT_MS, internal.downloadAnalytics.expireBuildInternal, {
    reportId,
    revision,
  });
  return readSummary(ctx);
}
export const refresh = mutation({
  args: {},
  returns: analyticsSummaryValidator,
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    return startRefresh(ctx);
  },
});
export const refreshForAdminInternal = internalMutation({
  args: { actorUserId: v.id("users") },
  returns: analyticsSummaryValidator,
  handler: async (ctx, args) => {
    assertAdmin(await requireActiveUserById(ctx, args.actorUserId));
    return startRefresh(ctx);
  },
});
export const refreshInternal = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await startRefresh(ctx);
    return null;
  },
});
const buildArgs = {
  reportId: v.id("downloadAnalyticsReports"),
  revision: v.number(),
  pageNumber: v.number(),
};
export const buildPageActionInternal = internalAction({
  args: buildArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.downloadAnalytics.buildPageInternal, args);
    } catch (error) {
      console.error("Template download analytics page failed", error);
      await ctx.runMutation(internal.downloadAnalytics.failBuildInternal, args);
    }
    return null;
  },
});
export const failBuildInternal = internalMutation({
  args: buildArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (report?.revision === args.revision && report.build?.pageNumber === args.pageNumber)
      await ctx.db.patch(report._id, {
        build: undefined,
        lastError:
          "Report refresh failed. Retry refresh; previous completed report, if any, is unchanged.",
      });
    return null;
  },
});
export const expireBuildInternal = internalMutation({
  args: { reportId: v.id("downloadAnalyticsReports"), revision: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (report?.revision === args.revision && report.build && report.build.expiresAt <= Date.now())
      await ctx.db.patch(report._id, {
        build: undefined,
        lastError:
          "Report refresh timed out. Retry refresh; previous completed report, if any, is unchanged.",
      });
    return null;
  },
});
export const buildPageInternal = internalMutation({
  args: buildArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (
      !report?.build ||
      report.revision !== args.revision ||
      report.build.pageNumber !== args.pageNumber
    )
      return null;
    const build = report.build;
    if (Date.now() >= build.expiresAt) {
      await ctx.db.patch(report._id, {
        build: undefined,
        lastError: "Report refresh timed out. Retry refresh.",
      });
      return null;
    }
    const scan = { ...build.scan, pages: build.scan.pages + 1 };
    let downloadsLast24h = build.downloadsLast24h;
    let downloadsAllTime = build.downloadsAllTime;
    let phase = build.phase;
    let cursor: string | null;
    let done = false;
    if (phase === "events") {
      const result = await ctx.db
        .query("packageStatEvents")
        .withIndex("by_occurred_at", (q) =>
          q.gte("occurredAt", build.startedAt - DAY_MS).lt("occurredAt", build.startedAt),
        )
        .paginate({
          cursor: build.cursor,
          numItems: EVENTS_PAGE_SIZE,
          maximumRowsRead: EVENTS_PAGE_SIZE,
          maximumBytesRead: PAGE_BYTES,
        });
      const eligibility = new Map<Id<"packages">, boolean>();
      for (const event of result.page) {
        if (event.kind !== "download") continue;
        if (!eligibility.has(event.packageId)) {
          eligibility.set(event.packageId, isEligible(await ctx.db.get(event.packageId)));
          scan.eligibilityReads++;
        }
        if (eligibility.get(event.packageId)) downloadsLast24h++;
      }
      scan.eventsScanned += result.page.length;
      cursor = result.isDone ? null : result.continueCursor;
      if (result.isDone) phase = "packages";
    } else {
      // All packages, not a leaderboard/top-N. Canonical counters survive event TTL.
      const result = await ctx.db.query("packages").paginate({
        cursor: build.cursor,
        numItems: PACKAGES_PAGE_SIZE,
        maximumRowsRead: PACKAGES_PAGE_SIZE,
        maximumBytesRead: PAGE_BYTES,
      });
      for (const pkg of result.page) {
        if (!isEligible(pkg)) continue;
        downloadsAllTime += pkg.stats.downloads;
        scan.eligiblePackages++;
      }
      scan.packagesScanned += result.page.length;
      cursor = result.isDone ? null : result.continueCursor;
      done = result.isDone;
    }
    if (done) {
      await ctx.db.patch(report._id, {
        snapshot: {
          generatedAt: Date.now(),
          windowStartAt: build.startedAt - DAY_MS,
          windowEndAt: build.startedAt,
          downloadsLast24h,
          downloadsAllTime,
          scan,
        },
        build: undefined,
        lastError: undefined,
      });
      console.info("Template download analytics report completed", {
        ...scan,
        durationMs: Date.now() - build.startedAt,
      });
    } else {
      const pageNumber = build.pageNumber + 1;
      await ctx.db.patch(report._id, {
        build: { ...build, phase, cursor, pageNumber, downloadsLast24h, downloadsAllTime, scan },
      });
      await ctx.scheduler.runAfter(0, internal.downloadAnalytics.buildPageActionInternal, {
        reportId: report._id,
        revision: report.revision,
        pageNumber,
      });
    }
    return null;
  },
});
