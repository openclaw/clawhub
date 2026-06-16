import { normalizeCatalogTopic } from "clawhub-schema";

export function parseCatalogTopicFilter(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return normalizeCatalogTopic(trimmed) ?? trimmed;
}
