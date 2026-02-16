import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useAction, usePaginatedQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { SkillCard } from '../../components/SkillCard'
import { UserBadge } from '../../components/UserBadge'
import { getSkillBadges } from '../../lib/badges'
import type { PublicSkill, PublicUser } from '../../lib/publicUser'

const sortKeys = [
  'relevance',
  'newest',
  'downloads',
  'installs',
  'stars',
  'name',
  'updated',
] as const
const pageSize = 25
type SortKey = (typeof sortKeys)[number]
type ListSortKey = Exclude<SortKey, 'relevance'>
type SortDir = 'asc' | 'desc'

function parseSort(value: unknown): SortKey {
  if (typeof value !== 'string') return 'downloads'
  if ((sortKeys as readonly string[]).includes(value)) return value as SortKey
  return 'downloads'
}

function parseDir(value: unknown, sort: SortKey): SortDir {
  if (value === 'asc' || value === 'desc') return value
  return sort === 'name' ? 'asc' : 'desc'
}

function toListSort(sort: SortKey): ListSortKey {
  return sort === 'relevance' ? 'downloads' : sort
}

type SkillListEntry = {
  skill: PublicSkill
  latestVersion: {
    version: string
    createdAt: number
    changelog: string
    changelogSource?: 'auto' | 'user'
    parsed?: {
      clawdis?: {
        nix?: {
          plugin?: boolean
        }
      }
    }
  } | null
  ownerHandle?: string | null
  owner?: PublicUser | null
  searchScore?: number
}

type SkillSearchEntry = {
  skill: PublicSkill
  version: Doc<'skillVersions'> | null
  score: number
  ownerHandle?: string | null
  owner?: PublicUser | null
}

function buildSkillHref(skill: PublicSkill, ownerHandle?: string | null) {
  const owner = ownerHandle?.trim() || String(skill.ownerUserId)
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(skill.slug)}`
}

export const Route = createFileRoute('/skills/')({
  validateSearch: (search) => {
    return {
      q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === 'string' ? parseSort(search.sort) : undefined,
      dir: search.dir === 'asc' || search.dir === 'desc' ? search.dir : undefined,
      highlighted:
        search.highlighted === '1' || search.highlighted === 'true' || search.highlighted === true
          ? true
          : undefined,
      nonSuspicious:
        search.nonSuspicious === '1' ||
        search.nonSuspicious === 'true' ||
        search.nonSuspicious === true
          ? true
          : undefined,
      view: search.view === 'cards' || search.view === 'list' ? search.view : undefined,
      focus: search.focus === 'search' ? 'search' : undefined,
    }
  },
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim())
    if (hasQuery || search.sort) return
    throw redirect({
      to: '/skills',
      search: {
        q: search.q || undefined,
        sort: 'downloads',
        dir: search.dir || undefined,
        highlighted: search.highlighted || undefined,
        nonSuspicious: search.nonSuspicious || undefined,
        view: search.view || undefined,
        focus: search.focus || undefined,
      },
      replace: true,
    })
  },
  component: SkillsIndex,
})

export function SkillsIndex() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const [query, setQuery] = useState(search.q ?? '')
  const view = search.view ?? 'list'
  const highlightedOnly = search.highlighted ?? false
  const nonSuspiciousOnly = search.nonSuspicious ?? false
  const searchSkills = useAction(api.search.searchSkills)
  const [searchResults, setSearchResults] = useState<Array<SkillSearchEntry>>([])
  const [searchLimit, setSearchLimit] = useState(pageSize)
  const [isSearching, setIsSearching] = useState(false)
  const searchRequest = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const loadMoreInFlightRef = useRef(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = useMemo(() => query.trim(), [query])
  const hasQuery = trimmedQuery.length > 0
  const sort =
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

  // Derive loading states from pagination status
  // status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
  const isLoadingList = paginationStatus === 'LoadingFirstPage'
  const canLoadMoreList = paginationStatus === 'CanLoadMore'
  const isLoadingMoreList = paginationStatus === 'LoadingMore'

  useEffect(() => {
    setQuery(search.q ?? '')
  }, [search.q])

  // Defense-in-depth for stale client bundles: always normalize browse mode to downloads sort.
  useEffect(() => {
    if (hasQuery || search.sort) return
    void navigate({
      search: (prev) => ({
        ...prev,
        sort: 'downloads',
      }),
      replace: true,
    })
  }, [hasQuery, navigate, search.sort])

  // Auto-focus search input when focus=search param is present
  useEffect(() => {
    if (search.focus === 'search' && searchInputRef.current) {
      searchInputRef.current.focus()
      // Clear the focus param from URL to avoid re-focusing on navigation
      void navigate({ search: (prev) => ({ ...prev, focus: undefined }), replace: true })
    }
  }, [search.focus, navigate])

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
    // paginatedResults is an array of page items from usePaginatedQuery
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
            ((a.skill.stats.installsAllTime ?? 0) - (b.skill.stats.installsAllTime ?? 0)) *
              multiplier || tieBreak()
          )
        case 'stars':
          return (a.skill.stats.stars - b.skill.stats.stars) * multiplier || tieBreak()
        case 'updated':
          return (
            (a.skill.updatedAt - b.skill.updatedAt) * multiplier ||
            a.skill.slug.localeCompare(b.skill.slug)
          )
        case 'name':
          return (
            (a.skill.displayName.localeCompare(b.skill.displayName) ||
              a.skill.slug.localeCompare(b.skill.slug)) * multiplier
          )
        default:
          return (
            (a.skill.createdAt - b.skill.createdAt) * multiplier ||
            a.skill.slug.localeCompare(b.skill.slug)
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

  const activeFilters: string[] = []
  if (highlightedOnly) activeFilters.push('highlighted')
  if (nonSuspiciousOnly) activeFilters.push('non-suspicious')

  return (
    <main className="section">
      <header className="skills-header-top">
        <h1 className="section-title" style={{ marginBottom: 8 }}>
          Skills
        </h1>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          {isLoadingSkills
            ? 'Loading skills…'
            : `Browse the skill library${activeFilters.length ? ` (${activeFilters.join(', ')})` : ''}.`}
        </p>
      </header>
      <div className="skills-container">
        <div className="skills-toolbar">
          <div className="skills-search">
            <input
              ref={searchInputRef}
              className="skills-search-input"
              value={query}
              onChange={(event) => {
                const next = event.target.value
                const trimmed = next.trim()
                setQuery(next)
                void navigate({
                  search: (prev) => ({ ...prev, q: trimmed ? next : undefined }),
                  replace: true,
                })
              }}
              placeholder="Filter by name, slug, or summary…"
            />
          </div>
          <div className="skills-toolbar-row">
            <button
              className={`search-filter-button${highlightedOnly ? ' is-active' : ''}`}
              type="button"
              aria-pressed={highlightedOnly}
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    highlighted: highlightedOnly ? undefined : true,
                  }),
                  replace: true,
                })
              }}
            >
              Highlighted
            </button>
            <button
              className={`search-filter-button${nonSuspiciousOnly ? ' is-active' : ''}`}
              type="button"
              aria-pressed={nonSuspiciousOnly}
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    nonSuspicious: nonSuspiciousOnly ? undefined : true,
                  }),
                  replace: true,
                })
              }}
            >
              Hide suspicious
            </button>
            <select
              className="skills-sort"
              value={sort}
              onChange={(event) => {
                const sort = parseSort(event.target.value)
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    sort,
                    dir: parseDir(prev.dir, sort),
                  }),
                  replace: true,
                })
              }}
              aria-label="Sort skills"
            >
              {hasQuery ? <option value="relevance">Relevance</option> : null}
              <option value="newest">Newest</option>
              <option value="updated">Recently updated</option>
              <option value="downloads">Downloads</option>
              <option value="installs">Installs</option>
              <option value="stars">Stars</option>
              <option value="name">Name</option>
            </select>
            <button
              className="skills-dir"
              type="button"
              aria-label={`Sort direction ${dir}`}
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    dir: parseDir(prev.dir, sort) === 'asc' ? 'desc' : 'asc',
                  }),
                  replace: true,
                })
              }}
            >
              {dir === 'asc' ? '↑' : '↓'}
            </button>
            <button
              className={`skills-view${view === 'cards' ? ' is-active' : ''}`}
              type="button"
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    view: prev.view === 'cards' ? undefined : 'cards',
                  }),
                  replace: true,
                })
              }}
            >
              {view === 'cards' ? 'List' : 'Cards'}
            </button>
          </div>
        </div>

        {isLoadingSkills ? (
          <div className="card">
            <div className="loading-indicator">Loading skills…</div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="card">
            {paginationStatus === 'Exhausted' || hasQuery
              ? 'No skills match that filter.'
              : 'Loading skills…'}
          </div>
        ) : view === 'cards' ? (
          <div className="grid">
            {sorted.map((entry) => {
              const skill = entry.skill
              const isPlugin = Boolean(entry.latestVersion?.parsed?.clawdis?.nix?.plugin)
              const ownerHandle = entry.owner?.handle ?? entry.owner?.name ?? entry.ownerHandle ?? null
              const skillHref = buildSkillHref(skill, ownerHandle)
              return (
                <SkillCard
                  key={skill._id}
                  skill={skill}
                  href={skillHref}
                  badge={getSkillBadges(skill)}
                  chip={isPlugin ? 'Plugin bundle (nix)' : undefined}
                  summaryFallback="Agent-ready skill pack."
                  meta={
                    <div className="skill-card-footer-rows">
                      <UserBadge user={entry.owner} fallbackHandle={ownerHandle} prefix="by" link={false} />
                      <div className="stat">
                        ⭐ {skill.stats.stars} · ⤓ {skill.stats.downloads} · ⤒{' '}
                        {skill.stats.installsAllTime ?? 0}
                      </div>
                    </div>
                  }
                />
              )
            })}
          </div>
        ) : (
          <div className="skills-list">
            {sorted.map((entry) => {
              const skill = entry.skill
              const isPlugin = Boolean(entry.latestVersion?.parsed?.clawdis?.nix?.plugin)
              const ownerHandle = entry.owner?.handle ?? entry.owner?.name ?? entry.ownerHandle ?? null
              const skillHref = buildSkillHref(skill, ownerHandle)
              return (
                <Link key={skill._id} className="skills-row" to={skillHref}>
                  <div className="skills-row-main">
                    <div className="skills-row-title">
                      <span>{skill.displayName}</span>
                      <span className="skills-row-slug">/{skill.slug}</span>
                      {getSkillBadges(skill).map((badge) => (
                        <span key={badge} className="tag">
                          {badge}
                        </span>
                      ))}
                      {isPlugin ? (
                        <span className="tag tag-accent tag-compact">Plugin bundle (nix)</span>
                      ) : null}
                    </div>
                    <div className="skills-row-summary">
                      {skill.summary ?? 'No summary provided.'}
                    </div>
                    <div className="skills-row-owner">
                      <UserBadge user={entry.owner} fallbackHandle={ownerHandle} prefix="by" link={false} />
                    </div>
                    {isPlugin ? (
                      <div className="skills-row-meta">
                        Bundle includes SKILL.md, CLI, and config.
                      </div>
                    ) : null}
                  </div>
                  <div className="skills-row-metrics">
                    <span>⤓ {skill.stats.downloads}</span>
                    <span>⤒ {skill.stats.installsAllTime ?? 0}</span>
                    <span>★ {skill.stats.stars}</span>
                    <span>{skill.stats.versions} v</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {canLoadMore || isLoadingMore ? (
          <div
            ref={canAutoLoad ? loadMoreRef : null}
            className="card"
            style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}
          >
            {canAutoLoad ? (
              isLoadingMore ? (
                'Loading more…'
              ) : (
                'Scroll to load more'
              )
            ) : (
              <button className="btn" type="button" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </main>
  )
}
