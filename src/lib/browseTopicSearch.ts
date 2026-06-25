import { normalizeCatalogTopic } from "clawhub-schema";

function parseTopicSlug(value: string | undefined) {
  if (!value) return undefined;
  return normalizeCatalogTopic(value) ?? undefined;
}

function parseTopicFromSearchParams(params: URLSearchParams) {
  const direct = parseTopicSlug(params.get("topic") ?? undefined);
  if (direct) return direct;

  for (const [key, value] of params.entries()) {
    if (key.startsWith("topic=")) {
      const embedded = parseTopicSlug(key.slice("topic=".length) || value);
      if (embedded) return embedded;
    }
  }

  return undefined;
}

export function parseBrowseTopicFromSearchInput(
  search: Record<string, unknown> | string | undefined,
) {
  if (search == null) return undefined;

  if (typeof search === "string") {
    const normalized = search.startsWith("?") ? search.slice(1) : search;
    return parseTopicFromSearchParams(new URLSearchParams(normalized));
  }

  const direct = parseTopicSlug(typeof search.topic === "string" ? search.topic : undefined);
  if (direct) return direct;

  for (const [key, value] of Object.entries(search)) {
    if (key === "topic" && typeof value === "string") {
      const topic = parseTopicSlug(value);
      if (topic) return topic;
    }
    if (key.startsWith("topic=")) {
      const embedded = parseTopicSlug(
        key.slice("topic=".length) || (typeof value === "string" ? value : undefined),
      );
      if (embedded) return embedded;
    }
  }

  return undefined;
}

export function parseBrowseTopicFromSearchString(searchStr: string | undefined) {
  if (!searchStr) return undefined;
  const normalized = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  if (!normalized) return undefined;
  return parseTopicFromSearchParams(new URLSearchParams(normalized));
}

export function hasMalformedBrowseTopicSearch(
  search: Record<string, unknown>,
  searchStr?: string,
) {
  if (Object.keys(search).some((key) => key.startsWith("topic="))) {
    return true;
  }
  if (!searchStr) return false;
  const normalized = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  if (!normalized) return false;
  for (const key of new URLSearchParams(normalized).keys()) {
    if (key.startsWith("topic=")) return true;
  }
  return false;
}

export function sanitizeBrowseTopicSearch<T extends Record<string, unknown>>(
  search: T,
  topic?: string | null,
): T {
  const next = { ...search } as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    if (key === "topic" || key.startsWith("topic=")) {
      delete next[key];
    }
  }

  if (topic === null) {
    return next as T;
  }

  const resolvedTopic = topic ?? parseBrowseTopicFromSearchInput(search);
  if (resolvedTopic) {
    next.topic = resolvedTopic;
  }

  return next as T;
}
