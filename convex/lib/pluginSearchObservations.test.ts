import { describe, expect, it } from "vitest";
import {
  buildPluginSearchObservation,
  normalizePluginSearchQuery,
  parsePluginSearchSource,
} from "./pluginSearchObservations";

describe("plugin search observation contract", () => {
  it("accepts only the closed source enum", () => {
    expect(parsePluginSearchSource("clawhub-web")).toBe("clawhub-web");
    expect(parsePluginSearchSource("openclaw-control-ui")).toBe("openclaw-control-ui");
    expect(parsePluginSearchSource("crawler")).toBeUndefined();
    expect(parsePluginSearchSource(null)).toBeUndefined();
  });

  it("normalizes only casing and whitespace", () => {
    expect(normalizePluginSearchQuery("  Weather\t API  ")).toBe("weather api");
    expect(normalizePluginSearchQuery("weather-api")).toBe("weather-api");
  });

  it("derives exact visible and official counts without identity metadata", () => {
    expect(
      buildPluginSearchObservation({
        source: "clawhub-web",
        query: "  Weather  API ",
        category: "tools",
        topic: "automation",
        results: [
          { package: { isOfficial: true } },
          { package: { isOfficial: false } },
          { package: { isOfficial: false } },
        ],
      }),
    ).toEqual({
      source: "clawhub-web",
      artifactKind: "plugin",
      normalizedQuery: "weather api",
      category: "tools",
      topic: "automation",
      resultCount: 3,
      officialResultCount: 1,
    });
  });

  it("builds no observation for unmarked traffic", () => {
    expect(
      buildPluginSearchObservation({
        source: undefined,
        query: "weather",
        results: [{ package: { isOfficial: false } }],
      }),
    ).toBeNull();
  });
});
