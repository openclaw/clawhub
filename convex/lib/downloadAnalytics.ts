import { v } from "convex/values";

export const analyticsScanValidator = v.object({
  eventsScanned: v.number(),
  packagesScanned: v.number(),
  eligiblePackages: v.number(),
  eligibilityReads: v.number(),
  pages: v.number(),
});
export const analyticsSnapshotValidator = v.object({
  generatedAt: v.number(),
  windowStartAt: v.number(),
  windowEndAt: v.number(),
  downloadsLast24h: v.number(),
  downloadsAllTime: v.number(),
  scan: analyticsScanValidator,
});
export const analyticsBuildValidator = v.object({
  startedAt: v.number(),
  expiresAt: v.number(),
  phase: v.union(v.literal("events"), v.literal("packages")),
  cursor: v.union(v.string(), v.null()),
  pageNumber: v.number(),
  downloadsLast24h: v.number(),
  downloadsAllTime: v.number(),
  scan: analyticsScanValidator,
});
export const analyticsSummaryValidator = v.object({
  scope: v.literal("templates"),
  status: v.union(v.literal("pending"), v.literal("ready")),
  generatedAt: v.union(v.number(), v.null()),
  windowStartAt: v.union(v.number(), v.null()),
  windowEndAt: v.union(v.number(), v.null()),
  downloadsLast24h: v.union(v.number(), v.null()),
  downloadsAllTime: v.union(v.number(), v.null()),
  countingPaused: v.boolean(),
  refreshInProgress: v.boolean(),
  refreshStartedAt: v.union(v.number(), v.null()),
  refreshExpiresAt: v.union(v.number(), v.null()),
  staleAfterAt: v.union(v.number(), v.null()),
  lastError: v.union(v.string(), v.null()),
  scan: v.union(analyticsScanValidator, v.null()),
  counterLagNote: v.string(),
  eligibilityNote: v.string(),
  consistencyNote: v.string(),
});
