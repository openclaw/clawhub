import { expect, it } from "vitest";
import { buildSearchEvidenceDigest, type DigestCatalogInput } from "./searchEvidenceDigest";
const weekEnd = Date.parse("2026-09-07T00:00:00Z");
const catalog = (): DigestCatalogInput => ({
  totalSearches7d: 25,
  sources7d: { "clawhub-web": 20, "openclaw-control-ui": 5 },
  classificationStatus: "available",
  currentMetadataStatus: "available",
  truncated: false,
  coverage: {
    dataThrough: weekEnd,
    collectionStartedAt: weekEnd - 30 * 86_400_000,
    gapStart: null,
    gapEnd: null,
  },
  adoption: {
    status: "available",
    collectionStartedAt: weekEnd + 86_400_000,
    periodStart7d: weekEnd - 7 * 86_400_000,
    scannedRows: 1,
    importedRows: 0,
    importDatasetVersions: [],
    generatedAt: weekEnd + 86_400_000,
    periodStart: weekEnd,
    periodEnd: weekEnd + 86_400_000,
    snapshotId: "latest",
    rankingVersion: "v1",
    totalItems: 1,
    inspectedItems: 1,
    truncated: false,
  },
  metadataCheckedAt: weekEnd + 86_400_000,
  rows: [
    {
      query: "notion",
      scope: "catalog",
      searches7d: 5,
      searchesPrevious7d: 1,
      officialGaps7d: 5,
      searchUrl: "/plugins?q=notion",
      classification: { intentKind: "company_product", confidence: 0.9 },
    },
  ],
  moverRows: [
    {
      query: "dropped",
      scope: "catalog",
      searches7d: 0,
      searchesPrevious7d: 4,
      officialGaps7d: 0,
      searchUrl: "/plugins?q=dropped",
      classification: null,
    },
  ],
  recommendations: {
    lineup: {
      targetSize: 16,
      baseline: [],
      proposed: [],
      removals: [],
      shortfall: 16,
      reservedSlots: 0,
      telemetryTarget: 16,
      pendingCount: 0,
      telemetryShortfall: 16,
      editorialRevision: 0,
      currentEditorialRevision: 0,
      staleEditorial: false,
      reservations: [],
    },
    omittedCandidates: 0,
    candidates: [
      {
        artifactKind: "plugin",
        version: "1.0.0",
        id: "plugin:memory",
        displayName: "Memory",
        url: "/plugins/memory",
        category: null,
        support: "both",
        search: {
          matchedSearches7d: 9,
          previous7d: 0,
          searches30d: 9,
          queries: [
            { query: "memory", scope: "catalog", searches7d: 4, previous7d: 0, searches30d: 4 },
            { query: "memory", scope: "shelf", searches7d: 3, previous7d: 0, searches30d: 3 },
            {
              query: "rare private text",
              scope: "catalog",
              searches7d: 2,
              previous7d: 0,
              searches30d: 2,
            },
          ],
          omittedQueries: 0,
          periodStart: weekEnd - 604_800_000,
          periodEnd: weekEnd,
          dataThrough: weekEnd,
          collectionStartedAt: weekEnd - 604_800_000,
        },
        adoption: {
          source: "package-daily-installs",
          rank: 2,
          installs30d: 341,
          installs7d: 1,
          importedRows: 0,
          importDatasetVersions: [],
        },
      },
    ],
  },
});
const build = (
  plugins = catalog(),
  skills: DigestCatalogInput = {
    ...catalog(),
    recommendations: {
      candidates: [],
      omittedCandidates: 0,
      lineup: {
        targetSize: 16,
        baseline: [],
        proposed: [],
        removals: [],
        shortfall: 16,
        reservedSlots: 0,
        telemetryTarget: 16,
        pendingCount: 0,
        telemetryShortfall: 16,
        editorialRevision: 0,
        currentEditorialRevision: 0,
        staleEditorial: false,
        reservations: [],
      },
    },
  },
) => {
  for (const input of [plugins, skills]) {
    input.recommendations.lineup.proposed = input.recommendations.candidates.map(
      (candidate, index) => ({
        ...candidate,
        slot: index,
        selectionBasis: "telemetry",
        reason: "Recorded monthly installs",
        change: "add",
        emerging: false,
      }),
    );
    input.recommendations.lineup.shortfall = 16 - input.recommendations.lineup.proposed.length;
  }
  return buildSearchEvidenceDigest({
    weekEnd,
    siteUrl: "https://clawhub.ai",
    catalogs: { plugins, skills },
  });
};

it("projects both catalogs, separate periods and scoped demand without leaking identities or rare query text", () => {
  const plugins = catalog();
  Object.assign(plugins.recommendations.candidates[0], { userId: "private-identity" });
  const skills = catalog();
  skills.rows.push({ ...skills.rows[0], scope: "shelf" });
  skills.recommendations.candidates = [
    {
      ...plugins.recommendations.candidates[0],
      artifactKind: "skill",
      id: "clawhub:skill",
      support: "adoption-only",
      search: null,
      adoption: {
        ...plugins.recommendations.candidates[0].adoption!,
        source: "skill-daily-installs",
      },
    },
  ];
  const digest = build(plugins, skills);
  expect(digest.catalogs.plugins.recommendations[0].search).toMatchObject({
    matchedSearches7d: 9,
    omittedQueries: 1,
    queries: [{ scope: "catalog" }, { scope: "shelf" }],
  });
  expect(digest.catalogs.skills.recommendations[0]).toMatchObject({
    search: null,
    adoption: { source: "skill-daily-installs", installs30d: 341, installs7d: 1 },
  });
  expect(digest.catalogs.skills.companyOpportunities).toHaveLength(1);
  expect(digest.catalogs.skills.officialGaps).toHaveLength(2);
  expect(digest.catalogs.plugins.movers[0]).toMatchObject({
    query: "dropped",
    searches: 0,
    previousSearches: 4,
  });
  expect(digest.catalogs.plugins.adoption.periodStart).toBe(weekEnd);
  expect(JSON.stringify(digest)).not.toMatch(/rare private text|private-identity/);
  expect(plugins.recommendations.candidates[0].search?.queries).toHaveLength(3);
});

it("retains canonical candidate order, preserves the full selection while suppressing rare query text", () => {
  const input = catalog();
  const base = input.recommendations.candidates[0];
  input.recommendations.candidates = [
    {
      ...base,
      id: "plugin:z-first",
      search: {
        ...base.search!,
        matchedSearches7d: 2,
        searches30d: 2,
        queries: [base.search!.queries[2]],
      },
    },
    {
      ...base,
      id: "plugin:excluded",
      support: "search-only",
      adoption: null,
      search: {
        ...base.search!,
        matchedSearches7d: 2,
        searches30d: 2,
        queries: [base.search!.queries[2]],
      },
    },
    { ...base, id: "plugin:a-next" },
  ];
  const digest = build(input);
  expect(digest.catalogs.plugins.recommendations.map((row) => row.id)).toEqual([
    "plugin:z-first",
    "plugin:excluded",
    "plugin:a-next",
  ]);
  expect(digest.catalogs.plugins.recommendations[0].search).toMatchObject({
    matchedSearches7d: 2,
    queries: [],
    omittedQueries: 1,
  });
  expect(JSON.stringify(digest)).not.toContain("rare private text");
});

it("bounds sections and UTF-8 while preserving leading rows from each catalog and explicit omissions", () => {
  const input = catalog();
  input.rows = Array.from({ length: 6 }, (_, index) => ({
    ...input.rows[0],
    query: "界".repeat(190) + index,
    searchUrl: `/plugins?q=${encodeURIComponent("界".repeat(190) + index)}`,
  }));
  input.moverRows = input.rows;
  input.recommendations.candidates = Array.from({ length: 16 }, (_, index) => ({
    ...input.recommendations.candidates[0],
    id: `plugin:item-${index}`,
    url: `/plugins/item-${index}?q=${"x".repeat(50)}`,
  }));
  const skills = structuredClone(input);
  skills.recommendations.candidates = skills.recommendations.candidates.map((row) => ({
    ...row,
    artifactKind: "skill",
    id: row.id.replace("plugin:", "clawhub:"),
    adoption: { ...row.adoption!, source: "skill-daily-installs" },
  }));
  const result = build(input, skills);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(30_000);
  expect(result.truncated).toBe(true);
  for (const value of Object.values(result.catalogs)) {
    expect(value.recommendations).toHaveLength(16);
    expect(value.lineup.changes).toHaveLength(16);
    expect(value.lineup.shortfall).toBe(0);
    expect(value.recommendations[0].id).toContain("item-0");
  }
  expect(build(input, skills)).toEqual(result);
});

it("keeps deterministic gaps on classifier failure and independently checked adoption on search metadata failure", () => {
  const input = catalog();
  input.classificationStatus = "unavailable";
  input.currentMetadataStatus = "unavailable";
  input.rows.push({ ...input.rows[0], query: "rare", searches7d: 2, officialGaps7d: 2 });
  const output = build(input).catalogs.plugins;
  expect(output.companyOpportunities).toEqual([]);
  expect(output.officialGaps.map((row) => row.query)).toEqual(["notion"]);
  expect(output.recommendations.map((row) => row.id)).toEqual(["plugin:memory"]);
  input.metadataCheckedAt = null;
  expect(() => build(input)).toThrow("complete Featured selection cannot be represented");
});

it("preserves same-query catalog, shelf and legacy evidence while limiting company opportunities to the catalog", () => {
  const input = catalog();
  const scopes = ["catalog", "shelf", "legacy"] as const;
  input.rows = scopes.map((scope, index) => ({
    ...input.rows[0],
    scope,
    searches7d: 6 - index,
    officialGaps7d: 6 - index,
  }));
  input.moverRows = input.rows;
  const candidate = input.recommendations.candidates[0];
  candidate.search = {
    ...candidate.search!,
    matchedSearches7d: 15,
    searches30d: 15,
    queries: scopes.map((scope, index) => ({
      query: "notion",
      scope,
      searches7d: 6 - index,
      previous7d: 1,
      searches30d: 6 - index,
    })),
  };
  const wire = JSON.parse(JSON.stringify(build(input))) as ReturnType<typeof build>;
  const output = wire.catalogs.plugins;
  expect(output.officialGaps.map((row) => [row.query, row.scope, row.searches])).toEqual([
    ["notion", "catalog", 6],
    ["notion", "shelf", 5],
    ["notion", "legacy", 4],
  ]);
  expect(output.movers.map((row) => row.scope)).toEqual(scopes);
  expect(output.recommendations[0].search?.queries.map((row) => row.scope)).toEqual(scopes);
  expect(output.companyOpportunities.map((row) => row.scope)).toEqual(["catalog"]);
});

it("fails explicitly instead of dropping an unrepresentable selected identity", () => {
  const input = catalog();
  input.recommendations.candidates[0].id = "plugin:" + "x".repeat(256);
  expect(() => build(input)).toThrow("complete Featured selection cannot be represented");
  expect(input.recommendations.candidates).toHaveLength(1);
});
