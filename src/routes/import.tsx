import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { getUserFacingConvexError } from '../lib/convexError'
import { getPublicSlugCollision } from '../lib/slugCollision'
import { formatBytes } from '../lib/uploadUtils'
import { useI18n } from '../i18n/useI18n'
import { useAuthStatus } from '../lib/useAuthStatus'

export const Route = createFileRoute('/import')({
  component: ImportGitHub,
})

type Candidate = {
  path: string
  readmePath: string
  name: string | null
  description: string | null
}

type CandidatePreview = {
  resolved: {
    owner: string
    repo: string
    ref: string
    commit: string
    path: string
    repoUrl: string
    originalUrl: string
  }
  candidate: Candidate
  defaults: {
    selectedPaths: string[]
    slug: string
    displayName: string
    version: string
    tags: string[]
  }
  files: Array<{ path: string; size: number; defaultSelected: boolean }>
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function ImportGitHub() {
  const { isAuthenticated, isLoading, me } = useAuthStatus()
  const previewImport = useAction(api.githubImport.previewGitHubImport)
  const previewCandidate = useAction(api.githubImport.previewGitHubImportCandidate)
  const importSkill = useAction(api.githubImport.importGitHubSkill)
  const navigate = useNavigate()
  const { t } = useI18n()

  const [url, setUrl] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selectedCandidatePath, setSelectedCandidatePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<CandidatePreview | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [version, setVersion] = useState('0.1.0')
  const [tags, setTags] = useState('latest')

  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const trimmedSlug = slug.trim()
  const slugAvailability = useQuery(
    api.skills.checkSlugAvailability,
    isAuthenticated && trimmedSlug && SLUG_PATTERN.test(trimmedSlug)
      ? { slug: trimmedSlug.toLowerCase() }
      : 'skip',
  ) as
    | {
        available: boolean
        reason: 'available' | 'taken' | 'reserved'
        message: string | null
        url: string | null
      }
    | null
    | undefined
  const slugCollision = useMemo(
    () =>
      getPublicSlugCollision({
        isSoulMode: false,
        slug: trimmedSlug,
        result: slugAvailability,
      }),
    [slugAvailability, trimmedSlug],
  )

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected])
  const selectedBytes = useMemo(() => {
    if (!preview) return 0
    let total = 0
    for (const file of preview.files) {
      if (selected[file.path]) total += file.size
    }
    return total
  }, [preview, selected])

  const detect = async () => {
    setError(null)
    setStatus(null)
    setPreview(null)
    setCandidates([])
    setSelectedCandidatePath(null)
    setSelected({})
    setIsBusy(true)
    try {
      const result = await previewImport({ url: url.trim() })
      const items = (result.candidates ?? []) as Candidate[]
      setCandidates(items)
      if (items.length === 1) {
        const only = items[0]
        if (only) await loadCandidate(only.path)
      } else {
        setStatus(t('import.foundSkills', { count: String(items.length) }))
      }
    } catch (e) {

      setError(getUserFacingConvexError(e, t('import.previewFailed')))

    } finally {
      setIsBusy(false)
    }
  }

  const loadCandidate = async (candidatePath: string) => {
    setError(null)
    setStatus(null)
    setPreview(null)
    setSelected({})
    setSelectedCandidatePath(candidatePath)
    setIsBusy(true)
    try {
      const result = (await previewCandidate({
        url: url.trim(),
        candidatePath,
      })) as CandidatePreview
      setPreview(result)
      setSlug(result.defaults.slug)
      setDisplayName(result.defaults.displayName)
      setVersion(result.defaults.version)
      setTags((result.defaults.tags ?? ['latest']).join(','))
      const nextSelected: Record<string, boolean> = {}
      for (const file of result.files) nextSelected[file.path] = file.defaultSelected
      setSelected(nextSelected)
      setStatus(t('import.readyToImport'))
    } catch (e) {

      setError(getUserFacingConvexError(e, t('import.previewFailed')))

    } finally {
      setIsBusy(false)
    }
  }

  const applyDefaultSelection = () => {
    if (!preview) return
    const set = new Set(preview.defaults.selectedPaths)
    const next: Record<string, boolean> = {}
    for (const file of preview.files) next[file.path] = set.has(file.path)
    setSelected(next)
  }

  const selectAll = () => {
    if (!preview) return
    const next: Record<string, boolean> = {}
    for (const file of preview.files) next[file.path] = true
    setSelected(next)
  }

  const clearAll = () => {
    if (!preview) return
    const next: Record<string, boolean> = {}
    for (const file of preview.files) next[file.path] = false
    setSelected(next)
  }

  const doImport = async () => {
    if (!preview) return
    if (slugCollision) {
      setError(slugCollision.message)
      return
    }
    setIsBusy(true)
    setError(null)
    setStatus(t('import.importing'))
    try {
      const selectedPaths = preview.files.map((file) => file.path).filter((path) => selected[path])
      const tagList = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
      const result = await importSkill({
        url: url.trim(),
        commit: preview.resolved.commit,
        candidatePath: preview.candidate.path,
        selectedPaths,
        slug: slug.trim(),
        displayName: displayName.trim(),
        version: version.trim(),
        tags: tagList,
      })
      const nextSlug = result.slug
      setStatus(t('import.imported'))
      const ownerParam = me?.handle ?? (me?._id ? String(me._id) : 'unknown')
      await navigate({ to: '/$owner/$slug', params: { owner: ownerParam, slug: nextSlug } })
    } catch (e) {

      setError(getUserFacingConvexError(e, t('import.importFailed')))

      setStatus(null)
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="section">
        <div className="card">
          {isLoading ? t('import.loading') : t('import.signInRequired')}
        </div>
      </main>
    )
  }

  return (
    <main className="section upload-shell">
      <div className="upload-header">
        <div>
          <div className="upload-kicker">{t('import.kicker')}</div>
          <h1 className="upload-title">{t('import.title')}</h1>
          <p className="upload-subtitle">{t('import.subtitle')}</p>
        </div>
        <div className="upload-badge">
          <div>{t('import.publicOnly')}</div>
          <div className="upload-badge-sub">{t('import.commitPinned')}</div>
        </div>
      </div>

      <div className="upload-card">
        <div className="upload-fields">
          <label className="upload-field" htmlFor="github-url">
            <div className="upload-field-header">
              <strong>{t('import.githubUrl')}</strong>
              <span className="upload-field-hint">{t('import.repoHint')}</span>
            </div>
            <input
              id="github-url"
              className="upload-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('import.placeholder')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="upload-footer">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!url.trim() || isBusy}
            onClick={() => void detect()}
          >
            {t('import.detect')}
          </button>
          {status ? <p className="upload-muted">{status}</p> : null}
        </div>

        {error ? (
          <div className="upload-validation">
            <div className="upload-validation-item upload-error">{error}</div>
          </div>
        ) : null}
      </div>

      {candidates.length > 1 ? (
        <div className="card">
          <h2 style={{ margin: 0 }}>{t('import.pickSkill')}</h2>
          <div className="upload-filelist">
            {candidates.map((candidate) => (
              <label key={candidate.path} className="upload-file">
                <input
                  type="radio"
                  name="candidate"
                  checked={selectedCandidatePath === candidate.path}
                  onChange={() => void loadCandidate(candidate.path)}
                  disabled={isBusy}
                />
                <span className="mono">{candidate.path || t('import.repoRoot')}</span>
                <span>
                  {candidate.name
                    ? candidate.name
                    : candidate.description
                      ? candidate.description
                      : ''}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="upload-card">
            <div className="upload-grid">
              <div className="upload-fields">
                <label className="upload-field" htmlFor="slug">
                  <div className="upload-field-header">
                    <strong>Slug</strong>
                    <span className="upload-field-hint">Unique, lowercase</span>
                  </div>
                  <input
                    id="slug"
                    className="upload-input"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </label>
                <label className="upload-field" htmlFor="name">
                  <div className="upload-field-header">
                    <strong>Display name</strong>
                    <span className="upload-field-hint">Shown in listings</span>
                  </div>
                  <input
                    id="name"
                    className="upload-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </label>
                <div className="upload-row">
                  <label className="upload-field" htmlFor="version">
                    <div className="upload-field-header">
                      <strong>Version</strong>
                      <span className="upload-field-hint">Semver</span>
                    </div>
                    <input
                      id="version"
                      className="upload-input"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="upload-field" htmlFor="tags">
                    <div className="upload-field-header">
                      <strong>Tags</strong>
                      <span className="upload-field-hint">Comma-separated</span>
                    </div>
                    <input
                      id="tags"
                      className="upload-input"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
              </div>
              <aside className="upload-side">
                <div className="upload-summary">
                  <div className="upload-requirement ok">{t('import.commitPinned')}</div>
                  <div className="upload-muted">
                    {preview.resolved.owner}/{preview.resolved.repo}@
                    {preview.resolved.commit.slice(0, 7)}
                  </div>
                  <div className="upload-muted mono">{preview.candidate.path || 'repo root'}</div>
                </div>
              </aside>
            </div>
          </div>

          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <h2 style={{ margin: 0 }}>Files</h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  type="button"
                  disabled={isBusy}
                  onClick={applyDefaultSelection}
                >
                  {t('import.selectReferenced')}
                </button>
                <button className="btn" type="button" disabled={isBusy} onClick={selectAll}>
                  {t('import.selectAll')}
                </button>
                <button className="btn" type="button" disabled={isBusy} onClick={clearAll}>
                  {t('import.clear')}
                </button>
              </div>
            </div>
            <div className="upload-muted">
              {t('import.selected', { selectedCount: String(selectedCount), totalCount: String(preview.files.length), size: formatBytes(selectedBytes) })}
            </div>
            <div className="file-list">
              {preview.files.map((file) => (
                <label key={file.path} className="file-row">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[file.path])}
                    onChange={() =>
                      setSelected((prev) => ({ ...prev, [file.path]: !prev[file.path] }))
                    }
                    disabled={isBusy}
                  />
                  <span className="mono file-path">{file.path}</span>
                  <span className="file-meta">{formatBytes(file.size)}</span>
                </label>
              ))}
            </div>
            <div className="upload-footer">
              <button
                className="btn btn-primary"
                type="button"
                disabled={
                  isBusy ||
                  !slug.trim() ||
                  !displayName.trim() ||
                  !version.trim() ||
                  selectedCount === 0 ||
                  Boolean(slugCollision)
                }
                onClick={() => void doImport()}
              >
                {t('import.importPublish')}
              </button>
              {slugCollision ? (
                <div className="upload-muted">
                  {slugCollision.message}
                  {slugCollision.url ? (
                    <>
                      {' '}
                      <a href={slugCollision.url} className="upload-link">
                        {slugCollision.url}
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </main>
  )
}
