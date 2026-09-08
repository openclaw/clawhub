import { v } from "convex/values";

const row = v.object({
  query: v.string(),
  searches: v.number(),
  previousSearches: v.number(),
  officialGaps: v.number(),
  searchUrl: v.string(),
});
export const searchDigestValidator = v.object({
  kind: v.literal("plugin_search_weekly"),
  weekStart: v.number(),
  weekEnd: v.number(),
  minimumSearches: v.literal(3),
  dashboardUrl: v.string(),
  totalSearches: v.number(),
  sourceCounts: v.object({ clawhubWeb: v.number(), openclawControlUi: v.number() }),
  classificationStatus: v.union(
    v.literal("available"),
    v.literal("partial"),
    v.literal("unavailable"),
  ),
  currentMetadataStatus: v.union(v.literal("available"), v.literal("unavailable")),
  truncated: v.boolean(),
  coverage: v.object({
    dataThrough: v.union(v.number(), v.null()),
    collectionStartedAt: v.union(v.number(), v.null()),
    gapStart: v.union(v.number(), v.null()),
    gapEnd: v.union(v.number(), v.null()),
  }),
  companyOpportunities: v.array(
    row.extend({ companyProductName: v.optional(v.string()), confidence: v.number() }),
  ),
  officialGaps: v.array(row),
  featuredCandidates: v.array(
    row.extend({
      package: v.object({ name: v.string(), displayName: v.string(), url: v.string() }),
    }),
  ),
  movers: v.array(row),
});
