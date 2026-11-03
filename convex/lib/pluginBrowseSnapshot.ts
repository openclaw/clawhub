import { isPluginCategorySlug } from "clawhub-schema/pluginCategories";

// Only the first, unfiltered 25-card page shares the default browse snapshot.
// Curated categories already have their own public snapshot policy.
export function getPluginBrowseSnapshotKind(url: URL): "default" | "category" | null {
  if (url.pathname !== "/api/v1/plugins") return null;
  const allowed = new Set(["limit", "sort", "category", "curated"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  }
  if ((url.searchParams.get("limit") ?? "25") !== "25") return null;
  const category = url.searchParams.get("category");
  if (category) {
    return category !== "other" &&
      isPluginCategorySlug(category) &&
      url.searchParams.get("curated") === "true" &&
      (url.searchParams.get("sort") ?? "downloads") === "downloads"
      ? "category"
      : null;
  }
  return !url.searchParams.has("category") &&
    !url.searchParams.has("curated") &&
    (url.searchParams.get("sort") ?? "recommended") === "recommended"
    ? "default"
    : null;
}
