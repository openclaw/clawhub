import { describe, expect, it } from "vitest";
import { assertSeedTargetAllowed, buildSeedSteps, parseSeedArgs } from "./seed";

describe("shared seed runner", () => {
  it("uses the local deployment selected by the environment by default", () => {
    expect(buildSeedSteps(parseSeedArgs([]))).toEqual([
      {
        command: "bunx",
        args: ["convex", "run", "--no-push", "devSeed:seedLocalFixtures"],
      },
      {
        command: "bun",
        args: ["scripts/public-corpus/seed-public-corpus.ts"],
      },
      {
        command: "bun",
        args: ["scripts/public-corpus/seed-catalog-presentation.ts"],
      },
      {
        command: "bunx",
        args: ["convex", "run", "--no-push", "statsMaintenance:updateGlobalStatsAction"],
      },
    ]);
  });

  it("targets every seed step at the same named preview deployment", () => {
    expect(buildSeedSteps(parseSeedArgs(["--preview-name", "feature/demo"]))).toEqual([
      {
        command: "bunx",
        args: ["convex", "run", "--preview-name", "feature/demo", "devSeed:seedLocalFixtures"],
      },
      {
        command: "bun",
        args: ["scripts/public-corpus/seed-public-corpus.ts", "--preview-name", "feature/demo"],
      },
      {
        command: "bun",
        args: [
          "scripts/public-corpus/seed-catalog-presentation.ts",
          "--preview-name",
          "feature/demo",
        ],
      },
      {
        command: "bunx",
        args: [
          "convex",
          "run",
          "--preview-name",
          "feature/demo",
          "statsMaintenance:updateGlobalStatsAction",
        ],
      },
    ]);
  });

  it("allows only local or explicitly keyed preview targets", () => {
    expect(() =>
      assertSeedTargetAllowed(parseSeedArgs([]), {
        CONVEX_DEPLOYMENT: "local:local-amantus-clawdhub",
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedTargetAllowed(parseSeedArgs(["--preview-name", "feature/demo"]), {
        CONVEX_DEPLOY_KEY: "preview:openclaw:clawhub|secret",
      }),
    ).not.toThrow();

    expect(() =>
      assertSeedTargetAllowed(parseSeedArgs(["--preview-name", "feature/demo"]), {
        CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|secret",
      }),
    ).toThrow("requires a Convex Preview deploy key");
  });
});
