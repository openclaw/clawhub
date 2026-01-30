import { createFileRoute, Link } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
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
import type { PublicSoul } from '../../lib/publicUser'
import { getResourceLink } from '../../lib/resources'

const sortKeys = ['downloads', 'stars', 'newest', 'name', 'updated'] as const
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

export const Route = createFileRoute('/souls/')({
  validateSearch: (search) => {
    return {
      q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === 'string' ? parseSort(search.sort) : undefined,
      dir: search.dir === 'asc' || search.dir === 'desc' ? search.dir : undefined,
      view: search.view === 'cards' || search.view === 'list' ? search.view : undefined,
      focus: search.focus === 'search' ? 'search' : undefined,
    }
  },
  component: SoulsIndex,
})

function SoulsIndex() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const sort = search.sort ?? 'downloads'
  const dir = parseDir(search.dir, sort)
  const view = search.view ?? 'cards'
  const [query, setQuery] = useState(search.q ?? '')

  const souls = useQuery(api.souls.list, { limit: 500 }) as PublicSoul[] | undefined
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds)
  const seedEnsuredRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isLoadingSouls = souls === undefined

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
    if (seedEnsuredRef.current) return
    seedEnsuredRef.current = true
    void ensureSoulSeeds({})
  }, [ensureSoulSeeds])

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    const all = souls ?? []
    if (!value) return all
    return all.filter((soul) => {
      if (soul.slug.toLowerCase().includes(value)) return true
      if (soul.displayName.toLowerCase().includes(value)) return true
      return (soul.summary ?? '').toLowerCase().includes(value)
    })
  }, [query, souls])

  const sorted = useMemo(() => {
    const multiplier = dir === 'asc' ? 1 : -1
    const results = [...filtered]
    results.sort((a, b) => {
      switch (sort) {
        case 'downloads':
          return (
            (a.stats.downloads - b.stats.downloads) * multiplier ||
            (a.stats.stars - b.stats.stars) * multiplier
          )
        case 'stars':
          return (a.stats.stars - b.stats.stars) * multiplier
        case 'updated':
          return (a.updatedAt - b.updatedAt) * multiplier
        case 'name':
          return (
            (a.displayName.localeCompare(b.displayName) || a.slug.localeCompare(b.slug)) *
            multiplier
          )
        default:
          return (a.createdAt - b.createdAt) * multiplier
      }
    })
    return results
  }, [dir, filtered, sort])

  const showing = sorted.length
  const total = souls?.length

  return (
    <main className="py-10">
      <PageShell className="space-y-10">
        <SectionHeader
          title="Souls"
          description={
            isLoadingSouls
              ? 'Loading souls…'
              : `${showing}${typeof total === 'number' ? ` of ${total}` : ''} souls.`
          }
          actions={
            <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
              Upload a soul
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

        {isLoadingSouls ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Loading souls…
          </div>
        ) : showing === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            No souls match that filter.
          </div>
        ) : view === 'cards' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((soul) => (
              <ResourceCard
                key={soul._id}
                type="soul"
                resource={soul}
                summaryFallback="A SOUL.md bundle."
                meta={
                  <span>
                    ⭐ {soul.stats.stars} stars · ⤓ {soul.stats.downloads} downloads ·{' '}
                    {soul.stats.versions} versions
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {sorted.map((soul) => (
              <ResourceListRow
                key={soul._id}
                type="soul"
                resource={soul}
                summaryFallback="SOUL.md bundle."
                meta={
                  <span className="flex flex-wrap gap-2">
                    <Badge variant="secondary">⤓ {soul.stats.downloads} downloads</Badge>
                    <Badge variant="secondary">★ {soul.stats.stars} stars</Badge>
                    <Badge variant="secondary">{soul.stats.versions} versions</Badge>
                  </span>
                }
                href={getResourceLink('soul', soul, soul.slug, null)}
              />
            ))}
          </div>
        )}
      </PageShell>
    </main>
  )
}
