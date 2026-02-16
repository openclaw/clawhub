import { createFileRoute, redirect } from '@tanstack/react-router'
import { useRef } from 'react'
import { parseSort } from './-params'
import { SkillsResults } from './-SkillsResults'
import { SkillsToolbar } from './-SkillsToolbar'
import { useSkillsBrowseModel } from './-useSkillsBrowseModel'

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
  const searchInputRef = useRef<HTMLInputElement>(null)

  const model = useSkillsBrowseModel({
    navigate,
    search,
    searchInputRef,
  })

  return (
    <main className="section">
      <header className="skills-header-top">
        <h1 className="section-title" style={{ marginBottom: 8 }}>
          Skills
        </h1>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          {model.isLoadingSkills
            ? 'Loading skills…'
            : `Browse the skill library${model.activeFilters.length ? ` (${model.activeFilters.join(', ')})` : ''}.`}
        </p>
      </header>
      <div className="skills-container">
        <SkillsToolbar
          searchInputRef={searchInputRef}
          query={model.query}
          hasQuery={model.hasQuery}
          sort={model.sort}
          dir={model.dir}
          view={model.view}
          highlightedOnly={model.highlightedOnly}
          nonSuspiciousOnly={model.nonSuspiciousOnly}
          onQueryChange={model.onQueryChange}
          onToggleHighlighted={model.onToggleHighlighted}
          onToggleNonSuspicious={model.onToggleNonSuspicious}
          onSortChange={model.onSortChange}
          onToggleDir={model.onToggleDir}
          onToggleView={model.onToggleView}
        />
        <SkillsResults
          isLoadingSkills={model.isLoadingSkills}
          sorted={model.sorted}
          view={model.view}
          paginationStatus={model.paginationStatus}
          hasQuery={model.hasQuery}
          canLoadMore={model.canLoadMore}
          isLoadingMore={model.isLoadingMore}
          canAutoLoad={model.canAutoLoad}
          loadMoreRef={model.loadMoreRef}
          loadMore={model.loadMore}
        />
      </div>
    </main>
  )
}
