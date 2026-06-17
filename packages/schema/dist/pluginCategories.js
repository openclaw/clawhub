import { resolvePluginCategories } from "./catalogMetadata.js";
export { isPluginCategorySlug, PLUGIN_CATEGORY_DEFINITIONS, PLUGIN_CATEGORY_SLUGS, } from "./catalogMetadata.js";
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function hasValues(value) {
    return Array.isArray(value) && value.length > 0;
}
export function inferPluginCategoriesFromManifest(manifest) {
    if (!isRecord(manifest))
        return [];
    const categories = [];
    const add = (category) => {
        if (!categories.includes(category))
            categories.push(category);
    };
    const kinds = Array.isArray(manifest.kind) ? manifest.kind : [manifest.kind];
    const contracts = isRecord(manifest.contracts) ? manifest.contracts : {};
    if (hasValues(manifest.channels))
        add("channels");
    if (hasValues(manifest.providers) || hasValues(manifest.cliBackends))
        add("models");
    if (kinds.includes("memory") || hasValues(contracts.embeddingProviders))
        add("memory");
    if (kinds.includes("context-engine") || hasValues(contracts.memoryEmbeddingProviders)) {
        add("context");
    }
    if (hasValues(contracts.speechProviders) ||
        hasValues(contracts.realtimeTranscriptionProviders) ||
        hasValues(contracts.realtimeVoiceProviders) ||
        hasValues(contracts.transcriptSourceProviders)) {
        add("voice");
    }
    if (hasValues(contracts.mediaUnderstandingProviders) ||
        hasValues(contracts.imageGenerationProviders) ||
        hasValues(contracts.musicGenerationProviders) ||
        hasValues(contracts.videoGenerationProviders)) {
        add("media");
    }
    if (hasValues(contracts.webFetchProviders) || hasValues(contracts.webSearchProviders)) {
        add("web");
    }
    if (hasValues(contracts.tools) || hasValues(manifest.commandAliases))
        add("tools");
    if (hasValues(contracts.embeddedExtensionFactories) ||
        hasValues(contracts.agentToolResultMiddleware)) {
        add("runtime");
    }
    if (hasValues(contracts.gatewayMethodDispatch))
        add("gateway");
    if (hasValues(contracts.externalAuthProviders) || isRecord(manifest.secretProviderIntegrations)) {
        add("security");
    }
    return categories.slice(0, 3);
}
export function derivePluginCategoryTags(input) {
    if (input.family === "skill")
        return [];
    return resolvePluginCategories({
        declared: input.categories,
        inferred: input.inferredCategories ?? inferPluginCategoriesFromManifest(input.pluginManifest),
    });
}
export function resolveStoredPluginCategories(input) {
    return derivePluginCategoryTags(input);
}
//# sourceMappingURL=pluginCategories.js.map