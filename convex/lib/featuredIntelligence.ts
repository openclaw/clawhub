import { DISCOVERY_RECENT_WINDOW_MS } from "./discoveryWindows";
import { FEATURED_CATALOG_SIZE } from "./featuredPolicy";
export type RecommendationArtifact = {
  id: string;
  artifactKind: "plugin" | "skill";
  name: string;
  displayName: string;
  summary: string | null;
  url: string;
  category?: string;
  version?: string | null;
  createdAt?: number;
  eligibleForFeatured: boolean;
  eligibilityReasons: string[];
};

export type AdoptionEvidence = {
  source: "package-trending" | "clawhub-trending" | "clawhub-rising" | "skills-sh-trending";
  rank: number;
  snapshotId: string;
  rankingVersion: string;
  periodStart: number | null;
  periodEnd: number | null;
  generatedAt: number;
  sourceObservedAt: number | null;
  downloads: number | null;
  installs: number | null;
  bookmarks: number | null;
  lifetimeInstalls: number | null;
};

export type RecommendationQuery = {
  query: string;
  scope: "catalog" | "shelf" | "legacy";
  searches7d: number;
  previous7d: number;
  searches30d: number;
};

export type FeaturedRecommendation = Omit<RecommendationArtifact, "category"> & {
  category: string | null;
  version: string | null;
  support: "both" | "search-only" | "adoption-only" | "current-only";
  search: {
    matchedSearches7d: number;
    previous7d: number;
    searches30d: number;
    queries: RecommendationQuery[];
    omittedQueries: number;
    periodStart: number;
    periodEnd: number;
    dataThrough: number | null;
    collectionStartedAt: number | null;
  } | null;
  adoption: AdoptionEvidence | null;
};

type DemandRow = {
  query: string;
  scope: RecommendationQuery["scope"];
  searches7d: number;
  searchesPrevious7d: number;
  searches30d: number;
  currentResults: RecommendationArtifact[];
};

export type CurrentFeaturedArtifact = RecommendationArtifact & { featuredAt: number };

export type AdoptionArtifact = { artifact: RecommendationArtifact; evidence: AdoptionEvidence };

export type AdoptionSummary = {
  status: "available" | "unavailable";
  generatedAt: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  snapshotId: string | null;
  rankingVersion: string | null;
  totalItems: number;
  inspectedItems: number;
  truncated: boolean;
};

// Each call ranks one catalog. The existing adoption rank and observed search
// counts remain separate; cohort order is not a new combined popularity score.
export function recommendFeatured(params: {
  rows: DemandRow[];
  adoption: AdoptionArtifact[];
  window: { start7d: number; start30d: number; endDay: number; days: 7 | 30 };
  coverage: { dataThrough: number | null; collectionStartedAt: number | null };
  limit: number;
  currentFeatured?: CurrentFeaturedArtifact[];
}) {
  const candidates = new Map<
    string,
    {
      artifact: RecommendationArtifact;
      queries: Map<string, RecommendationQuery>;
      adoption: AdoptionEvidence | null;
    }
  >();
  const entryFor = (artifact: RecommendationArtifact) => {
    let entry = candidates.get(artifact.id);
    if (!entry) {
      entry = { artifact, queries: new Map(), adoption: null };
      candidates.set(artifact.id, entry);
    }
    return entry;
  };
  for (const row of params.rows) {
    if ((params.window.days === 7 ? row.searches7d : row.searches30d) === 0) continue;
    for (const artifact of row.currentResults) {
      // One query contributes once per artifact even if multiple result paths match it.
      entryFor(artifact).queries.set(`${row.scope}\0${row.query}`, {
        query: row.query,
        scope: row.scope,
        searches7d: row.searches7d,
        previous7d: row.searchesPrevious7d,
        searches30d: row.searches30d,
      });
    }
  }
  for (const { artifact, evidence } of params.adoption) {
    const entry = entryFor(artifact);
    entry.adoption = evidence;
    // The adoption adapter hydrates current eligibility through the same owner.
    entry.artifact = artifact;
  }
  // Membership is independently hydrated even when no inspected search or
  // Trending result mentions the item. Missing evidence is not zero demand.
  const currentFeatured = params.currentFeatured ?? [];
  for (const artifact of currentFeatured) entryFor(artifact).artifact = artifact;
  const excluded: Array<{ id: string; displayName: string; url: string; reasons: string[] }> = [];
  const recommendations: FeaturedRecommendation[] = [];
  for (const { artifact, queries: byQuery, adoption } of candidates.values()) {
    if (!artifact.eligibleForFeatured) {
      excluded.push({
        id: artifact.id,
        displayName: artifact.displayName,
        url: artifact.url,
        reasons: artifact.eligibilityReasons,
      });
      continue;
    }
    const queries = [...byQuery.values()].sort(
      (a, b) =>
        (params.window.days === 7 ? b.searches7d - a.searches7d : b.searches30d - a.searches30d) ||
        a.query.localeCompare(b.query) ||
        a.scope.localeCompare(b.scope),
    );
    recommendations.push({
      ...artifact,
      category: artifact.category ?? null,
      version: artifact.version ?? null,
      support: queries.length
        ? adoption
          ? "both"
          : "search-only"
        : adoption
          ? "adoption-only"
          : "current-only",
      search: queries.length
        ? {
            matchedSearches7d: queries.reduce((sum, query) => sum + query.searches7d, 0),
            previous7d: queries.reduce((sum, query) => sum + query.previous7d, 0),
            searches30d: queries.reduce((sum, query) => sum + query.searches30d, 0),
            queries: queries.slice(0, 8),
            omittedQueries: Math.max(0, queries.length - 8),
            periodStart: params.window.days === 7 ? params.window.start7d : params.window.start30d,
            periodEnd: params.window.endDay,
            ...params.coverage,
          }
        : null,
      adoption,
    });
  }
  const cohort = { both: 0, "search-only": 1, "adoption-only": 2, "current-only": 3 };
  recommendations.sort(
    (a, b) =>
      cohort[a.support] - cohort[b.support] ||
      (params.window.days === 7
        ? (b.search?.matchedSearches7d ?? 0) - (a.search?.matchedSearches7d ?? 0)
        : (b.search?.searches30d ?? 0) - (a.search?.searches30d ?? 0)) ||
      (a.adoption?.rank ?? Number.MAX_SAFE_INTEGER) -
        (b.adoption?.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );
  const previous = new Set(currentFeatured.map((artifact) => artifact.id));
  const proposed = recommendations.slice(0, FEATURED_CATALOG_SIZE).map((candidate) => {
    const adoption = candidate.adoption;
    const observed =
      adoption &&
      [adoption.downloads, adoption.installs, adoption.bookmarks].some(
        (count) => count !== null && count > 0,
      );
    const recentlyPublished =
      candidate.createdAt !== undefined &&
      adoption &&
      candidate.createdAt <= adoption.generatedAt &&
      candidate.createdAt >= adoption.generatedAt - DISCOVERY_RECENT_WINDOW_MS;
    return {
      ...candidate,
      change: previous.has(candidate.id) ? ("retain" as const) : ("add" as const),
      emerging: Boolean(observed && (adoption?.source === "clawhub-rising" || recentlyPublished)),
    };
  });
  const selected = new Set(proposed.map((candidate) => candidate.id));
  return {
    lineup: {
      targetSize: FEATURED_CATALOG_SIZE as 8,
      baseline: currentFeatured.map((artifact) => ({
        id: artifact.id,
        version: artifact.version ?? null,
        featuredAt: artifact.featuredAt,
      })),
      proposed,
      removals: currentFeatured
        .filter((artifact) => !selected.has(artifact.id))
        .map((artifact) => ({
          id: artifact.id,
          displayName: artifact.displayName,
          url: artifact.url,
          reasons: artifact.eligibleForFeatured
            ? ["outside-proposed-set"]
            : artifact.eligibilityReasons,
        })),
      shortfall: FEATURED_CATALOG_SIZE - proposed.length,
    },
    candidates: recommendations.slice(0, params.limit),
    totalCandidates: recommendations.length,
    omittedCandidates: Math.max(0, recommendations.length - params.limit),
    excluded,
  };
}
