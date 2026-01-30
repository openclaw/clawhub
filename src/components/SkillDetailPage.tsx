import { Link, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import type { MoltbotSkillMetadata, SkillInstallSpec } from 'molthub-schema'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { getSkillBadges } from '../lib/badges'
import type { PublicSkill, PublicUser } from '../lib/publicUser'
import { toCanonicalResourcePath } from '../lib/resources'
import { canManageSkill, isModerator } from '../lib/roles'
import { useAuthStatus } from '../lib/useAuthStatus'
import { PageShell } from './PageShell'
import { ResourceDetailShell } from './ResourceDetailShell'
import { SkillDiffCard } from './SkillDiffCard'
import { Badge } from './ui/badge'
import { Button, buttonVariants } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

type SkillDetailPageProps = {
  slug: string
  canonicalOwner?: string
  redirectToCanonical?: boolean
}

type SkillBySlugResult = {
  skill: PublicSkill
  latestVersion: Doc<'skillVersions'> | null
  owner: PublicUser | null
  forkOf: {
    kind: 'fork'
    version: string | null
    skill: { slug: string; displayName: string }
    owner: { handle: string | null; userId: Id<'users'> | null }
  } | null
} | null

type SkillFile = Doc<'skillVersions'>['files'][number]

export function SkillDetailPage({
  slug,
  canonicalOwner,
  redirectToCanonical,
}: SkillDetailPageProps) {
  const navigate = useNavigate()
  const { isAuthenticated, me } = useAuthStatus()
  const result = useQuery(api.skills.getBySlug, { slug }) as SkillBySlugResult | undefined
  const toggleStar = useMutation(api.stars.toggle)
  const reportSkill = useMutation(api.skills.report)
  const addComment = useMutation(api.comments.add)
  const removeComment = useMutation(api.comments.remove)
  const updateTags = useMutation(api.skills.updateTags)
  const getReadme = useAction(api.skills.getReadme)
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [tagName, setTagName] = useState('latest')
  const [tagVersionId, setTagVersionId] = useState<Id<'skillVersions'> | ''>('')
  const [activeTab, setActiveTab] = useState<'files' | 'compare' | 'versions'>('files')
  const tagNameInputId = useId()
  const tagVersionSelectId = useId()

  const isLoadingSkill = result === undefined
  const skill = result?.skill
  const owner = result?.owner
  const latestVersion = result?.latestVersion
  const versions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 50 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined
  const diffVersions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 200 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined

  const isStarred = useQuery(
    api.stars.isStarred,
    isAuthenticated && skill ? { skillId: skill._id } : 'skip',
  )
  const comments = useQuery(
    api.comments.listBySkill,
    skill ? { skillId: skill._id, limit: 50 } : 'skip',
  ) as Array<{ comment: Doc<'comments'>; user: PublicUser | null }> | undefined

  const canManage = canManageSkill(me, skill)
  const isStaff = isModerator(me)

  const ownerHandle = owner?.handle ?? owner?.name ?? null
  const ownerParam = ownerHandle ?? (owner?._id ? String(owner._id) : null)
  const wantsCanonicalRedirect = Boolean(
    ownerParam &&
      (redirectToCanonical ||
        (typeof canonicalOwner === 'string' && canonicalOwner && canonicalOwner !== ownerParam)),
  )

  const forkOf = result?.forkOf?.kind === 'fork' ? result?.forkOf : null
  const forkOfLabel = 'fork of'
  const forkOfOwnerHandle = forkOf?.owner?.handle ?? null
  const forkOfOwnerId = forkOf?.owner?.userId ?? null
  const forkOfHref = forkOf?.skill?.slug
    ? buildSkillHref(forkOfOwnerHandle, forkOfOwnerId, forkOf.skill.slug)
    : null

  useEffect(() => {
    if (!wantsCanonicalRedirect || !ownerParam) return
    void navigate({
      to: '/skills/$owner/$slug',
      params: { owner: ownerParam, slug },
      replace: true,
    })
  }, [navigate, ownerParam, slug, wantsCanonicalRedirect])

  const versionById = new Map<Id<'skillVersions'>, Doc<'skillVersions'>>(
    (diffVersions ?? versions ?? []).map((version) => [version._id, version]),
  )
  const moltbot = (latestVersion?.parsed as { moltbot?: MoltbotSkillMetadata } | undefined)?.moltbot
  const osLabels = useMemo(() => formatOsList(moltbot?.os), [moltbot?.os])
  const requirements = moltbot?.requires
  const installSpecs = moltbot?.install ?? []
  const nixPlugin = moltbot?.nix?.plugin
  const nixSystems = moltbot?.nix?.systems ?? []
  const nixSnippet = nixPlugin ? formatNixInstallSnippet(nixPlugin) : null
  const configRequirements = moltbot?.config
  const configExample = configRequirements?.example
    ? formatConfigSnippet(configRequirements.example)
    : null
  const cliHelp = moltbot?.cliHelp
  const hasRuntimeRequirements = Boolean(
    moltbot?.emoji ||
      osLabels.length ||
      requirements?.bins?.length ||
      requirements?.anyBins?.length ||
      requirements?.env?.length ||
      requirements?.config?.length ||
      moltbot?.primaryEnv,
  )
  const hasInstallSpecs = installSpecs.length > 0
  const hasPluginBundle = Boolean(nixSnippet || configRequirements || cliHelp)
  const readmeContent = useMemo(() => {
    if (!readme) return null
    return stripFrontmatter(readme)
  }, [readme])
  const latestFiles: SkillFile[] = latestVersion?.files ?? []

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
        setReadmeError(error instanceof Error ? error.message : 'Failed to load README')
        setReadme(null)
      })
    return () => {
      cancelled = true
    }
  }, [latestVersionId])

  useEffect(() => {
    if (!latestVersionId) return
    setTagVersionId((current) => (current ? current : latestVersionId))
  }, [latestVersionId])

  if (isLoadingSkill || wantsCanonicalRedirect) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">Loading skill…</Card>
        </PageShell>
      </main>
    )
  }

  if (result === null || !skill) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">Skill not found.</Card>
        </PageShell>
      </main>
    )
  }

  const tagEntries = Object.entries(skill.tags ?? {}) as Array<[string, Id<'skillVersions'>]>
  const tagVersionValue = tagVersionId ? String(tagVersionId) : ''

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <ResourceDetailShell
          title={skill.displayName}
          subtitle={skill.summary ?? 'No summary provided.'}
          badges={getSkillBadges(skill)}
          note={
            nixPlugin
              ? 'Bundles the skill pack, CLI binary, and config requirements in one Nix install.'
              : undefined
          }
          stats={
            <span>
              ⭐ {skill.stats.stars} stars · ⤓ {skill.stats.downloads} downloads · ⤒{' '}
              {skill.stats.installsCurrent ?? 0} current installs ·{' '}
              {skill.stats.installsAllTime ?? 0} total installs
            </span>
          }
          ownerLine={
            <div className="space-y-1">
              {owner?.handle ? (
                <div>
                  by <a href={`/u/${owner.handle}`}>@{owner.handle}</a>
                </div>
              ) : null}
              {forkOf && forkOfHref ? (
                <div>
                  {forkOfLabel}{' '}
                  <a href={forkOfHref}>
                    {forkOfOwnerHandle ? `@${forkOfOwnerHandle}/` : ''}
                    {forkOf.skill.slug}
                  </a>
                  {forkOf.version ? ` (based on ${forkOf.version})` : null}
                </div>
              ) : null}
            </div>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-[var(--radius)] border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                <div>Current version</div>
                <strong className="text-foreground">v{latestVersion?.version ?? '—'}</strong>
              </div>
              {!nixPlugin ? (
                <a
                  className={buttonVariants()}
                  href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/download?slug=${skill.slug}`}
                >
                  Download zip
                </a>
              ) : null}
              {isAuthenticated ? (
                <Button
                  type="button"
                  variant={isStarred ? 'default' : 'outline'}
                  onClick={() => void toggleStar({ skillId: skill._id })}
                  aria-label={isStarred ? 'Unstar skill' : 'Star skill'}
                >
                  ★ {isStarred ? 'Starred' : 'Star'}
                </Button>
              ) : null}
              {isAuthenticated ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const reason = window.prompt('Report this skill? Add a reason if you want.')
                    if (reason === null) return
                    try {
                      const result = await reportSkill({
                        skillId: skill._id,
                        reason: reason.trim() || undefined,
                      })
                      if (result.reported) {
                        window.alert('Thanks — your report has been submitted.')
                      } else {
                        window.alert('You have already reported this skill.')
                      }
                    } catch (error) {
                      console.error('Failed to report skill', error)
                      window.alert('Unable to submit report. Please try again.')
                    }
                  }}
                >
                  Report
                </Button>
              ) : null}
              {isStaff ? (
                <Link
                  className={buttonVariants({ variant: 'outline' })}
                  to="/moderation"
                  search={{ skill: skill.slug, tab: 'queue' }}
                >
                  Moderation
                </Link>
              ) : null}
            </div>
          }
        />

        {hasPluginBundle ? (
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="font-display text-lg font-semibold">Plugin bundle (nix)</h2>
              <p className="text-sm text-muted-foreground">Skill pack · CLI binary · Config</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">SKILL.md</Badge>
              <Badge variant="secondary">CLI</Badge>
              <Badge variant="secondary">Config</Badge>
            </div>
            {configRequirements ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Config requirements</h3>
                {configRequirements.requiredEnv?.length ? (
                  <div className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Required env</strong> ·{' '}
                    {configRequirements.requiredEnv.join(', ')}
                  </div>
                ) : null}
                {configRequirements.stateDirs?.length ? (
                  <div className="text-xs text-muted-foreground">
                    <strong className="text-foreground">State dirs</strong> ·{' '}
                    {configRequirements.stateDirs.join(', ')}
                  </div>
                ) : null}
              </div>
            ) : null}
            {cliHelp ? (
              <details className="rounded-[var(--radius)] border border-border bg-muted px-4 py-3 text-xs">
                <summary className="cursor-pointer text-sm font-medium">
                  CLI help (from plugin)
                </summary>
                <pre className="mt-3 whitespace-pre-wrap font-mono text-xs">{cliHelp}</pre>
              </details>
            ) : null}
          </Card>
        ) : null}

        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2">
            {tagEntries.length === 0 ? (
              <span className="text-sm text-muted-foreground">No tags yet.</span>
            ) : (
              tagEntries.map(([tag, versionId]) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                  <span className="ml-2 text-xs text-muted-foreground">
                    v{versionById.get(versionId)?.version ?? versionId}
                  </span>
                </Badge>
              ))
            )}
          </div>

          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!tagName.trim() || !tagVersionId) return
                void updateTags({
                  skillId: skill._id,
                  tags: [
                    {
                      tag: tagName.trim(),
                      versionId: tagVersionId,
                    },
                  ],
                }).then(() => setTagName(''))
              }}
              className="flex flex-col gap-3 md:flex-row md:items-end"
            >
              <div className="flex-1">
                <label className="text-xs font-medium" htmlFor={tagNameInputId}>
                  Tag
                </label>
                <Input
                  id={tagNameInputId}
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium" htmlFor={tagVersionSelectId}>
                  Version
                </label>
                <Select
                  value={tagVersionValue}
                  onValueChange={(value) => setTagVersionId(value as Id<'skillVersions'>)}
                >
                  <SelectTrigger id={tagVersionSelectId}>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {(versions ?? []).map((version) => (
                      <SelectItem key={version._id} value={String(version._id)}>
                        v{version.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit">Add tag</Button>
            </form>
          ) : null}
        </Card>

        {(hasRuntimeRequirements || hasInstallSpecs) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {hasRuntimeRequirements ? (
              <Card className="space-y-4 p-6">
                <h2 className="font-display text-lg font-semibold">Runtime</h2>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {moltbot?.emoji ? (
                    <Badge variant="secondary">{moltbot.emoji} Moltbot</Badge>
                  ) : null}
                  {osLabels.length ? <span>OS: {osLabels.join(', ')}</span> : null}
                  {requirements?.bins?.length ? (
                    <span>Bins: {requirements.bins.join(', ')}</span>
                  ) : null}
                  {requirements?.anyBins?.length ? (
                    <span>Any bins: {requirements.anyBins.join(', ')}</span>
                  ) : null}
                  {requirements?.env?.length ? (
                    <span>Env: {requirements.env.join(', ')}</span>
                  ) : null}
                  {requirements?.config?.length ? (
                    <span>Config: {requirements.config.join(', ')}</span>
                  ) : null}
                  {moltbot?.primaryEnv ? <span>Primary env: {moltbot.primaryEnv}</span> : null}
                </div>
              </Card>
            ) : null}

            {hasInstallSpecs ? (
              <Card className="space-y-4 p-6">
                <h2 className="font-display text-lg font-semibold">Install</h2>
                <div className="space-y-2 text-xs text-muted-foreground">
                  {installSpecs.map((spec, index) => {
                    const label = formatInstallLabel(spec)
                    const command = formatInstallCommand(spec)
                    return (
                      <div key={`${spec.id ?? spec.kind}-${index}`}>
                        <strong className="text-foreground">{label}</strong>
                        {command ? <div className="font-mono text-xs">{command}</div> : null}
                      </div>
                    )
                  })}
                </div>
              </Card>
            ) : null}
          </div>
        )}

        {nixSnippet ? (
          <Card className="space-y-3 p-6">
            <h2 className="font-display text-lg font-semibold">Nix install</h2>
            <p className="text-sm text-muted-foreground">
              Available systems: {nixSystems.length ? nixSystems.join(', ') : 'Unspecified'}.
            </p>
            <pre className="rounded-[var(--radius)] border border-border bg-muted p-4 text-xs">
              {nixSnippet}
            </pre>
          </Card>
        ) : null}

        {configExample ? (
          <Card className="space-y-3 p-6">
            <h2 className="font-display text-lg font-semibold">Config example</h2>
            <pre className="rounded-[var(--radius)] border border-border bg-muted p-4 text-xs">
              {configExample}
            </pre>
          </Card>
        ) : null}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <TabsList>
            <TabsTrigger value="files">README</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="space-y-4">
            <Card className="p-6">
              <h2 className="font-display text-lg font-semibold">SKILL.md</h2>
              <div className="mt-4 markdown">
                {readmeContent ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{readmeContent}</ReactMarkdown>
                ) : readmeError ? (
                  <div className="text-sm text-muted-foreground">
                    Failed to load SKILL.md: {readmeError}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Loading SKILL.md…</div>
                )}
              </div>
            </Card>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">Files</h3>
                <span className="text-xs text-muted-foreground">
                  {latestFiles.length} file{latestFiles.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                {latestFiles.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No files available.</div>
                ) : (
                  latestFiles.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between border-b border-border pb-2 last:border-none"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{file.path}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>
          <TabsContent value="compare">
            <Card className="p-6">
              <SkillDiffCard skill={skill as Doc<'skills'>} versions={diffVersions ?? []} />
            </Card>
          </TabsContent>
          <TabsContent value="versions">
            <Card className="p-6">
              <h2 className="font-display text-lg font-semibold">Versions</h2>
              <p className="text-sm text-muted-foreground">Release history for this skill.</p>
              <div className="mt-4 max-h-[360px] space-y-4 overflow-auto">
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
                    <div className="flex flex-wrap gap-2">
                      <a
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/download?slug=${skill.slug}&version=${encodeURIComponent(
                          version.version,
                        )}`}
                      >
                        Download zip
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Comments</h2>
          {isAuthenticated ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!comment.trim()) return
                void addComment({ skillId: skill._id, body: comment.trim() }).then(() =>
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

function buildSkillHref(ownerHandle: string | null, ownerId: Id<'users'> | null, slug: string) {
  const owner = ownerHandle?.trim() || (ownerId ? String(ownerId) : 'unknown')
  return toCanonicalResourcePath('skill', owner, slug)
}

function formatConfigSnippet(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed || raw.includes('\n')) return raw
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    // fall through
  }

  let out = ''
  let indent = 0
  let inString = false
  let isEscaped = false

  const newline = () => {
    out = out.replace(/[ \t]+$/u, '')
    out += `\n${' '.repeat(indent * 2)}`
  }

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      out += ch
      if (isEscaped) {
        isEscaped = false
      } else if (ch === '\\') {
        isEscaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === '{' || ch === '[') {
      out += ch
      indent += 1
      newline()
      continue
    }

    if (ch === '}' || ch === ']') {
      indent = Math.max(0, indent - 1)
      newline()
      out += ch
      continue
    }

    if (ch === ';' || ch === ',') {
      out += ch
      newline()
      continue
    }

    if (ch === '\n' || ch === '\r' || ch === '\t') {
      continue
    }

    if (ch === ' ') {
      if (out.endsWith(' ') || out.endsWith('\n')) {
        continue
      }
      out += ' '
      continue
    }

    out += ch
  }

  return out.trim()
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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatNixInstallSnippet(plugin: string) {
  const snippet = `programs.moltbot.plugins = [ { source = "${plugin}"; } ];`
  return formatConfigSnippet(snippet)
}
