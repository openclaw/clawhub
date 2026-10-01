import type { Doc, Id } from "../_generated/dataModel";

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
