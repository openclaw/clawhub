import { type PluginCategorySlug } from "./catalogMetadata.js";
export { isPluginCategorySlug, PLUGIN_CATEGORY_DEFINITIONS, PLUGIN_CATEGORY_SLUGS, type PluginCategorySlug, } from "./catalogMetadata.js";
export declare function inferPluginCategoriesFromManifest(manifest: unknown): PluginCategorySlug[];
export declare function derivePluginCategoryTags(input: {
    family?: string;
    categories?: readonly string[] | null;
    inferredCategories?: readonly string[] | null;
    pluginManifest?: unknown;
    name?: string;
    displayName?: string;
    runtimeId?: string;
    summary?: string;
    latestReleaseId?: string | null;
    inferredFromReleaseId?: string | null;
}): PluginCategorySlug[];
export declare function resolveStoredPluginCategories(input: Parameters<typeof derivePluginCategoryTags>[0]): PluginCategorySlug[];
