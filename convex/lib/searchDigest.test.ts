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

it("does not let an oversized valid registry package poison the frozen receiver payload", () => {
  const result = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 4,
    sources7d: { "clawhub-web": 4, "openclaw-control-ui": 0 },
    classificationStatus: "unavailable",
    currentMetadataStatus: "available",
    truncated: false,
    rows: [
      {
        query: "notion",
        searches7d: 4,
        searchesPrevious7d: 0,
        officialGaps7d: 4,
        searchUrl: "/plugins?q=notion",
        classification: null,
        featuredCandidate: {
          name: "a".repeat(161),
          displayName: "Long registry name",
          url: `/plugins/${"a".repeat(161)}`,
          eligibleForFeatured: true,
          isFeatured: false,
        },
      },
    ],
  });
  expect(result.featuredCandidates).toEqual([]);
  expect(result.officialGaps).toHaveLength(1);
  expect(result.truncated).toBe(true);
});

it("omits unrepresentable query identities without silently changing counts or names and sanitizes display-only text", () => {
  const base = {
    searches7d: 4,
    searchesPrevious7d: 0,
    officialGaps7d: 4,
    searchUrl: "/plugins?q=notion",
    classification: null,
    featuredCandidate: null,
  };
  const result = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 8,
    sources7d: { "clawhub-web": 8, "openclaw-control-ui": 0 },
    classificationStatus: "unavailable",
    currentMetadataStatus: "available",
    truncated: false,
    rows: [
      { ...base, query: "notion\u0000" },
      {
        ...base,
        query: "界".repeat(256),
        searchUrl: `/plugins?q=${encodeURIComponent("界".repeat(256))}`,
      },
      {
        ...base,
        query: "notion",
        featuredCandidate: {
          name: "notion",
          displayName: " Notion\ncommunity ",
          url: "/plugins/notion",
          eligibleForFeatured: true,
          isFeatured: false,
        },
      },
    ],
  });
  expect(result.totalSearches).toBe(8);
  expect(result.officialGaps.map((row) => row.query)).toEqual(["notion"]);
  expect(result.movers.map((row) => row.query)).toEqual(["notion"]);
  expect(result.featuredCandidates[0].package).toMatchObject({
    name: "notion",
    displayName: "Notion community",
  });
  expect(result.truncated).toBe(true);
});

it("fits valid long Unicode shortlists within the persisted UTF-8 budget by dropping only whole tail rows", () => {
  const rows = Array.from({ length: 5 }, (_, i) => {
    const query = "界".repeat(200) + i;
    return {
      query,
      searches7d: 5,
      searchesPrevious7d: 0,
      officialGaps7d: 5,
      searchUrl: `/plugins?q=${encodeURIComponent(query)}`,
      classification: {
        intentKind: "company_product",
        confidence: 0.9,
        companyProductName: "Synthetic Product",
      },
      featuredCandidate: {
        name: `package-${i}`,
        displayName: `Package ${i}`,
        url: `/plugins/package-${i}`,
        eligibleForFeatured: true,
        isFeatured: false,
      },
    };
  });
  const digest = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 25,
    sources7d: { "clawhub-web": 25, "openclaw-control-ui": 0 },
    classificationStatus: "available",
    currentMetadataStatus: "available",
    truncated: false,
    rows,
  });
  expect(new TextEncoder().encode(JSON.stringify(digest)).byteLength).toBeLessThanOrEqual(30_000);
  expect(digest.truncated).toBe(true);
  expect(digest.totalSearches).toBe(25);
  for (const section of [
    digest.companyOpportunities,
    digest.officialGaps,
    digest.featuredCandidates,
    digest.movers,
  ]) {
    expect(section.length).toBeGreaterThan(0);
    expect(section.map((row) => row.query)).toEqual(
      rows.slice(0, section.length).map((row) => row.query),
    );
  }
});

it("keeps successful demand metadata when the separate official-gap cohort lookup fails", () => {
  const gap = {
    query: "notion",
    searches7d: 4,
    searchesPrevious7d: 0,
    officialGaps7d: 4,
    searchUrl: "/plugins?q=notion",
    classification: null,
    featuredCandidate: null,
  };
  const candidate = {
    name: "notion-community",
    displayName: "Notion community",
    url: "/plugins/notion-community",
    eligibleForFeatured: true,
    isFeatured: false,
  };
  const digest = buildSearchDigest({
    weekEnd: Date.parse("2026-09-07T00:00:00Z"),
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 4,
    sources7d: { "clawhub-web": 4, "openclaw-control-ui": 0 },
    classificationStatus: "unavailable",
    currentMetadataStatus: "available",
    truncated: false,
    rows: [gap],
    featuredRows: [{ ...gap, featuredCandidate: candidate }],
  });
  expect(digest.featuredCandidates).toHaveLength(1);
  expect(digest.featuredCandidates[0].package.name).toBe("notion-community");
  expect(digest.officialGaps).toHaveLength(1);
});
