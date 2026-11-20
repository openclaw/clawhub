import { describe, expect, it } from "vitest";
import { makeCanonicalExternalSearchResult } from "../__tests__/helpers/unifiedSearch";
import { toSkillsShSearchResult } from "./skillsShCatalog";

describe("toSkillsShSearchResult", () => {
  it("maps the canonical external result without changing its order metadata", () => {
    expect(toSkillsShSearchResult(makeCanonicalExternalSearchResult(123))).toEqual({
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
    const result = makeCanonicalExternalSearchResult(123);
    result.install.reference = "skills-sh/patrick-erichsen/skills/html";

    expect(toSkillsShSearchResult(result)).toBeNull();
  });
});
