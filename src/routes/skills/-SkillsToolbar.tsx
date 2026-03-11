import type { RefObject } from 'react'
import { useI18n } from '../../i18n'
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
  const { t } = useI18n()
  return (
    <div className="skills-toolbar">
      <div className="skills-search">
        <input
          ref={searchInputRef}
          className="skills-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('skillsToolbar.filterPlaceholder')}
        />
      </div>
      <div className="skills-toolbar-row">
        <button
          className={`search-filter-button${highlightedOnly ? ' is-active' : ''}`}
          type="button"
          aria-pressed={highlightedOnly}
          onClick={onToggleHighlighted}
        >
          {t('skillsToolbar.highlighted')}
        </button>
        <button
          className={`search-filter-button${nonSuspiciousOnly ? ' is-active' : ''}`}
          type="button"
          aria-pressed={nonSuspiciousOnly}
          onClick={onToggleNonSuspicious}
        >
          {t('skillsToolbar.hideSuspicious')}
        </button>
        <select
          className="skills-sort"
          value={sort}
          onChange={(event) => onSortChange(event.target.value)}
          aria-label="Sort skills"
        >
          {hasQuery ? <option value="relevance">{t('skillsToolbar.relevance')}</option> : null}
          <option value="newest">{t('skillsToolbar.newest')}</option>
          <option value="updated">{t('skillsToolbar.recentlyUpdated')}</option>
          <option value="downloads">{t('skillsToolbar.downloads')}</option>
          <option value="installs">{t('skillsToolbar.installs')}</option>
          <option value="stars">{t('skillsToolbar.stars')}</option>
          <option value="name">{t('skillsToolbar.name')}</option>
        </select>
        <button className="skills-dir" type="button" aria-label={t('skillsToolbar.sortDirection')} onClick={onToggleDir}>
          {dir === 'asc' ? '↑' : '↓'}
        </button>
        <button
          className={`skills-view${view === 'cards' ? ' is-active' : ''}`}
          type="button"
          onClick={onToggleView}
        >
          {view === 'cards' ? t('skillsToolbar.list') : t('skillsToolbar.cards')}
        </button>
      </div>
    </div>
  )
}
