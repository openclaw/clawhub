import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { PageShell } from '../components/PageShell'
import { SectionHeader } from '../components/SectionHeader'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
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
      await navigate({
        to: '/skills/$owner/$slug',
        params: { owner: ownerParam, slug: nextSlug },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStatus(null)
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">
            {isLoading ? 'Loading…' : 'Sign in to import and publish skills.'}
          </Card>
        </PageShell>
      </main>
    )
  }

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <SectionHeader
          title="Import from GitHub"
          description="Public repos only. Detects SKILL.md automatically."
          actions={
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Public only</Badge>
              <Badge variant="secondary">Commit pinned</Badge>
            </div>
          }
        />

        <Card className="space-y-4 p-6">
          <div className="space-y-2">
            <label className="text-xs font-medium" htmlFor="github-url">
              GitHub URL
            </label>
            <Input
              id="github-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!url.trim() || isBusy} onClick={() => void detect()}>
              Detect
            </Button>
            {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
          </div>
          {error ? (
            <div className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </Card>

        {candidates.length > 1 ? (
          <Card className="space-y-3 p-6">
            <h2 className="font-display text-lg font-semibold">Pick a skill</h2>
            <div className="space-y-2 text-sm">
              {candidates.map((candidate) => (
                <label
                  key={candidate.path}
                  className="flex items-center gap-3 rounded-[var(--radius)] border border-border px-3 py-2"
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={selectedCandidatePath === candidate.path}
                    onChange={() => void loadCandidate(candidate.path)}
                    disabled={isBusy}
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {candidate.path || '(repo root)'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {candidate.name
                      ? candidate.name
                      : candidate.description
                        ? candidate.description
                        : ''}
                  </span>
                </label>
              ))}
            </div>
          </Card>
        ) : null}

        {preview ? (
          <>
            <Card className="space-y-4 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="slug">
                    Slug
                  </label>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="name">
                    Display name
                  </label>
                  <Input
                    id="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="version">
                    Version
                  </label>
                  <Input
                    id="version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor="tags">
                    Tags
                  </label>
                  <Input
                    id="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">Commit pinned</Badge>
                <span>
                  {preview.resolved.owner}/{preview.resolved.repo}@
                  {preview.resolved.commit.slice(0, 7)}
                </span>
                <span className="font-mono">{preview.candidate.path || 'repo root'}</span>
              </div>
            </Card>

            <Card className="space-y-4 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="font-display text-lg font-semibold">Files</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={applyDefaultSelection}
                  >
                    Select referenced
                  </Button>
                  <Button type="button" variant="outline" disabled={isBusy} onClick={selectAll}>
                    Select all
                  </Button>
                  <Button type="button" variant="outline" disabled={isBusy} onClick={clearAll}>
                    Clear
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Selected: {selectedCount}/{preview.files.length} • {formatBytes(selectedBytes)}
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                {preview.files.map((file) => (
                  <label
                    key={file.path}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[file.path])}
                        onChange={() =>
                          setSelected((prev) => ({ ...prev, [file.path]: !prev[file.path] }))
                        }
                        disabled={isBusy}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{file.path}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  </label>
                ))}
              </div>
              <Button
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
              </Button>
            </Card>
          </>
        ) : null}
      </PageShell>
    </main>
  )
}
