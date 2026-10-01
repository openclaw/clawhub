import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

const SEARCH_SOURCES = ["clawhub-web", "openclaw-control-ui"] as const;
type SearchSource = (typeof SEARCH_SOURCES)[number];
export type CatalogArtifactKind = "plugin" | "skill";
export type CatalogSearchScope = "catalog" | "shelf";

export function parseCatalogSearchSource(value: string | null): SearchSource | undefined {
  return SEARCH_SOURCES.find((source) => source === value);
}

export function normalizeCatalogSearchQuery(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function isBoundedCatalogSearchText(query: string, category?: string, topic?: string) {
  return (
    query.length > 0 &&
    query.length <= 256 &&
    (category?.length ?? 0) <= 120 &&
    (topic?.length ?? 0) <= 120
  );
}

type SearchFacts = {
  artifactKind: CatalogArtifactKind;
  query: string;
  category?: string;
  topic?: string;
  filtered: boolean;
  officialResults: readonly boolean[];
};

export function buildCatalogSearchObservation(
  params: SearchFacts & { source: SearchSource | undefined },
) {
  if (!params.source) return null;
  const normalizedQuery = normalizeCatalogSearchQuery(params.query);
  if (!isBoundedCatalogSearchText(normalizedQuery, params.category, params.topic)) return null;
  return {
    source: params.source,
    artifactKind: params.artifactKind,
    scope: params.filtered ? ("shelf" as const) : ("catalog" as const),
    normalizedQuery,
    category: params.category,
    topic: params.topic,
    resultCount: params.officialResults.length,
    officialResultCount: params.officialResults.filter((official) => official === true).length,
  };
}

export async function recordCatalogSearchObservation(
  ctx: ActionCtx,
  request: Request,
  facts: SearchFacts,
) {
  if (request.signal.aborted) return;
  const source = parseCatalogSearchSource(new URL(request.url).searchParams.get("searchSource"));
  await recordCatalogSearchFacts(ctx, { ...facts, source });
}

export async function recordCatalogSearchFacts(
  ctx: ActionCtx,
  facts: SearchFacts & { source: SearchSource | undefined },
) {
  const observation = buildCatalogSearchObservation(facts);
  if (!observation) return;
  try {
    await ctx.runMutation(internal.pluginSearchObservations.recordInternal, observation);
  } catch {
    // Analytics failure must neither fail search nor disclose a raw query in logs.
    console.error("[catalog-search-observations] failed to record marked search", {
      source: facts.source,
    });
  }
}
