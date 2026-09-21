import { type } from "arktype";
import { FeaturedIntelligenceReportSchema, SearchInsightsReportSchema } from "./searchInsights.js";

export const SearchReportRequestSchema = type({
  view: '"demand" | "recommendations"',
  "artifactKind?": '"plugin" | "skill"',
  "scope?": '"catalog" | "shelf" | "legacy"',
  "source?": '"clawhub-web" | "openclaw-control-ui"',
  "window?": "7 | 30",
  "endDay?": "number",
  "limit?": "number",
  "officialGap?": "boolean",
  "intentKind?": '"company_product" | "generic_capability" | "ambiguous"',
  "refreshOf?": "string",
});
const common = {
  reportId: "string",
  requestedAt: "number",
  completedAt: "number | null",
  expirationTime: "number",
  previousAttempts: "number",
  failureCode: "string | null",
  reportVersion: '"search-report-v1" | "search-report-v2"',
} as const;
export const SearchReportStatusSchema = type({
  ...common,
  view: '"demand" | "recommendations"',
  status: '"pending" | "running" | "ready" | "failed" | "expired" | "incomplete"',
});
export const SearchReportResponseSchema = type({
  ...common,
  view: '"demand" | "recommendations"',
  status: '"pending" | "running" | "failed" | "expired" | "incomplete"',
})
  .or({
    ...common,
    view: '"demand"',
    status: '"ready"',
    report: SearchInsightsReportSchema,
  })
  .or({
    ...common,
    view: '"recommendations"',
    status: '"ready"',
    report: FeaturedIntelligenceReportSchema,
  });
export type SearchReportRequest = typeof SearchReportRequestSchema.infer;
export type SearchReportStatus = typeof SearchReportStatusSchema.infer;
export type SearchReportResponse = typeof SearchReportResponseSchema.infer;
