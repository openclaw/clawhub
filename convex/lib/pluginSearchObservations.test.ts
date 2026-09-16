import { describe, expect, it } from "vitest";
import {
  buildCatalogSearchObservation,
  normalizeCatalogSearchQuery,
  parseCatalogSearchSource,
} from "./catalogSearchObservations";

describe("plugin search observation contract", () => {
  it("accepts only the closed source enum", () => {
    expect(parseCatalogSearchSource("clawhub-web")).toBe("clawhub-web");
    expect(parseCatalogSearchSource("openclaw-control-ui")).toBe("openclaw-control-ui");
    expect(parseCatalogSearchSource("crawler")).toBeUndefined();
    expect(parseCatalogSearchSource(null)).toBeUndefined();
  });

  it("normalizes only casing and whitespace", () => {
    expect(normalizeCatalogSearchQuery("  Weather\t API  ")).toBe("weather api");
    expect(normalizeCatalogSearchQuery("weather-api")).toBe("weather-api");
  });

  it("derives exact visible and official counts without identity metadata", () => {
    expect(
      buildCatalogSearchObservation({
        source: "clawhub-web",
        artifactKind: "plugin",
        filtered: true,
        query: "  Weather  API ",
        category: "tools",
        topic: "automation",
        officialResults: [true, false, false],
      }),
    ).toEqual({
      source: "clawhub-web",
      artifactKind: "plugin",
      scope: "shelf",
      normalizedQuery: "weather api",
      category: "tools",
      topic: "automation",
      resultCount: 3,
      officialResultCount: 1,
    });
  });

  it("builds no observation for unmarked traffic", () => {
    expect(
      buildCatalogSearchObservation({
        source: undefined,
        artifactKind: "plugin",
        filtered: false,
        query: "weather",
        officialResults: [false],
      }),
    ).toBeNull();
  });
});
