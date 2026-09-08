import { expect, it } from "vitest";
import { buildSearchDigest, mondaySearchWeek } from "./searchDigest";

it.each([
  ["2026-03-02T16:59:00Z", null],
  ["2026-03-02T17:00:00Z", "2026-03-02T00:00:00Z"],
  ["2026-03-09T15:59:00Z", null],
  ["2026-03-09T16:00:00Z", "2026-03-09T00:00:00Z"],
  ["2026-11-02T17:00:00Z", "2026-11-02T00:00:00Z"],
  ["2026-09-08T17:00:00Z", null],
])("Monday 09:00 Pacific schedule at %s identifies the completed UTC week", (now, end) => {
  expect(mondaySearchWeek(Date.parse(now!))).toEqual(
    end
      ? {
          weekStart: Date.parse(end) - 604_800_000,
          weekEnd: Date.parse(end),
        }
      : null,
  );
});

it("keeps deterministic official gaps on classifier failure, suppresses rare queries, and allowlists the delivery payload", () => {
  const base = {
    searches7d: 8,
    searchesPrevious7d: 2,
    officialGaps7d: 5,
    classification: null,
    featuredCandidate: null,
    searchUrl: "/plugins?q=memory",
  };
  const identified = { ...base, query: "memory", userId: "must-not-leave" };
  const digest = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 17,
    sources7d: { "clawhub-web": 10, "openclaw-control-ui": 7 },
    classificationStatus: "unavailable",
    currentMetadataStatus: "available",
    truncated: false,
    rows: [
      identified,
      { ...base, query: "calendar", searchUrl: "/plugins?q=calendar" },
      { ...base, query: "rare", searches7d: 1, officialGaps7d: 1 },
    ],
  });
  expect(digest.companyOpportunities).toEqual([]);
  expect(digest.classificationStatus).toBe("unavailable");
  expect(digest.officialGaps.map((row) => row.query)).toEqual(["calendar", "memory"]);
  expect(digest.movers.map((row) => row.query)).toEqual(["calendar", "memory"]);
  expect(digest.minimumSearches).toBe(3);
  expect(digest.dashboardUrl).toBe(
    "https://clawhub.ai/management?view=search-insights&endDay=1788739200000",
  );
  expect(JSON.stringify(digest)).not.toContain("must-not-leave");
});

it("routes only high-confidence company intent and eligible unfeatured packages into advisory shortlists", () => {
  const base = {
    searches7d: 9,
    searchesPrevious7d: 3,
    officialGaps7d: 9,
    featuredCandidate: null,
    searchUrl: "/plugins?q=notion",
  };
  const result = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 45,
    sources7d: { "clawhub-web": 45, "openclaw-control-ui": 0 },
    classificationStatus: "available",
    currentMetadataStatus: "available",
    truncated: false,
    rows: [
      {
        ...base,
        query: "notion",
        classification: {
          intentKind: "company_product",
          confidence: 0.95,
          companyProductName: "Notion",
        },
        featuredCandidate: {
          name: "notion-community",
          displayName: "Notion community",
          url: "/plugins/notion-community",
          eligibleForFeatured: true,
          isFeatured: false,
        },
      },
      {
        ...base,
        query: "apple",
        classification: { intentKind: "company_product", confidence: 0.6 },
      },
      {
        ...base,
        query: "memory",
        classification: { intentKind: "generic_capability", confidence: 0.99 },
      },
      { ...base, query: "drive", classification: { intentKind: "ambiguous", confidence: 0.95 } },
      {
        ...base,
        query: "calendar",
        classification: null,
        featuredCandidate: {
          name: "calendar",
          displayName: "Calendar",
          url: "/plugins/calendar",
          eligibleForFeatured: true,
          isFeatured: true,
        },
      },
    ],
  });
  expect(result.companyOpportunities.map((entry) => entry.query)).toEqual(["notion"]);
  expect(result.officialGaps).toHaveLength(5);
  expect(result.featuredCandidates.map((entry) => entry.package.name)).toEqual([
    "notion-community",
  ]);
});

it("includes a dropped-to-zero mover qualified by the previous full week, while suppressing rare queries in both weeks", () => {
  const base = {
    officialGaps7d: 0,
    classification: null,
    featuredCandidate: null,
    searchUrl: "/plugins?q=calendar",
  };
  const result = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 1,
    sources7d: { "clawhub-web": 1, "openclaw-control-ui": 0 },
    classificationStatus: "unavailable",
    currentMetadataStatus: "unavailable",
    truncated: false,
    rows: [],
    moverRows: [
      { ...base, query: "calendar", searches7d: 0, searchesPrevious7d: 8 },
      { ...base, query: "rare", searches7d: 1, searchesPrevious7d: 2 },
    ],
  });
  expect(result.movers.map((row) => row.query)).toEqual(["calendar"]);
});
