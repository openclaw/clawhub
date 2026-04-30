import { fetchPluginCatalog } from "./packageApi";

export async function fetchFeaturedPlugins(limit: number = 50) {
  const result = await fetchPluginCatalog({ featured: true, limit });
  return result.items;
}
