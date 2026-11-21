import { getPage, type IndexKey } from "convex-helpers/server/pagination";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalQuery, internalMutation } from "./functions";
import { assertModerator, requireUserFromAction } from "./lib/access";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import { readReport, readCurrentResults } from "./lib/searchInsightRead";
import {
  SEARCH_DAY_MS,
  searchAggregateExpiration,
  searchIntentKind,
  searchInsightArgs,
  searchInsightSource,
  searchArtifactKind,
  searchScope,
  type SearchInsightReport,
} from "./lib/searchInsights";

export const get = action({
  args: searchInsightArgs,
  handler: async (ctx, args): Promise<SearchInsightReport> => {
    const { user } = await requireUserFromAction(ctx);
    assertModerator(user);
    return await readReport(ctx, args);
  },
});
export const getInternal = internalAction({
  args: searchInsightArgs,
  handler: readReport,
});
export const listDailyInternal = internalQuery({
  args: {
    artifactKind: v.optional(searchArtifactKind),
    start: v.number(),
    end: v.number(),
    source: v.optional(searchInsightSource),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const rows = ctx.db.query("searchDailyAggregates");
    return await (
      args.source
        ? rows.withIndex("by_artifact_source_day", (q) =>
            q
              .eq("artifactKind", args.artifactKind ?? "plugin")
              .eq("source", args.source!)
              .gte("dayStart", args.start)
              .lt("dayStart", args.end),
          )
        : rows.withIndex("by_artifact_day", (q) =>
            q
              .eq("artifactKind", args.artifactKind ?? "plugin")
              .gte("dayStart", args.start)
              .lt("dayStart", args.end),
          )
    ).paginate(args.paginationOpts);
  },
});

export const storeClassificationsInternal = internalMutation({
  args: {
    artifactKind: v.optional(searchArtifactKind),
    weekStart: v.number(),
    weekEnd: v.number(),
    processedAt: v.number(),
    model: v.string(),
    modelVersion: v.string(),
    status: v.optional(v.union(v.literal("available"), v.literal("unavailable"))),
    expectedQualified: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    failureCode: v.optional(v.string()),
    rows: v.array(
      v.object({
        query: v.string(),
        scope: v.optional(searchScope),
        intentKind: searchIntentKind,
        companyProductName: v.optional(v.string()),
        confidence: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (
      args.rows.length > 100 ||
      args.weekEnd - args.weekStart !== 7 * SEARCH_DAY_MS ||
      args.weekEnd % SEARCH_DAY_MS !== 0 ||
      !Number.isSafeInteger(args.weekEnd) ||
      !Number.isSafeInteger(args.processedAt) ||
      args.model.length > 120 ||
      args.modelVersion.length > 120 ||
      (args.failureCode?.length ?? 0) > 80
    )
      throw new Error("Invalid bounded classification batch");
    const expectedQualified = args.expectedQualified ?? args.rows.length;
    if (
      !Number.isInteger(expectedQualified) ||
      expectedQualified < args.rows.length ||
      expectedQualified > 100
    )
      throw new Error("Invalid qualified query count");
    const expirationTime = searchAggregateExpiration(args.weekEnd);
    const status = args.status ?? "available";
    if (status === "unavailable" && args.rows.length)
      throw new Error("Unavailable classification cannot include rows");
    const previous = await ctx.db
      .query("searchWeeklyClassifications")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .take(201);
    if (previous.length > 200) throw new Error("Classification week exceeds bounded batch");
    for (const row of previous) {
      if ((row.artifactKind ?? "plugin") === (args.artifactKind ?? "plugin"))
        await ctx.db.delete(row._id);
    }
    const queries = new Set<string>();
    for (const row of args.rows) {
      if (
        !row.query ||
        row.query.length > 256 ||
        row.query !== row.query.trim().toLowerCase().replace(/\s+/g, " ") ||
        queries.has(JSON.stringify([row.scope ?? "legacy", row.query])) ||
        !Number.isFinite(row.confidence) ||
        row.confidence < 0 ||
        row.confidence > 1 ||
        (row.companyProductName?.length ?? 0) > 120
      )
        throw new Error("Invalid classification row");
      queries.add(JSON.stringify([row.scope ?? "legacy", row.query]));
      const doc = {
        ...row,
        artifactKind: args.artifactKind ?? "plugin",
        weekStart: args.weekStart,
        weekEnd: args.weekEnd,
        processedAt: args.processedAt,
        model: args.model,
        modelVersion: args.modelVersion,
        expirationTime,
      };
      await ctx.db.insert("searchWeeklyClassifications", doc);
    }
    const existing = await ctx.db
      .query("searchClassificationRuns")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .take(3);
    const previousRun = existing.find(
      (row) => (row.artifactKind ?? "plugin") === (args.artifactKind ?? "plugin"),
    );
    const run = {
      artifactKind: args.artifactKind ?? "plugin",
      weekStart: args.weekStart,
      weekEnd: args.weekEnd,
      processedAt: args.processedAt,
      model: args.model,
      modelVersion: args.modelVersion,
      expectedQualified,
      classifiedCount: args.rows.length,
      truncated: args.truncated ?? false,
      status,
      expirationTime,
      ...(args.failureCode ? { failureCode: args.failureCode } : {}),
    };
    if (previousRun) await ctx.db.replace(previousRun._id, run);
    else await ctx.db.insert("searchClassificationRuns", run);
    return { status, classifiedCount: args.rows.length };
  },
});
export const getClassificationRunInternal = internalQuery({
  args: { endDay: v.number(), artifactKind: v.optional(searchArtifactKind) },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("searchClassificationRuns")
      .withIndex("by_weekEnd", (q) =>
        q.gt("weekEnd", args.endDay - 7 * SEARCH_DAY_MS).lte("weekEnd", args.endDay),
      )
      .order("desc")
      .take(21);
    return (
      runs.find((run) => (run.artifactKind ?? "plugin") === (args.artifactKind ?? "plugin")) ?? null
    );
  },
});
export const getClassificationsInternal = internalQuery({
  args: { weekEnd: v.number(), artifactKind: v.optional(searchArtifactKind) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("searchWeeklyClassifications")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .take(201);
    if (rows.length > 200) throw new Error("Classification week exceeds bounded batch");
    return rows.filter((row) => (row.artifactKind ?? "plugin") === (args.artifactKind ?? "plugin"));
  },
});

export const aggregateInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const state = await ctx.db
      .query("searchAggregateStates")
      .withIndex("by_key", (q) => q.eq("key", "plugin"))
      .unique();
    // The cursor and every bucket delta commit together. Retrying a batch cannot double-count it.
    const page = await getPage(ctx, {
      table: "pluginSearchObservations",
      targetMaxRows: 200,
      absoluteMaxRows: 200,
      startIndexKey: state?.cursor ? (JSON.parse(state.cursor) as IndexKey) : undefined,
    });
    for (const raw of page.page) {
      const dayStart = Math.floor(raw.observedAt / SEARCH_DAY_MS) * SEARCH_DAY_MS;
      const category = raw.category ?? "";
      const intent = raw.topic ?? "";
      const existing = await ctx.db
        .query("searchDailyAggregates")
        .withIndex("by_bucket", (q) =>
          q
            .eq("artifactKind", raw.artifactKind)
            .eq("scope", raw.scope)
            .eq("dayStart", dayStart)
            .eq("source", raw.source)
            .eq("query", raw.normalizedQuery)
            .eq("category", category)
            .eq("intent", intent),
        )
        .unique();
      const counts = {
        searches: (existing?.searches ?? 0) + 1,
        officialGaps: (existing?.officialGaps ?? 0) + (raw.officialResultCount === 0 ? 1 : 0),
        zeroResults: (existing?.zeroResults ?? 0) + (raw.resultCount === 0 ? 1 : 0),
      };
      if (existing) await ctx.db.patch(existing._id, counts);
      else
        await ctx.db.insert("searchDailyAggregates", {
          dayStart,
          source: raw.source,
          query: raw.normalizedQuery,
          category,
          intent,
          artifactKind: raw.artifactKind,
          scope: raw.scope,
          ...counts,
          expirationTime: searchAggregateExpiration(dayStart),
        });
    }
    const missedBefore = now - 30 * SEARCH_DAY_MS;
    const coverageGap =
      state && state.processedThrough < missedBefore
        ? {
            coverageGapStart: state.coverageGapStart ?? state.processedThrough,
            coverageGapEnd: missedBefore,
          }
        : {};
    const next = {
      key: "plugin" as const,
      cursor: page.page.length ? JSON.stringify(page.indexKeys.at(-1)) : (state?.cursor ?? null),
      processedThrough: !page.hasMore
        ? now
        : (state?.processedThrough ?? page.page[0]?.observedAt ?? now),
      revision: (state?.revision ?? 0) + 1,
      coverageStart: state?.coverageStart ?? page.page[0]?.observedAt ?? now,
      skillCoverageStart:
        state?.skillCoverageStart ??
        page.page.find((row) => row.artifactKind === "skill")?.observedAt,
      ...coverageGap,
    };
    if (state) await ctx.db.patch(state._id, next);
    else await ctx.db.insert("searchAggregateStates", next);
    if (page.hasMore)
      await ctx.scheduler.runAfter(0, internal.searchInsights.aggregateInternal, {});
    return { processed: page.page.length, hasMore: page.hasMore };
  },
});
export const pruneExpiredInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;
    let hasMore = false;
    for (const table of [
      "searchDailyAggregates",
      "searchWeeklyClassifications",
      "searchClassificationRuns",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_expirationTime", (q) => q.lte("expirationTime", now))
        .take(RETENTION_STANDARD_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted += rows.length;
      hasMore ||= rows.length === RETENTION_STANDARD_BATCH_SIZE;
    }
    if (hasMore) await ctx.scheduler.runAfter(0, internal.searchInsights.pruneExpiredInternal, {});
    return { deleted, hasMore };
  },
});

export const readCurrentResultsInternal = internalAction({
  args: { queries: v.array(v.string()), artifactKind: v.optional(searchArtifactKind) },
  handler: readCurrentResults,
});

export const getAggregateStateInternal = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("searchAggregateStates")
      .withIndex("by_key", (q) => q.eq("key", "plugin"))
      .unique(),
});
