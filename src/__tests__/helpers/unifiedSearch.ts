import type { CanonicalSkillSearchResult } from "../../lib/skillsShCatalog";

export function createEmptySearchResult() {
  return {
    results: [],
    skillResults: [],
    pluginResults: [],
    creatorResults: [],
    skillCount: 0,
    pluginCount: 0,
    creatorCount: 0,
    skillHasMore: false,
    pluginHasMore: false,
    creatorHasMore: false,
    isSearching: false,
  };
}

export function makeCanonicalExternalSearchResult(updatedAt = 1): CanonicalSkillSearchResult {
  return {
    id: "skills-sh:patrick-erichsen/skills/html",
    source: "skills-sh",
    slug: "html",
    displayName: "HTML Artifact Chooser",
    summary: "Build self-contained HTML artifacts.",
    score: 5000,
    canonicalUrl: "/skills-sh/patrick-erichsen/skills/html",
    install: {
      kind: "skills-sh",
      reference: "skills-sh:patrick-erichsen/skills/html",
      sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
    },
    sourceIdentity: {
      id: "patrick-erichsen/skills/html",
      owner: "patrick-erichsen",
      repo: "skills",
      host: null,
      lifetimeInstalls: 12500,
    },
    metrics: { updatedAt },
    native: null,
  };
}
