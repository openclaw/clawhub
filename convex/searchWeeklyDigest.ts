import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./functions";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import { searchDigestValidator } from "./lib/searchDigestContract";

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
    const date = new Date(weekEnd);
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 13, 1));
    target.setUTCDate(
      Math.min(
        date.getUTCDate(),
        new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(),
      ),
    );
    const expirationTime = target.getTime();
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
  args: { weekEnd: v.number(), attempt: v.number(), payload: searchDigestValidator },
  handler: async (ctx, args) => {
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
      JSON.stringify(payload).length > 30_000
    )
      throw new Error("Invalid bounded digest payload");
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
            status: "failed",
            nextAttemptAt: Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** args.attempt),
            failureCode: args.failureCode ?? "delivery_failed",
          },
    );
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

export const listDueInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = [];
    for (const status of ["claimed", "failed"] as const) {
      rows.push(
        ...(await ctx.db
          .query("searchWeeklyDigests")
          .withIndex("by_status_and_nextAttemptAt", (q) =>
            q.eq("status", status).lte("nextAttemptAt", Date.now()),
          )
          .take(8)),
      );
    }
    return rows.filter((row) => row.attempts < MAX_ATTEMPTS).map((row) => row.weekEnd);
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
