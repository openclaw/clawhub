import type { RefObject } from 'react'
import { type SortDir, type SortKey } from './-params'

type SkillsToolbarProps = {
  searchInputRef: RefObject<HTMLInputElement | null>
  query: string
  hasQuery: boolean
  sort: SortKey
  dir: SortDir
  view: 'cards' | 'list'
  highlightedOnly: boolean
  nonSuspiciousOnly: boolean
  onQueryChange: (next: string) => void
  onToggleHighlighted: () => void
  onToggleNonSuspicious: () => void
  onSortChange: (value: string) => void
  onToggleDir: () => void
  onToggleView: () => void
}

export function SkillsToolbar({
  searchInputRef,
  query,
  hasQuery,
  sort,
  dir,
  view,
  highlightedOnly,
  nonSuspiciousOnly,
  onQueryChange,
  onToggleHighlighted,
  onToggleNonSuspicious,
  onSortChange,
  onToggleDir,
  onToggleView,
}: SkillsToolbarProps) {
  return (
    <div className="skills-toolbar">
      <div className="skills-search">
        <input
          ref={searchInputRef}
          className="skills-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter by name, slug, or summary…"
        />
      </div>
      <div className="skills-toolbar-row">
        <button
          className={`search-filter-button${highlightedOnly ? ' is-active' : ''}`}
          type="button"
          aria-pressed={highlightedOnly}
          onClick={onToggleHighlighted}
        >
          Highlighted
        </button>
        <button
          className={`search-filter-button${nonSuspiciousOnly ? ' is-active' : ''}`}
          type="button"
          aria-pressed={nonSuspiciousOnly}
          onClick={onToggleNonSuspicious}
        >
          Hide suspicious
        </button>
        <select
          className="skills-sort"
          value={sort}
          onChange={(event) => onSortChange(event.target.value)}
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
        <button className="skills-dir" type="button" aria-label={`Sort direction ${dir}`} onClick={onToggleDir}>
          {dir === 'asc' ? '↑' : '↓'}
        </button>
        <button
          className={`skills-view${view === 'cards' ? ' is-active' : ''}`}
          type="button"
          onClick={onToggleView}
        >
          {view === 'cards' ? 'List' : 'Cards'}
        </button>
      </div>
    </div>
  )
}
