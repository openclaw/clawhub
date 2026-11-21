/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  getPackageReleaseArtifactSha256,
  packageArtifactSummary,
  toReleaseArtifact,
} from "./packageArtifacts";

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

describe("package artifact projections", () => {
  it("keeps npm fields identical for stored summaries and HTTP artifacts", () => {
    const release = {
      artifactKind: "npm-pack" as const,
      version: "1.0.0",
      clawpackSha256: "",
      sha256hash: "unrelated-zip-hash",
      clawpackSize: 0,
      npmUnpackedSize: 0,
      npmFileCount: 0,
    };
    const expected = {
      kind: "npm-pack",
      sha256: "",
      size: 0,
      format: "tgz",
      npmIntegrity: undefined,
      npmShasum: undefined,
      npmTarballName: undefined,
      npmUnpackedSize: 0,
      npmFileCount: 0,
    };

    expect(packageArtifactSummary(release)).toStrictEqual(expected);
    expect(toReleaseArtifact(release, "example")).toStrictEqual(expected);
    expect(Object.keys(toReleaseArtifact(release))).toEqual(Object.keys(expected));
  });

  it("keeps legacy HTTP metadata separate from the stored summary", () => {
    const release = {
      artifactKind: "legacy-zip" as const,
      version: "1.0.0",
      sha256hash: "",
      clawpackSha256: "unrelated-tarball-hash",
      clawpackSize: 0,
    };

    expect(packageArtifactSummary(release)).toStrictEqual({
      kind: "legacy-zip",
      sha256: "",
      format: "zip",
    });
    expect(toReleaseArtifact(release)).toStrictEqual({
      kind: "legacy-zip",
      size: 0,
      format: "zip",
      source: "clawhub",
      artifactKind: "legacy-zip",
      packageName: undefined,
      version: "1.0.0",
    });
    expect(packageArtifactSummary({})).toStrictEqual({
      kind: "legacy-zip",
      sha256: undefined,
      format: "zip",
    });
  });
});
