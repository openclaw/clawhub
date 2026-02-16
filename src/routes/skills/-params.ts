export const sortKeys = [
  'relevance',
  'newest',
  'downloads',
  'installs',
  'stars',
  'name',
  'updated',
] as const

export type SortKey = (typeof sortKeys)[number]
export type ListSortKey = Exclude<SortKey, 'relevance'>
export type SortDir = 'asc' | 'desc'

export function parseSort(value: unknown): SortKey {
  if (typeof value !== 'string') return 'downloads'
  if ((sortKeys as readonly string[]).includes(value)) return value as SortKey
  return 'downloads'
}

export function parseDir(value: unknown, sort: SortKey): SortDir {
  if (value === 'asc' || value === 'desc') return value
  return sort === 'name' ? 'asc' : 'desc'
}

export function toListSort(sort: SortKey): ListSortKey {
  return sort === 'relevance' ? 'downloads' : sort
}
