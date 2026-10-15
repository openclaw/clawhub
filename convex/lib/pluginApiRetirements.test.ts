import { describe, expect, it } from "vitest";
import { collectPluginApiRetirements, pluginApiRetirement } from "./pluginApiRetirements";

const finding = {
  deprecated: true,
  deprecatedApi: " readAcpSessionEntry ",
  replacement: " readAcpSessionEntryAsync ",
  removeAfter: "2026-12-31",
  evidence: ["private/source.ts:12"],
};

describe("public API retirements", () => {
  it("deduplicates and projects only API, replacement and date", () => {
    expect(collectPluginApiRetirements([finding, finding])).toEqual([
      {
        deprecatedApi: "readAcpSessionEntry",
        replacement: "readAcpSessionEntryAsync",
        removeAfter: "2026-12-31",
      },
    ]);
  });

  it.each([
    { findingKind: "error" },
    { level: "error" },
    { level: "breakage" },
    { severity: "P0" },
    { deprecated: false },
    { replacement: " " },
    { removeAfter: "2026-02-30" },
    { removeAfter: "2026-13-01" },
    { removeAfter: "12/31/2026" },
    { removeAfter: undefined },
  ])("does not turn incompatible or incomplete findings into reassurance: %j", (overrides) => {
    expect(pluginApiRetirement({ ...finding, ...overrides })).toBeNull();
  });

  it("accepts the inspector deprecation class and orders different deadlines", () => {
    const earlier = {
      ...finding,
      deprecated: undefined,
      issueClass: "deprecation-warning",
      removeAfter: "2026-11-30",
    };
    expect(collectPluginApiRetirements([finding, earlier]).map((item) => item.removeAfter)).toEqual(
      ["2026-11-30", "2026-12-31"],
    );
  });
});
