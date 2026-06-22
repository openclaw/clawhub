export const sortKeys = [
  "relevance",
  "recommended",
  "default",
  "newest",
  "downloads",
  "stars",
  "name",
  "updated",
] as const;

export type SortKey = (typeof sortKeys)[number];
export type ListSortKey = Exclude<SortKey, "relevance" | "recommended" | "default">;
export type SortDir = "asc" | "desc";

export function parseSort(value: unknown): SortKey {
  if (typeof value !== "string") return "recommended";
  if (value === "default") return "recommended";
  if (value === "installs") return "downloads";
  if ((sortKeys as readonly string[]).includes(value)) return value as SortKey;
  return "recommended";
}

export function parseDir(value: unknown, sort: SortKey): SortDir {
  if (value === "asc" || value === "desc") return value;
  return sort === "name" ? "asc" : "desc";
}

export function toListSort(sort: SortKey): ListSortKey | undefined {
  return sort === "relevance" || sort === "recommended" || sort === "default" ? undefined : sort;
}
