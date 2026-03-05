import { Link } from '@tanstack/react-router'
import type { ClawdisSkillMetadata } from 'clawhub-schema'
import { Package } from 'lucide-react'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { getSkillBadges } from '../lib/badges'
import { formatCompactStat, formatSkillStatsTriplet } from '../lib/numberFormat'
import type { PublicSkill, PublicUser } from '../lib/publicUser'
import { type LlmAnalysis, SecurityScanResults } from './SkillSecurityScanResults'
import { SkillInstallCard } from './SkillInstallCard'
import { UserBadge } from './UserBadge'
import { useI18n } from '../i18n/useI18n'

export type SkillModerationInfo = {
  isPendingScan: boolean
  isMalwareBlocked: boolean
  isSuspicious: boolean
  isHiddenByMod: boolean
  isRemoved: boolean
  reason?: string
}

type SkillFork = {
  kind: 'fork' | 'duplicate'
  version: string | null
  skill: { slug: string; displayName: string }
  owner: { handle: string | null; userId: Id<'users'> | null }
}

type SkillCanonical = {
  skill: { slug: string; displayName: string }
  owner: { handle: string | null; userId: Id<'users'> | null }
}

type SkillHeaderProps = {
  skill: Doc<'skills'> | PublicSkill
  owner: Doc<'users'> | PublicUser | null
  ownerHandle: string | null
  latestVersion: Doc<'skillVersions'> | null
  modInfo: SkillModerationInfo | null
  canManage: boolean
  isAuthenticated: boolean
  isStaff: boolean
  isStarred: boolean | undefined
  onToggleStar: () => void
  onOpenReport: () => void
  forkOf: SkillFork | null
  forkOfLabel: string
  forkOfHref: string | null
  forkOfOwnerHandle: string | null
  canonical: SkillCanonical | null
  canonicalHref: string | null
  canonicalOwnerHandle: string | null
  staffModerationNote: string | null
  staffVisibilityTag: string | null
  isAutoHidden: boolean
  isRemoved: boolean
  nixPlugin: string | undefined
  hasPluginBundle: boolean
  configRequirements: ClawdisSkillMetadata['config'] | undefined
  cliHelp: string | undefined
  tagEntries: Array<[string, Id<'skillVersions'>]>
  versionById: Map<Id<'skillVersions'>, Doc<'skillVersions'>>
  tagName: string
  onTagNameChange: (value: string) => void
  tagVersionId: Id<'skillVersions'> | ''
  onTagVersionChange: (value: Id<'skillVersions'> | '') => void
  onTagSubmit: () => void
  tagVersions: Doc<'skillVersions'>[]
  clawdis: ClawdisSkillMetadata | undefined
  osLabels: string[]
}

export function SkillHeader({
  skill,
  owner,
  ownerHandle,
  latestVersion,
  modInfo,
  canManage,
  isAuthenticated,
  isStaff,
  isStarred,
  onToggleStar,
  onOpenReport,
  forkOf,
  forkOfLabel,
  forkOfHref,
  forkOfOwnerHandle,
  canonical,
  canonicalHref,
  canonicalOwnerHandle,
  staffModerationNote,
  staffVisibilityTag,
  isAutoHidden,
  isRemoved,
  nixPlugin,
  hasPluginBundle,
  configRequirements,
  cliHelp,
  tagEntries,
  versionById,
  tagName,
  onTagNameChange,
  tagVersionId,
  onTagVersionChange,
  onTagSubmit,
  tagVersions,
  clawdis,
  osLabels,
}: SkillHeaderProps) {
  const formattedStats = formatSkillStatsTriplet(skill.stats)
  const { t } = useI18n()

  return (
    <>
      {modInfo?.isPendingScan ? (
        <div className="pending-banner">
          <div className="pending-banner-content">
            <strong>{t('skillHeader.scanInProgress')}</strong>
            <p>{t('skillHeader.scanDescription')}</p>
          </div>
        </div>
      ) : modInfo?.isMalwareBlocked ? (
        <div className="pending-banner pending-banner-blocked">
          <div className="pending-banner-content">
            <strong>{t('skillHeader.blockedTitle')}</strong>
            <p>{t('skillHeader.blockedDescription')}</p>
          </div>
        </div>
      ) : modInfo?.isSuspicious ? (
        <div className="pending-banner pending-banner-warning">
          <div className="pending-banner-content">
            <strong>{t('skillHeader.suspiciousTitle')}</strong>
            <p>{t('skillHeader.suspiciousDescription')}</p>
            {canManage ? (
              <p className="pending-banner-appeal">
                If you believe this skill has been incorrectly flagged, please{' '}
                <a
                  href="https://github.com/openclaw/clawhub/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  submit an issue on GitHub
                </a>{' '}
                and we'll break down why it was flagged and what you can do.
              </p>
            ) : null}
          </div>
        </div>
      ) : modInfo?.isRemoved ? (
        <div className="pending-banner pending-banner-blocked">
          <div className="pending-banner-content">
            <strong>{t('skillHeader.removedTitle')}</strong>
            <p>{t('skillHeader.removedDescription')}</p>
          </div>
        </div>
      ) : modInfo?.isHiddenByMod ? (
        <div className="pending-banner pending-banner-blocked">
          <div className="pending-banner-content">
            <strong>{t('skillHeader.hiddenTitle')}</strong>
            <p>{t('skillHeader.hiddenDescription')}</p>
          </div>
        </div>
      ) : null}

      <div className="card skill-hero">
        <div className={`skill-hero-top${hasPluginBundle ? ' has-plugin' : ''}`}>
          <div className="skill-hero-header">
            <div className="skill-hero-title">
              <div className="skill-hero-title-row">
                <h1 className="section-title" style={{ margin: 0 }}>
                  {skill.displayName}
                </h1>
                {nixPlugin ? <span className="tag tag-accent">{t('skillHeader.pluginBundle')}</span> : null}
              </div>
              <p className="section-subtitle">{skill.summary ?? t('skillHeader.noSummary')}</p>

              {isStaff && staffModerationNote ? (
                <div className="skill-hero-note">{staffModerationNote}</div>
              ) : null}
              {nixPlugin ? (
                <div className="skill-hero-note">
                  {t('skillHeader.bundleNote')}
                </div>
              ) : null}
              <div className="stat">
                ⭐ {formattedStats.stars} · <Package size={14} aria-hidden="true" />{' '}
                {formattedStats.downloads} · {formatCompactStat(skill.stats.installsCurrent ?? 0)} {t('skillHeader.currentInstalls')} · {formattedStats.installsAllTime} {t('skillHeader.allTimeInstalls')}
              </div>
              <div className="stat">
                <UserBadge user={owner} fallbackHandle={ownerHandle} prefix="by" size="md" showName />
              </div>
              {forkOf && forkOfHref ? (
                <div className="stat">
                  {forkOfLabel}{' '}
                  <a href={forkOfHref}>
                    {forkOfOwnerHandle ? `@${forkOfOwnerHandle}/` : ''}
                    {forkOf.skill.slug}
                  </a>
                  {forkOf.version ? ` (based on ${forkOf.version})` : null}
                </div>
              ) : null}
              {canonicalHref ? (
                <div className="stat">
                  {t('skillHeader.canonical')}{' '}
                  <a href={canonicalHref}>
                    {canonicalOwnerHandle ? `@${canonicalOwnerHandle}/` : ''}
                    {canonical?.skill?.slug}
                  </a>
                </div>
              ) : null}
              {getSkillBadges(skill).map((badge) => (
                <div key={badge} className="tag">
                  {badge}
                </div>
              ))}
              {isStaff && staffVisibilityTag ? (
                <div className={`tag${isAutoHidden || isRemoved ? ' tag-accent' : ''}`}>
                  {staffVisibilityTag}
                </div>
              ) : null}
              <div className="skill-actions">
                {isAuthenticated ? (
                  <button
                    className={`star-toggle${isStarred ? ' is-active' : ''}`}
                    type="button"
                    onClick={onToggleStar}
                    aria-label={isStarred ? t('skillHeader.unstarSkill') : t('skillHeader.starSkill')}
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <button className="btn btn-ghost" type="button" onClick={onOpenReport}>
                    {t('skillHeader.report')}
                  </button>
                ) : null}
                {isStaff ? (
                  <Link className="btn" to="/management" search={{ skill: skill.slug }}>
                    {t('skillHeader.manage')}
                  </Link>
                ) : null}
              </div>
              <SecurityScanResults
                sha256hash={latestVersion?.sha256hash}
                vtAnalysis={latestVersion?.vtAnalysis}
                llmAnalysis={latestVersion?.llmAnalysis as LlmAnalysis | undefined}
              />
              {latestVersion?.sha256hash || latestVersion?.llmAnalysis ? (
                <p className="scan-disclaimer">
                  {t('skillHeader.securityDisclaimer')}
                </p>
              ) : null}
            </div>
            <div className="skill-hero-cta">
              <div className="skill-version-pill">
                <span className="skill-version-label">{t('skillHeader.currentVersion')}</span>
                <strong>v{latestVersion?.version ?? '—'}</strong>
              </div>
              {!nixPlugin && !modInfo?.isMalwareBlocked && !modInfo?.isRemoved ? (
                <a
                  className="btn btn-primary"
                  href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/download?slug=${skill.slug}`}
                >
                  {t('skillHeader.downloadZip')}
                </a>
              ) : null}
            </div>
          </div>
          {hasPluginBundle ? (
            <div className="skill-panel bundle-card">
              <div className="bundle-header">
                <div className="bundle-title">{t('skillHeader.pluginBundle')}</div>
                <div className="bundle-subtitle">{t('skillHeader.skillPack')}</div>
              </div>
              <div className="bundle-includes">
                <span>{t('skillHeader.skillMd')}</span>
                <span>{t('skillHeader.cli')}</span>
                <span>{t('skillHeader.config')}</span>
              </div>
              {configRequirements ? (
                <div className="bundle-section">
                  <div className="bundle-section-title">{t('skillHeader.configRequirements')}</div>
                  <div className="bundle-meta">
                    {configRequirements.requiredEnv?.length ? (
                      <div className="stat">
                        <strong>{t('skillHeader.requiredEnv')}</strong>
                        <span>{configRequirements.requiredEnv.join(', ')}</span>
                      </div>
                    ) : null}
                    {configRequirements.stateDirs?.length ? (
                      <div className="stat">
                        <strong>{t('skillHeader.stateDirs')}</strong>
                        <span>{configRequirements.stateDirs.join(', ')}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {cliHelp ? (
                <details className="bundle-section bundle-details">
                  <summary>{t('skillHeader.cliHelp')}</summary>
                  <pre className="hero-install-code mono">{cliHelp}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="skill-tag-row">
          {tagEntries.length === 0 ? (
            <span className="section-subtitle" style={{ margin: 0 }}>
              {t('skillHeader.noTags')}
            </span>
          ) : (
            tagEntries.map(([tag, versionId]) => (
              <span key={tag} className="tag">
                {tag}
                <span className="tag-meta">v{versionById.get(versionId)?.version ?? versionId}</span>
              </span>
            ))
          )}
        </div>

        {canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onTagSubmit()
            }}
            className="tag-form"
          >
            <input
              className="search-input"
              value={tagName}
              onChange={(event) => onTagNameChange(event.target.value)}
              placeholder="latest"
            />
            <select
              className="search-input"
              value={tagVersionId ?? ''}
              onChange={(event) => onTagVersionChange(event.target.value as Id<'skillVersions'>)}
            >
              {tagVersions.map((version) => (
                <option key={version._id} value={version._id}>
                  v{version.version}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              {t('skillHeader.updateTag')}
            </button>
          </form>
        ) : null}

        <SkillInstallCard clawdis={clawdis} osLabels={osLabels} />
      </div>
    </>
  )
}
