import { useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import type { PublicSoul, PublicUser } from '../lib/publicUser'
import { isModerator } from '../lib/roles'
import { useAuthStatus } from '../lib/useAuthStatus'
import { PageShell } from './PageShell'
import { ResourceDetailShell } from './ResourceDetailShell'
import { Button, buttonVariants } from './ui/button'
import { Card } from './ui/card'
import { Textarea } from './ui/textarea'

type SoulDetailPageProps = {
  slug: string
  canonicalOwner?: string
  redirectToCanonical?: boolean
}

type SoulBySlugResult = {
  soul: PublicSoul
  latestVersion: Doc<'soulVersions'> | null
  owner: PublicUser | null
} | null

export function SoulDetailPage({ slug, canonicalOwner, redirectToCanonical }: SoulDetailPageProps) {
  const navigate = useNavigate()
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

  const ownerHandle = owner?.handle ?? owner?.name ?? null
  const ownerParam = ownerHandle ?? (owner?._id ? String(owner._id) : null)
  const wantsCanonicalRedirect = Boolean(
    ownerParam &&
      (redirectToCanonical ||
        (typeof canonicalOwner === 'string' && canonicalOwner && canonicalOwner !== ownerParam)),
  )

  useEffect(() => {
    if (!wantsCanonicalRedirect || !ownerParam) return
    void navigate({
      to: '/souls/$owner/$slug',
      params: { owner: ownerParam, slug },
      replace: true,
    })
  }, [navigate, ownerParam, slug, wantsCanonicalRedirect])

  useEffect(() => {
    if (seedEnsuredRef.current) return
    seedEnsuredRef.current = true
    void ensureSoulSeeds({})
  }, [ensureSoulSeeds])

  const latestVersionId = latestVersion?._id

  const getReadmeRef = useRef(getReadme)

  useEffect(() => {
    getReadmeRef.current = getReadme
  }, [getReadme])

  useEffect(() => {
    if (!latestVersionId) return
    setReadme(null)
    setReadmeError(null)
    let cancelled = false
    void getReadmeRef
      .current({ versionId: latestVersionId })
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
  }, [latestVersionId])

  if (isLoadingSoul || wantsCanonicalRedirect) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">Loading soul…</Card>
        </PageShell>
      </main>
    )
  }

  if (result === null || !soul) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">Soul not found.</Card>
        </PageShell>
      </main>
    )
  }

  const downloadBase = `${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/souls/${soul.slug}/file`

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <ResourceDetailShell
          title={soul.displayName}
          subtitle={soul.summary ?? 'No summary provided.'}
          stats={
            <span>
              ⭐ {soul.stats.stars} · ⤓ {soul.stats.downloads} · {soul.stats.versions} versions
            </span>
          }
          ownerLine={
            ownerHandle ? (
              <span>
                by <a href={`/u/${ownerHandle}`}>@{ownerHandle}</a>
              </span>
            ) : null
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-[var(--radius)] border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                <div>Current version</div>
                <strong className="text-foreground">v{latestVersion?.version ?? '—'}</strong>
              </div>
              <a
                className={buttonVariants()}
                href={`${downloadBase}?path=SOUL.md`}
                aria-label="Download SOUL.md"
              >
                Download SOUL.md
              </a>
              {isAuthenticated ? (
                <Button
                  type="button"
                  variant={isStarred ? 'default' : 'outline'}
                  onClick={() => void toggleStar({ soulId: soul._id })}
                  aria-label={isStarred ? 'Unstar soul' : 'Star soul'}
                >
                  ★ {isStarred ? 'Starred' : 'Star'}
                </Button>
              ) : null}
            </div>
          }
        />

        <Card className="p-6">
          <div className="markdown">
            {readmeContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{readmeContent}</ReactMarkdown>
            ) : readmeError ? (
              <div className="text-sm text-muted-foreground">
                Failed to load SOUL.md: {readmeError}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Loading SOUL.md…</div>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Versions</h2>
          <div className="max-h-[360px] space-y-4 overflow-auto">
            {(versions ?? []).map((version) => (
              <div
                key={version._id}
                className="flex flex-col gap-2 rounded-[var(--radius)] border border-border p-4"
              >
                <div className="text-sm font-medium">
                  v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
                  {version.changelogSource === 'auto' ? (
                    <span className="text-xs text-muted-foreground"> · auto</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {version.changelog}
                </div>
                <div>
                  <a
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
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
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Comments</h2>
          {isAuthenticated ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!comment.trim()) return
                void addComment({ soulId: soul._id, body: comment.trim() }).then(() =>
                  setComment(''),
                )
              }}
              className="space-y-3"
            >
              <Textarea
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Leave a note…"
              />
              <Button type="submit">Post comment</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Sign in to comment.</p>
          )}
          <div className="space-y-3">
            {(comments ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No comments yet.</div>
            ) : (
              (comments ?? []).map((entry) => (
                <div
                  key={entry.comment._id}
                  className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-border p-4"
                >
                  <div className="space-y-1">
                    <strong className="text-sm">
                      @{entry.user?.handle ?? entry.user?.name ?? 'user'}
                    </strong>
                    <div className="text-sm text-muted-foreground">{entry.comment.body}</div>
                  </div>
                  {isAuthenticated && me && (me._id === entry.comment.userId || isModerator(me)) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void removeComment({ commentId: entry.comment._id })}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </PageShell>
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
