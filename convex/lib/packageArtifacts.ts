import type { Doc } from "../_generated/dataModel";

type PackageReleaseArtifactHashFields = Pick<
  Doc<"packageReleases">,
  "artifactKind" | "clawpackSha256" | "sha256hash"
>;

export function getPackageReleaseArtifactSha256(
  release: PackageReleaseArtifactHashFields,
): string | null {
  if (release.artifactKind === "npm-pack") {
    return release.clawpackSha256 ?? null;
  }
  return release.sha256hash ?? null;
}
