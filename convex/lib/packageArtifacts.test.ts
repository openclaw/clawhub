import { describe, expect, it } from "vitest";
import { getPackageReleaseArtifactSha256 } from "./packageArtifacts";

describe("getPackageReleaseArtifactSha256", () => {
  it("uses the exact npm-pack artifact hash instead of the legacy ZIP hash", () => {
    expect(
      getPackageReleaseArtifactSha256({
        artifactKind: "npm-pack",
        clawpackSha256: "tgz-sha",
        sha256hash: "legacy-zip-sha",
      }),
    ).toBe("tgz-sha");
  });

  it("does not fall back to the legacy ZIP hash for npm-pack releases", () => {
    expect(
      getPackageReleaseArtifactSha256({
        artifactKind: "npm-pack",
        sha256hash: "legacy-zip-sha",
      }),
    ).toBeNull();
  });

  it("uses the ZIP hash for legacy releases", () => {
    expect(
      getPackageReleaseArtifactSha256({
        artifactKind: "legacy-zip",
        sha256hash: "legacy-zip-sha",
      }),
    ).toBe("legacy-zip-sha");
  });
});
