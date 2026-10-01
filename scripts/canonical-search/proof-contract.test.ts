import { describe, expect, it } from "vitest";
import {
  assertCanonicalSearchResults,
  assertStableOrder,
  latencySummary,
  orderedResultIds,
} from "./proof-contract";

const native = {
  id: "clawhub:skill-1",
  source: "clawhub",
  canonicalUrl: "/publisher/skills/gifgrep",
  links: { canonical: "/publisher/skills/gifgrep", source: null },
  publisher: {
    kind: "org",
    handle: "publisher",
    displayName: "Publisher",
    image: null,
    official: true,
  },
  official: true,
  featured: false,
  install: { kind: "clawhub", reference: "publisher/gifgrep", sourceUrl: null },
  sourceIdentity: {
    id: "skill-1",
    owner: "publisher",
    repo: null,
    host: null,
    lifetimeInstalls: null,
  },
  trust: {
    visibility: "public",
    installability: "installable",
    clawHubVerdict: "clean",
    upstreamScanners: null,
    sourceFreshness: "native",
  },
  metrics: { rolling60DayInstalls: 12, bookmarks: 3, updatedAt: 10 },
};

const external = {
  id: "skills-sh:clawhub-test/claw-577/search-popularity-decoy",
  source: "skills-sh",
  canonicalUrl: "/skills-sh/clawhub-test/claw-577/search-popularity-decoy",
  links: {
    canonical: "/skills-sh/clawhub-test/claw-577/search-popularity-decoy",
    source: "https://skills.sh/clawhub-test/claw-577/search-popularity-decoy",
  },
  publisher: null,
  official: false,
  featured: false,
  install: {
    kind: "skills-sh",
    reference: "skills-sh/clawhub-test/claw-577/search-popularity-decoy",
    sourceUrl: "https://skills.sh/clawhub-test/claw-577/search-popularity-decoy",
  },
  sourceIdentity: {
    id: "clawhub-test/claw-577/search-popularity-decoy",
    owner: "clawhub-test",
    repo: "claw-577",
    host: null,
    lifetimeInstalls: 9_000_000,
  },
  trust: {
    visibility: "public",
    installability: "installable",
    clawHubVerdict: null,
    upstreamScanners: {},
    sourceFreshness: "observed-only",
  },
  metrics: { rolling60DayInstalls: null, bookmarks: null, updatedAt: 11 },
};

describe("canonical search Test proof contract", () => {
  it("validates canonical native and external result metadata", () => {
    expect(assertCanonicalSearchResults([native, external])).toEqual([native, external]);
    expect(orderedResultIds([native, external])).toEqual([native.id, external.id]);
  });

  it("rejects consumer order drift", () => {
    expect(() =>
      assertStableOrder([
        [native.id, external.id],
        [native.id, external.id],
      ]),
    ).not.toThrow();
    expect(() =>
      assertStableOrder([
        [native.id, external.id],
        [external.id, native.id],
      ]),
    ).toThrow("search order drifted");
  });

  it("records median and nearest-rank p95 without inventing a latency SLO", () => {
    expect(latencySummary([40, 10, 30, 20, 50])).toEqual({ medianMs: 30, p95Ms: 50 });
  });
});
