import { createFileRoute, Link } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { SoulCard } from '../../components/SoulCard'

const sortKeys = ['newest', 'downloads', 'stars', 'name', 'updated'] as const
type SortKey = (typeof sortKeys)[number]
type SortDir = 'asc' | 'desc'

function parseSort(value: unknown): SortKey {
  if (typeof value !== 'string') return 'newest'
  if ((sortKeys as readonly string[]).includes(value)) return value as SortKey
  return 'newest'
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
    }
  },
  component: SoulsIndex,
})

function SoulsIndex() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const sort = search.sort ?? 'newest'
  const dir = parseDir(search.dir, sort)
  const view = search.view ?? 'list'
  const [query, setQuery] = useState(search.q ?? '')

  const souls = useQuery(api.souls.list, { limit: 500 }) as Doc<'souls'>[] | undefined
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds)
  const seedEnsuredRef = useRef(false)
  const isLoadingSouls = souls === undefined

  useEffect(() => {
    setQuery(search.q ?? '')
  }, [search.q])

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
          return (a.stats.downloads - b.stats.downloads) * multiplier
        case 'stars':
          return (a.stats.stars - b.stats.stars) * multiplier
        case 'updated':
          return (a.updatedAt - b.updatedAt) * multiplier
        case 'name':
          return a.displayName.localeCompare(b.displayName) || a.slug.localeCompare(b.slug)
        default:
          return (a.createdAt - b.createdAt) * multiplier
      }
    })
    return results
  }, [dir, filtered, sort])

  const showing = sorted.length
  const total = souls?.length

  return (
    <main className="section">
      <header className="skills-header">
        <div>
          <h1 className="section-title" style={{ marginBottom: 8 }}>
            Souls
          </h1>
          <p className="section-subtitle" style={{ marginBottom: 0 }}>
            {isLoadingSouls
              ? 'Loading souls…'
              : `${showing}${typeof total === 'number' ? ` of ${total}` : ''} souls.`}
          </p>
        </div>
        <div className="skills-toolbar">
          <div className="skills-search">
            <input
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
              aria-label="Sort souls"
            >
              <option value="newest">Newest</option>
              <option value="updated">Recently updated</option>
              <option value="downloads">Downloads</option>
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
      </header>

      {isLoadingSouls ? (
        <div className="card">
          <div className="loading-indicator">Loading souls…</div>
        </div>
      ) : showing === 0 ? (
        <div className="card">No souls match that filter.</div>
      ) : view === 'cards' ? (
        <div className="grid">
          {sorted.map((soul) => (
            <SoulCard
              key={soul._id}
              soul={soul}
              summaryFallback="A SOUL.md bundle."
              meta={
                <div className="stat">
                  ⭐ {soul.stats.stars} · ⤓ {soul.stats.downloads} · {soul.stats.versions} v
                </div>
              }
            />
          ))}
        </div>
      ) : (
        <div className="skills-list">
          {sorted.map((soul) => (
            <Link
              key={soul._id}
              className="skills-row"
              to="/souls/$slug"
              params={{ slug: soul.slug }}
            >
              <div className="skills-row-main">
                <div className="skills-row-title">
                  <span>{soul.displayName}</span>
                  <span className="skills-row-slug">/{soul.slug}</span>
                </div>
                <div className="skills-row-summary">{soul.summary ?? 'SOUL.md bundle.'}</div>
              </div>
              <div className="skills-row-metrics">
                <span>⤓ {soul.stats.downloads}</span>
                <span>★ {soul.stats.stars}</span>
                <span>{soul.stats.versions} v</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
