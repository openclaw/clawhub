import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { formatBytes } from '../lib/uploadUtils'
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

function ImportGitHub() {
  const { isAuthenticated, isLoading, me } = useAuthStatus()
  const previewImport = useAction(api.githubImport.previewGitHubImport)
  const previewCandidate = useAction(api.githubImport.previewGitHubImportCandidate)
  const importSkill = useAction(api.githubImport.importGitHubSkill)
  const navigate = useNavigate()

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
        setStatus(`Found ${items.length} skills. Pick one.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
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
      setStatus('Ready to import.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
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
    setIsBusy(true)
    setError(null)
    setStatus('Importing…')
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
      setStatus('Imported.')
      const ownerParam = me?.handle ?? (me?._id ? String(me._id) : 'unknown')
      await navigate({ to: '/$owner/$slug', params: { owner: ownerParam, slug: nextSlug } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStatus(null)
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="section">
        <div className="card">
          {isLoading ? 'Loading…' : 'Sign in to import and publish skills.'}
        </div>
      </main>
    )
  }

  return (
    <main className="section upload-shell">
      <div className="upload-header">
        <div>
          <div className="upload-kicker">GitHub import</div>
          <h1 className="upload-title">Import from GitHub</h1>
          <p className="upload-subtitle">Public repos only. Detects SKILL.md automatically.</p>
        </div>
        <div className="upload-badge">
          <div>Public only</div>
          <div className="upload-badge-sub">Commit pinned</div>
        </div>
      </div>

      <div className="upload-card">
        <div className="upload-fields">
          <label className="upload-field" htmlFor="github-url">
            <div className="upload-field-header">
              <strong>GitHub URL</strong>
              <span className="upload-field-hint">Repo, tree path, or blob</span>
            </div>
            <input
              id="github-url"
              className="upload-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
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
            Detect
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
          <h2 style={{ margin: 0 }}>Pick a skill</h2>
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
                <span className="mono">{candidate.path || '(repo root)'}</span>
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
                  <div className="upload-requirement ok">Commit pinned</div>
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
                  Select referenced
                </button>
                <button className="btn" type="button" disabled={isBusy} onClick={selectAll}>
                  Select all
                </button>
                <button className="btn" type="button" disabled={isBusy} onClick={clearAll}>
                  Clear
                </button>
              </div>
            </div>
            <div className="upload-muted">
              Selected: {selectedCount}/{preview.files.length} • {formatBytes(selectedBytes)}
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
                  selectedCount === 0
                }
                onClick={() => void doImport()}
              >
                Import + publish
              </button>
            </div>
          </div>
        </>
      ) : null}
    </main>
  )
}
