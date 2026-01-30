import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import semver from 'semver'
import { api } from '../../convex/_generated/api'
import { PageShell } from '../components/PageShell'
import { SectionHeader } from '../components/SectionHeader'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { getSiteMode } from '../lib/site'
import { expandDroppedItems, expandFiles } from '../lib/uploadFiles'
import { useAuthStatus } from '../lib/useAuthStatus'
import {
  formatBytes,
  formatPublishError,
  hashFile,
  isTextFile,
  readText,
  uploadFile,
} from './upload/-utils'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const Route = createFileRoute('/upload')({
  validateSearch: (search) => ({
    updateSlug: typeof search.updateSlug === 'string' ? search.updateSlug : undefined,
  }),
  component: Upload,
})

export function Upload() {
  const { isAuthenticated, me } = useAuthStatus()
  const { updateSlug } = useSearch({ from: '/upload' })
  const siteMode = getSiteMode()
  const isSoulMode = siteMode === 'souls'
  const requiredFileLabel = isSoulMode ? 'SOUL.md' : 'SKILL.md'
  const contentLabel = isSoulMode ? 'soul' : 'skill'

  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl)
  const publishVersion = useAction(
    isSoulMode ? api.souls.publishVersion : api.skills.publishVersion,
  )
  const generateChangelogPreview = useAction(
    isSoulMode ? api.souls.generateChangelogPreview : api.skills.generateChangelogPreview,
  )
  const existingSkill = useQuery(
    api.skills.getBySlug,
    !isSoulMode && updateSlug ? { slug: updateSlug } : 'skip',
  )
  const existingSoul = useQuery(
    api.souls.getBySlug,
    isSoulMode && updateSlug ? { slug: updateSlug } : 'skip',
  )
  const existing = (isSoulMode ? existingSoul : existingSkill) as
    | {
        skill?: { slug: string; displayName: string }
        soul?: { slug: string; displayName: string }
        latestVersion?: { version: string }
      }
    | null
    | undefined

  const [hasAttempted, setHasAttempted] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [slug, setSlug] = useState(updateSlug ?? '')
  const [displayName, setDisplayName] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [tags, setTags] = useState('latest')
  const [changelog, setChangelog] = useState('')
  const [changelogStatus, setChangelogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [changelogSource, setChangelogSource] = useState<'auto' | 'user' | null>(null)
  const changelogTouchedRef = useRef(false)
  const changelogRequestRef = useRef(0)
  const changelogKeyRef = useRef<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const isSubmitting = status !== null
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const validationRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const maxBytes = 50 * 1024 * 1024
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])
  const stripRoot = useMemo(() => {
    if (files.length === 0) return null
    const paths = files.map((file) => (file.webkitRelativePath || file.name).replace(/^\.\//, ''))
    if (!paths.every((path) => path.includes('/'))) return null
    const firstSegment = paths[0]?.split('/')[0]
    if (!firstSegment) return null
    if (!paths.every((path) => path.startsWith(`${firstSegment}/`))) return null
    return firstSegment
  }, [files])
  const normalizedPaths = useMemo(
    () =>
      files.map((file) => {
        const raw = (file.webkitRelativePath || file.name).replace(/^\.\//, '')
        if (stripRoot && raw.startsWith(`${stripRoot}/`)) {
          return raw.slice(stripRoot.length + 1)
        }
        return raw
      }),
    [files, stripRoot],
  )
  const hasRequiredFile = useMemo(
    () =>
      normalizedPaths.some((path) => {
        const lower = path.trim().toLowerCase()
        return isSoulMode ? lower === 'soul.md' : lower === 'skill.md' || lower === 'skills.md'
      }),
    [isSoulMode, normalizedPaths],
  )
  const sizeLabel = totalBytes ? formatBytes(totalBytes) : '0 B'
  const trimmedSlug = slug.trim()
  const trimmedName = displayName.trim()
  const trimmedChangelog = changelog.trim()

  useEffect(() => {
    if (!existing?.latestVersion || (!existing?.skill && !existing?.soul)) return
    const name = existing.skill?.displayName ?? existing.soul?.displayName
    const nextSlug = existing.skill?.slug ?? existing.soul?.slug
    if (nextSlug) setSlug(nextSlug)
    if (name) setDisplayName(name)
    const nextVersion = semver.inc(existing.latestVersion.version, 'patch')
    if (nextVersion) setVersion(nextVersion)
  }, [existing])

  useEffect(() => {
    if (changelogTouchedRef.current) return
    if (trimmedChangelog) return
    if (!trimmedSlug || !SLUG_PATTERN.test(trimmedSlug)) return
    if (!semver.valid(version)) return
    if (!hasRequiredFile) return
    if (files.length === 0) return

    const requiredIndex = normalizedPaths.findIndex((path) => {
      const lower = path.trim().toLowerCase()
      return isSoulMode ? lower === 'soul.md' : lower === 'skill.md' || lower === 'skills.md'
    })
    if (requiredIndex < 0) return

    const requiredFile = files[requiredIndex]
    if (!requiredFile) return

    const key = `${trimmedSlug}:${version}:${requiredFile.size}:${requiredFile.lastModified}:${normalizedPaths.length}`
    if (changelogKeyRef.current === key) return
    changelogKeyRef.current = key

    const requestId = ++changelogRequestRef.current
    setChangelogStatus('loading')

    void readText(requiredFile)
      .then((text) => {
        if (changelogRequestRef.current !== requestId) return null
        return generateChangelogPreview({
          slug: trimmedSlug,
          version,
          readmeText: text.slice(0, 20_000),
          filePaths: normalizedPaths,
        })
      })
      .then((result) => {
        if (!result) return
        if (changelogRequestRef.current !== requestId) return
        setChangelog(result.changelog)
        setChangelogSource('auto')
        setChangelogStatus('ready')
      })
      .catch(() => {
        if (changelogRequestRef.current !== requestId) return
        setChangelogStatus('error')
      })
  }, [
    files,
    generateChangelogPreview,
    hasRequiredFile,
    isSoulMode,
    normalizedPaths,
    trimmedChangelog,
    trimmedSlug,
    version,
  ])
  const parsedTags = useMemo(
    () =>
      tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  )
  const validation = useMemo(() => {
    const issues: string[] = []
    if (!trimmedSlug) {
      issues.push('Slug is required.')
    } else if (!SLUG_PATTERN.test(trimmedSlug)) {
      issues.push('Slug must be lowercase and use dashes only.')
    }
    if (!trimmedName) {
      issues.push('Display name is required.')
    }
    if (!semver.valid(version)) {
      issues.push('Version must be valid semver (e.g. 1.0.0).')
    }
    if (parsedTags.length === 0) {
      issues.push('At least one tag is required.')
    }
    if (files.length === 0) {
      issues.push('Add at least one file.')
    }
    if (!hasRequiredFile) {
      issues.push(`${requiredFileLabel} is required.`)
    }
    const invalidFiles = files.filter((file) => !isTextFile(file))
    if (invalidFiles.length > 0) {
      issues.push(
        `Remove non-text files: ${invalidFiles
          .slice(0, 3)
          .map((file) => file.name)
          .join(', ')}`,
      )
    }
    if (totalBytes > maxBytes) {
      issues.push('Total file size exceeds 50MB.')
    }
    return {
      issues,
      ready: issues.length === 0,
    }
  }, [
    trimmedSlug,
    trimmedName,
    version,
    parsedTags.length,
    files,
    hasRequiredFile,
    totalBytes,
    requiredFileLabel,
  ])

  useEffect(() => {
    if (!fileInputRef.current) return
    fileInputRef.current.setAttribute('webkitdirectory', '')
    fileInputRef.current.setAttribute('directory', '')
  }, [])

  if (!isAuthenticated) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">
            Sign in to upload a {contentLabel}.
          </Card>
        </PageShell>
      </main>
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setHasAttempted(true)
    if (!validation.ready) {
      if (validationRef.current && 'scrollIntoView' in validationRef.current) {
        validationRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }
    setError(null)
    if (totalBytes > maxBytes) {
      setError('Total size exceeds 50MB per version.')
      return
    }
    if (!hasRequiredFile) {
      setError(`${requiredFileLabel} is required.`)
      return
    }
    setStatus('Uploading files…')

    const uploaded = [] as Array<{
      path: string
      size: number
      storageId: string
      sha256: string
      contentType?: string
    }>

    for (const file of files) {
      const uploadUrl = await generateUploadUrl()
      const rawPath = (file.webkitRelativePath || file.name).replace(/^\.\//, '')
      const path =
        stripRoot && rawPath.startsWith(`${stripRoot}/`)
          ? rawPath.slice(stripRoot.length + 1)
          : rawPath
      const sha256 = await hashFile(file)
      const storageId = await uploadFile(uploadUrl, file)
      uploaded.push({
        path,
        size: file.size,
        storageId,
        sha256,
        contentType: file.type || undefined,
      })
    }

    setStatus('Publishing…')
    try {
      const result = await publishVersion({
        slug: trimmedSlug,
        displayName: trimmedName,
        version,
        changelog: trimmedChangelog,
        tags: parsedTags,
        files: uploaded,
      })
      setStatus(null)
      setError(null)
      setHasAttempted(false)
      setChangelogSource('user')
      if (result) {
        const ownerParam = me?.handle ?? (me?._id ? String(me._id) : 'unknown')
        void navigate({
          to: isSoulMode ? '/souls/$owner/$slug' : '/skills/$owner/$slug',
          params: { owner: ownerParam, slug: trimmedSlug },
        })
      }
    } catch (error) {
      setStatus(null)
      setError(formatPublishError(error))
    }
  }

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <SectionHeader
          title={`Publish a ${contentLabel}`}
          description={`Drop a folder with ${requiredFileLabel} and text files. We'll handle the rest.`}
        />

        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Card className="space-y-4 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="slug">
                    Slug
                  </label>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    placeholder={`${contentLabel}-name`}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="displayName">
                    Display name
                  </label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={`My ${contentLabel}`}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="version">
                    Version
                  </label>
                  <Input
                    id="version"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="tags">
                    Tags
                  </label>
                  <Input
                    id="tags"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="latest, stable"
                  />
                </div>
              </div>
            </Card>

            <Card className="space-y-4 p-6">
              <div className="text-sm font-semibold">Files</div>
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border p-6 text-center text-sm text-muted-foreground transition ${
                  isDragging ? 'bg-muted/70' : 'bg-card'
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                  const items = event.dataTransfer.items
                  void (async () => {
                    const dropped = items?.length
                      ? await expandDroppedItems(items)
                      : Array.from(event.dataTransfer.files)
                    const next = await expandFiles(dropped)
                    setFiles(next)
                  })()
                }}
              >
                <input
                  ref={fileInputRef}
                  className="hidden"
                  id="upload-files"
                  data-testid="upload-input"
                  type="file"
                  multiple
                  // @ts-expect-error - non-standard attribute to allow folder selection
                  webkitdirectory=""
                  directory=""
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? [])
                    void expandFiles(picked).then((next) => setFiles(next))
                  }}
                />
                <div className="text-sm font-medium">Drop a folder</div>
                <div className="text-xs text-muted-foreground">
                  {files.length} files · {sizeLabel}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose folder
                </Button>
              </label>

              <div className="space-y-2 text-xs text-muted-foreground">
                {files.length === 0 ? (
                  <div>No files selected.</div>
                ) : (
                  normalizedPaths.map((path) => (
                    <div
                      key={path}
                      className="rounded-[var(--radius)] border border-border px-3 py-2"
                    >
                      {path}
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="space-y-4 p-6">
              <div className="text-sm font-semibold">Changelog</div>
              <Textarea
                id="changelog"
                rows={6}
                value={changelog}
                onChange={(event) => {
                  changelogTouchedRef.current = true
                  setChangelogSource('user')
                  setChangelog(event.target.value)
                }}
                placeholder={`Describe what changed in this ${contentLabel}...`}
              />
              <div className="text-xs text-muted-foreground">
                {changelogStatus === 'loading' ? 'Generating changelog…' : null}
                {changelogStatus === 'error' ? 'Could not auto-generate changelog.' : null}
                {changelogSource === 'auto' && changelog
                  ? 'Auto-generated changelog (edit as needed).'
                  : null}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="space-y-4 p-6" ref={validationRef}>
              <div className="text-sm font-semibold">Validation</div>
              {validation.issues.length === 0 ? (
                <div className="text-xs text-muted-foreground">All checks passed.</div>
              ) : (
                <ul className="list-disc space-y-2 pl-4 text-xs text-muted-foreground">
                  {validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {hasRequiredFile ? <Badge variant="secondary">{requiredFileLabel}</Badge> : null}
                {files.length ? <Badge variant="secondary">{files.length} files</Badge> : null}
                {totalBytes ? <Badge variant="secondary">{sizeLabel}</Badge> : null}
              </div>
            </Card>

            <Card className="space-y-3 p-6">
              {error ? (
                <div className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              ) : null}
              {status ? <div className="text-xs text-muted-foreground">{status}</div> : null}
              <Button type="submit" disabled={!validation.ready || isSubmitting}>
                Publish {contentLabel}
              </Button>
              {hasAttempted && !validation.ready ? (
                <div className="text-xs text-muted-foreground">
                  Fix validation issues to continue.
                </div>
              ) : null}
            </Card>
          </div>
        </form>
      </PageShell>
    </main>
  )
}
