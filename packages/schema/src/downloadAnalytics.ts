import { type } from "arktype";

export const DownloadAnalyticsSummarySchema = type({
  scope: '"templates"',
  status: '"pending" | "ready"',
  generatedAt: "number | null",
  windowStartAt: "number | null",
  windowEndAt: "number | null",
  downloadsLast24h: "number | null",
  downloadsAllTime: "number | null",
  countingPaused: "boolean",
  refreshInProgress: "boolean",
  refreshStartedAt: "number | null",
  refreshExpiresAt: "number | null",
  staleAfterAt: "number | null",
  lastError: "string | null",
  scan: type({
    eventsScanned: "number",
    packagesScanned: "number",
    eligiblePackages: "number",
    eligibilityReads: "number",
    pages: "number",
  }).or("null"),
  counterLagNote: "string",
  eligibilityNote: "string",
  consistencyNote: "string",
});
export type DownloadAnalyticsSummary = typeof DownloadAnalyticsSummarySchema.infer;
