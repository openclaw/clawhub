import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { SkillCard } from '../../components/SkillCard'
import { SkillStatsTripletLine } from '../../components/SkillStats'
import { getSkillBadges } from '../../lib/badges'
import type { PublicSkill, PublicUser } from '../../lib/publicUser'

export const Route = createFileRoute('/u/$handle')({
  component: UserProfile,
})

function UserProfile() {
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
          <div className="loading-indicator">Loading user…</div>
        </div>
      </main>
    )
  }

  if (user === null) {
    return (
      <main className="section">
        <div className="card">User not found.</div>
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
        <div className="profile-tabs" role="tablist" aria-label="Profile tabs">
          <button
            className={tab === 'stars' ? 'profile-tab is-active' : 'profile-tab'}
            type="button"
            role="tab"
            aria-selected={tab === 'stars'}
            onClick={() => setTab('stars')}
          >
            Stars
          </button>
          <button
            className={tab === 'installed' ? 'profile-tab is-active' : 'profile-tab'}
            type="button"
            role="tab"
            aria-selected={tab === 'installed'}
            onClick={() => setTab('installed')}
          >
            Installed
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
            Published
          </h2>
          <p className="section-subtitle">Skills published by this user.</p>

          {isLoadingPublished ? (
            <div className="card">
              <div className="loading-indicator">Loading published skills…</div>
            </div>
          ) : published.length > 0 ? (
            <div className="grid" style={{ marginBottom: 18 }}>
              {published.map((skill) => (
                <SkillCard
                  key={skill._id}
                  skill={skill}
                  badge={getSkillBadges(skill)}
                  summaryFallback="Agent-ready skill pack."
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
            Stars
          </h2>
          <p className="section-subtitle">Skills this user has starred.</p>

          {isLoadingSkills ? (
            <div className="card">
              <div className="loading-indicator">Loading stars…</div>
            </div>
          ) : skills.length === 0 ? (
            <div className="card">No stars yet.</div>
          ) : (
            <div className="grid">
              {skills.map((skill) => (
                <SkillCard
                  key={skill._id}
                  skill={skill}
                  badge={getSkillBadges(skill)}
                  summaryFallback="Agent-ready skill pack."
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
  const clearTelemetry = useMutation(api.telemetry.clearMyTelemetry)
  const [showRaw, setShowRaw] = useState(false)
  const data = props.data
  if (data === undefined) {
    return (
      <>
        <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
          Installed
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
          Installed
        </h2>
        <div className="card">Sign in to view your installed skills.</div>
      </>
    )
  }

  return (
    <>
      <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
        Installed
      </h2>
      <p className="section-subtitle" style={{ maxWidth: 760 }}>
        Private view. Only you can see your folders/roots. Everyone else only sees aggregated
        install counts per skill.
      </p>
      <div className="profile-actions">
        <button className="btn" type="button" onClick={props.onToggleRemoved}>
          {props.includeRemoved ? 'Hide removed' : 'Show removed'}
        </button>
        <button className="btn" type="button" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? 'Hide JSON' : 'Show JSON'}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (!window.confirm('Delete all telemetry data?')) return
            void clearTelemetry()
          }}
        >
          Delete telemetry
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
        <div className="card">No telemetry yet. Run `clawhub sync` from the CLI.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {data.roots.map((root) => (
            <div key={root.rootId} className="card telemetry-root">
              <div className="telemetry-root-header">
                <div>
                  <div className="telemetry-root-title">{root.label}</div>
                  <div className="telemetry-root-meta">
                    Last sync {new Date(root.lastSeenAt).toLocaleString()}
                    {root.expiredAt ? ' · stale' : ''}
                  </div>
                </div>
                <div className="tag">{root.skills.length} skills</div>
              </div>
              {root.skills.length === 0 ? (
                <div className="stat">No skills found in this root.</div>
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
                        {entry.removedAt ? '· removed' : ''}
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
