import type { Doc, Id } from "../_generated/dataModel";

/** A parent row inserted for a staged first publish, before any release is public. */
export function hasNoPublishedPackageVersions(
  pkg: Pick<Doc<"packages">, "latestReleaseId" | "latestVersionSummary" | "stats">,
) {
  return !pkg.latestReleaseId && !pkg.latestVersionSummary && (pkg.stats?.versions ?? 0) <= 0;
}

/** Publication eligibility shared by public readers and latest-pointer writers. */
export function isPublishedPackageRelease(
  release: Doc<"packageReleases"> | null | undefined,
  packageId?: Id<"packages">,
): release is Doc<"packageReleases"> {
  return Boolean(
    release &&
    release.softDeletedAt === undefined &&
    release.ownerDeletedAt === undefined &&
    (packageId === undefined || release.packageId === packageId) &&
    (release.publicationStatus === undefined || release.publicationStatus === "published"),
  );
}
