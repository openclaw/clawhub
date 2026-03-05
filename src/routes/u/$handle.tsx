import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { SkillCard } from '../../components/SkillCard'
import { SkillStatsTripletLine } from '../../components/SkillStats'
import { useI18n } from '../../i18n/useI18n'
import { getSkillBadges } from '../../lib/badges'
import type { PublicSkill, PublicUser } from '../../lib/publicUser'

export const Route = createFileRoute('/u/$handle')({
  component: UserProfile,
})

function UserProfile() {
  const { t } = useI18n()
  const { handle } = Route.useParams()
  const me = useQuery(api.users.me) as Doc<'users'> | null | undefined
  const user = useQuery(api.users.getByHandle, { handle }) as PublicUser | null | undefined
  const publishedSkills = useQuery(
    api.skills.list,
    user ? { ownerUserId: user._id, limit: 50 } : 'skip',
  ) as PublicSkill[] | undefined
  const starredSkills = useQuery(
    api.stars.listByUser,
    user ? { userId: user._id, limit: 50 } : 'skip',
  ) as PublicSkill[] | undefined

  const isSelf = Boolean(me && user && me._id === user._id)
  const [tab, setTab] = useState<'stars' | 'installed'>('stars')
  const [includeRemoved, setIncludeRemoved] = useState(false)
  const installed = useQuery(
    api.telemetry.getMyInstalled,
    isSelf && tab === 'installed' ? { includeRemoved } : 'skip',
  ) as TelemetryResponse | null | undefined

  useEffect(() => {
    if (!isSelf && tab === 'installed') setTab('stars')
  }, [isSelf, tab])

  if (user === undefined) {
    return (
      <main className="section">
        <div className="card">
          <div className="loading-indicator">{t('userProfile.loading')}</div>
        </div>
      </main>
    )
  }

  if (user === null) {
    return (
      <main className="section">
        <div className="card">{t('userProfile.notFound')}</div>
      </main>
    )
  }

  const avatar = user.image
  const displayName = user.displayName ?? user.name ?? user.handle ?? 'User'
  const displayHandle = user.handle ?? user.name ?? handle
  const initial = displayName.charAt(0).toUpperCase()
  const isLoadingSkills = starredSkills === undefined
  const skills = starredSkills ?? []
  const isLoadingPublished = publishedSkills === undefined
  const published = publishedSkills ?? []

  return (
    <main className="section">
      <div className="card settings-profile" style={{ marginBottom: 22 }}>
        <div className="settings-avatar" aria-hidden="true">
          {avatar ? <img src={avatar} alt="" /> : <span>{initial}</span>}
        </div>
        <div className="settings-profile-body">
          <div className="settings-name">{displayName}</div>
          <div className="settings-handle">@{displayHandle}</div>
        </div>
      </div>

      {isSelf ? (
        <div className="profile-tabs" role="tablist" aria-label={t('userProfile.profileTabs')}>
          <button
            className={tab === 'stars' ? 'profile-tab is-active' : 'profile-tab'}
            type="button"
            role="tab"
            aria-selected={tab === 'stars'}
            onClick={() => setTab('stars')}
          >
            {t('userProfile.starsTab')}
          </button>
          <button
            className={tab === 'installed' ? 'profile-tab is-active' : 'profile-tab'}
            type="button"
            role="tab"
            aria-selected={tab === 'installed'}
            onClick={() => setTab('installed')}
          >
            {t('userProfile.installedTab')}
          </button>
        </div>
      ) : null}

      {tab === 'installed' && isSelf ? (
        <InstalledSection
          includeRemoved={includeRemoved}
          onToggleRemoved={() => setIncludeRemoved((value) => !value)}
          data={installed}
        />
      ) : (
        <>
          <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
            {t('userProfile.published')}
          </h2>
          <p className="section-subtitle">{t('userProfile.publishedSubtitle')}</p>

          {isLoadingPublished ? (
            <div className="card">
              <div className="loading-indicator">{t('userProfile.loadingPublished')}</div>
            </div>
          ) : published.length > 0 ? (
            <div className="grid" style={{ marginBottom: 18 }}>
              {published.map((skill) => (
                <SkillCard
                  key={skill._id}
                  skill={skill}
                  badge={getSkillBadges(skill)}
                  summaryFallback={t('userProfile.agentReady')}
                  meta={
                    <div className="stat">
                      <SkillStatsTripletLine stats={skill.stats} />
                    </div>
                  }
                />
              ))}
            </div>
          ) : null}

          <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
            {t('userProfile.starsTitle')}
          </h2>
          <p className="section-subtitle">{t('userProfile.starsSubtitle')}</p>

          {isLoadingSkills ? (
            <div className="card">
              <div className="loading-indicator">{t('userProfile.loadingStars')}</div>
            </div>
          ) : skills.length === 0 ? (
            <div className="card">{t('userProfile.noStars')}</div>
          ) : (
            <div className="grid">
              {skills.map((skill) => (
                <SkillCard
                  key={skill._id}
                  skill={skill}
                  badge={getSkillBadges(skill)}
                  summaryFallback={t('userProfile.agentReady')}
                  meta={
                    <div className="stat">
                      <SkillStatsTripletLine stats={skill.stats} />
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}

function InstalledSection(props: {
  includeRemoved: boolean
  onToggleRemoved: () => void
  data: TelemetryResponse | null | undefined
}) {
  const { t } = useI18n()
  const clearTelemetry = useMutation(api.telemetry.clearMyTelemetry)
  const [showRaw, setShowRaw] = useState(false)
  const data = props.data
  if (data === undefined) {
    return (
      <>
        <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
          {t('userProfile.installed')}
        </h2>
        <div className="card">
          <div className="loading-indicator">Loading telemetry…</div>
        </div>
      </>
    )
  }

  if (data === null) {
    return (
      <>
        <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
          {t('userProfile.installed')}
        </h2>
        <div className="card">Sign in to view your installed skills.</div>
      </>
    )
  }

  return (
    <>
      <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
        {t('userProfile.installed')}
      </h2>
      <p className="section-subtitle" style={{ maxWidth: 760 }}>
        {t('userProfile.installedSubtitle')}
      </p>
      <div className="profile-actions">
        <button className="btn" type="button" onClick={props.onToggleRemoved}>
          {props.includeRemoved ? t('userProfile.hideRemoved') : t('userProfile.showRemoved')}
        </button>
        <button className="btn" type="button" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? t('userProfile.hideJson') : t('userProfile.showJson')}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (!window.confirm(t('userProfile.deleteTelemetryConfirm'))) return
            void clearTelemetry()
          }}
        >
          {t('userProfile.deleteTelemetry')}
        </button>
      </div>

      {showRaw ? (
        <div className="card telemetry-json" style={{ marginBottom: 18 }}>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : null}

      {data.roots.length === 0 ? (
        <div className="card">{t('userProfile.noTelemetry')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {data.roots.map((root) => (
            <div key={root.rootId} className="card telemetry-root">
              <div className="telemetry-root-header">
                <div>
                  <div className="telemetry-root-title">{root.label}</div>
                  <div className="telemetry-root-meta">
                    {t('userProfile.lastSync', { date: new Date(root.lastSeenAt).toLocaleString() })}
                    {root.expiredAt ? ` · ${t('userProfile.stale')}` : ''}
                  </div>
                </div>
                <div className="tag">{t('userProfile.skillsCount', { count: String(root.skills.length) })}</div>
              </div>
              {root.skills.length === 0 ? (
                <div className="stat">{t('userProfile.noSkillsInRoot')}</div>
              ) : (
                <div className="telemetry-skill-list">
                  {root.skills.map((entry) => (
                    <div key={`${root.rootId}:${entry.skill.slug}`} className="telemetry-skill-row">
                      <a
                        className="telemetry-skill-link"
                        href={`/${encodeURIComponent(String(entry.skill.ownerUserId))}/${entry.skill.slug}`}
                      >
                        <span>{entry.skill.displayName}</span>
                        <span className="telemetry-skill-slug">/{entry.skill.slug}</span>
                      </a>
                      <div className="telemetry-skill-meta mono">
                        {entry.lastVersion ? `v${entry.lastVersion}` : 'v?'}{' '}
                        {entry.removedAt ? `· ${t('userProfile.removed')}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

type TelemetryResponse = {
  roots: Array<{
    rootId: string
    label: string
    firstSeenAt: number
    lastSeenAt: number
    expiredAt?: number
    skills: Array<{
      skill: {
        slug: string
        displayName: string
        summary?: string
        stats: unknown
        ownerUserId: string
      }
      firstSeenAt: number
      lastSeenAt: number
      lastVersion?: string
      removedAt?: number
    }>
  }>
  cutoffDays: number
}
