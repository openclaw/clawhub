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
