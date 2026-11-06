export function isPostPublishFlag(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/^"|"$/g, "") : value;
  return normalized === "1" || normalized === "true" || normalized === 1 || normalized === true;
}

export function hasPostPublishSearch(searchStr: string) {
  return isPostPublishFlag(new URLSearchParams(searchStr).get("published"));
}

export function parsePostPublishSearch(search: { published?: unknown }): { published?: true } {
  return isPostPublishFlag(search.published) ? { published: true } : {};
}
