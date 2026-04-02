import { describe, expect, it } from "vitest";
import { getDeploymentDriftInfo } from "./deploymentDrift";

describe("getDeploymentDriftInfo", () => {
  it("reports no mismatch when either side is missing", () => {
    expect(
      getDeploymentDriftInfo({
        expectedBuildSha: "abc123",
        actualBuildSha: null,
      }),
    ).toEqual({
      expectedBuildSha: "abc123",
      actualBuildSha: null,
      hasMismatch: false,
    });
  });

  it("reports no mismatch when SHAs match", () => {
    expect(
      getDeploymentDriftInfo({
        expectedBuildSha: "abc123",
        actualBuildSha: "abc123",
      }),
    ).toEqual({
      expectedBuildSha: "abc123",
      actualBuildSha: "abc123",
      hasMismatch: false,
    });
  });

  it("reports mismatch when SHAs differ", () => {
    expect(
      getDeploymentDriftInfo({
        expectedBuildSha: "abc123",
        actualBuildSha: "def456",
      }),
    ).toEqual({
      expectedBuildSha: "abc123",
      actualBuildSha: "def456",
      hasMismatch: true,
    });
  });
});
