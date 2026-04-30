import { describe, expect, it } from "vitest";
import {
  depRegistryUrl,
  mergeDepRegistryFinding,
  parseDependencyFile,
  summarizeDepRegistryChecks,
} from "./depRegistryScan";
import { summarizeReasonCodes, verdictFromCodes } from "./moderationReasonCodes";

describe("depRegistryScan", () => {
  it("parses registry dependency manifests and skips vendored or non-registry specs", () => {
    expect(
      parseDependencyFile(
        "package.json",
        JSON.stringify({
          dependencies: {
            "@types/node": "^24.0.0",
            local: "file:../local",
            remote: "github:owner/repo",
          },
          optionalDependencies: {
            undici: "^7.0.0",
          },
        }),
      ),
    ).toEqual([
      { name: "@types/node", registry: "npm", source: "package.json" },
      { name: "undici", registry: "npm", source: "package.json" },
    ]);

    expect(
      parseDependencyFile("vendor/package.json", '{"dependencies":{"phantom":"1.0.0"}}'),
    ).toEqual([]);
    expect(
      parseDependencyFile(
        "requirements.txt",
        ["requests>=2", "demo @ git+https://example.test/demo.git", "-r dev.txt"].join("\n"),
      ),
    ).toEqual([{ name: "requests", registry: "pypi", source: "requirements.txt" }]);
  });

  it("keeps npm scope names compatible with registry URL lookup", () => {
    expect(depRegistryUrl("npm", "@types/node")).toBe("https://registry.npmjs.org/@types%2Fnode");
  });

  it("does not produce clean status when registry lookups are unresolved", () => {
    const analysis = summarizeDepRegistryChecks({
      checkedAt: 123,
      results: [{ name: "requests", registry: "pypi", source: "requirements.txt", exists: true }],
      unresolved: [
        {
          name: "maybe-real",
          registry: "npm",
          source: "package.json",
          reason: "network error",
        },
      ],
    });

    expect(analysis.status).toBe("error");
    expect(analysis.notFoundPackages).toEqual([]);
    expect(analysis.unresolvedPackages).toEqual(["maybe-real (npm)"]);
  });

  it("injects a static finding only for confirmed missing packages", () => {
    const suspicious = summarizeDepRegistryChecks({
      checkedAt: 456,
      results: [
        {
          name: "phantom-package-xyz",
          registry: "npm",
          source: "package.json",
          exists: false,
          httpStatus: 404,
        },
      ],
      unresolved: [],
    });

    const merged = mergeDepRegistryFinding({
      staticScan: undefined,
      analysis: suspicious,
      statusFromCodes: verdictFromCodes,
      summarizeCodes: summarizeReasonCodes,
    });

    expect(merged.status).toBe("suspicious");
    expect(merged.reasonCodes).toEqual(["suspicious.dep_not_found_on_registry"]);
    expect(merged.findings[0]?.file).toBe("Dependency manifests");

    const cleanAgain = mergeDepRegistryFinding({
      staticScan: merged,
      analysis: summarizeDepRegistryChecks({ checkedAt: 789, results: [], unresolved: [] }),
      statusFromCodes: verdictFromCodes,
      summarizeCodes: summarizeReasonCodes,
    });
    expect(cleanAgain.status).toBe("clean");
    expect(cleanAgain.findings).toEqual([]);
  });
});
