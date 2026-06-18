import { resolvePluginCategories, type PluginCategorySlug } from "./catalogMetadata.js";

export {
  isPluginCategorySlug,
  PLUGIN_CATEGORY_DEFINITIONS,
  PLUGIN_CATEGORY_SLUGS,
  type PluginCategorySlug,
} from "./catalogMetadata.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasValues(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasProperties(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

export function inferPluginCategoriesFromManifest(manifest: unknown): PluginCategorySlug[] {
  if (!isRecord(manifest)) return [];

  const categories: PluginCategorySlug[] = [];
  const add = (category: PluginCategorySlug) => {
    if (!categories.includes(category)) categories.push(category);
  };
  const kinds = Array.isArray(manifest.kind) ? manifest.kind : [manifest.kind];
  const contracts = isRecord(manifest.contracts) ? manifest.contracts : {};

  if (hasValues(manifest.channels)) add("channels");
  if (hasValues(manifest.providers) || hasValues(manifest.cliBackends)) add("models");
  if (kinds.includes("memory") || hasValues(contracts.embeddingProviders)) add("memory");
  if (kinds.includes("context-engine") || hasValues(contracts.memoryEmbeddingProviders)) {
    add("context");
  }
  if (
    hasValues(contracts.speechProviders) ||
    hasValues(contracts.realtimeTranscriptionProviders) ||
    hasValues(contracts.realtimeVoiceProviders) ||
    hasValues(contracts.transcriptSourceProviders)
  ) {
    add("voice");
  }
  if (
    hasValues(contracts.mediaUnderstandingProviders) ||
    hasValues(contracts.imageGenerationProviders) ||
    hasValues(contracts.musicGenerationProviders) ||
    hasValues(contracts.videoGenerationProviders)
  ) {
    add("media");
  }
  if (hasValues(contracts.webFetchProviders) || hasValues(contracts.webSearchProviders)) {
    add("web");
  }
  if (hasValues(contracts.tools) || hasValues(manifest.commandAliases)) add("tools");
  if (
    hasValues(contracts.embeddedExtensionFactories) ||
    hasValues(contracts.agentToolResultMiddleware)
  ) {
    add("runtime");
  }
  if (hasValues(contracts.gatewayMethodDispatch)) add("gateway");
  if (
    hasValues(contracts.externalAuthProviders) ||
    hasProperties(manifest.secretProviderIntegrations)
  ) {
    add("security");
  }

  return categories.slice(0, 3);
}

export function derivePluginCategoryTags(input: {
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
}): PluginCategorySlug[] {
  if (input.family === "skill") return [];
  return resolvePluginCategories({
    declared: input.categories,
    inferred: input.inferredCategories ?? inferPluginCategoriesFromManifest(input.pluginManifest),
  });
}

export function resolveStoredPluginCategories(
  input: Parameters<typeof derivePluginCategoryTags>[0],
): PluginCategorySlug[] {
  if (input.family === "skill") return [];
  try {
    const inferenceCurrent =
      Boolean(input.latestReleaseId) && input.latestReleaseId === input.inferredFromReleaseId;
    return resolvePluginCategories({
      declared: input.categories,
      inferred: inferenceCurrent ? input.inferredCategories : undefined,
    });
  } catch {
    return resolvePluginCategories({});
  }
}
