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

  it("uses a deployment-scoped CI key without combining auth target formats", () => {
    expect(
      buildSeedTestCommands(
        CLAWHUB_TEST_DEPLOYMENT,
        `prod:${CLAWHUB_TEST_DEPLOYMENT}|deployment-key`,
      ),
    ).toEqual([
      {
        command: "bunx",
        args: ["convex", "run", "--no-push", "devSeed:seedTestFixtures"],
      },
      {
        command: "bunx",
        args: ["convex", "run", "--no-push", "statsMaintenance:updateGlobalStatsAction"],
      },
    ]);
  });

  it("rejects a deploy key for any other deployment", () => {
    expect(() =>
      buildSeedTestCommands(CLAWHUB_TEST_DEPLOYMENT, "prod:wry-manatee-359|deployment-key"),
    ).toThrow(`seed:test deploy key must target ${CLAWHUB_TEST_DEPLOYMENT}`);
  });

  it("rejects every other deployment", () => {
    expect(() => buildSeedTestCommands("wry-manatee-359")).toThrow(
      `seed:test may only target ${CLAWHUB_TEST_DEPLOYMENT}`,
    );
  });
});
