export type SortKey = 'relevance' | 'newest' | 'updated' | 'downloads' | 'installs' | 'stars' | 'name'
export type SortDir = 'asc' | 'desc'

const VALID_SORTS = new Set<SortKey>(['relevance', 'newest', 'updated', 'downloads', 'installs', 'stars', 'name'])

export function parseSort(raw: string): SortKey | undefined {
  const normalized = raw.trim().toLowerCase()
  return VALID_SORTS.has(normalized as SortKey) ? (normalized as SortKey) : undefined
}
