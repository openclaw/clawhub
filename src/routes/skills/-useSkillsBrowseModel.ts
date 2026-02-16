import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { SortDir, SortKey } from './-params'
import type { SkillListEntry } from './-types'

type UseSkillsBrowseModelParams = {
  navigate: (opts: { search: (prev: Record<string, unknown>) => Record<string, unknown> }) => void
  search: {
    q?: string
    sort?: SortKey
    dir?: SortDir
    highlighted?: boolean
    nonSuspicious?: boolean
    view?: 'cards' | 'list'
    focus?: string
  }
  searchInputRef: RefObject<HTMLInputElement | null>
}

export function useSkillsBrowseModel({ navigate, search }: UseSkillsBrowseModelParams) {
  const query = search.q ?? ''
  const hasQuery = Boolean(query.trim())
  const sort: SortKey = search.sort ?? (hasQuery ? 'relevance' : 'downloads')
  const dir: SortDir = search.dir ?? 'desc'
  const view = search.view ?? 'cards'
  const highlightedOnly = search.highlighted ?? false
  const nonSuspiciousOnly = search.nonSuspicious ?? false

  const updateSearch = useCallback(
    (updates: Record<string, unknown>) => {
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...updates }) })
    },
    [navigate],
  )

  return {
    query,
    hasQuery,
    sort,
    dir,
    view,
    highlightedOnly,
    nonSuspiciousOnly,
    isLoadingSkills: false,
    sorted: [] as SkillListEntry[],
    paginationStatus: 'Exhausted' as const,
    canLoadMore: false,
    isLoadingMore: false,
    canAutoLoad: false,
    loadMoreRef: useRef<HTMLDivElement>(null),
    activeFilters: [] as string[],
    loadMore: () => {},
    onQueryChange: (next: string) => updateSearch({ q: next || undefined }),
    onToggleHighlighted: () => updateSearch({ highlighted: highlightedOnly ? undefined : true }),
    onToggleNonSuspicious: () => updateSearch({ nonSuspicious: nonSuspiciousOnly ? undefined : true }),
    onSortChange: (value: string) => updateSearch({ sort: value }),
    onToggleDir: () => updateSearch({ dir: dir === 'asc' ? 'desc' : 'asc' }),
    onToggleView: () => updateSearch({ view: view === 'cards' ? 'list' : 'cards' }),
  }
}
