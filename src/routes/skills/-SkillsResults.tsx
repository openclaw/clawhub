import { Link } from '@tanstack/react-router'
import type { RefObject } from 'react'
import { SkillCard } from '../../components/SkillCard'
import { SkillMetricsRow, SkillStatsTripletLine } from '../../components/SkillStats'
import { UserBadge } from '../../components/UserBadge'
import { useI18n } from '../../i18n'
import { getPlatformLabels } from '../../components/skillDetailUtils'
import { getSkillBadges } from '../../lib/badges'
import { buildSkillHref, type SkillListEntry } from './-types'

type SkillsResultsProps = {
  isLoadingSkills: boolean
  sorted: SkillListEntry[]
  view: 'cards' | 'list'
  paginationStatus: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
  hasQuery: boolean
  canLoadMore: boolean
  isLoadingMore: boolean
  canAutoLoad: boolean
  loadMoreRef: RefObject<HTMLDivElement | null>
  loadMore: () => void
}

export function SkillsResults({
  isLoadingSkills,
  sorted,
  view,
  paginationStatus,
  hasQuery,
  canLoadMore,
  isLoadingMore,
  canAutoLoad,
  loadMoreRef,
  loadMore,
}: SkillsResultsProps) {
  const { t } = useI18n()
  return (
    <>
      {isLoadingSkills ? (
        <div className="card">
          <div className="loading-indicator">{t('skillsResults.loading')}</div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          {paginationStatus === 'Exhausted' || hasQuery
            ? t('skillsResults.noMatch')
            : t('skillsResults.loading')}
        </div>
      ) : view === 'cards' ? (
        <div className="grid">
          {sorted.map((entry) => {
            const skill = entry.skill
            const clawdis = entry.latestVersion?.parsed?.clawdis
            const isPlugin = Boolean(clawdis?.nix?.plugin)
            const platforms = getPlatformLabels(clawdis?.os, clawdis?.nix?.systems)
            const ownerHandle = entry.owner?.handle ?? entry.owner?.name ?? entry.ownerHandle ?? null
            const skillHref = buildSkillHref(skill, ownerHandle)
            return (
              <SkillCard
                key={skill._id}
                skill={skill}
                href={skillHref}
                badge={getSkillBadges(skill)}
                chip={isPlugin ? t('skillsResults.pluginBundle') : undefined}
                platformLabels={platforms.length ? platforms : undefined}
                summaryFallback={t('skillsResults.agentReady')}
                meta={
                  <div className="skill-card-footer-rows">
                    <UserBadge user={entry.owner} fallbackHandle={ownerHandle} prefix={t('userBadge.by')} link={false} />
                    <div className="stat">
                      <SkillStatsTripletLine stats={skill.stats} />
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
            const clawdis = entry.latestVersion?.parsed?.clawdis
            const isPlugin = Boolean(clawdis?.nix?.plugin)
            const platforms = getPlatformLabels(clawdis?.os, clawdis?.nix?.systems)
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
                    {isPlugin ? <span className="tag tag-accent tag-compact">{t('skillsResults.pluginBundle')}</span> : null}
                    {platforms.map((label) => (
                      <span key={label} className="tag tag-compact">{label}</span>
                    ))}
                  </div>
                  <div className="skills-row-summary">{skill.summary ?? t('skillsResults.noSummary')}</div>
                  <div className="skills-row-owner">
                    <UserBadge user={entry.owner} fallbackHandle={ownerHandle} prefix={t('userBadge.by')} link={false} />
                  </div>
                </div>
                <div className="skills-row-metrics">
                  <SkillMetricsRow stats={skill.stats} />
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
              t('skillsResults.loadingMore')
            ) : (
              t('skillsResults.scrollToLoad')
            )
          ) : (
            <button className="btn" type="button" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? t('skillsResults.loadingEllipsis') : t('skillsResults.loadMore')}
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}
