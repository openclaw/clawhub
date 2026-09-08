export const PLUGIN_SEARCH_SOURCES = ["clawhub-web", "openclaw-control-ui"] as const;

export type PluginSearchSource = (typeof PLUGIN_SEARCH_SOURCES)[number];

type PluginSearchResult = {
  package: {
    isOfficial: boolean;
  };
};

export function parsePluginSearchSource(value: string | null): PluginSearchSource | undefined {
  return PLUGIN_SEARCH_SOURCES.find((source) => source === value);
}

export function normalizePluginSearchQuery(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function isBoundedPluginSearchText(query: string, category?: string, topic?: string) {
  return (
    query.length > 0 &&
    query.length <= 256 &&
    (category?.length ?? 0) <= 120 &&
    (topic?.length ?? 0) <= 120
  );
}

export function buildPluginSearchObservation(params: {
  source: PluginSearchSource | undefined;
  query: string;
  category?: string;
  topic?: string;
  results: PluginSearchResult[];
}) {
  if (!params.source) return null;
  const normalizedQuery = normalizePluginSearchQuery(params.query);
  if (!isBoundedPluginSearchText(normalizedQuery, params.category, params.topic)) return null;
  return {
    source: params.source,
    artifactKind: "plugin" as const,
    normalizedQuery,
    category: params.category,
    topic: params.topic,
    resultCount: params.results.length,
    officialResultCount: params.results.filter((entry) => entry.package.isOfficial === true).length,
  };
}
