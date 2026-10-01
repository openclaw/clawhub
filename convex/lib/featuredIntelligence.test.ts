import { expect, it } from "vitest";
import { recommendFeatured, type RecommendationArtifact } from "./featuredIntelligence";

const artifact = (id: string): RecommendationArtifact => ({
  id,
  artifactKind: "plugin",
  name: id.slice(7),
  displayName: id.slice(7),
  summary: "A public catalog entry",
  url: `/plugins/${id.slice(7)}`,
  eligibleForFeatured: true,
  eligibilityReasons: [],
});
const demand = (query: string, searches7d: number, results: RecommendationArtifact[]) => ({
  query,
  scope: "catalog" as const,
  searches7d,
  searchesPrevious7d: 2,
  searches30d: searches7d + 2,
  currentResults: results,
});
const adoption = (installs30d: number, installs7d = 0) => ({
  source: "package-daily-installs" as const,
  rank: 1,
  snapshotId: "fixture",
  rankingVersion: "featured-installs-30d-v1",
  periodStart: 500,
  periodStart7d: 1000,
  periodEnd: 2000,
  generatedAt: 2000,
  installs30d,
  installs7d,
  importedRows: 0,
  importDatasetVersions: [],
});
const window = { start7d: 1_000, start30d: 500, endDay: 2_000, days: 7 as const };
const coverage = { dataThrough: 2_000, collectionStartedAt: 1_000 };

const base = {
  artifactKind: "plugin" as const,
  rows: [],
  adoption: [],
  editorial: { revision: 0, items: [] },
  editorialArtifacts: [],
  currentEditorialRevision: 0,
  window,
  coverage,
  limit: 20,
};

it("ranks telemetry by monthly installs, final-week installs, then identity without search or incumbent bonuses", () => {
  const entries = ["plugin:monthly", "plugin:weekly", "plugin:stable-a", "plugin:stable-b"].map(
    artifact,
  );
  const report = recommendFeatured({
    ...base,
    rows: [demand("familiar", 10000, [entries[3], artifact("plugin:search-only")])],
    adoption: entries.map((entry, index) => ({
      artifact: entry,
      evidence: adoption([20, 10, 10, 10][index], [0, 8, 3, 3][index]),
    })),
    currentFeatured: [{ ...entries[3], featuredAt: 1 }],
  });
  expect(report.lineup.proposed.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
  expect(report.lineup).toMatchObject({
    targetSize: 16,
    reservedSlots: 8,
    telemetryTarget: 8,
    pendingCount: 8,
    telemetryShortfall: 4,
    shortfall: 12,
  });
  expect(report.lineup.proposed[3]).toMatchObject({
    change: "retain",
    support: "both",
    selectionBasis: "telemetry",
    slot: 11,
  });
});

it("reserves missing editorial slots, deduplicates their telemetry and exposes stale revisions without substituting choices", () => {
  const chosen = artifact("plugin:chosen");
  const missing = {
    ...artifact("plugin:missing"),
    eligibleForFeatured: false,
    eligibilityReasons: ["no-public-version"],
  };
  const report = recommendFeatured({
    ...base,
    editorial: {
      revision: 4,
      items: [
        {
          id: chosen.id,
          name: chosen.name,
          displayName: chosen.displayName,
          reason: "Useful review tool",
        },
        {
          id: missing.id,
          name: missing.name,
          displayName: missing.displayName,
          reason: "Awaiting publication",
        },
      ],
    },
    editorialArtifacts: [chosen, missing],
    currentEditorialRevision: 5,
    adoption: [
      chosen,
      ...Array.from({ length: 12 }, (_, index) => artifact(`plugin:item-${index}`)),
    ].map((entry, index) => ({ artifact: entry, evidence: adoption(100 - index) })),
  });
  expect(report.lineup.proposed).toHaveLength(9);
  expect(report.lineup.proposed[0]).toMatchObject({
    id: chosen.id,
    slot: 0,
    selectionBasis: "editorial",
    reason: "Useful review tool",
  });
  expect(report.lineup.proposed[1]).toMatchObject({
    id: "plugin:item-0",
    slot: 8,
    selectionBasis: "telemetry",
  });
  expect(report.lineup.reservations[1]).toMatchObject({
    id: missing.id,
    status: "pending",
    artifact: null,
    pendingReasons: ["no-public-version"],
  });
  expect(report.lineup).toMatchObject({
    editorialRevision: 4,
    currentEditorialRevision: 5,
    staleEditorial: true,
    pendingCount: 7,
    telemetryShortfall: 0,
    shortfall: 7,
  });
});

it("fills sixteen skill telemetry slots, excludes unsafe entries and never pads with current-only or search-only cards", () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({
    ...artifact(`clawhub:${index.toString().padStart(2, "0")}`),
    artifactKind: "skill" as const,
  }));
  const unsafe = {
    ...entries[0],
    eligibleForFeatured: false,
    eligibilityReasons: ["security-not-clean"],
  };
  const report = recommendFeatured({
    ...base,
    artifactKind: "skill",
    limit: 1,
    adoption: [unsafe, ...entries.slice(1)].map((entry, index) => ({
      artifact: entry,
      evidence: adoption(100 - index),
    })),
  });
  expect(report.lineup.proposed).toHaveLength(16);
  expect(report.lineup.proposed[0]).toMatchObject({ id: "clawhub:01", slot: 0 });
  expect(report.lineup.proposed.at(-1)?.id).toBe("clawhub:16");
  expect(report.lineup.reservations).toEqual([]);
  expect(report.excluded).toMatchObject([{ id: unsafe.id, reasons: ["security-not-clean"] }]);
  const empty = recommendFeatured({
    ...base,
    artifactKind: "skill",
    currentFeatured: [{ ...entries[1], featuredAt: 1 }],
    rows: [demand("popular", 99, entries)],
  });
  expect(empty.lineup.proposed).toEqual([]);
  expect(empty.lineup.removals).toMatchObject([
    { id: entries[1].id, reasons: ["outside-proposed-set"] },
  ]);
  expect(empty.lineup.shortfall).toBe(16);
});

it("retains bounded query context without changing install selection or mistaking absent evidence for zero", () => {
  const candidate = artifact("plugin:calendar");
  const report = recommendFeatured({
    ...base,
    rows: Array.from({ length: 12 }, (_, index) => ({
      ...demand(`query ${index}`, index + 1, [candidate, candidate]),
      scope: "shelf" as const,
    })),
    adoption: [{ artifact: candidate, evidence: adoption(3) }],
  });
  expect(report.candidates[0].search).toMatchObject({ matchedSearches7d: 78, omittedQueries: 4 });
  expect(report.candidates[0].search?.queries).toHaveLength(8);
  expect(
    recommendFeatured({ ...base, adoption: [{ artifact: candidate, evidence: adoption(3) }] })
      .candidates[0].search,
  ).toBeNull();
  expect(
    recommendFeatured({ ...base, adoption: [{ artifact: candidate, evidence: adoption(0) }] })
      .lineup.proposed,
  ).toEqual([]);
});
