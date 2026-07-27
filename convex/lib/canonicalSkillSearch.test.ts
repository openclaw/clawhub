import { describe, expect, it } from "vitest";
import {
  classifyCanonicalSkillSearchMatch,
  compareCanonicalSkillSearchCandidates,
  type CanonicalSkillSearchCandidate,
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

  it("uses official and featured only after lexical relevance is tied", () => {
    const betterLexical = candidate("clawhub:better", {
      relevance: { tier: 1, lexicalScore: 96, semanticScore: 0 },
    });
    const official = candidate("clawhub:official", {
      relevance: { tier: 1, lexicalScore: 95, semanticScore: 0 },
      official: true,
      featured: true,
    });
    const tiedCommunity = candidate("clawhub:community", {
      relevance: { tier: 1, lexicalScore: 95, semanticScore: 0 },
    });

    expect(
      [official, betterLexical, tiedCommunity]
        .sort(compareCanonicalSkillSearchCandidates)
        .map((row) => row.id),
    ).toEqual(["clawhub:better", "clawhub:official", "clawhub:community"]);
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
