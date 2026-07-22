/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  loadAndRankMixedSkillCandidates,
  rankMixedSkillCandidates,
  type MixedSkillCandidate,
} from "./mixedSkillSearch";

function candidate(
  key: string,
  overrides: Partial<MixedSkillCandidate<string>> = {},
): MixedSkillCandidate<string> {
  return {
    key,
    value: key,
    source: "native",
    rankTier: 2,
    textScore: 0,
    clawhubTrusted: true,
    popularity: 0,
    freshness: 0,
    ...overrides,
  };
}

describe("mixed skill search", () => {
  it("loads native and mirrored candidate pools in parallel and bounds both inputs", async () => {
    const calls: string[] = [];
    let resolveNative!: (value: MixedSkillCandidate<string>[]) => void;
    let resolveExternal!: (value: MixedSkillCandidate<string>[]) => void;
    const loadNative = vi.fn(
      async () =>
        await new Promise<MixedSkillCandidate<string>[]>((resolve) => {
          calls.push("native");
          resolveNative = resolve;
        }),
    );
    const loadExternal = vi.fn(
      async () =>
        await new Promise<MixedSkillCandidate<string>[]>((resolve) => {
          calls.push("external");
          resolveExternal = resolve;
        }),
    );

    const pending = loadAndRankMixedSkillCandidates({
      loadNative,
      loadExternal,
      nativeLimit: 2,
      externalLimit: 2,
      resultLimit: 3,
    });

    expect(calls).toEqual(["native", "external"]);
    resolveNative([candidate("native-1"), candidate("native-2"), candidate("native-3")]);
    resolveExternal([
      candidate("external-1", { source: "skills-sh", clawhubTrusted: false }),
      candidate("external-2", { source: "skills-sh", clawhubTrusted: false }),
      candidate("external-3", { source: "skills-sh", clawhubTrusted: false }),
    ]);

    const result = await pending;

    expect(loadNative).toHaveBeenCalledWith(2);
    expect(loadExternal).toHaveBeenCalledWith(2);
    expect(result).toHaveLength(3);
    expect(result.map((entry) => entry.key)).not.toContain("native-3");
    expect(result.map((entry) => entry.key)).not.toContain("external-3");
  });

  it("keeps an exact mirrored result above unrelated trusted native results", () => {
    const result = rankMixedSkillCandidates([
      candidate("native-summary", {
        rankTier: 3,
        textScore: 1,
        popularity: 10_000,
        freshness: 10_000,
      }),
      candidate("external-exact", {
        source: "skills-sh",
        rankTier: 0,
        textScore: 1,
        clawhubTrusted: false,
      }),
    ]);

    expect(result.map((entry) => entry.key)).toEqual(["external-exact", "native-summary"]);
  });

  it("prefers ClawHub-trusted results within the same textual relevance tier", () => {
    const result = rankMixedSkillCandidates([
      candidate("external-popular", {
        source: "skills-sh",
        rankTier: 1,
        textScore: 10,
        clawhubTrusted: false,
        popularity: 1_000_000,
        freshness: 10_000,
      }),
      candidate("native-trusted", {
        rankTier: 1,
        textScore: 1,
        popularity: 1,
        freshness: 1,
      }),
    ]);

    expect(result.map((entry) => entry.key)).toEqual(["native-trusted", "external-popular"]);
  });

  it("uses textual score, attributable popularity, and freshness as stable tie-breakers", () => {
    const result = rankMixedSkillCandidates([
      candidate("fresh", { textScore: 1, popularity: 5, freshness: 20 }),
      candidate("popular", { textScore: 1, popularity: 10, freshness: 1 }),
      candidate("relevant", { textScore: 2, popularity: 0, freshness: 0 }),
    ]);

    expect(result.map((entry) => entry.key)).toEqual(["relevant", "popular", "fresh"]);
  });
});
