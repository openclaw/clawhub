import { describe, expect, it } from "vitest";
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
const adoption = (rank: number) => ({
  source: "package-trending" as const,
  rank,
  snapshotId: "plugin-snapshot",
  rankingVersion: "existing-package-trending",
  periodStart: 1_000,
  periodEnd: 2_000,
  generatedAt: 2_000,
  sourceObservedAt: null,
  downloads: 40,
  installs: 3,
  bookmarks: null,
  lifetimeInstalls: null,
});
const window = { start7d: 1_000, start30d: 500, endDay: 2_000, days: 7 as const };
const coverage = { dataThrough: 2_000, collectionStartedAt: 1_000 };

describe("Featured recommendation evidence", () => {
  it("unites distinct signal cohorts without creating a blended score or duplicate candidate", () => {
    const both = artifact("plugin:both");
    const searched = artifact("plugin:searched");
    const chosen = artifact("plugin:chosen");
    const report = recommendFeatured({
      rows: [demand("calendar", 8, [both, searched, both]), demand("schedule", 4, [both])],
      adoption: [
        { artifact: chosen, evidence: adoption(1) },
        { artifact: both, evidence: adoption(2) },
      ],
      window,
      coverage,
      limit: 20,
    });
    expect(report.candidates.map((row) => [row.id, row.support])).toEqual([
      [both.id, "both"],
      [searched.id, "search-only"],
      [chosen.id, "adoption-only"],
    ]);
    expect(report.candidates[0].search).toMatchObject({ matchedSearches7d: 12, searches30d: 16 });
    expect(report.candidates[0].adoption).toEqual(adoption(2));
    expect(report.candidates[2].search).toBeNull();
    expect(report.candidates.every((row) => !("score" in row))).toBe(true);
  });

  it("retains observed adoption when the newly deployed search window is empty", () => {
    const native = { ...artifact("clawhub:skill-id"), artifactKind: "skill" as const };
    const report = recommendFeatured({
      rows: [],
      adoption: [{ artifact: native, evidence: { ...adoption(3), source: "clawhub-trending" } }],
      window,
      coverage,
      limit: 20,
    });
    expect(report.candidates).toMatchObject([
      { id: native.id, support: "adoption-only", search: null },
    ]);
    expect(report.candidates[0].adoption?.installs).toBe(3);
  });

  it("keeps ineligible entries as explicit exclusions instead of promoting popularity", () => {
    const blocked = {
      ...artifact("plugin:blocked"),
      eligibleForFeatured: false,
      eligibilityReasons: ["security_not_clean"],
    };
    const report = recommendFeatured({
      rows: [demand("popular", 900, [blocked])],
      adoption: [{ artifact: blocked, evidence: adoption(1) }],
      window,
      coverage,
      limit: 20,
    });
    expect(report.candidates).toEqual([]);
    expect(report.excluded).toEqual([
      {
        id: blocked.id,
        displayName: blocked.displayName,
        url: blocked.url,
        reasons: ["security_not_clean"],
      },
    ]);
  });

  it("keeps filtered demand scope and reports bounded omissions", () => {
    const candidate = artifact("plugin:calendar");
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...demand(`query ${index}`, index + 1, [candidate]),
      scope: "shelf" as const,
    }));
    const report = recommendFeatured({ rows, adoption: [], window, coverage, limit: 20 });
    expect(report.candidates[0].search).toMatchObject({ matchedSearches7d: 78, omittedQueries: 4 });
    expect(report.candidates[0].search?.queries).toHaveLength(8);
    expect(report.candidates[0].search?.queries.every((row) => row.scope === "shelf")).toBe(true);
  });
});

it("reassesses a complete eight-member lineup, retains observed members and explains removals without padding", () => {
  const existing = { ...artifact("plugin:existing"), version: "1.0.0", featuredAt: 10 };
  const unknown = { ...artifact("plugin:unknown"), version: "1.0.0", featuredAt: 11 };
  const unsafe = {
    ...artifact("plugin:unsafe"),
    featuredAt: 12,
    eligibleForFeatured: false,
    eligibilityReasons: ["security-not-clean"],
  };
  const newcomers = Array.from({ length: 9 }, (_, index) => artifact(`plugin:new-${index}`));
  const result = recommendFeatured({
    rows: [],
    adoption: [
      { artifact: existing, evidence: adoption(2) },
      ...newcomers.map((entry, index) => ({ artifact: entry, evidence: adoption(index + 3) })),
    ],
    currentFeatured: [existing, unknown, unsafe],
    window,
    coverage,
    limit: 1,
  });
  expect(result.lineup.proposed).toHaveLength(8);
  expect(result.lineup.proposed[0]).toMatchObject({ id: existing.id, change: "retain" });
  expect(result.lineup.proposed.slice(1).every((entry) => entry.change === "add")).toBe(true);
  expect(result.lineup.removals).toMatchObject([
    { id: unknown.id, reasons: ["outside-proposed-set"] },
    { id: unsafe.id, reasons: ["security-not-clean"] },
  ]);
  expect(result.lineup.baseline).toHaveLength(3);
  expect(result.lineup.shortfall).toBe(0);
  const sparse = recommendFeatured({
    rows: [],
    adoption: [],
    currentFeatured: [unknown, unsafe],
    window,
    coverage,
    limit: 20,
  });
  expect(sparse.lineup.proposed).toMatchObject([
    { id: unknown.id, change: "retain", support: "current-only", search: null, adoption: null },
  ]);
  expect(sparse.lineup.shortfall).toBe(7);
});

it("labels recent publication with observed adoption and existing Rising evidence without inventing growth", () => {
  const recent = { ...artifact("plugin:recent"), createdAt: 1_500 };
  const old = { ...artifact("plugin:old"), createdAt: 0 };
  const snapshot = { ...adoption(1), generatedAt: 20 * 86_400_000 };
  const rows = [recent, old].map((entry, index) => ({
    artifact: { ...entry, createdAt: index ? 0 : snapshot.generatedAt - 86_400_000 },
    evidence: snapshot,
  }));
  const result = recommendFeatured({
    rows: [],
    adoption: rows,
    currentFeatured: [],
    window,
    coverage,
    limit: 20,
  });
  expect(result.lineup.proposed.find((entry) => entry.id === recent.id)?.emerging).toBe(true);
  expect(result.lineup.proposed.find((entry) => entry.id === old.id)?.emerging).toBe(false);
  const noUsage = recommendFeatured({
    rows: [],
    adoption: [{ artifact: recent, evidence: { ...adoption(1), downloads: 0, installs: 0 } }],
    window,
    coverage,
    limit: 20,
  });
  expect(noUsage.lineup.proposed[0].emerging).toBe(false);
});
