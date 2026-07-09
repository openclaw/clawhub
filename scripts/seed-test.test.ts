import { describe, expect, it } from "vitest";
import { buildSeedTestCommands, CLAWHUB_TEST_DEPLOYMENT, parseSeedTestArgs } from "./seed-test";

describe("seed:test", () => {
  it("defaults to the permanent ClawHub Test deployment", () => {
    expect(parseSeedTestArgs([])).toEqual({ deployment: CLAWHUB_TEST_DEPLOYMENT });
  });

  it("runs only the fixture overlay without the public corpus", () => {
    expect(buildSeedTestCommands(CLAWHUB_TEST_DEPLOYMENT)).toEqual([
      {
        command: "bunx",
        args: [
          "convex",
          "run",
          "--deployment",
          CLAWHUB_TEST_DEPLOYMENT,
          "--no-push",
          "devSeed:seedTestFixtures",
        ],
      },
      {
        command: "bunx",
        args: [
          "convex",
          "run",
          "--deployment",
          CLAWHUB_TEST_DEPLOYMENT,
          "--no-push",
          "statsMaintenance:updateGlobalStatsAction",
        ],
      },
    ]);
  });

  it("rejects every other deployment", () => {
    expect(() => buildSeedTestCommands("wry-manatee-359")).toThrow(
      `seed:test may only target ${CLAWHUB_TEST_DEPLOYMENT}`,
    );
  });
});
