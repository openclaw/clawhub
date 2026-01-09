import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import semver from 'semver'
import { api } from '../../convex/_generated/api'
import { getSiteMode } from '../lib/site'
import { expandFiles } from '../lib/uploadFiles'
import {
  formatBytes,
  formatPublishError,
  hashFile,
  isTextFile,
  readText,
  uploadFile,
} from '../lib/uploadUtils'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const Route = createFileRoute('/upload')({
  validateSearch: (search) => ({
    updateSlug: typeof search.updateSlug === 'string' ? search.updateSlug : undefined,
  }),
  component: Upload,
})

export function Upload() {
  const { isAuthenticated } = useConvexAuth()
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
      <main className="section">
        <div className="card">Sign in to upload a {contentLabel}.</div>
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
        void navigate({
          to: isSoulMode ? '/souls/$slug' : '/skills/$slug',
          params: { slug: trimmedSlug },
        })
      }
    } catch (error) {
      setStatus(null)
      setError(formatPublishError(error))
    }
  }

  return (
    <main className="section">
      <h1 className="section-title">Publish a {contentLabel}</h1>
      <p className="section-subtitle">
        Drop a folder with {requiredFileLabel} and text files. We will handle the rest.
      </p>

      <form onSubmit={handleSubmit} className="upload-grid">
        <div className="card">
          <label className="form-label" htmlFor="slug">
            Slug
          </label>
          <input
            className="form-input"
            id="slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={`${contentLabel}-name`}
          />

          <label className="form-label" htmlFor="displayName">
            Display name
          </label>
          <input
            className="form-input"
            id="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={`My ${contentLabel}`}
          />

          <label className="form-label" htmlFor="version">
            Version
          </label>
          <input
            className="form-input"
            id="version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="1.0.0"
          />

          <label className="form-label" htmlFor="tags">
            Tags
          </label>
          <input
            className="form-input"
            id="tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="latest, stable"
          />
        </div>

        <div className="card">
          <label
            className={`upload-dropzone${isDragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              const dropped = Array.from(event.dataTransfer.files)
              void expandFiles(dropped).then((next) => setFiles(next))
            }}
          >
            <input
              ref={fileInputRef}
              className="upload-input"
              id="upload-files"
              data-testid="upload-input"
              type="file"
              multiple
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                void expandFiles(picked).then((next) => setFiles(next))
              }}
            />
            <div className="upload-dropzone-copy">
              <strong>Drop a folder</strong>
              <span>
                {files.length} files · {sizeLabel}
              </span>
              <button className="btn" type="button" onClick={() => fileInputRef.current?.click()}>
                Choose folder
              </button>
            </div>
          </label>

          <div className="upload-file-list">
            {files.length === 0 ? (
              <div className="stat">No files selected.</div>
            ) : (
              normalizedPaths.map((path) => (
                <div key={path} className="upload-file-row">
                  <span>{path}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card" ref={validationRef}>
          <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
            Validation
          </h2>
          {validation.issues.length === 0 ? (
            <div className="stat">All checks passed.</div>
          ) : (
            <ul className="validation-list">
              {validation.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <label className="form-label" htmlFor="changelog">
            Changelog
          </label>
          <textarea
            className="form-input"
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
          {changelogStatus === 'loading' ? <div className="stat">Generating changelog…</div> : null}
          {changelogStatus === 'error' ? (
            <div className="stat">Could not auto-generate changelog.</div>
          ) : null}
          {changelogSource === 'auto' && changelog ? (
            <div className="stat">Auto-generated changelog (edit as needed).</div>
          ) : null}
        </div>

        <div className="card">
          {error ? (
            <div className="error" role="alert">
              {error}
            </div>
          ) : null}
          {status ? <div className="stat">{status}</div> : null}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!validation.ready || isSubmitting}
          >
            Publish {contentLabel}
          </button>
          {hasAttempted && !validation.ready ? (
            <div className="stat">Fix validation issues to continue.</div>
          ) : null}
        </div>
      </form>
    </main>
  )
}
