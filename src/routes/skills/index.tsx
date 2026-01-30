import { createFileRoute, Link } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { usePaginatedQuery } from 'convex-helpers/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { PageShell } from '../../components/PageShell'
import { ResourceCard } from '../../components/ResourceCard'
import { ResourceListRow } from '../../components/ResourceListRow'
import { SectionHeader } from '../../components/SectionHeader'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { getSkillBadges, isSkillHighlighted } from '../../lib/badges'
import type { PublicSkill } from '../../lib/publicUser'
import { getResourceLink } from '../../lib/resources'

const sortKeys = ['downloads', 'stars', 'newest', 'installs', 'name', 'updated'] as const
const pageSize = 25
type SortKey = (typeof sortKeys)[number]
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

type SkillListEntry = {
  skill: PublicSkill
  latestVersion: Doc<'skillVersions'> | null
  ownerHandle?: string | null
}

type SkillSearchEntry = {
  skill: PublicSkill
  version: Doc<'skillVersions'> | null
  score: number
  ownerHandle?: string | null
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
      view: search.view === 'cards' || search.view === 'list' ? search.view : undefined,
      focus: search.focus === 'search' ? 'search' : undefined,
    }
  },
  component: SkillsIndex,
})

export function SkillsIndex() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const sort = search.sort ?? 'downloads'
  const dir = parseDir(search.dir, sort)
  const view = search.view ?? 'cards'
  const highlightedOnly = search.highlighted ?? false
  const [query, setQuery] = useState(search.q ?? '')
  const searchSkills = useAction(api.search.searchSkills)
  const [searchResults, setSearchResults] = useState<Array<SkillSearchEntry>>([])
  const [searchLimit, setSearchLimit] = useState(pageSize)
  const [isSearching, setIsSearching] = useState(false)
  const searchRequest = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = useMemo(() => query.trim(), [query])
  const hasQuery = trimmedQuery.length > 0
  const searchKey = trimmedQuery ? `${trimmedQuery}::${highlightedOnly ? '1' : '0'}` : ''

  const {
    results: paginatedResults,
    status: paginationStatus,
    loadMore: loadMorePaginated,
  } = usePaginatedQuery(api.skills.listPublicPageV2, hasQuery ? 'skip' : {}, {
    initialNumItems: pageSize,
  })

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
  }, [hasQuery, highlightedOnly, searchLimit, searchSkills, trimmedQuery])

  const baseItems = useMemo(() => {
    if (hasQuery) {
      return searchResults.map((entry) => ({
        skill: entry.skill,
        latestVersion: entry.version,
        ownerHandle: entry.ownerHandle ?? null,
      }))
    }
    return paginatedResults as Array<SkillListEntry>
  }, [hasQuery, paginatedResults, searchResults])

  const filtered = useMemo(
    () => baseItems.filter((entry) => (highlightedOnly ? isSkillHighlighted(entry.skill) : true)),
    [baseItems, highlightedOnly],
  )

  const sorted = useMemo(() => {
    const multiplier = dir === 'asc' ? 1 : -1
    const results = [...filtered]
    results.sort((a, b) => {
      switch (sort) {
        case 'downloads':
          return (
            (a.skill.stats.downloads - b.skill.stats.downloads) * multiplier ||
            (a.skill.stats.stars - b.skill.stats.stars) * multiplier
          )
        case 'installs':
          return (
            ((a.skill.stats.installsAllTime ?? 0) - (b.skill.stats.installsAllTime ?? 0)) *
            multiplier
          )
        case 'stars':
          return (a.skill.stats.stars - b.skill.stats.stars) * multiplier
        case 'updated':
          return (a.skill.updatedAt - b.skill.updatedAt) * multiplier
        case 'name':
          return (
            (a.skill.displayName.localeCompare(b.skill.displayName) ||
              a.skill.slug.localeCompare(b.skill.slug)) * multiplier
          )
        default:
          return (a.skill.createdAt - b.skill.createdAt) * multiplier
      }
    })
    return results
  }, [dir, filtered, sort])

  const isLoadingSkills = hasQuery ? isSearching && searchResults.length === 0 : isLoadingList
  const canLoadMore = hasQuery
    ? !isSearching && searchResults.length === searchLimit && searchResults.length > 0
    : canLoadMoreList
  const isLoadingMore = hasQuery ? isSearching && searchResults.length > 0 : isLoadingMoreList
  const canAutoLoad = typeof IntersectionObserver !== 'undefined'

  const loadMore = useCallback(() => {
    if (isLoadingMore || !canLoadMore) return
    if (hasQuery) {
      setSearchLimit((value) => value + pageSize)
    } else {
      loadMorePaginated(pageSize)
    }
  }, [canLoadMore, hasQuery, isLoadingMore, loadMorePaginated])

  useEffect(() => {
    if (!canLoadMore || typeof IntersectionObserver === 'undefined') return
    const target = loadMoreRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMore, loadMore])

  return (
    <main className="py-10">
      <PageShell className="space-y-10">
        <SectionHeader
          title="Skills"
          description={
            isLoadingSkills
              ? 'Loading skills…'
              : `Browse the skill library${highlightedOnly ? ' (highlighted)' : ''}.`
          }
          actions={
            <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
              Upload a skill
            </Link>
          }
        />

        <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <Input
              ref={searchInputRef}
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={highlightedOnly ? 'default' : 'outline'}
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
            </Button>
            <Select
              value={sort}
              onValueChange={(value) => {
                const nextSort = parseSort(value)
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    sort: nextSort,
                    dir: parseDir(prev.dir, nextSort),
                  }),
                  replace: true,
                })
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="downloads">Downloads</SelectItem>
                <SelectItem value="stars">Stars</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="updated">Recently updated</SelectItem>
                <SelectItem value="installs">Installs</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
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
            </Button>
            <Button
              type="button"
              variant={view === 'cards' ? 'default' : 'outline'}
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    view: prev.view === 'cards' ? 'list' : 'cards',
                  }),
                  replace: true,
                })
              }}
            >
              {view === 'cards' ? 'Cards' : 'List'}
            </Button>
          </div>
        </div>

        {isLoadingSkills ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Loading skills…
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            No skills match that filter.
          </div>
        ) : view === 'cards' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((entry) => {
              const skill = entry.skill
              const isPlugin = Boolean(entry.latestVersion?.parsed?.moltbot?.nix?.plugin)
              const skillHref = getResourceLink(
                'skill',
                skill,
                skill.slug,
                entry.ownerHandle ?? null,
              )
              return (
                <ResourceCard
                  key={skill._id}
                  type="skill"
                  resource={skill}
                  ownerHandle={entry.ownerHandle ?? null}
                  href={skillHref}
                  badges={getSkillBadges(skill)}
                  chip={isPlugin ? 'Plugin bundle (nix)' : undefined}
                  summaryFallback="Agent-ready skill pack."
                  meta={
                    <span>
                      ⭐ {skill.stats.stars} stars · ⤓ {skill.stats.downloads} downloads · ⤒{' '}
                      {skill.stats.installsAllTime ?? 0} installs
                    </span>
                  }
                />
              )
            })}
          </div>
        ) : (
          <div className="grid gap-3">
            {sorted.map((entry) => {
              const skill = entry.skill
              const isPlugin = Boolean(entry.latestVersion?.parsed?.moltbot?.nix?.plugin)
              return (
                <ResourceListRow
                  key={skill._id}
                  type="skill"
                  resource={skill}
                  ownerHandle={entry.ownerHandle ?? null}
                  badges={getSkillBadges(skill)}
                  chip={isPlugin ? 'Plugin bundle (nix)' : undefined}
                  summaryFallback="No summary provided."
                  meta={
                    <span className="flex flex-wrap gap-2">
                      <Badge variant="secondary">⤓ {skill.stats.downloads} downloads</Badge>
                      <Badge variant="secondary">
                        ⤒ {skill.stats.installsAllTime ?? 0} installs
                      </Badge>
                      <Badge variant="secondary">★ {skill.stats.stars} stars</Badge>
                      <Badge variant="secondary">{skill.stats.versions} versions</Badge>
                    </span>
                  }
                />
              )
            })}
          </div>
        )}

        {canLoadMore ? (
          <div
            ref={canAutoLoad ? loadMoreRef : null}
            className="rounded-[var(--radius)] border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground"
          >
            {canAutoLoad ? (
              isLoadingMore ? (
                'Loading more…'
              ) : (
                'Scroll to load more'
              )
            ) : (
              <Button type="button" variant="outline" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        ) : null}
      </PageShell>
    </main>
  )
}
