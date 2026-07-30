import type { PackageArtifactSummary } from "clawhub-schema";
import type { Doc } from "../_generated/dataModel";

type PackageReleaseArtifactHashFields = Pick<
  Doc<"packageReleases">,
  "artifactKind" | "clawpackSha256" | "sha256hash"
>;

type PackageReleaseArtifactSummaryFields = Pick<
  Doc<"packageReleases">,
  | "artifactKind"
  | "clawpackSha256"
  | "sha256hash"
  | "clawpackSize"
  | "clawpackFormat"
  | "npmIntegrity"
  | "npmShasum"
  | "npmTarballName"
  | "npmUnpackedSize"
  | "npmFileCount"
>;

export function getPackageReleaseArtifactSha256(
  release: PackageReleaseArtifactHashFields,
): string | null {
  if (release.artifactKind === "npm-pack") {
    return release.clawpackSha256 ?? null;
  }
  return release.sha256hash ?? null;
}

export function summarizePackageReleaseArtifact(
  release: PackageReleaseArtifactSummaryFields,
): PackageArtifactSummary {
  if (release.artifactKind === "npm-pack") {
    return {
      kind: "npm-pack",
      sha256: getPackageReleaseArtifactSha256(release) ?? undefined,
      size: release.clawpackSize,
      format: release.clawpackFormat ?? "tgz",
      npmIntegrity: release.npmIntegrity,
      npmShasum: release.npmShasum,
      npmTarballName: release.npmTarballName,
      npmUnpackedSize: release.npmUnpackedSize,
      npmFileCount: release.npmFileCount,
    };
  }
  return {
    kind: "legacy-zip",
    sha256: getPackageReleaseArtifactSha256(release) ?? undefined,
    format: "zip",
  };
}
