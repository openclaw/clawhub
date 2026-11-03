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
