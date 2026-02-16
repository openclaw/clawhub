import { useAction, usePaginatedQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { api } from '../../../convex/_generated/api'
import { parseDir, parseSort, toListSort, type SortDir, type SortKey } from './-params'
import type { SkillListEntry, SkillSearchEntry } from './-types'

const pageSize = 25

type SkillsView = 'cards' | 'list'

export type SkillsSearchState = {
  q?: string
  sort?: SortKey
  dir?: SortDir
  highlighted?: boolean
  nonSuspicious?: boolean
  view?: SkillsView
  focus?: 'search'
}

type SkillsNavigate = (options: {
  search: (prev: SkillsSearchState) => SkillsSearchState
  replace?: boolean
}) => void | Promise<void>

export function useSkillsBrowseModel({
  search,
  navigate,
  searchInputRef,
}: {
  search: SkillsSearchState
  navigate: SkillsNavigate
  searchInputRef: RefObject<HTMLInputElement | null>
}) {
  const [query, setQuery] = useState(search.q ?? '')
  const [searchResults, setSearchResults] = useState<Array<SkillSearchEntry>>([])
  const [searchLimit, setSearchLimit] = useState(pageSize)
  const [isSearching, setIsSearching] = useState(false)
  const searchRequest = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const loadMoreInFlightRef = useRef(false)

  const view: SkillsView = search.view ?? 'list'
  const highlightedOnly = search.highlighted ?? false
  const nonSuspiciousOnly = search.nonSuspicious ?? false
  const searchSkills = useAction(api.search.searchSkills)

  const trimmedQuery = useMemo(() => query.trim(), [query])
  const hasQuery = trimmedQuery.length > 0
  const sort: SortKey =
    search.sort === 'relevance' && !hasQuery
      ? 'downloads'
      : (search.sort ?? (hasQuery ? 'relevance' : 'downloads'))
  const listSort = toListSort(sort)
  const dir = parseDir(search.dir, sort)
  const searchKey = trimmedQuery
    ? `${trimmedQuery}::${highlightedOnly ? '1' : '0'}::${nonSuspiciousOnly ? '1' : '0'}`
    : ''

  const {
    results: paginatedResults,
    status: paginationStatus,
    loadMore: loadMorePaginated,
  } = usePaginatedQuery(
    api.skills.listPublicPageV2,
    hasQuery ? 'skip' : { sort: listSort, dir, highlightedOnly, nonSuspiciousOnly },
    {
      initialNumItems: pageSize,
    },
  )

  const isLoadingList = paginationStatus === 'LoadingFirstPage'
  const canLoadMoreList = paginationStatus === 'CanLoadMore'
  const isLoadingMoreList = paginationStatus === 'LoadingMore'

  useEffect(() => {
    setQuery(search.q ?? '')
  }, [search.q])

  useEffect(() => {
    if (search.focus === 'search' && searchInputRef.current) {
      searchInputRef.current.focus()
      void navigate({ search: (prev) => ({ ...prev, focus: undefined }), replace: true })
    }
  }, [navigate, search.focus, searchInputRef])

  useEffect(() => {
    if (!searchKey) {
      setSearchResults([])
      setIsSearching(false)
      return
    }
    setSearchResults([])
    setSearchLimit(pageSize)
  }, [searchKey])

  useEffect(() => {
    if (!hasQuery) return
    searchRequest.current += 1
    const requestId = searchRequest.current
    setIsSearching(true)
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const data = (await searchSkills({
            query: trimmedQuery,
            highlightedOnly,
            nonSuspiciousOnly,
            limit: searchLimit,
          })) as Array<SkillSearchEntry>
          if (requestId === searchRequest.current) {
            setSearchResults(data)
          }
        } finally {
          if (requestId === searchRequest.current) {
            setIsSearching(false)
          }
        }
      })()
    }, 220)
    return () => window.clearTimeout(handle)
  }, [hasQuery, highlightedOnly, nonSuspiciousOnly, searchLimit, searchSkills, trimmedQuery])

  const baseItems = useMemo(() => {
    if (hasQuery) {
      return searchResults.map((entry) => ({
        skill: entry.skill,
        latestVersion: entry.version,
        ownerHandle: entry.ownerHandle ?? null,
        owner: entry.owner ?? null,
        searchScore: entry.score,
      }))
    }
    return paginatedResults as Array<SkillListEntry>
  }, [hasQuery, paginatedResults, searchResults])

  const sorted = useMemo(() => {
    if (!hasQuery) {
      return baseItems
    }
    const multiplier = dir === 'asc' ? 1 : -1
    const results = [...baseItems]
    results.sort((a, b) => {
      const tieBreak = () => {
        const updated = (a.skill.updatedAt - b.skill.updatedAt) * multiplier
        if (updated !== 0) return updated
        return a.skill.slug.localeCompare(b.skill.slug)
      }
      switch (sort) {
        case 'relevance':
          return ((a.searchScore ?? 0) - (b.searchScore ?? 0)) * multiplier
        case 'downloads':
          return (a.skill.stats.downloads - b.skill.stats.downloads) * multiplier || tieBreak()
        case 'installs':
          return (
            ((a.skill.stats.installsAllTime ?? 0) - (b.skill.stats.installsAllTime ?? 0)) * multiplier ||
            tieBreak()
          )
        case 'stars':
          return (a.skill.stats.stars - b.skill.stats.stars) * multiplier || tieBreak()
        case 'updated':
          return (
            (a.skill.updatedAt - b.skill.updatedAt) * multiplier || a.skill.slug.localeCompare(b.skill.slug)
          )
        case 'name':
          return (
            (a.skill.displayName.localeCompare(b.skill.displayName) ||
              a.skill.slug.localeCompare(b.skill.slug)) * multiplier
          )
        default:
          return (
            (a.skill.createdAt - b.skill.createdAt) * multiplier || a.skill.slug.localeCompare(b.skill.slug)
          )
      }
    })
    return results
  }, [baseItems, dir, hasQuery, sort])

  const isLoadingSkills = hasQuery ? isSearching && searchResults.length === 0 : isLoadingList
  const canLoadMore = hasQuery
    ? !isSearching && searchResults.length === searchLimit && searchResults.length > 0
    : canLoadMoreList
  const isLoadingMore = hasQuery ? isSearching && searchResults.length > 0 : isLoadingMoreList
  const canAutoLoad = typeof IntersectionObserver !== 'undefined'

  const loadMore = useCallback(() => {
    if (loadMoreInFlightRef.current || isLoadingMore || !canLoadMore) return
    loadMoreInFlightRef.current = true
    if (hasQuery) {
      setSearchLimit((value) => value + pageSize)
    } else {
      loadMorePaginated(pageSize)
    }
  }, [canLoadMore, hasQuery, isLoadingMore, loadMorePaginated])

  useEffect(() => {
    if (!isLoadingMore) {
      loadMoreInFlightRef.current = false
    }
  }, [isLoadingMore])

  useEffect(() => {
    if (!canLoadMore || typeof IntersectionObserver === 'undefined') return
    const target = loadMoreRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMore, loadMore])

  const onQueryChange = useCallback(
    (next: string) => {
      const trimmed = next.trim()
      setQuery(next)
      void navigate({
        search: (prev) => ({ ...prev, q: trimmed ? next : undefined }),
        replace: true,
      })
    },
    [navigate],
  )

  const onToggleHighlighted = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        highlighted: prev.highlighted ? undefined : true,
      }),
      replace: true,
    })
  }, [navigate])

  const onToggleNonSuspicious = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        nonSuspicious: prev.nonSuspicious ? undefined : true,
      }),
      replace: true,
    })
  }, [navigate])

  const onSortChange = useCallback(
    (value: string) => {
      const nextSort = parseSort(value)
      void navigate({
        search: (prev) => ({
          ...prev,
          sort: nextSort,
          dir: parseDir(prev.dir, nextSort),
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const onToggleDir = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        dir: parseDir(prev.dir, sort) === 'asc' ? 'desc' : 'asc',
      }),
      replace: true,
    })
  }, [navigate, sort])

  const onToggleView = useCallback(() => {
    void navigate({
      search: (prev) => ({
        ...prev,
        view: prev.view === 'cards' ? undefined : 'cards',
      }),
      replace: true,
    })
  }, [navigate])

  const activeFilters: string[] = []
  if (highlightedOnly) activeFilters.push('highlighted')
  if (nonSuspiciousOnly) activeFilters.push('non-suspicious')

  return {
    activeFilters,
    canAutoLoad,
    canLoadMore,
    dir,
    hasQuery,
    highlightedOnly,
    isLoadingMore,
    isLoadingSkills,
    loadMore,
    loadMoreRef,
    nonSuspiciousOnly,
    onQueryChange,
    onSortChange,
    onToggleDir,
    onToggleHighlighted,
    onToggleNonSuspicious,
    onToggleView,
    paginationStatus,
    query,
    sort,
    sorted,
    view,
  }
}
