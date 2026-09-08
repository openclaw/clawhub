import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import { buildSearchDigest, mondaySearchWeek, type SearchDigest } from "./lib/searchDigest";
import {
  digestClassificationValidator,
  searchDigestValidator,
  SEARCH_DIGEST_MAX_BYTES,
} from "./lib/searchDigestContract";
import { deliverSearchDigest } from "./lib/searchDigestDelivery";
import { searchAggregateExpiration, type SearchInsightReport } from "./lib/searchInsights";
import { classifySearchIntent } from "./lib/searchIntentClassifier";
import { readReport } from "./searchInsights";

const DAY = 86_400_000;
const LEASE = 5 * 60_000;
const MAX_ATTEMPTS = 8;

export const claimInternal = internalMutation({
  args: { weekEnd: v.number() },
  handler: async (ctx, { weekEnd }) => {
    const now = Date.now();
    if (
      !Number.isSafeInteger(weekEnd) ||
      weekEnd % DAY !== 0 ||
      new Date(weekEnd).getUTCDay() !== 1 ||
      weekEnd > now
    )
      throw new Error("Expected completed Monday UTC week boundary");
    const expirationTime = searchAggregateExpiration(weekEnd);
    if (expirationTime <= now) throw new Error("Digest week expired");
    const existing = await ctx.db
      .query("searchWeeklyDigests")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", weekEnd))
      .unique();
    if (
      existing &&
      (existing.status === "sent" ||
        existing.attempts >= MAX_ATTEMPTS ||
        existing.nextAttemptAt > now ||
        (existing.status === "claimed" && existing.claimedUntil > now))
    )
      return null;
    const attempt = (existing?.attempts ?? 0) + 1;
    const claim = {
      status: "claimed" as const,
      attempts: attempt,
      claimedUntil: now + LEASE,
      nextAttemptAt: now + LEASE,
    };
    if (existing) await ctx.db.patch(existing._id, claim);
    else await ctx.db.insert("searchWeeklyDigests", { weekEnd, ...claim, expirationTime });
    return { weekEnd, attempt, ...(existing?.payload ? { payload: existing.payload } : {}) };
  },
});

export const savePayloadInternal = internalMutation({
  args: {
    weekEnd: v.number(),
    attempt: v.number(),
    payload: searchDigestValidator,
    classification: v.optional(digestClassificationValidator),
  },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const record = await ctx.db
      .query("searchWeeklyDigests")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .unique();
    if (
      !record ||
      record.status !== "claimed" ||
      record.attempts !== args.attempt ||
      record.payload
    )
      return { applied: false };
    const payload = args.payload;
    const sections = [
      payload.companyOpportunities,
      payload.officialGaps,
      payload.featuredCandidates,
      payload.movers,
    ];
    if (
      payload.weekEnd !== args.weekEnd ||
      payload.weekStart !== args.weekEnd - 7 * DAY ||
      sections.some((rows) => rows.length > 5) ||
      sections
        .flat()
        .some(
          (row) =>
            !row.query ||
            row.query.length > 256 ||
            !Number.isSafeInteger(row.searches) ||
            row.searches < 0 ||
            !Number.isSafeInteger(row.officialGaps) ||
            row.officialGaps < 0 ||
            row.officialGaps > row.searches ||
            !Number.isSafeInteger(row.previousSearches) ||
            row.previousSearches < 0,
        ) ||
      sections
        .slice(0, 3)
        .flat()
        .some((row) => row.searches < 3) ||
      payload.movers.some((row) => Math.max(row.searches, row.previousSearches) < 3) ||
      new TextEncoder().encode(JSON.stringify(payload)).byteLength > SEARCH_DIGEST_MAX_BYTES
    )
      throw new Error("Invalid bounded digest payload");
    // Classification and the frozen payload share this fenced transaction. A stale
    // action cannot replace dashboard enrichment after another attempt took over.
    if (args.classification)
      await ctx.runMutation(internal.searchInsights.storeClassificationsInternal, {
        ...args.classification,
        weekStart: payload.weekStart,
        weekEnd: args.weekEnd,
        processedAt: Date.now(),
      });
    await ctx.db.patch(record._id, { payload });
    return { applied: true };
  },
});

export const finishInternal = internalMutation({
  args: {
    weekEnd: v.number(),
    attempt: v.number(),
    delivered: v.boolean(),
    failureCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.failureCode && !/^[a-z_]{1,80}$/.test(args.failureCode))
      throw new Error("Expected query-free failure code");
    const record = await ctx.db
      .query("searchWeeklyDigests")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", args.weekEnd))
      .unique();
    if (!record || record.status !== "claimed" || record.attempts !== args.attempt)
      return { applied: false };
    await ctx.db.patch(
      record._id,
      args.delivered
        ? { status: "sent", sentAt: Date.now(), failureCode: undefined }
        : {
            status: args.attempt >= MAX_ATTEMPTS ? "exhausted" : "failed",
            nextAttemptAt: Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** args.attempt),
            failureCode: args.failureCode ?? "delivery_failed",
          },
    );
    if (!args.delivered && args.attempt < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        Math.min(60 * 60_000, 60_000 * 2 ** args.attempt),
        internal.searchWeeklyDigest.deliverInternal,
        { weekEnd: args.weekEnd },
      );
    }
    return { applied: true };
  },
});

export const pruneExpiredInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("searchWeeklyDigests")
      .withIndex("by_expiration_time", (q) => q.lte("expirationTime", Date.now()))
      .take(RETENTION_STANDARD_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === RETENTION_STANDARD_BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.searchWeeklyDigest.pruneExpiredInternal, {});
    return { deleted: rows.length };
  },
});

export const recoverDueInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<number[]> => {
    const rows: Doc<"searchWeeklyDigests">[] = [];
    for (const status of ["claimed", "failed"] as const) {
      rows.push(
        ...(await ctx.db
          .query("searchWeeklyDigests")
          .withIndex("by_status_and_nextAttemptAt", (q) =>
            q.eq("status", status).lte("nextAttemptAt", Date.now()),
          )
          .take(16)),
      );
    }
    for (const row of rows)
      if (row.attempts >= MAX_ATTEMPTS) {
        await ctx.db.patch(row._id, {
          status: "exhausted",
          failureCode: row.failureCode ?? "final_attempt_expired",
        });
      }
    return rows.filter((row) => row.attempts < MAX_ATTEMPTS).map((row) => row.weekEnd);
  },
});

export const tickInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const due = new Set(await ctx.runMutation(internal.searchWeeklyDigest.recoverDueInternal, {}));
    const week = mondaySearchWeek(Date.now());
    if (week) {
      const existing = await ctx.db
        .query("searchWeeklyDigests")
        .withIndex("by_weekEnd", (q) => q.eq("weekEnd", week.weekEnd))
        .unique();
      if (!existing) due.add(week.weekEnd);
    }
    for (const weekEnd of due)
      await ctx.scheduler.runAfter(0, internal.searchWeeklyDigest.deliverInternal, { weekEnd });
    return { scheduled: due.size };
  },
});

export const deliverInternal = internalAction({
  args: { weekEnd: v.number() },
  handler: async (ctx, { weekEnd }): Promise<{ delivered: boolean; skipped?: boolean }> => {
    const claim: { weekEnd: number; attempt: number; payload?: SearchDigest } | null =
      await ctx.runMutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
    if (!claim) return { delivered: false, skipped: true };
    let payload = claim.payload;
    let failureCode = "digest_build_failed";
    try {
      if (!payload) {
        // One bounded drain starts the existing continuation chain. A backlogged
        // collection retries later; never freeze a knowingly unfinished snapshot.
        const aggregation = await ctx.runMutation(internal.searchInsights.aggregateInternal, {});
        if (aggregation.hasMore) throw new Error("aggregation_pending");
        const before: Doc<"searchAggregateStates"> | null = await ctx.runQuery(
          internal.searchInsights.getAggregateStateInternal,
          {},
        );
        const [demand, gaps, movers]: SearchInsightReport[] = await Promise.all([
          readReport(ctx, { endDay: weekEnd, limit: 100 }),
          readReport(ctx, {
            endDay: weekEnd,
            limit: 100,
            order: "official-gaps",
            officialGap: true,
          }),
          readReport(ctx, {
            endDay: weekEnd,
            limit: 100,
            order: "change",
            includeCurrentResults: false,
          }),
        ]);
        const after: Doc<"searchAggregateStates"> | null = await ctx.runQuery(
          internal.searchInsights.getAggregateStateInternal,
          {},
        );
        if (before?.revision !== after?.revision) throw new Error("snapshot_changed");
        const qualified = gaps.rows.filter((row) => row.officialGaps7d >= 3);
        const classification = await classifySearchIntent(
          qualified.map((row) => ({
            query: row.query,
            searches: row.searches7d,
            officialGaps: row.officialGaps7d,
            topResults: row.currentResults.map((result) => ({
              name: result.name,
              displayName: result.displayName,
              summary: result.summary ?? "",
            })),
          })),
          process.env.OPENAI_API_KEY,
        );
        const intentByQuery = new Map(classification.rows.map((row) => [row.query, row]));
        const rows = [
          ...new Map([...demand.rows, ...gaps.rows].map((row) => [row.query, row])).values(),
        ].map((row) => ({ ...row, classification: intentByQuery.get(row.query) ?? null }));
        payload = buildSearchDigest({
          weekEnd,
          siteUrl: process.env.SITE_URL?.trim() || "https://clawhub.ai",
          totalSearches7d: demand.totalSearches7d,
          sources7d: demand.sources7d,
          classificationStatus:
            classification.status === "available" && gaps.truncated
              ? "partial"
              : classification.status,
          currentMetadataStatus: demand.currentMetadataStatus,
          truncated: demand.truncated || gaps.truncated || movers.truncated,
          coverage: demand.coverage,
          rows,
          // Featured hydration has its own canonical demand cohort. A failed
          // gap-cohort lookup must not erase successfully fetched demand metadata.
          featuredRows: demand.rows,
          moverRows: movers.rows,
        });
        const frozen = await ctx.runMutation(internal.searchWeeklyDigest.savePayloadInternal, {
          weekEnd,
          attempt: claim.attempt,
          payload,
          classification: {
            ...classification,
            expectedQualified: qualified.length,
            truncated: gaps.truncated,
          },
        });
        if (!frozen.applied) return { delivered: false, skipped: true };
      }
      const result = await deliverSearchDigest(
        payload,
        process.env.HERMIT_CONTENT_RIGHTS_BASE_URL?.trim() || "https://forms.openclaw.ai",
        process.env.CLAWHUB_HERMIT_TOKEN || process.env.CLAWHUB_BAN_APPEALS_TOKEN,
      );
      await ctx.runMutation(internal.searchWeeklyDigest.finishInternal, {
        weekEnd,
        attempt: claim.attempt,
        delivered: result.delivered,
        ...(!result.delivered ? { failureCode: result.failureCode } : {}),
      });
      return { delivered: result.delivered };
    } catch {
      // Deliberately omit exception/provider text: it can contain query data.
      if (payload) failureCode = "digest_delivery_failed";
      await ctx.runMutation(internal.searchWeeklyDigest.finishInternal, {
        weekEnd,
        attempt: claim.attempt,
        delivered: false,
        failureCode,
      });
      return { delivered: false };
    }
  },
});

export const getStatusInternal = internalQuery({
  args: { weekEnd: v.number() },
  handler: async (ctx, { weekEnd }) => {
    const row = await ctx.db
      .query("searchWeeklyDigests")
      .withIndex("by_weekEnd", (q) => q.eq("weekEnd", weekEnd))
      .unique();
    return row
      ? {
          weekEnd,
          status: row.status,
          attempts: row.attempts,
          exhausted: row.status !== "sent" && row.attempts >= MAX_ATTEMPTS,
          nextAttemptAt: row.nextAttemptAt,
          failureCode: row.failureCode ?? null,
          sentAt: row.sentAt ?? null,
        }
      : null;
  },
});
