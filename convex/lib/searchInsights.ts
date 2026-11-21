import { v, type Infer } from "convex/values";

export const searchArtifactKind = v.union(v.literal("plugin"), v.literal("skill"));
export const searchScope = v.union(v.literal("catalog"), v.literal("shelf"), v.literal("legacy"));
export type SearchArtifactKind = Infer<typeof searchArtifactKind>;
export type SearchScope = Infer<typeof searchScope>;
export const SEARCH_DAY_MS = 86_400_000;
export const SEARCH_INTENT_CONFIDENCE = 0.8;
const SEARCH_SOURCES = ["clawhub-web", "openclaw-control-ui"] as const;
export const searchInsightSource = v.union(
  v.literal(SEARCH_SOURCES[0]),
  v.literal(SEARCH_SOURCES[1]),
);
export const searchIntentKind = v.union(
  v.literal("company_product"),
  v.literal("generic_capability"),
  v.literal("ambiguous"),
);
export const searchInsightArgs = {
  artifactKind: v.optional(searchArtifactKind),
  scope: v.optional(searchScope),
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
  artifactKind: v.optional(searchArtifactKind),
  scope: v.optional(searchScope),
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
  artifactKind: SearchArtifactKind;
  scope: SearchScope;
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
  artifactKind: SearchArtifactKind;
  scope: SearchScope | null;
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
  createdAt?: number;
  id: string;
  artifactKind: SearchArtifactKind;
  nativeSkillId?: string;
  category?: string;
  eligibilityReasons: string[];
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

export function parseCatalogSearchSource(value: string | null): SearchInsightSource | undefined {
  return SEARCH_SOURCES.find((source) => source === value);
}

export function normalizeCatalogSearchQuery(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function isBoundedCatalogSearchText(query: string, category?: string, topic?: string) {
  return (
    query.length > 0 &&
    query.length <= 256 &&
    (category?.length ?? 0) <= 120 &&
    (topic?.length ?? 0) <= 120
  );
}

export type CatalogSearchFacts = {
  artifactKind: SearchArtifactKind;
  query: string;
  category?: string;
  topic?: string;
  filtered: boolean;
  officialResults: readonly boolean[];
};

export function buildCatalogSearchObservation(
  params: CatalogSearchFacts & { source: SearchInsightSource | undefined },
) {
  if (!params.source) return null;
  const normalizedQuery = normalizeCatalogSearchQuery(params.query);
  if (!isBoundedCatalogSearchText(normalizedQuery, params.category, params.topic)) return null;
  return {
    source: params.source,
    artifactKind: params.artifactKind,
    scope: params.filtered ? ("shelf" as const) : ("catalog" as const),
    normalizedQuery,
    category: params.category,
    topic: params.topic,
    resultCount: params.officialResults.length,
    officialResultCount: params.officialResults.filter((official) => official === true).length,
  };
}
