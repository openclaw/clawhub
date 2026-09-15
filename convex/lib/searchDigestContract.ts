import { type Infer, v } from "convex/values";

export const SEARCH_DIGEST_MAX_BYTES = 30_000;

export const digestClassificationValidator = v.object({
  status: v.union(v.literal("available"), v.literal("unavailable")),
  model: v.string(),
  modelVersion: v.string(),
  failureCode: v.optional(v.string()),
  expectedQualified: v.number(),
  truncated: v.boolean(),
  rows: v.array(
    v.object({
      query: v.string(),
      scope: v.optional(v.union(v.literal("catalog"), v.literal("shelf"), v.literal("legacy"))),
      intentKind: v.union(
        v.literal("company_product"),
        v.literal("generic_capability"),
        v.literal("ambiguous"),
      ),
      companyProductName: v.optional(v.string()),
      confidence: v.number(),
    }),
  ),
});

const row = v.object({
  query: v.string(),
  searches: v.number(),
  previousSearches: v.number(),
  officialGaps: v.number(),
  searchUrl: v.string(),
});
export const legacySearchDigestValidator = v.object({
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

const scope = v.union(v.literal("catalog"), v.literal("shelf"), v.literal("legacy"));
const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());
export const searchRecommendationValidator = v.object({
  artifactKind: v.union(v.literal("plugin"), v.literal("skill")),
  id: v.string(),
  displayName: v.string(),
  url: v.string(),
  category: nullableString,
  support: v.union(v.literal("both"), v.literal("search-only"), v.literal("adoption-only")),
  metadataCheckedAt: v.number(),
  search: v.union(
    v.null(),
    v.object({
      matchedSearches7d: v.number(),
      previous7d: v.number(),
      searches30d: v.number(),
      queries: v.array(
        v.object({
          query: v.string(),
          scope,
          searches7d: v.number(),
          previous7d: v.number(),
          searches30d: v.number(),
        }),
      ),
      omittedQueries: v.number(),
      periodStart: v.number(),
      periodEnd: v.number(),
      dataThrough: nullableNumber,
      collectionStartedAt: nullableNumber,
    }),
  ),
  adoption: v.union(
    v.null(),
    v.object({
      source: v.union(
        v.literal("package-trending"),
        v.literal("clawhub-trending"),
        v.literal("clawhub-rising"),
        v.literal("skills-sh-trending"),
      ),
      rank: nullableNumber,
      snapshotId: nullableString,
      rankingVersion: nullableString,
      periodStart: nullableNumber,
      periodEnd: nullableNumber,
      generatedAt: nullableNumber,
      sourceObservedAt: nullableNumber,
      downloads: nullableNumber,
      installs: nullableNumber,
      bookmarks: nullableNumber,
      lifetimeInstalls: nullableNumber,
    }),
  ),
});
const scopedRow = row.extend({ scope });
const catalog = legacySearchDigestValidator
  .pick(
    "totalSearches",
    "sourceCounts",
    "coverage",
    "classificationStatus",
    "currentMetadataStatus",
  )
  .extend({
    adoption: v.object({
      status: v.union(v.literal("available"), v.literal("unavailable")),
      generatedAt: nullableNumber,
      periodStart: nullableNumber,
      periodEnd: nullableNumber,
      snapshotId: nullableString,
      rankingVersion: nullableString,
      totalItems: v.number(),
      inspectedItems: v.number(),
      truncated: v.boolean(),
    }),
    companyOpportunities: v.array(
      scopedRow.extend({ companyProductName: v.optional(v.string()), confidence: v.number() }),
    ),
    officialGaps: v.array(scopedRow),
    movers: v.array(scopedRow),
    recommendations: v.array(searchRecommendationValidator),
  });
export const evidenceSearchDigestValidator = legacySearchDigestValidator
  .pick("weekStart", "weekEnd", "minimumSearches", "dashboardUrl", "truncated")
  .extend({
    kind: v.literal("search_intelligence_weekly_v2"),
    catalogs: v.object({ plugins: catalog, skills: catalog }),
  });

// Frozen weeks retain their original contract and receipt hash across upgrades.
export const searchDigestValidator = v.union(
  legacySearchDigestValidator,
  evidenceSearchDigestValidator,
);

export type WeeklySearchDigest = Infer<typeof searchDigestValidator>;
export type EvidenceSearchDigest = Infer<typeof evidenceSearchDigestValidator>;
export type SearchRecommendation = Infer<typeof searchRecommendationValidator>;
