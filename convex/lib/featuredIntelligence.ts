import { DISCOVERY_RECENT_WINDOW_MS } from "./discoveryWindows";
import { FEATURED_CATALOG_SIZE } from "./featuredPolicy";
import {
  FEATURED_EDITORIAL_SLOTS,
  type EditorialSelection as EditorialItem,
} from "./featuredSelections";
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
  source: "package-daily-installs" | "skill-daily-installs";
  rank: number;
  snapshotId: string;
  rankingVersion: string;
  periodStart: number;
  periodStart7d: number;
  periodEnd: number;
  generatedAt: number;
  installs30d: number;
  installs7d: number;
  importedRows: number;
  importDatasetVersions: string[];
};

export type EditorialSelection = {
  revision: number;
  items: EditorialItem[];
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
  collectionStartedAt: number;
  periodStart: number;
  periodStart7d: number;
  periodEnd: number;
  snapshotId: string | null;
  rankingVersion: string;
  totalItems: number;
  inspectedItems: number;
  truncated: boolean;
  scannedRows: number;
  importedRows: number;
  importDatasetVersions: string[];
};

// Search associations explain context only. Selection uses completed-month
// installs, the final week's installs, and stable identity in that order.
export function recommendFeatured(params: {
  artifactKind: "plugin" | "skill";
  editorial: EditorialSelection;
  editorialArtifacts: RecommendationArtifact[];
  currentEditorialRevision: number;
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
  for (const artifact of params.editorialArtifacts) entryFor(artifact).artifact = artifact;
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
  const byId = new Map(recommendations.map((entry) => [entry.id, entry]));
  const telemetry = recommendations.filter((entry) => (entry.adoption?.installs30d ?? 0) > 0);
  telemetry.sort(
    (a, b) =>
      b.adoption!.installs30d - a.adoption!.installs30d ||
      b.adoption!.installs7d - a.adoption!.installs7d ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const reservedSlots = params.artifactKind === "plugin" ? FEATURED_EDITORIAL_SLOTS : 0;
  const telemetryTarget = FEATURED_CATALOG_SIZE - reservedSlots;
  const reservations = Array.from({ length: reservedSlots }, (_, slot) => {
    const item = params.editorial.items[slot];
    const artifact = item ? (byId.get(item.id) ?? null) : null;
    const rejected = item ? candidates.get(item.id)?.artifact : null;
    return {
      slot,
      id: item?.id ?? null,
      name: item?.name ?? null,
      displayName: item?.displayName ?? null,
      reason: item?.reason ?? null,
      status: artifact ? ("ready" as const) : ("pending" as const),
      pendingReasons: artifact
        ? []
        : item
          ? (rejected?.eligibilityReasons ?? ["no-public-version"])
          : ["unassigned-editorial-slot"],
      artifact,
    };
  });
  const previous = new Set(currentFeatured.map((artifact) => artifact.id));
  const selectedEditorial = new Set(
    params.artifactKind === "plugin" ? params.editorial.items.map((item) => item.id) : [],
  );
  const selection = [
    ...reservations.flatMap((entry) =>
      entry.artifact
        ? [
            {
              candidate: entry.artifact,
              slot: entry.slot,
              selectionBasis: "editorial" as const,
              reason: entry.reason!,
            },
          ]
        : [],
    ),
    ...telemetry
      .filter((entry) => !selectedEditorial.has(entry.id))
      .slice(0, telemetryTarget)
      .map((candidate, index) => ({
        candidate,
        slot: reservedSlots + index,
        selectionBasis: "telemetry" as const,
        reason: `${candidate.adoption!.installs30d} installs in 30 completed UTC days; ${candidate.adoption!.installs7d} in the final 7 days.`,
      })),
  ];
  const proposed = selection.map(({ candidate, ...choice }) => ({
    ...candidate,
    ...choice,
    change: previous.has(candidate.id) ? ("retain" as const) : ("add" as const),
    emerging: Boolean(
      candidate.adoption &&
      candidate.createdAt !== undefined &&
      candidate.createdAt <= candidate.adoption.generatedAt &&
      candidate.createdAt >= candidate.adoption.generatedAt - DISCOVERY_RECENT_WINDOW_MS,
    ),
  }));
  const pendingCount = reservations.filter((entry) => entry.status === "pending").length;
  const selected = new Set(proposed.map((candidate) => candidate.id));
  return {
    lineup: {
      targetSize: FEATURED_CATALOG_SIZE as 16,
      reservedSlots,
      telemetryTarget,
      reservations,
      pendingCount,
      telemetryShortfall:
        telemetryTarget - proposed.filter((entry) => entry.selectionBasis === "telemetry").length,
      editorialRevision: params.editorial.revision,
      currentEditorialRevision: params.currentEditorialRevision,
      staleEditorial: params.editorial.revision !== params.currentEditorialRevision,
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
    candidates: telemetry.slice(0, params.limit),
    totalCandidates: telemetry.length,
    omittedCandidates: Math.max(0, telemetry.length - params.limit),
    excluded,
  };
}
