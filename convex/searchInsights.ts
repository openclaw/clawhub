import { getPage, type IndexKey } from "convex-helpers/server/pagination";
import { paginationOptsValidator, type FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction, internalQuery, internalMutation } from "./functions";
import { compareCatalogSearchEntries } from "./httpApiV1/packagesV1";
import { assertModerator, requireUserFromAction } from "./lib/access";
import {
  getPackageDownloadSecurityBlock,
  resolvePackageReleaseScanStatus,
} from "./lib/packageSecurity";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import {
  SEARCH_DAY_MS,
  SEARCH_INTENT_CONFIDENCE,
  searchAggregateExpiration,
  searchIntentKind,
  searchInsightArgs,
  searchInsightSource,
  type SearchInsightArgs,
  type SearchInsightReport,
  type SearchInsightRow,
  type SearchCurrentResults,
  type SearchCurrentResult,
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
    start: v.number(),
    end: v.number(),
    source: v.optional(searchInsightSource),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const rows = ctx.db.query("searchDailyAggregates");
    return await (
      args.source
        ? rows.withIndex("by_source_and_dayStart", (q) =>
            q.eq("source", args.source!).gte("dayStart", args.start).lt("dayStart", args.end),
          )
        : rows.withIndex("by_dayStart_and_source_and_query_and_category_and_intent", (q) =>
            q.gte("dayStart", args.start).lt("dayStart", args.end),
          )
    ).paginate(args.paginationOpts);
  },
});
async function readReport(ctx: ActionCtx, args: SearchInsightArgs): Promise<SearchInsightReport> {
  const coverageState: Doc<"searchAggregateStates"> | null = await ctx.runQuery(
    internal.searchInsights.getAggregateStateInternal,
    {},
  );
  const endDay = args.endDay ?? Math.floor(Date.now() / SEARCH_DAY_MS) * SEARCH_DAY_MS;
  if (!Number.isSafeInteger(endDay) || endDay % SEARCH_DAY_MS !== 0)
    throw new Error("endDay must be a UTC day boundary");
  const days = args.window ?? 7;
  const limit = args.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be between 1 and 100");
  const window = {
    endDay,
    start7d: endDay - 7 * SEARCH_DAY_MS,
    startPrevious7d: endDay - 14 * SEARCH_DAY_MS,
    start30d: endDay - 30 * SEARCH_DAY_MS,
    days,
  };
  const facts = new Map<string, SearchInsightRow>();
  let cursor: string | null = null;
  for (let batch = 0; ; batch++) {
    if (batch >= 200)
      throw new Error("Search aggregate scan budget exceeded; narrow the source filter");
    const page: { page: Doc<"searchDailyAggregates">[]; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(internal.searchInsights.listDailyInternal, {
        start: window.start30d,
        end: endDay,
        source: args.source,
        paginationOpts: {
          cursor,
          numItems: 500,
          maximumRowsRead: 500,
          maximumBytesRead: 1_000_000,
        },
      });
    for (const daily of page.page) {
      const row = facts.get(daily.query) ?? {
        query: daily.query,
        searches7d: 0,
        searchesPrevious7d: 0,
        searches30d: 0,
        officialGaps7d: 0,
        officialGaps30d: 0,
        zeroResults7d: 0,
        change7d: 0,
        changePercent: null,
        sources7d: { "clawhub-web": 0, "openclaw-control-ui": 0 },
        classification: null,
        companyOpportunity: false,
        currentResults: [],
        featuredCandidate: null,
        searchUrl: `/plugins?q=${encodeURIComponent(daily.query)}`,
      };
      row.searches30d += daily.searches;
      row.officialGaps30d += daily.officialGaps;
      if (daily.dayStart >= window.start7d) {
        row.searches7d += daily.searches;
        row.officialGaps7d += daily.officialGaps;
        row.zeroResults7d += daily.zeroResults;
        row.sources7d[daily.source] += daily.searches;
      } else if (daily.dayStart >= window.startPrevious7d) row.searchesPrevious7d += daily.searches;
      facts.set(daily.query, row);
    }
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  let rows = [...facts.values()].filter(
    (row) =>
      (days === 7 ? row.searches7d : row.searches30d) > 0 ||
      (args.order === "change" && row.searchesPrevious7d > 0),
  );
  const classificationRun: Doc<"searchClassificationRuns"> | null = await ctx.runQuery(
    internal.searchInsights.getClassificationRunInternal,
    { endDay },
  );
  const classifications = new Map<string, Doc<"searchWeeklyClassifications">>();
  if (classificationRun?.status === "available") {
    const batch: Doc<"searchWeeklyClassifications">[] = await ctx.runQuery(
      internal.searchInsights.getClassificationsInternal,
      { weekEnd: classificationRun.weekEnd },
    );
    for (const entry of batch) classifications.set(entry.query, entry);
  }
  for (const row of rows) {
    const entry = classifications.get(row.query);
    if (entry) {
      const { _id, _creationTime, expirationTime: _expirationTime, ...classification } = entry;
      row.classification = classification;
    }
    row.companyOpportunity =
      (days === 7 ? row.officialGaps7d : row.officialGaps30d) >= 3 &&
      row.classification?.intentKind === "company_product" &&
      row.classification.confidence >= SEARCH_INTENT_CONFIDENCE;
    row.change7d = row.searches7d - row.searchesPrevious7d;
    row.changePercent = row.searchesPrevious7d
      ? (100 * row.change7d) / row.searchesPrevious7d
      : null;
  }
  rows = rows.filter(
    (row) =>
      (!args.officialGap || (days === 7 ? row.officialGaps7d : row.officialGaps30d) > 0) &&
      (!args.intentKind ||
        (args.intentKind === "company_product"
          ? row.companyOpportunity
          : row.classification?.intentKind === args.intentKind)),
  );
  const rank = (row: SearchInsightRow) =>
    args.order === "change"
      ? Math.abs(row.change7d)
      : args.order === "official-gaps"
        ? days === 7
          ? row.officialGaps7d
          : row.officialGaps30d
        : days === 7
          ? row.searches7d
          : row.searches30d;
  rows.sort((a, b) => rank(b) - rank(a) || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
  const sources7d = { "clawhub-web": 0, "openclaw-control-ui": 0 };
  let totalSearches7d = 0;
  for (const row of rows) {
    totalSearches7d += row.searches7d;
    sources7d["clawhub-web"] += row.sources7d["clawhub-web"];
    sources7d["openclaw-control-ui"] += row.sources7d["openclaw-control-ui"];
  }
  const run = classificationRun
    ? {
        weekStart: classificationRun.weekStart,
        weekEnd: classificationRun.weekEnd,
        processedAt: classificationRun.processedAt,
        expectedQualified: classificationRun.expectedQualified,
        classifiedCount: classificationRun.classifiedCount,
        truncated: classificationRun.truncated ?? false,
        model: classificationRun.model,
        modelVersion: classificationRun.modelVersion,
        ...(classificationRun.failureCode ? { failureCode: classificationRun.failureCode } : {}),
      }
    : null;
  const classificationStatus =
    !classificationRun || classificationRun.status === "unavailable"
      ? "unavailable"
      : classificationRun.truncated ||
          classificationRun.classifiedCount < classificationRun.expectedQualified
        ? "partial"
        : "available";
  const selected = rows.slice(0, limit);
  let metadataCheckedAt: number | null = null;
  if (args.includeCurrentResults !== false && selected.length) {
    try {
      const current = await readCurrentResults(ctx, { queries: selected.map((row) => row.query) });
      metadataCheckedAt = current.metadataCheckedAt;
      for (const row of selected) {
        row.currentResults = current.rows.find((entry) => entry.query === row.query)?.results ?? [];
        row.featuredCandidate =
          row.currentResults.find((entry) => entry.eligibleForFeatured) ?? null;
      }
    } catch {
      // Catalog lookup failure must not discard deterministic search counts.
    }
  }
  const latestCoverage: Doc<"searchAggregateStates"> | null = await ctx.runQuery(
    internal.searchInsights.getAggregateStateInternal,
    {},
  );
  if (coverageState?.revision !== latestCoverage?.revision)
    throw new Error("Search aggregates changed during report; refresh to retry");
  const coverage = {
    dataThrough: coverageState?.processedThrough ?? null,
    collectionStartedAt: coverageState?.coverageStart ?? null,
    gapStart: coverageState?.coverageGapStart ?? null,
    gapEnd: coverageState?.coverageGapEnd ?? null,
  };
  return {
    coverage,
    metadataCheckedAt,
    currentMetadataStatus: metadataCheckedAt === null ? "unavailable" : "available",
    totalSearches7d,
    sources7d,
    truncated: rows.length > limit,
    classificationStatus,
    classificationRun: run,
    window,
    source: args.source ?? null,
    generatedAt: Date.now(),
    totalQueries: rows.length,
    rows: selected,
  };
}

export const storeClassificationsInternal = internalMutation({
  args: {
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
      .take(101);
    if (previous.length > 100) throw new Error("Classification week exceeds bounded batch");
    for (const row of previous) await ctx.db.delete(row._id);
    const queries = new Set<string>();
    for (const row of args.rows) {
      if (
        !row.query ||
        row.query.length > 256 ||
        row.query !== row.query.trim().toLowerCase().replace(/\s+/g, " ") ||
        queries.has(row.query) ||
        !Number.isFinite(row.confidence) ||
        row.confidence < 0 ||
        row.confidence > 1 ||
        (row.companyProductName?.length ?? 0) > 120
      )
        throw new Error("Invalid classification row");
      queries.add(row.query);
      const existing = await ctx.db
        .query("searchWeeklyClassifications")
        .withIndex("by_query_and_weekEnd", (q) =>
          q.eq("query", row.query).eq("weekEnd", args.weekEnd),
        )
        .unique();
      const doc = {
        ...row,
        weekStart: args.weekStart,
        weekEnd: args.weekEnd,
        processedAt: args.processedAt,
        model: args.model,
        modelVersion: args.modelVersion,
        expirationTime,
      };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("searchWeeklyClassifications", doc);
    }
    const existing = await ctx.db
      .query("searchClassificationRuns")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .unique();
    const run = {
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
    if (existing) await ctx.db.replace(existing._id, run);
    else await ctx.db.insert("searchClassificationRuns", run);
    return { status, classifiedCount: args.rows.length };
  },
});
export const getClassificationRunInternal = internalQuery({
  args: { endDay: v.number() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("searchClassificationRuns")
      .withIndex("by_weekEnd", (q) =>
        q.gt("weekEnd", args.endDay - 7 * SEARCH_DAY_MS).lte("weekEnd", args.endDay),
      )
      .order("desc")
      .first(),
});
export const getClassificationsInternal = internalQuery({
  args: { weekEnd: v.number() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("searchWeeklyClassifications")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .take(100),
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
        .withIndex("by_dayStart_and_source_and_query_and_category_and_intent", (q) =>
          q
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
          artifactKind: "plugin",
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
  args: { queries: v.array(v.string()) },
  handler: readCurrentResults,
});
async function readCurrentResults(
  ctx: ActionCtx,
  args: { queries: string[] },
): Promise<SearchCurrentResults> {
  if (args.queries.length > 100 || args.queries.some((query) => !query || query.length > 256))
    throw new Error("Maximum 100 bounded queries");
  const rows: SearchCurrentResults["rows"] = [];
  for (const query of args.queries) {
    // Current public metadata is separate from historical visible-result facts. No attribution marker.
    const groups: FunctionReturnType<typeof internal.packages.searchForViewerInternal>[] =
      await Promise.all(
        (["code-plugin", "bundle-plugin"] as const).map((family) =>
          ctx.runQuery(internal.packages.searchForViewerInternal, {
            query,
            family,
            limit: 3,
          }),
        ),
      );
    const candidates = groups.flat().sort(compareCatalogSearchEntries).slice(0, 3);
    const results: SearchCurrentResult[] = [];
    for (const { package: pkg } of candidates) {
      if (pkg.channel === "private") continue;
      const detail: FunctionReturnType<typeof internal.packages.getVersionByNameForViewerInternal> =
        pkg.latestVersion
          ? await ctx.runQuery(internal.packages.getVersionByNameForViewerInternal, {
              name: pkg.name,
              version: pkg.latestVersion,
            })
          : null;
      const release = detail?.version;
      const installableAndClean = Boolean(
        release &&
        resolvePackageReleaseScanStatus(release) === "clean" &&
        !getPackageDownloadSecurityBlock(release) &&
        (release.files.length || release.clawpackStorageId),
      );
      const isFeatured = pkg.featuredAt !== undefined;
      results.push({
        name: pkg.name,
        displayName: pkg.displayName.slice(0, 120),
        summary: pkg.summary?.slice(0, 500) ?? null,
        version: pkg.latestVersion,
        url: `/plugins/${encodeURIComponent(pkg.name)}`,
        isOfficial: pkg.isOfficial === true,
        isFeatured,
        eligibleForFeatured: installableAndClean && !isFeatured,
      });
    }
    rows.push({ query, results });
  }
  return { metadataCheckedAt: Date.now(), rows };
}

export const getAggregateStateInternal = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("searchAggregateStates")
      .withIndex("by_key", (q) => q.eq("key", "plugin"))
      .unique(),
});
