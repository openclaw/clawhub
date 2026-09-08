import { v, type Infer } from "convex/values";

export const SEARCH_DAY_MS = 86_400_000;
export const SEARCH_INTENT_CONFIDENCE = 0.8;
export const searchInsightSource = v.union(
  v.literal("clawhub-web"),
  v.literal("openclaw-control-ui"),
);
export const searchIntentKind = v.union(
  v.literal("company_product"),
  v.literal("generic_capability"),
  v.literal("ambiguous"),
);
export const searchInsightArgs = {
  endDay: v.optional(v.number()),
  includeCurrentResults: v.optional(v.boolean()),
  order: v.optional(
    v.union(v.literal("searches"), v.literal("change"), v.literal("official-gaps")),
  ),
  source: v.optional(searchInsightSource),
  window: v.optional(v.union(v.literal(7), v.literal(30))),
  officialGap: v.optional(v.boolean()),
  intentKind: v.optional(searchIntentKind),
  limit: v.optional(v.number()),
};
export const searchClassification = v.object({
  weekStart: v.number(),
  weekEnd: v.number(),
  query: v.string(),
  intentKind: searchIntentKind,
  companyProductName: v.optional(v.string()),
  confidence: v.number(),
  model: v.string(),
  modelVersion: v.string(),
  processedAt: v.number(),
});
export type SearchClassification = Infer<typeof searchClassification>;
export type SearchInsightSource = Infer<typeof searchInsightSource>;
export type SearchInsightArgs = Infer<ReturnType<typeof argsValidator>>;
function argsValidator() {
  return v.object(searchInsightArgs);
}
export type SearchInsightRow = {
  query: string;
  searches7d: number;
  searchesPrevious7d: number;
  searches30d: number;
  officialGaps7d: number;
  officialGaps30d: number;
  zeroResults7d: number;
  change7d: number;
  changePercent: number | null;
  sources7d: Record<SearchInsightSource, number>;
  classification: SearchClassification | null;
  companyOpportunity: boolean;
  currentResults: SearchCurrentResult[];
  featuredCandidate: SearchCurrentResult | null;
  searchUrl: string;
};
export type SearchInsightReport = {
  window: {
    endDay: number;
    start7d: number;
    startPrevious7d: number;
    start30d: number;
    days: 7 | 30;
  };
  source: SearchInsightSource | null;
  generatedAt: number;
  metadataCheckedAt: number | null;
  currentMetadataStatus: "available" | "unavailable";
  coverage: {
    dataThrough: number | null;
    collectionStartedAt: number | null;
    gapStart: number | null;
    gapEnd: number | null;
  };
  totalQueries: number;
  totalSearches7d: number;
  sources7d: Record<SearchInsightSource, number>;
  truncated: boolean;
  classificationStatus: "available" | "partial" | "unavailable";
  classificationRun: {
    weekStart: number;
    weekEnd: number;
    processedAt: number;
    expectedQualified: number;
    classifiedCount: number;
    truncated: boolean;
    model: string;
    modelVersion: string;
    failureCode?: string;
  } | null;
  rows: SearchInsightRow[];
};

// Calendar months, clamped at month-end (not a fixed 390-day approximation).
export function searchAggregateExpiration(day: number) {
  const date = new Date(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 13, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target.getTime();
}
export type SearchCurrentResult = {
  name: string;
  displayName: string;
  summary: string | null;
  version: string | null;
  url: string;
  isOfficial: boolean;
  isFeatured: boolean;
  eligibleForFeatured: boolean;
};
export type SearchCurrentResults = {
  metadataCheckedAt: number;
  rows: Array<{ query: string; results: SearchCurrentResult[] }>;
};
