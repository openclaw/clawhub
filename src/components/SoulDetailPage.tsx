import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import type { PublicSoul, PublicUser } from '../lib/publicUser'
import { isModerator } from '../lib/roles'
import { useAuthStatus } from '../lib/useAuthStatus'

type SoulDetailPageProps = {
  slug: string
}

type SoulBySlugResult = {
  soul: PublicSoul
  latestVersion: Doc<'soulVersions'> | null
  owner: PublicUser | null
} | null

export function SoulDetailPage({ slug }: SoulDetailPageProps) {
  const { isAuthenticated, me } = useAuthStatus()
  const result = useQuery(api.souls.getBySlug, { slug }) as SoulBySlugResult | undefined
  const toggleStar = useMutation(api.soulStars.toggle)
  const addComment = useMutation(api.soulComments.add)
  const removeComment = useMutation(api.soulComments.remove)
  const getReadme = useAction(api.souls.getReadme)
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds)
  const seedEnsuredRef = useRef(false)
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  const isLoadingSoul = result === undefined
  const soul = result?.soul
  const owner = result?.owner
  const latestVersion = result?.latestVersion
  const versions = useQuery(
    api.souls.listVersions,
    soul ? { soulId: soul._id, limit: 50 } : 'skip',
  ) as Doc<'soulVersions'>[] | undefined

  const isStarred = useQuery(
    api.soulStars.isStarred,
    isAuthenticated && soul ? { soulId: soul._id } : 'skip',
  )

  const comments = useQuery(
    api.soulComments.listBySoul,
    soul ? { soulId: soul._id, limit: 50 } : 'skip',
  ) as Array<{ comment: Doc<'soulComments'>; user: PublicUser | null }> | undefined

  const readmeContent = useMemo(() => {
    if (!readme) return null
    return stripFrontmatter(readme)
  }, [readme])

  useEffect(() => {
    if (seedEnsuredRef.current) return
    seedEnsuredRef.current = true
    void ensureSoulSeeds({})
  }, [ensureSoulSeeds])

  useEffect(() => {
    if (!latestVersion) return
    setReadme(null)
    setReadmeError(null)
    let cancelled = false
    void getReadme({ versionId: latestVersion._id })
      .then((data) => {
        if (cancelled) return
        setReadme(data.text)
      })
      .catch((error) => {
        if (cancelled) return
        setReadmeError(error instanceof Error ? error.message : 'Failed to load SOUL.md')
        setReadme(null)
      })
    return () => {
      cancelled = true
    }
  }, [latestVersion, getReadme])

  if (isLoadingSoul) {
    return (
      <main className="section">
        <div className="card">
          <div className="loading-indicator">Loading soul…</div>
        </div>
      </main>
    )
  }

  if (result === null || !soul) {
    return (
      <main className="section">
        <div className="card">Soul not found.</div>
      </main>
    )
  }

  const ownerHandle = owner?.handle ?? owner?.name ?? null
  const downloadBase = `${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/souls/${soul.slug}/file`

  return (
    <main className="section">
      <div className="skill-detail-stack">
        <div className="card skill-hero">
          <div className="skill-hero-header">
            <div className="skill-hero-title">
              <h1 className="section-title" style={{ margin: 0 }}>
                {soul.displayName}
              </h1>
              <p className="section-subtitle">{soul.summary ?? 'No summary provided.'}</p>
              <div className="stat">
                ⭐ {soul.stats.stars} · ⤓ {soul.stats.downloads} · {soul.stats.versions} versions
              </div>
              {ownerHandle ? (
                <div className="stat">
                  by <a href={`/u/${ownerHandle}`}>@{ownerHandle}</a>
                </div>
              ) : null}
              <div className="skill-actions">
                {isAuthenticated ? (
                  <button
                    className={`star-toggle${isStarred ? ' is-active' : ''}`}
                    type="button"
                    onClick={() => void toggleStar({ soulId: soul._id })}
                    aria-label={isStarred ? 'Unstar soul' : 'Star soul'}
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                ) : null}
              </div>
            </div>
            <div className="skill-hero-cta">
              <div className="skill-version-pill">
                <span className="skill-version-label">Current version</span>
                <strong>v{latestVersion?.version ?? '—'}</strong>
              </div>
              <a
                className="btn btn-primary"
                href={`${downloadBase}?path=SOUL.md`}
                aria-label="Download SOUL.md"
              >
                Download SOUL.md
              </a>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="skill-readme markdown">
            {readmeContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{readmeContent}</ReactMarkdown>
            ) : readmeError ? (
              <div className="stat">Failed to load SOUL.md: {readmeError}</div>
            ) : (
              <div className="loading-indicator">Loading SOUL.md…</div>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title" style={{ fontSize: '1.2rem', marginBottom: 8 }}>
            Versions
          </h2>
          <div className="version-scroll">
            <div className="version-list">
              {(versions ?? []).map((version) => (
                <div key={version._id} className="version-row">
                  <div className="version-info">
                    <div>
                      v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
                      {version.changelogSource === 'auto' ? (
                        <span style={{ color: 'var(--ink-soft)' }}> · auto</span>
                      ) : null}
                    </div>
                    <div style={{ color: '#5c554e', whiteSpace: 'pre-wrap' }}>
                      {version.changelog}
                    </div>
                  </div>
                  <div className="version-actions">
                    <a
                      className="btn version-zip"
                      href={`${downloadBase}?path=SOUL.md&version=${encodeURIComponent(
                        version.version,
                      )}`}
                    >
                      SOUL.md
                    </a>
                  </div>
                </div>
              ))}
            </div>
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
                void addComment({ soulId: soul._id, body: comment.trim() }).then(() =>
                  setComment(''),
                )
              }}
              className="comment-form"
            >
              <textarea
                className="comment-input"
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Leave a note…"
              />
              <button className="btn comment-submit" type="submit">
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
                <div key={entry.comment._id} className="comment-item">
                  <div className="comment-body">
                    <strong>@{entry.user?.handle ?? entry.user?.name ?? 'user'}</strong>
                    <div className="comment-body-text">{entry.comment.body}</div>
                  </div>
                  {isAuthenticated && me && (me._id === entry.comment.userId || isModerator(me)) ? (
                    <button
                      className="btn comment-delete"
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
