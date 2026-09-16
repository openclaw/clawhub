import type { LineupSearchDigest, LineupSearchRecommendation } from "./searchDigestContract";
import { SEARCH_DIGEST_MAX_BYTES } from "./searchDigestContract";

type Scope = "catalog" | "shelf" | "legacy";
type EvidenceRow = {
  query: string;
  scope: Scope;
  searches7d: number;
  searchesPrevious7d: number;
  officialGaps7d: number;
  searchUrl: string;
  classification: { intentKind: string; confidence: number; companyProductName?: string } | null;
};
type Catalog = LineupSearchDigest["catalogs"]["plugins"];
export type DigestCatalogInput = {
  totalSearches7d: number;
  sources7d: { "clawhub-web": number; "openclaw-control-ui": number };
  classificationStatus: Catalog["classificationStatus"];
  currentMetadataStatus: Catalog["currentMetadataStatus"];
  coverage: Catalog["coverage"];
  adoption: Catalog["adoption"];
  metadataCheckedAt: number | null;
  truncated: boolean;
  rows: EvidenceRow[];
  moverRows: EvidenceRow[];
  recommendations: {
    candidates: Omit<LineupSearchRecommendation, "metadataCheckedAt">[];
    lineup: Omit<Catalog["lineup"], "changes"> & {
      proposed: Array<
        Omit<LineupSearchRecommendation, "metadataCheckedAt"> & {
          change: "retain" | "add";
          emerging: boolean;
        }
      >;
    };
    omittedCandidates: number;
  };
};

/** Bounded wire projection only: the shared recommendation owner orders candidates. */
export function buildSearchEvidenceDigest(input: {
  weekEnd: number;
  siteUrl: string;
  catalogs: { plugins: DigestCatalogInput; skills: DigestCatalogInput };
}): LineupSearchDigest {
  const site = new URL(input.siteUrl);
  const absolute = (path: string) => {
    const url = new URL(path, site);
    if (url.origin !== site.origin || url.username || url.password)
      throw new Error("Digest link outside ClawHub origin");
    return url.toString();
  };
  const representable = (value: string, max: number) =>
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    // eslint-disable-next-line no-control-regex -- Receiver identity bounds; never rename a query or artifact.
    !/[\u0000-\u001f\u007f]/.test(value);
  const descriptor = (value: string) =>
    value
      // eslint-disable-next-line no-control-regex -- Only display text is normalized.
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  let truncated = false;
  const project = (source: DigestCatalogInput, kind: "plugin" | "skill"): Catalog => {
    truncated ||=
      source.truncated || source.adoption.truncated || source.recommendations.omittedCandidates > 0;
    const tie = (a: EvidenceRow, b: EvidenceRow) =>
      a.query < b.query
        ? -1
        : a.query > b.query
          ? 1
          : a.scope < b.scope
            ? -1
            : a.scope > b.scope
              ? 1
              : 0;
    const demand = (a: EvidenceRow, b: EvidenceRow) => b.searches7d - a.searches7d || tie(a, b);
    const validRow = (row: EvidenceRow) =>
      representable(row.query, 256) && absolute(row.searchUrl).length <= 2048;
    const rows = source.rows.filter(validRow);
    const movers = source.moverRows.filter(validRow);
    truncated ||= rows.length !== source.rows.length || movers.length !== source.moverRows.length;
    const row = (entry: EvidenceRow) => ({
      query: entry.query,
      scope: entry.scope,
      searches: entry.searches7d,
      previousSearches: entry.searchesPrevious7d,
      officialGaps: entry.officialGaps7d,
      searchUrl: absolute(entry.searchUrl),
    });
    const gaps = rows
      .filter((entry) => entry.officialGaps7d >= 3)
      .sort((a, b) => b.officialGaps7d - a.officialGaps7d || demand(a, b));
    const company =
      source.classificationStatus === "unavailable"
        ? []
        : gaps.filter(
            (entry) =>
              entry.scope === "catalog" &&
              entry.classification?.intentKind === "company_product" &&
              entry.classification.confidence >= 0.8,
          );
    const moving = movers
      .filter(
        (entry) =>
          Math.max(entry.searches7d, entry.searchesPrevious7d) >= 3 &&
          entry.searches7d !== entry.searchesPrevious7d,
      )
      .sort(
        (a, b) =>
          Math.abs(b.searches7d - b.searchesPrevious7d) -
            Math.abs(a.searches7d - a.searchesPrevious7d) || tie(a, b),
      );
    const qualified =
      source.metadataCheckedAt === null
        ? []
        : source.recommendations.lineup.proposed.filter(
            (candidate) =>
              candidate.artifactKind === kind &&
              representable(candidate.id, 256) &&
              absolute(candidate.url).length <= 2048,
          );
    if (qualified.length !== source.recommendations.lineup.proposed.length)
      throw new Error("The complete Featured selection cannot be represented in this digest");
    truncated ||= [gaps, company, moving].some((section) => section.length > 5);
    return {
      totalSearches: source.totalSearches7d,
      sourceCounts: {
        clawhubWeb: source.sources7d["clawhub-web"],
        openclawControlUi: source.sources7d["openclaw-control-ui"],
      },
      coverage: {
        dataThrough: source.coverage.dataThrough,
        collectionStartedAt: source.coverage.collectionStartedAt,
        gapStart: source.coverage.gapStart,
        gapEnd: source.coverage.gapEnd,
      },
      classificationStatus: source.classificationStatus,
      currentMetadataStatus: source.currentMetadataStatus,
      adoption: {
        status: source.adoption.status,
        generatedAt: source.adoption.generatedAt,
        periodStart: source.adoption.periodStart,
        periodEnd: source.adoption.periodEnd,
        snapshotId: source.adoption.snapshotId,
        rankingVersion: source.adoption.rankingVersion,
        totalItems: source.adoption.totalItems,
        inspectedItems: source.adoption.inspectedItems,
        truncated: source.adoption.truncated,
      },
      companyOpportunities: company.slice(0, 5).map((entry) => ({
        ...row(entry),
        confidence: entry.classification!.confidence,
        ...(entry.classification?.companyProductName
          ? { companyProductName: descriptor(entry.classification.companyProductName) }
          : {}),
      })),
      officialGaps: gaps.slice(0, 5).map(row),
      movers: moving.slice(0, 5).map(row),
      lineup: {
        targetSize: 8,
        baseline: source.recommendations.lineup.baseline.map(({ id, version, featuredAt }) => ({
          id,
          version,
          featuredAt,
        })),
        changes: qualified.map(({ id, change, emerging }) => ({ id, change, emerging })),
        removals: source.recommendations.lineup.removals.map((entry) => ({
          id: entry.id,
          displayName: descriptor(entry.displayName),
          url: absolute(entry.url),
          reasons: entry.reasons,
        })),
        shortfall: 8 - qualified.length,
      },
      recommendations: qualified.map((candidate) => {
        const search = candidate.search;
        // Counts remain available for adoption-supported candidates; rare query
        // text never leaves the staff report. Preserve the canonical candidate order.
        const queries =
          search?.queries
            .filter((query) => query.searches7d >= 3 && representable(query.query, 256))
            .slice(0, 3) ?? [];
        const adoption = candidate.adoption;
        return {
          artifactKind: candidate.artifactKind,
          version: candidate.version,
          id: candidate.id,
          displayName: descriptor(candidate.displayName) || descriptor(candidate.id),
          url: absolute(candidate.url),
          category: candidate.category ? descriptor(candidate.category) || null : null,
          support: candidate.support,
          metadataCheckedAt: source.metadataCheckedAt!,
          search: search
            ? {
                matchedSearches7d: search.matchedSearches7d,
                previous7d: search.previous7d,
                searches30d: search.searches30d,
                queries: queries.map((query) => ({
                  query: query.query,
                  scope: query.scope,
                  searches7d: query.searches7d,
                  previous7d: query.previous7d,
                  searches30d: query.searches30d,
                })),
                omittedQueries: search.omittedQueries + search.queries.length - queries.length,
                periodStart: search.periodStart,
                periodEnd: search.periodEnd,
                dataThrough: search.dataThrough,
                collectionStartedAt: search.collectionStartedAt,
              }
            : null,
          adoption: adoption
            ? {
                source: adoption.source,
                rank: adoption.rank,
                snapshotId: adoption.snapshotId,
                rankingVersion: adoption.rankingVersion,
                periodStart: adoption.periodStart,
                periodEnd: adoption.periodEnd,
                generatedAt: adoption.generatedAt,
                sourceObservedAt: adoption.sourceObservedAt,
                downloads: adoption.downloads,
                installs: adoption.installs,
                bookmarks: adoption.bookmarks,
                lifetimeInstalls: adoption.lifetimeInstalls,
              }
            : null,
        };
      }),
    };
  };
  const catalogs = {
    plugins: project(input.catalogs.plugins, "plugin"),
    skills: project(input.catalogs.skills, "skill"),
  };
  const digest: LineupSearchDigest = {
    kind: "search_intelligence_weekly_v3",
    weekStart: input.weekEnd - 604_800_000,
    weekEnd: input.weekEnd,
    minimumSearches: 3,
    dashboardUrl: absolute(`/management?view=search-insights&endDay=${input.weekEnd}`),
    truncated,
    catalogs,
  };
  const sections = Object.values(catalogs).flatMap((catalog) => [
    catalog.movers,
    catalog.officialGaps,
    catalog.companyOpportunities,
  ]);
  // Preserve every proposed member and its change; trim query detail and
  // secondary opportunity rows before the complete lineup can be obscured.
  const candidateQueries = Object.values(catalogs).flatMap((catalog) =>
    catalog.recommendations
      .map((candidate) => candidate.search)
      .filter((search) => search !== null),
  );
  while (new TextEncoder().encode(JSON.stringify(digest)).byteLength > SEARCH_DIGEST_MAX_BYTES) {
    const search = candidateQueries.find((entry) => entry.queries.length > 0);
    if (search) {
      search.queries.pop();
      search.omittedQueries += 1;
      digest.truncated = true;
      continue;
    }
    const longest = sections.reduce((best, section) =>
      section.length > best.length ? section : best,
    );
    if (!longest.length) throw new Error("Digest metadata exceeds wire budget");
    longest.pop();
    digest.truncated = true;
  }
  return digest;
}
