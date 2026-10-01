import { describe, expect, it } from "vitest";
import { toSkillsShSearchResult, type CanonicalSkillSearchResult } from "./skillsShCatalog";

describe("toSkillsShSearchResult", () => {
  it("maps the canonical external result without changing its order metadata", () => {
    expect(toSkillsShSearchResult(makeCanonicalExternalResult())).toEqual({
      source: "skills.sh",
      externalId: "patrick-erichsen/skills/html",
      route: "/skills-sh/patrick-erichsen/skills/html",
      reference: "skills-sh:patrick-erichsen/skills/html",
      owner: "patrick-erichsen",
      repo: "skills",
      sourceHost: undefined,
      slug: "html",
      displayName: "HTML Artifact Chooser",
      summary: "Build self-contained HTML artifacts.",
      upstreamInstalls: 12500,
      lastObservedAt: 123,
    });
  });

  it("fails closed on a noncanonical external install reference", () => {
    const result = makeCanonicalExternalResult();
    result.install.reference = "skills-sh/patrick-erichsen/skills/html";

    expect(toSkillsShSearchResult(result)).toBeNull();
  });
});

function makeCanonicalExternalResult(): CanonicalSkillSearchResult {
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
    metrics: { updatedAt: 123 },
    native: null,
  };
}
