import { publicApiUrl } from "./publicApiUrl";
import type { CanonicalSkillSearchResult } from "./skillsShCatalog";

export async function fetchSkillSearch(params: {
  query: string;
  limit: number;
  highlightedOnly?: boolean;
  categorySlug?: string;
  topic?: string;
  searchSource?: "clawhub-web";
  signal?: AbortSignal;
}): Promise<CanonicalSkillSearchResult[]> {
  const url = publicApiUrl("/api/v1/search");
  url.searchParams.set("q", params.query);
  url.searchParams.set("limit", String(params.limit));
  if (params.highlightedOnly) url.searchParams.set("highlightedOnly", "true");
  if (params.categorySlug) url.searchParams.set("category", params.categorySlug);
  if (params.topic) url.searchParams.set("topic", params.topic);
  if (params.searchSource) url.searchParams.set("searchSource", params.searchSource);
  const response = await fetch(url.toString(), { signal: params.signal });
  if (!response.ok) throw new Error(`Skill search failed (${response.status})`);
  return ((await response.json()) as { results: CanonicalSkillSearchResult[] }).results;
}
