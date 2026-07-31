import { describe, expect, it } from "vitest";
import {
  blendCanonicalTrendingPools,
  buildExternalCanonicalTrendingCandidate,
  buildNativeCanonicalTrendingCandidate,
  decodeCanonicalTrendingCursor,
  encodeCanonicalTrendingCursor,
  isFreshExternalTrendingRun,
  retainTopCanonicalTrendingCandidates,
  sortCanonicalTrendingPools,
  type CanonicalTrendingCandidate,
} from "./canonicalTrending";

function candidate(
  identity: string,
  lane: CanonicalTrendingCandidate["lane"],
  overrides: Partial<CanonicalTrendingCandidate> = {},
): CanonicalTrendingCandidate {
  return {
    identity,
    lane,
    publisherKey: identity,
    installs24h: 0,
    bookmarks24h: 0,
    createdAt: 0,
    updatedAt: 0,
    upstreamRank: null,
    ...overrides,
  };
}

describe("canonical Trending ordering", () => {
  it("admits skills.sh only while its latest completed run is fresh", () => {
    expect(isFreshExternalTrendingRun({ runId: "run-1", completedAt: 8_001 }, 10_000, 2_000)).toBe(
      true,
    );
    expect(isFreshExternalTrendingRun({ runId: "run-1", completedAt: 8_000 }, 10_000, 2_000)).toBe(
      false,
    );
    expect(isFreshExternalTrendingRun({ runId: null, completedAt: 9_999 }, 10_000, 2_000)).toBe(
      false,
    );
  });

  it("interleaves complete pools as a continuous 40/20/40 feed", () => {
    const result = blendCanonicalTrendingPools({
      clawhubTrending: Array.from({ length: 4 }, (_, index) =>
        candidate(`c-${index + 1}`, "clawhub-trending"),
      ),
      clawhubRising: Array.from({ length: 2 }, (_, index) =>
        candidate(`r-${index + 1}`, "clawhub-rising"),
      ),
      skillsShTrending: Array.from({ length: 4 }, (_, index) =>
        candidate(`s-${index + 1}`, "skills-sh-trending"),
      ),
    });

    expect(result.map((entry) => entry.identity)).toEqual([
      "c-1",
      "s-1",
      "r-1",
      "c-2",
      "s-2",
      "c-3",
      "s-3",
      "r-2",
      "c-4",
      "s-4",
    ]);
  });

  it("backfills exhausted Rising capacity from ClawHub Trending", () => {
    const result = blendCanonicalTrendingPools({
      clawhubTrending: Array.from({ length: 6 }, (_, index) =>
        candidate(`c-${index + 1}`, "clawhub-trending"),
      ),
      clawhubRising: [],
      skillsShTrending: Array.from({ length: 4 }, (_, index) =>
        candidate(`s-${index + 1}`, "skills-sh-trending"),
      ),
    });

    expect(result.slice(0, 5).map((entry) => entry.identity)).toEqual([
      "c-1",
      "s-1",
      "c-2",
      "c-3",
      "s-2",
    ]);
    expect(result).toHaveLength(10);
  });

  it("deduplicates native overlap and defers capped publishers beyond the first 20", () => {
    const clawhubTrending = [
      candidate("shared", "clawhub-trending", { publisherKey: "alpha", installs24h: 30 }),
      candidate("alpha-2", "clawhub-trending", { publisherKey: "alpha", installs24h: 29 }),
      candidate("alpha-3", "clawhub-trending", { publisherKey: "alpha", installs24h: 28 }),
      ...Array.from({ length: 18 }, (_, index) =>
        candidate(`c-${index + 1}`, "clawhub-trending", {
          publisherKey: `c-${index + 1}`,
          installs24h: 27 - index,
        }),
      ),
    ];
    const clawhubRising = [
      candidate("shared", "clawhub-rising", { publisherKey: "alpha" }),
      ...Array.from({ length: 10 }, (_, index) =>
        candidate(`r-${index + 1}`, "clawhub-rising", { publisherKey: `r-${index + 1}` }),
      ),
    ];
    const skillsShTrending = Array.from({ length: 20 }, (_, index) =>
      candidate(`s-${index + 1}`, "skills-sh-trending", { publisherKey: `s-${index + 1}` }),
    );

    const result = blendCanonicalTrendingPools({
      clawhubTrending,
      clawhubRising,
      skillsShTrending,
    });

    expect(result.filter((entry) => entry.identity === "shared")).toHaveLength(1);
    expect(result.slice(0, 20).filter((entry) => entry.publisherKey === "alpha")).toHaveLength(2);
    expect(result.findIndex((entry) => entry.identity === "alpha-3")).toBeGreaterThanOrEqual(20);
    expect(result).toHaveLength(51);
  });

  it("completes an undersized feed after cap-compliant alternatives are exhausted", () => {
    const result = blendCanonicalTrendingPools({
      clawhubTrending: [
        candidate("alpha-1", "clawhub-trending", { publisherKey: "alpha" }),
        candidate("alpha-2", "clawhub-trending", { publisherKey: "alpha" }),
        candidate("alpha-3", "clawhub-trending", { publisherKey: "alpha" }),
      ],
      clawhubRising: [],
      skillsShTrending: [],
    });

    expect(result.map((entry) => entry.identity)).toEqual(["alpha-1", "alpha-2", "alpha-3"]);
  });

  it("sorts native metrics and preserves exact skills.sh upstream rank", () => {
    const pools = sortCanonicalTrendingPools({
      clawhubTrending: [
        candidate("c-low", "clawhub-trending", { installs24h: 2, bookmarks24h: 9 }),
        candidate("c-high-bookmarks", "clawhub-trending", {
          installs24h: 3,
          bookmarks24h: 5,
        }),
        candidate("c-high", "clawhub-trending", { installs24h: 3, bookmarks24h: 1 }),
      ],
      clawhubRising: [
        candidate("r-old", "clawhub-rising", {
          installs24h: 1,
          bookmarks24h: 1,
          createdAt: 10,
        }),
        candidate("r-new", "clawhub-rising", {
          installs24h: 1,
          bookmarks24h: 1,
          createdAt: 20,
        }),
      ],
      skillsShTrending: [
        candidate("s-3", "skills-sh-trending", { upstreamRank: 3 }),
        candidate("s-1", "skills-sh-trending", { upstreamRank: 1 }),
        candidate("s-2", "skills-sh-trending", { upstreamRank: 2 }),
      ],
    });

    expect(pools.clawhubTrending.map((entry) => entry.identity)).toEqual([
      "c-high-bookmarks",
      "c-high",
      "c-low",
    ]);
    expect(pools.clawhubRising.map((entry) => entry.identity)).toEqual(["r-new", "r-old"]);
    expect(pools.skillsShTrending.map((entry) => entry.identity)).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("retains only the strongest bounded candidates for a lane", () => {
    const retained = retainTopCanonicalTrendingCandidates(
      [
        candidate("low", "clawhub-trending", { installs24h: 1 }),
        candidate("high", "clawhub-trending", { installs24h: 9 }),
        candidate("middle", "clawhub-trending", { installs24h: 4 }),
      ],
      "clawhub-trending",
      2,
    );

    expect(retained.map((entry) => entry.identity)).toEqual(["high", "middle"]);
  });

  it("reserves lower-ranked publishers needed by the first-page cap", () => {
    const retained = retainTopCanonicalTrendingCandidates(
      [
        candidate("alpha-1", "clawhub-trending", {
          publisherKey: "alpha",
          installs24h: 5,
        }),
        candidate("alpha-2", "clawhub-trending", {
          publisherKey: "alpha",
          installs24h: 4,
        }),
        candidate("alpha-3", "clawhub-trending", {
          publisherKey: "alpha",
          installs24h: 3,
        }),
        candidate("beta", "clawhub-trending", { publisherKey: "beta", installs24h: 2 }),
        candidate("gamma", "clawhub-trending", { publisherKey: "gamma", installs24h: 1 }),
      ],
      "clawhub-trending",
      2,
      { size: 4, publisherCap: 2 },
    );

    expect(retained.map((entry) => entry.identity)).toEqual([
      "alpha-1",
      "alpha-2",
      "beta",
      "gamma",
    ]);
  });
});

describe("canonical Trending cursors", () => {
  it("round-trips a stable snapshot position and rejects malformed cursors", () => {
    const cursor = encodeCanonicalTrendingCursor({ snapshotId: "snapshot-123", offset: 40 });

    expect(decodeCanonicalTrendingCursor(cursor)).toEqual({
      snapshotId: "snapshot-123",
      offset: 40,
    });
    expect(() => decodeCanonicalTrendingCursor("not-a-cursor")).toThrow("Invalid cursor format");
  });

  it("rejects emitted counts beyond their physical snapshot offset", () => {
    expect(() =>
      encodeCanonicalTrendingCursor({ snapshotId: "snapshot-123", offset: 3, emitted: 4 }),
    ).toThrow("Invalid cursor emitted count");
    const malformed = btoa(JSON.stringify({ v: 1, s: "snapshot-123", o: 3, e: 4 }));
    expect(() => decodeCanonicalTrendingCursor(malformed)).toThrow("Invalid cursor format");
  });
});

describe("canonical Trending cards", () => {
  it("keeps native 24-hour metrics separate from lifetime installs", () => {
    const result = buildNativeCanonicalTrendingCandidate(
      {
        skillId: "skills:native" as never,
        slug: "native",
        displayName: "Native",
        summary: "Native summary",
        ownerUserId: "users:patrick" as never,
        ownerPublisherId: undefined,
        ownerHandle: "patrick",
        ownerKind: "user",
        ownerName: "patrick",
        ownerDisplayName: "Patrick",
        ownerImage: undefined,
        badges: undefined,
        installKind: undefined,
        githubScanStatus: undefined,
        moderationVerdict: "clean",
        statsInstallsAllTime: 900,
        stats: { downloads: 1_000, stars: 20, versions: 1, comments: 0 },
        createdAt: 100,
        updatedAt: 200,
      },
      { downloads: 37, installs: 12, bookmarks: 4, updatedAt: 300 },
    );

    expect(result?.card.metrics).toEqual({
      trending24hDownloads: 37,
      trending24hInstalls: 12,
      trending24hBookmarks: 4,
      lifetimeInstalls: 900,
      lifetimeInstallsPeriod: "lifetime",
      updatedAt: 300,
    });
  });

  it("excludes native rows without a routable public owner handle", () => {
    const result = buildNativeCanonicalTrendingCandidate(
      {
        skillId: "skills:native" as never,
        slug: "native",
        displayName: "Native",
        summary: undefined,
        ownerUserId: "users:patrick" as never,
        ownerPublisherId: undefined,
        ownerHandle: undefined,
        ownerKind: "user",
        ownerName: "patrick",
        ownerDisplayName: "Patrick",
        ownerImage: undefined,
        badges: undefined,
        installKind: undefined,
        githubScanStatus: undefined,
        moderationVerdict: "clean",
        statsInstallsAllTime: 0,
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 100,
        updatedAt: 200,
      },
      { downloads: 9, installs: 1, bookmarks: 0, updatedAt: 300 },
    );

    expect(result).toBeNull();
  });

  it("preserves an unknown native lifetime install count as null", () => {
    const result = buildNativeCanonicalTrendingCandidate(
      {
        skillId: "skills:native" as never,
        slug: "native",
        displayName: "Native",
        summary: undefined,
        ownerUserId: "users:patrick" as never,
        ownerPublisherId: undefined,
        ownerHandle: "patrick",
        ownerKind: "user",
        ownerName: "patrick",
        ownerDisplayName: "Patrick",
        ownerImage: undefined,
        badges: undefined,
        installKind: undefined,
        githubScanStatus: undefined,
        moderationVerdict: "clean",
        statsInstallsAllTime: undefined,
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 100,
        updatedAt: 200,
      },
      { downloads: 9, installs: 1, bookmarks: 0, updatedAt: 300 },
    );

    expect(result?.card.metrics).toMatchObject({
      trending24hDownloads: 9,
      trending24hInstalls: 1,
      lifetimeInstalls: null,
      updatedAt: 300,
    });
  });

  it("preserves skills.sh rank while leaving unavailable 24-hour metrics null", () => {
    const result = buildExternalCanonicalTrendingCandidate({
      externalId: "patrick/repo/external",
      owner: "patrick",
      repo: "repo",
      sourceHost: undefined,
      slug: "external",
      displayName: "External",
      searchSummary: "External summary",
      sourceUrl: "https://skills.sh/patrick/repo/external",
      upstreamInstalls: 4_000,
      trendingRank: 7,
      trendingLifetimeInstalls: 4_200,
      trendingObservedAt: 300,
      upstreamScanners: {
        genAgentTrustHub: { status: "pass" },
        socket: { status: "pass" },
        snyk: { status: "pass" },
      },
      firstObservedAt: 100,
      lastObservedAt: 250,
    });

    expect(result).toMatchObject({ upstreamRank: 7 });
    expect(result?.card.metrics).toEqual({
      trending24hDownloads: null,
      trending24hInstalls: null,
      trending24hBookmarks: null,
      lifetimeInstalls: 4_200,
      lifetimeInstallsPeriod: "lifetime",
      updatedAt: 300,
    });
  });
});
