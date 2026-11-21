/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildExternalCanonicalResult,
  buildNativeCanonicalResult,
  classifyCanonicalSkillSearchMatch,
  compareCanonicalSkillSearchCandidates,
  type CanonicalSkillSearchCandidate,
  type ExternalSkillSearchDigest,
} from "./canonicalSkillSearch";

function candidate(
  id: string,
  overrides: Partial<CanonicalSkillSearchCandidate> = {},
): CanonicalSkillSearchCandidate {
  return {
    id,
    source: "clawhub",
    relevance: { tier: 2, lexicalScore: 0, semanticScore: 0 },
    official: false,
    featured: false,
    rolling60DayInstalls: 0,
    bookmarks: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("canonical mixed skill search ranking", () => {
  it("keeps an exact lexical match above an irrelevant popular result", () => {
    const exact = candidate("clawhub:exact", {
      relevance: { tier: 0, lexicalScore: 100, semanticScore: 0 },
    });
    const irrelevant = candidate("clawhub:popular", {
      relevance: { tier: 5, lexicalScore: 0, semanticScore: 0.99 },
      rolling60DayInstalls: 1_000_000,
      bookmarks: 1_000_000,
    });

    expect(
      [irrelevant, exact].sort(compareCanonicalSkillSearchCandidates).map((row) => row.id),
    ).toEqual(["clawhub:exact", "clawhub:popular"]);
  });

  it("treats owner-qualified native and external identities as exact matches", () => {
    expect(
      classifyCanonicalSkillSearchMatch("openclaw/calendar", {
        identities: ["openclaw/calendar"],
        name: "Calendar",
        slug: "calendar",
        taxonomy: [],
        summary: null,
      }),
    ).toMatchObject({ tier: 0 });
    expect(
      classifyCanonicalSkillSearchMatch("vercel-labs/skills/find-skills", {
        identities: ["vercel-labs/skills/find-skills", "skills-sh/vercel-labs/skills/find-skills"],
        name: "Find Skills",
        slug: "find-skills",
        taxonomy: [],
        summary: null,
      }),
    ).toMatchObject({ tier: 0 });
    expect(
      classifyCanonicalSkillSearchMatch("skills-sh/vercel-labs/skills/find-skills", {
        identities: ["vercel-labs/skills/find-skills", "skills-sh/vercel-labs/skills/find-skills"],
        name: "Find Skills",
        slug: "find-skills",
        taxonomy: [],
        summary: null,
      }),
    ).toMatchObject({ tier: 0 });
  });

  it("keeps taxonomy and summary intent below navigational lexical matches", () => {
    const taxonomy = classifyCanonicalSkillSearchMatch("calendar automation", {
      identities: ["acme/scheduler"],
      name: "Scheduler",
      slug: "scheduler",
      taxonomy: ["calendar automation"],
      summary: "Coordinate recurring meetings.",
    });
    const summary = classifyCanonicalSkillSearchMatch("coordinate recurring meetings", {
      identities: ["acme/meeting-helper"],
      name: "Meeting Helper",
      slug: "meeting-helper",
      taxonomy: [],
      summary: "Coordinate recurring meetings across teams.",
    });

    expect(taxonomy).toMatchObject({ tier: 3 });
    expect(summary).toMatchObject({ tier: 4 });
  });

  it("orders matching official and featured skills before community matches", () => {
    const community = candidate("clawhub:community", {
      relevance: { tier: 1, lexicalScore: 96, semanticScore: 0 },
    });
    const official = candidate("clawhub:official", {
      relevance: { tier: 3, lexicalScore: 60, semanticScore: 0 },
      official: true,
    });
    const featured = candidate("clawhub:featured", {
      relevance: { tier: 4, lexicalScore: 40, semanticScore: 0 },
      featured: true,
    });

    expect(
      [featured, community, official]
        .sort(compareCanonicalSkillSearchCandidates)
        .map((row) => row.id),
    ).toEqual(["clawhub:official", "clawhub:featured", "clawhub:community"]);
  });

  it("uses rolling adoption, bookmarks, and freshness for comparable matches", () => {
    const recentAdoption = candidate("clawhub:recent-adoption", {
      rolling60DayInstalls: 12,
    });
    const staleLifetimePopularity = candidate("skills-sh:stale-lifetime-popularity", {
      source: "skills-sh",
      bookmarks: 10_000,
      updatedAt: 1,
    });
    const fresh = candidate("clawhub:fresh", { updatedAt: 3 });

    expect(
      [staleLifetimePopularity, fresh, recentAdoption]
        .sort(compareCanonicalSkillSearchCandidates)
        .map((row) => row.id),
    ).toEqual(["clawhub:recent-adoption", "skills-sh:stale-lifetime-popularity", "clawhub:fresh"]);
  });

  it("uses semantic recall only after all lexical evidence tiers", () => {
    const semantic = classifyCanonicalSkillSearchMatch("help me plan a trip", {
      identities: ["acme/travel-agent"],
      name: "Travel Agent",
      slug: "travel-agent",
      taxonomy: [],
      summary: null,
      semanticScore: 0.92,
    });
    expect(semantic).toEqual({ tier: 5, lexicalScore: 0, semanticScore: 0.92 });
  });
});

function nativeEntry(): Parameters<typeof buildNativeCanonicalResult>[0] {
  return {
    skill: {
      _id: "skills:calendar" as Id<"skills">,
      _creationTime: 1,
      slug: "calendar",
      displayName: "Calendar",
      ownerUserId: "users:owner" as Id<"users">,
      ownerPublisherId: "publishers:owner" as Id<"publishers">,
      tags: {},
      stats: { downloads: 9, installs: 3, stars: 2, versions: 1, comments: 0 },
      createdAt: 1,
      updatedAt: 2,
    },
    version: null,
    ownerHandle: null,
    owner: {
      _id: "publishers:owner" as Id<"publishers">,
      _creationTime: 1,
      kind: "org",
      handle: "calendar-org",
      displayName: "Calendar Org",
      bio: "Private to the full publisher profile",
      official: true,
    },
    semanticScore: 0,
  };
}

const externalDigest: ExternalSkillSearchDigest = {
  externalId: "acme/calendar tools/calendar",
  slug: "calendar",
  displayName: "Calendar",
  sourceHost: "skills.example.test",
  lastObservedAt: 3,
  sourceUrl: "https://skills.example.test/calendar",
  repo: "calendar tools",
  upstreamInstalls: 10,
  upstreamScanners: {
    genAgentTrustHub: { status: "unknown" },
    socket: { status: "unknown" },
    snyk: { status: "unknown" },
  },
  inferredCategories: ["source-only", "research"],
  featured: true,
};

describe("canonical skill result projection", () => {
  it("uses native publisher identity and omits the bio without changing the input", () => {
    const entry = nativeEntry();
    const result = buildNativeCanonicalResult(entry, "calendar");
    expect(result).toMatchObject({
      source: "clawhub",
      canonicalUrl: "/calendar-org/skills/calendar",
      install: { kind: "clawhub", reference: "calendar-org/calendar" },
      official: true,
      ownerHandle: "calendar-org",
      downloads: 9,
      version: null,
      metrics: { rolling60DayInstalls: 0, bookmarks: 0, updatedAt: 2 },
    });
    expect(result?.native?.skill).toBe(entry.skill);
    expect(result?.native?.owner).not.toHaveProperty("bio");
    expect(entry.owner).toHaveProperty("bio");
  });

  it.each([true, false])(
    "falls back to stored ownership when no handle exists (%s)",
    (publisher) => {
      const entry = nativeEntry();
      entry.owner = null;
      if (!publisher) entry.skill.ownerPublisherId = undefined;
      entry.skill.slug = "calendar space";
      entry.skill.installKind = "github";
      const result = buildNativeCanonicalResult(entry, "calendar space");
      expect(result?.canonicalUrl).toBe(
        publisher
          ? "/publishers%3Aowner/skills/calendar%20space"
          : "/users%3Aowner/skills/calendar%20space",
      );
      expect(result?.install).toEqual({
        kind: "github",
        reference: "calendar space",
        sourceUrl: null,
      });
      expect(result?.publisher).toBeNull();
    },
  );

  it("preserves external provenance, encoded routes, and unknown native metrics", () => {
    expect(buildExternalCanonicalResult(externalDigest, "calendar")).toMatchObject({
      source: "skills-sh",
      canonicalUrl: "/skills-sh/acme/calendar%20tools/calendar",
      categories: ["research"],
      featured: true,
      official: false,
      ownerHandle: "skills.example.test",
      native: null,
      install: {
        kind: "skills-sh",
        reference: "skills-sh:acme/calendar tools/calendar",
        sourceUrl: externalDigest.sourceUrl,
      },
      sourceIdentity: { owner: null, repo: "calendar tools", lifetimeInstalls: 10 },
      metrics: { rolling60DayInstalls: null, bookmarks: null, updatedAt: 3 },
    });
  });

  it("does not project candidates without query relevance", () => {
    expect(buildNativeCanonicalResult(nativeEntry(), "unrelated")).toBeNull();
    expect(buildExternalCanonicalResult(externalDigest, "unrelated")).toBeNull();
  });
});
