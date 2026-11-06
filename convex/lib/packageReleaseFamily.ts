import semver from "semver";
import type { Doc } from "../_generated/dataModel";

/** A plugin release's admitted family survives a guarded parent-family repair. */
export function resolvePackageReleaseFamily(
  family: Doc<"packages">["family"],
  release: Pick<Doc<"packageReleases">, "pluginFamily"> | null | undefined,
): Doc<"packages">["family"] {
  // Plugin-only metadata must never select the less restrictive plugin projection
  // for a Template or skill package. Legacy rows retain their existing parent fallback.
  if (family === "code-plugin" || family === "bundle-plugin") {
    return release?.pluginFamily ?? family;
  }
  return family;
}

type ComparablePackageRelease = Pick<Doc<"packageReleases">, "_id" | "createdAt" | "version">;

export function comparePackageReleaseOrder(
  family: Doc<"packages">["family"],
  a: ComparablePackageRelease,
  b: ComparablePackageRelease,
) {
  if (family === "bundle-plugin") {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a._id.localeCompare(b._id);
  }
  const aSemver = semver.valid(a.version);
  const bSemver = semver.valid(b.version);
  if (aSemver && bSemver) return semver.compare(aSemver, bSemver);
  if (aSemver) return 1;
  if (bSemver) return -1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a._id.localeCompare(b._id);
}
