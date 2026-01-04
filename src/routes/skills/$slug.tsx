import { createFileRoute } from '@tanstack/react-router'
import type { ClawdisSkillMetadata, SkillInstallSpec } from 'clawdhub-schema'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'

export const Route = createFileRoute('/skills/$slug')({
  component: SkillDetail,
})

function SkillDetail() {
  const { slug } = Route.useParams()
  const { isAuthenticated } = useConvexAuth()
  const me = useQuery(api.users.me)
  const result = useQuery(api.skills.getBySlug, { slug })
  const toggleStar = useMutation(api.stars.toggle)
  const addComment = useMutation(api.comments.add)
  const removeComment = useMutation(api.comments.remove)
  const updateTags = useMutation(api.skills.updateTags)
  const getReadme = useAction(api.skills.getReadme)
  const [readme, setReadme] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [tagName, setTagName] = useState('latest')
  const [tagVersionId, setTagVersionId] = useState<Id<'skillVersions'> | ''>('')

  const skill = result?.skill
  const owner = result?.owner
  const latestVersion = result?.latestVersion
  const versions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 10 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined

  const isStarred = useQuery(
    api.stars.isStarred,
    isAuthenticated && skill ? { skillId: skill._id } : 'skip',
  )
  const comments = useQuery(
    api.comments.listBySkill,
    skill ? { skillId: skill._id, limit: 50 } : 'skip',
  ) as Array<{ comment: Doc<'comments'>; user: Doc<'users'> | null }> | undefined

  const canManage = Boolean(
    me && skill && (me._id === skill.ownerUserId || ['admin', 'moderator'].includes(me.role ?? '')),
  )

  const versionById = new Map<Id<'skillVersions'>, Doc<'skillVersions'>>(
    (versions ?? []).map((version) => [version._id, version]),
  )
  const clawdis = (latestVersion?.parsed as { clawdis?: ClawdisSkillMetadata } | undefined)?.clawdis
  const osLabels = useMemo(() => formatOsList(clawdis?.os), [clawdis?.os])
  const requirements = clawdis?.requires
  const installSpecs = clawdis?.install ?? []
  const readmeContent = useMemo(() => {
    if (!readme) return null
    return stripFrontmatter(readme)
  }, [readme])

  useEffect(() => {
    if (!latestVersion) return
    void getReadme({ versionId: latestVersion._id }).then((data) => {
      setReadme(data.text)
    })
  }, [latestVersion, getReadme])

  useEffect(() => {
    if (!tagVersionId && latestVersion) {
      setTagVersionId(latestVersion._id)
    }
  }, [latestVersion, tagVersionId])

  if (!skill) {
    return (
      <main className="section">
        <div className="card">Skill not found.</div>
      </main>
    )
  }

  const tagEntries = Object.entries(skill.tags ?? {}) as Array<[string, Id<'skillVersions'>]>

  return (
    <main className="section">
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <h1 className="section-title" style={{ margin: 0 }}>
              {skill.displayName}
            </h1>
            <p className="section-subtitle">{skill.summary ?? 'No summary provided.'}</p>
            <div className="stat">
              ⭐ {skill.stats.stars} · ⤓ {skill.stats.downloads} · v{latestVersion?.version}
            </div>
            {owner?.handle ? (
              <div className="stat">
                by <a href={`/u/${owner.handle}`}>@{owner.handle}</a>
              </div>
            ) : null}
            {skill.batch === 'highlighted' ? <div className="tag">Highlighted</div> : null}
            {isAuthenticated ? (
              <button
                className={`star-toggle${isStarred ? ' is-active' : ''}`}
                type="button"
                onClick={() => void toggleStar({ skillId: skill._id })}
                aria-label={isStarred ? 'Unstar skill' : 'Star skill'}
              >
                <span aria-hidden="true">★</span>
              </button>
            ) : null}
          </div>
          <div className="card">
            <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
              SKILL.md
            </h2>
            <div className="markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {readmeContent ?? 'Loading…'}
              </ReactMarkdown>
            </div>
          </div>
          <div className="card">
            <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
              Comments
            </h2>
            {isAuthenticated ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!comment.trim()) return
                  void addComment({ skillId: skill._id, body: comment.trim() }).then(() =>
                    setComment(''),
                  )
                }}
                style={{ display: 'grid', gap: 10, marginTop: 12 }}
              >
                <textarea
                  className="search-input"
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Leave a note…"
                />
                <button className="btn" type="submit">
                  Post comment
                </button>
              </form>
            ) : (
              <p className="section-subtitle">Sign in to comment.</p>
            )}
            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              {(comments ?? []).length === 0 ? (
                <div className="stat">No comments yet.</div>
              ) : (
                (comments ?? []).map((entry) => (
                  <div
                    key={entry.comment._id}
                    className="stat"
                    style={{ alignItems: 'flex-start' }}
                  >
                    <div>
                      <strong>@{entry.user?.handle ?? entry.user?.name ?? 'user'}</strong>
                      <div style={{ color: '#5c554e' }}>{entry.comment.body}</div>
                    </div>
                    {isAuthenticated &&
                    me &&
                    (me._id === entry.comment.userId ||
                      me.role === 'admin' ||
                      me.role === 'moderator') ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void removeComment({ commentId: entry.comment._id })}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          {clawdis ? (
            <div className="card">
              <h3 className="section-title" style={{ fontSize: '1.1rem', margin: 0 }}>
                Requirements
              </h3>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                {clawdis.emoji ? <div className="tag">{clawdis.emoji} Clawdis</div> : null}
                {osLabels.length ? (
                  <div className="stat">
                    <strong>OS</strong>
                    <span>{osLabels.join(' · ')}</span>
                  </div>
                ) : null}
                {requirements?.bins?.length ? (
                  <div className="stat">
                    <strong>Bins</strong>
                    <span>{requirements.bins.join(', ')}</span>
                  </div>
                ) : null}
                {requirements?.anyBins?.length ? (
                  <div className="stat">
                    <strong>Any bin</strong>
                    <span>{requirements.anyBins.join(', ')}</span>
                  </div>
                ) : null}
                {requirements?.env?.length ? (
                  <div className="stat">
                    <strong>Env</strong>
                    <span>{requirements.env.join(', ')}</span>
                  </div>
                ) : null}
                {requirements?.config?.length ? (
                  <div className="stat">
                    <strong>Config</strong>
                    <span>{requirements.config.join(', ')}</span>
                  </div>
                ) : null}
                {clawdis.primaryEnv ? (
                  <div className="stat">
                    <strong>Primary env</strong>
                    <span>{clawdis.primaryEnv}</span>
                  </div>
                ) : null}
              </div>
              {installSpecs.length ? (
                <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                  <div className="section-subtitle" style={{ margin: 0 }}>
                    Install
                  </div>
                  {installSpecs.map((spec, index) => {
                    const command = formatInstallCommand(spec)
                    return (
                      <div key={`${spec.id ?? spec.kind}-${index}`} className="stat">
                        <div>
                          <strong>{spec.label ?? formatInstallLabel(spec)}</strong>
                          {spec.bins?.length ? (
                            <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
                              Bins: {spec.bins.join(', ')}
                            </div>
                          ) : null}
                          {command ? <code>{command}</code> : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="card">
            <h3 className="section-title" style={{ fontSize: '1.1rem', margin: 0 }}>
              Versions
            </h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {(versions ?? []).map((version) => (
                <div key={version._id} className="stat" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div>
                      v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
                    </div>
                    <div style={{ color: '#5c554e' }}>{version.changelog}</div>
                  </div>
                  <a
                    className="btn"
                    href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/download?slug=${skill.slug}&version=${version.version}`}
                  >
                    Zip
                  </a>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="section-title" style={{ fontSize: '1.1rem', margin: 0 }}>
              Tags
            </h3>
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {tagEntries.map(([tag, versionId]) => (
                <div key={tag} className="stat">
                  <strong>{tag}</strong>
                  <span>{versionById.get(versionId)?.version ?? versionId}</span>
                </div>
              ))}
            </div>
            {canManage ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!tagName.trim() || !tagVersionId) return
                  void updateTags({
                    skillId: skill._id,
                    tags: [{ tag: tagName.trim(), versionId: tagVersionId }],
                  })
                }}
                style={{ display: 'grid', gap: 10, marginTop: 16 }}
              >
                <input
                  className="search-input"
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  placeholder="latest"
                />
                <select
                  className="search-input"
                  value={tagVersionId ?? ''}
                  onChange={(event) => setTagVersionId(event.target.value as Id<'skillVersions'>)}
                >
                  {(versions ?? []).map((version) => (
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
          </div>
          <div className="card">
            <h3 className="section-title" style={{ fontSize: '1.1rem', margin: 0 }}>
              Download
            </h3>
            <a
              className="btn btn-primary"
              href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/download?slug=${skill.slug}`}
            >
              Download zip
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}

function stripFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith('---')) return content
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return content
  return normalized.slice(endIndex + 4).replace(/^\n+/, '')
}

function formatOsList(os?: string[]) {
  if (!os?.length) return []
  return os.map((entry) => {
    const key = entry.trim().toLowerCase()
    if (key === 'darwin' || key === 'macos' || key === 'mac') return 'macOS'
    if (key === 'linux') return 'Linux'
    if (key === 'windows' || key === 'win32') return 'Windows'
    return entry
  })
}

function formatInstallLabel(spec: SkillInstallSpec) {
  if (spec.kind === 'brew') return 'Homebrew'
  if (spec.kind === 'node') return 'Node'
  if (spec.kind === 'go') return 'Go'
  if (spec.kind === 'uv') return 'uv'
  return 'Install'
}

function formatInstallCommand(spec: SkillInstallSpec) {
  if (spec.kind === 'brew' && spec.formula) {
    if (spec.tap && !spec.formula.includes('/')) {
      return `brew install ${spec.tap}/${spec.formula}`
    }
    return `brew install ${spec.formula}`
  }
  if (spec.kind === 'node' && spec.package) {
    return `npm i -g ${spec.package}`
  }
  if (spec.kind === 'go' && spec.module) {
    return `go install ${spec.module}`
  }
  if (spec.kind === 'uv' && spec.package) {
    return `uv tool install ${spec.package}`
  }
  return null
}
