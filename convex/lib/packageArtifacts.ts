import type { PackageArtifactSummary } from "clawhub-schema";
import type { Doc } from "../_generated/dataModel";

type PackageReleaseArtifactFields = Pick<
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
  release: Pick<PackageReleaseArtifactFields, "artifactKind" | "clawpackSha256" | "sha256hash">,
): string | null {
  if (release.artifactKind === "npm-pack") {
    return release.clawpackSha256 ?? null;
  }
  return release.sha256hash ?? null;
}

function npmArtifactSummary(
  release: Omit<PackageReleaseArtifactFields, "artifactKind" | "clawpackSha256" | "sha256hash">,
  sha256: string | undefined,
) {
  return {
    kind: "npm-pack" as const,
    sha256,
    size: release.clawpackSize,
    format: release.clawpackFormat ?? "tgz",
    npmIntegrity: release.npmIntegrity,
    npmShasum: release.npmShasum,
    npmTarballName: release.npmTarballName,
    npmUnpackedSize: release.npmUnpackedSize,
    npmFileCount: release.npmFileCount,
  };
}

export function packageArtifactSummary(
  release: PackageReleaseArtifactFields,
): PackageArtifactSummary {
  if (release.artifactKind === "npm-pack") {
    return npmArtifactSummary(release, getPackageReleaseArtifactSha256(release) ?? undefined);
  }
  return {
    kind: "legacy-zip",
    sha256: getPackageReleaseArtifactSha256(release) ?? undefined,
    format: "zip",
  };
}

export function toReleaseArtifact(
  release: PackageReleaseArtifactFields & { version: string },
  packageName?: string,
) {
  if (release.artifactKind === "npm-pack") {
    return npmArtifactSummary(release, release.clawpackSha256);
  }
  const sha256 = release.sha256hash;
  return {
    kind: "legacy-zip" as const,
    ...(sha256 ? { sha256 } : {}),
    ...(release.clawpackSize !== undefined ? { size: release.clawpackSize } : {}),
    format: "zip",
    source: "clawhub" as const,
    artifactKind: "legacy-zip" as const,
    ...(sha256 ? { artifactSha256: sha256 } : {}),
    packageName,
    version: release.version,
  };
}
