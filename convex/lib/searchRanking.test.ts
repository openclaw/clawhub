import { describe, expect, it } from "vitest";
import {
  adoptionBucket,
  compareRankedSearchKeys,
  hasStrongTrustSignal,
  isDemotedExactMatch,
  rankedSearchKey,
  verificationRank,
  type SearchTrustSignals,
} from "./searchRanking";

const community = (overrides: Partial<SearchTrustSignals> = {}): SearchTrustSignals => ({
  isOfficial: false,
  verificationTier: null,
  downloads: 0,
  installs: 0,
  ...overrides,
});

describe("verificationRank", () => {
  it("orders tiers from unverified to rebuild-verified", () => {
    expect(verificationRank(null)).toBe(0);
    expect(verificationRank(undefined)).toBe(0);
    expect(verificationRank("structural")).toBe(1);
    expect(verificationRank("source-linked")).toBe(2);
    expect(verificationRank("provenance-verified")).toBe(3);
    expect(verificationRank("rebuild-verified")).toBe(4);
  });
});

describe("hasStrongTrustSignal", () => {
  it("accepts official packages and strong verification", () => {
    expect(hasStrongTrustSignal(community({ isOfficial: true }))).toBe(true);
    expect(hasStrongTrustSignal(community({ verificationTier: "provenance-verified" }))).toBe(true);
    expect(hasStrongTrustSignal(community({ verificationTier: "rebuild-verified" }))).toBe(true);
  });

  it("rejects self-serve tiers so they cannot open the squat gate", () => {
    expect(hasStrongTrustSignal(community())).toBe(false);
    expect(hasStrongTrustSignal(community({ verificationTier: "structural" }))).toBe(false);
    expect(hasStrongTrustSignal(community({ verificationTier: "source-linked" }))).toBe(false);
  });
});

describe("adoptionBucket", () => {
  it("buckets combined downloads and installs on a log scale", () => {
    expect(adoptionBucket(community())).toBe(0);
    expect(adoptionBucket(community({ downloads: 9 }))).toBe(0);
    expect(adoptionBucket(community({ downloads: 10 }))).toBe(1);
    expect(adoptionBucket(community({ downloads: 60, installs: 40 }))).toBe(2);
    expect(adoptionBucket(community({ downloads: 950, installs: 60 }))).toBe(3);
    expect(adoptionBucket(community({ downloads: 5_000_000_000 }))).toBe(6);
  });

  it("ignores negative and missing stats", () => {
    expect(adoptionBucket(community({ downloads: -5, installs: null }))).toBe(0);
    expect(adoptionBucket({ isOfficial: false })).toBe(0);
  });
});

describe("rankedSearchKey", () => {
  it("demotes exact matches without trust or adoption to the prefix tier", () => {
    const key = rankedSearchKey({ rankTier: 0, score: 200 }, community());
    expect(key.tier).toBe(1);
    expect(key.adoption).toBe(0);
    expect(key.score).toBe(200);
  });

  it("keeps exact matches for official, verified, or adopted entries", () => {
    expect(rankedSearchKey({ rankTier: 0, score: 200 }, community({ isOfficial: true })).tier).toBe(
      0,
    );
    expect(
      rankedSearchKey(
        { rankTier: 0, score: 200 },
        community({ verificationTier: "rebuild-verified" }),
      ).tier,
    ).toBe(0);
    expect(rankedSearchKey({ rankTier: 0, score: 200 }, community({ installs: 25 })).tier).toBe(0);
  });

  it("leaves non-exact tiers untouched", () => {
    expect(rankedSearchKey({ rankTier: 1, score: 80 }, community()).tier).toBe(1);
    expect(rankedSearchKey({ rankTier: 3, score: 20 }, community()).tier).toBe(3);
  });
});

describe("isDemotedExactMatch", () => {
  it("flags untrusted zero-adoption exact matches so they cannot fill collection quotas", () => {
    expect(isDemotedExactMatch({ rankTier: 0, score: 200 }, community())).toBe(true);
  });

  it("does not flag trusted, adopted, or non-exact matches", () => {
    expect(isDemotedExactMatch({ rankTier: 0, score: 200 }, community({ isOfficial: true }))).toBe(
      false,
    );
    expect(isDemotedExactMatch({ rankTier: 0, score: 200 }, community({ downloads: 40 }))).toBe(
      false,
    );
    expect(isDemotedExactMatch({ rankTier: 1, score: 80 }, community())).toBe(false);
  });
});

describe("compareRankedSearchKeys", () => {
  const sortKeys = (entries: Array<{ name: string; key: ReturnType<typeof rankedSearchKey> }>) =>
    [...entries].sort((a, b) => compareRankedSearchKeys(a.key, b.key)).map((entry) => entry.name);

  it("ranks adopted substring matches above fresh exact-name squats", () => {
    // Regression for issue #3054: a zero-adoption, unverified package named
    // exactly like the query must not headline over adopted alternatives.
    const squat = rankedSearchKey({ rankTier: 0, score: 355 }, community());
    const adopted = rankedSearchKey({ rankTier: 1, score: 120 }, community({ installs: 3_200 }));
    expect(
      sortKeys([
        { name: "squat", key: squat },
        { name: "adopted", key: adopted },
      ]),
    ).toEqual(["adopted", "squat"]);
  });

  it("keeps official exact matches on top", () => {
    const official = rankedSearchKey(
      { rankTier: 0, score: 200 },
      community({ isOfficial: true, downloads: 50 }),
    );
    const adopted = rankedSearchKey({ rankTier: 1, score: 120 }, community({ installs: 90_000 }));
    expect(
      sortKeys([
        { name: "adopted", key: adopted },
        { name: "official", key: official },
      ]),
    ).toEqual(["official", "adopted"]);
  });

  it("prefers adoption magnitude before text score within a tier", () => {
    const popular = rankedSearchKey({ rankTier: 1, score: 40 }, community({ downloads: 12_000 }));
    const niche = rankedSearchKey({ rankTier: 1, score: 120 }, community({ downloads: 15 }));
    expect(
      sortKeys([
        { name: "niche", key: niche },
        { name: "popular", key: popular },
      ]),
    ).toEqual(["popular", "niche"]);
  });

  it("breaks adoption ties by text score", () => {
    const better = rankedSearchKey({ rankTier: 1, score: 120 }, community({ downloads: 30 }));
    const worse = rankedSearchKey({ rankTier: 1, score: 40 }, community({ downloads: 60 }));
    expect(
      sortKeys([
        { name: "worse", key: worse },
        { name: "better", key: better },
      ]),
    ).toEqual(["better", "worse"]);
  });

  it("returns zero for identical keys so caller tie-breakers apply", () => {
    const key = rankedSearchKey({ rankTier: 1, score: 40 }, community({ downloads: 60 }));
    expect(compareRankedSearchKeys(key, { ...key })).toBe(0);
  });
});
