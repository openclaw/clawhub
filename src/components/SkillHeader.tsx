import { Link } from '@tanstack/react-router'
import type { ClawdisSkillMetadata } from 'clawhub-schema'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { getSkillBadges } from '../lib/badges'
import { formatCompactStat, formatSkillStatsTriplet } from '../lib/numberFormat'
import type { PublicSkill, PublicUser } from '../lib/publicUser'
import { type LlmAnalysis, SecurityScanResults } from './SkillSecurityScanResults'
import { SkillInstallCard } from './SkillInstallCard'
import { UserBadge } from './UserBadge'

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

  return (
    <>
      {modInfo?.isPendingScan ? (
        <div className="pending-banner">
          <div className="pending-banner-content">
            <strong>Security scan in progress</strong>
            <p>
              Your skill is being scanned by VirusTotal. It will be visible to others once the scan
              completes. This usually takes up to 5 minutes — grab a coffee or exfoliate your shell
              while you wait.
            </p>
          </div>
        </div>
      ) : modInfo?.isMalwareBlocked ? (
        <div className="pending-banner pending-banner-blocked">
          <div className="pending-banner-content">
            <strong>Skill blocked — malicious content detected</strong>
            <p>
              ClawHub Security flagged this skill as malicious. Downloads are disabled. Review the
              scan results below.
            </p>
          </div>
        </div>
      ) : modInfo?.isSuspicious ? (
        <div className="pending-banner pending-banner-warning">
          <div className="pending-banner-content">
            <strong>Skill flagged — suspicious patterns detected</strong>
            <p>ClawHub Security flagged this skill as suspicious. Review the scan results before using.</p>
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
            <strong>Skill removed by moderator</strong>
            <p>This skill has been removed and is not visible to others.</p>
          </div>
        </div>
      ) : modInfo?.isHiddenByMod ? (
        <div className="pending-banner pending-banner-blocked">
          <div className="pending-banner-content">
            <strong>Skill hidden</strong>
            <p>This skill is currently hidden and not visible to others.</p>
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
                {nixPlugin ? <span className="tag tag-accent">Plugin bundle (nix)</span> : null}
              </div>
              <p className="section-subtitle">{skill.summary ?? 'No summary provided.'}</p>

              {isStaff && staffModerationNote ? (
                <div className="skill-hero-note">{staffModerationNote}</div>
              ) : null}
              {nixPlugin ? (
                <div className="skill-hero-note">
                  Bundles the skill pack, CLI binary, and config requirements in one Nix install.
                </div>
              ) : null}
              <div className="stat">
                ⭐ {formattedStats.stars} · ⤓ {formattedStats.downloads} · ⤒{' '}
                {formatCompactStat(skill.stats.installsCurrent ?? 0)} current ·{' '}
                {formattedStats.installsAllTime} all-time
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
                  canonical:{' '}
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
                    aria-label={isStarred ? 'Unstar skill' : 'Star skill'}
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <button className="btn btn-ghost" type="button" onClick={onOpenReport}>
                    Report
                  </button>
                ) : null}
                {isStaff ? (
                  <Link className="btn" to="/management" search={{ skill: skill.slug }}>
                    Manage
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
                  Like a lobster shell, security has layers — review code before you run it.
                </p>
              ) : null}
            </div>
            <div className="skill-hero-cta">
              <div className="skill-version-pill">
                <span className="skill-version-label">Current version</span>
                <strong>v{latestVersion?.version ?? '—'}</strong>
              </div>
              {!nixPlugin && !modInfo?.isMalwareBlocked && !modInfo?.isRemoved ? (
                <a
                  className="btn btn-primary"
                  href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/download?slug=${skill.slug}`}
                >
                  Download zip
                </a>
              ) : null}
            </div>
          </div>
          {hasPluginBundle ? (
            <div className="skill-panel bundle-card">
              <div className="bundle-header">
                <div className="bundle-title">Plugin bundle (nix)</div>
                <div className="bundle-subtitle">Skill pack · CLI binary · Config</div>
              </div>
              <div className="bundle-includes">
                <span>SKILL.md</span>
                <span>CLI</span>
                <span>Config</span>
              </div>
              {configRequirements ? (
                <div className="bundle-section">
                  <div className="bundle-section-title">Config requirements</div>
                  <div className="bundle-meta">
                    {configRequirements.requiredEnv?.length ? (
                      <div className="stat">
                        <strong>Required env</strong>
                        <span>{configRequirements.requiredEnv.join(', ')}</span>
                      </div>
                    ) : null}
                    {configRequirements.stateDirs?.length ? (
                      <div className="stat">
                        <strong>State dirs</strong>
                        <span>{configRequirements.stateDirs.join(', ')}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {cliHelp ? (
                <details className="bundle-section bundle-details">
                  <summary>CLI help (from plugin)</summary>
                  <pre className="hero-install-code mono">{cliHelp}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="skill-tag-row">
          {tagEntries.length === 0 ? (
            <span className="section-subtitle" style={{ margin: 0 }}>
              No tags yet.
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
              Update tag
            </button>
          </form>
        ) : null}

        <SkillInstallCard clawdis={clawdis} osLabels={osLabels} />
      </div>
    </>
  )
}
