import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalogPresentationFixtures } from "./seed-catalog-presentation";
import { DEFAULT_PUBLIC_CORPUS_FIXTURE, parseCorpusJsonl } from "./validate";

describe("catalog presentation seed", () => {
  it("builds sixteen official org fixtures with featured skills and plugins", () => {
    const rows = parseCorpusJsonl(readFileSync(DEFAULT_PUBLIC_CORPUS_FIXTURE, "utf8"));
    const fixtures = buildCatalogPresentationFixtures(rows);

    expect(fixtures).toHaveLength(16);
    expect(new Set(fixtures.map((fixture) => fixture.sourceOwnerHandle)).size).toBe(16);
    expect(new Set(fixtures.map((fixture) => fixture.handle)).size).toBe(16);
    expect(fixtures.filter((fixture) => fixture.featured)).toHaveLength(8);
    expect(fixtures.every((fixture) => fixture.skillSlug && fixture.packageName)).toBe(true);
  });
});
