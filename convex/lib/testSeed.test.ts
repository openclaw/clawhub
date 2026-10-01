import { describe, expect, it } from "vitest";
import { assertTestSeedAllowed } from "./testSeed";

describe("assertTestSeedAllowed", () => {
  it("allows the permanent test deployment", () => {
    expect(() =>
      assertTestSeedAllowed({
        CLAWHUB_ENV: "test",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
      }),
    ).not.toThrow();
  });

  it("rejects production even if its environment marker is wrong", () => {
    expect(() =>
      assertTestSeedAllowed({
        CLAWHUB_ENV: "test",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_DEPLOYMENT_NAME: "wry-manatee-359",
      }),
    ).toThrow("CLAWHUB_DEPLOYMENT_NAME=academic-chihuahua-392");
  });

  it("rejects missing test safety markers", () => {
    expect(() =>
      assertTestSeedAllowed({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
      }),
    ).toThrow("CLAWHUB_ENV=test");

    expect(() =>
      assertTestSeedAllowed({
        CLAWHUB_ENV: "test",
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
      }),
    ).toThrow("CLAWHUB_DISABLE_CRONS=1");

    expect(() =>
      assertTestSeedAllowed({
        CLAWHUB_ENV: "test",
        CLAWHUB_DISABLE_CRONS: "1",
      }),
    ).toThrow("CLAWHUB_DEPLOYMENT_NAME=academic-chihuahua-392");
  });
});
