import type { DiffEditorProps } from '@monaco-editor/react'
import { DiffEditor, useMonaco } from '@monaco-editor/react'
import { useAction } from 'convex/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import {
  buildFileDiffList,
  getDefaultDiffSelection,
  MAX_DIFF_FILE_BYTES,
  resolveLatestVersionId,
  resolvePreviousVersionId,
  selectDefaultFilePath,
  sortVersionsBySemver,
} from '../lib/diffing'
import { cn } from '../lib/utils'
import { ClientOnly } from './ClientOnly'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

type SkillDiffCardProps = {
  skill: Doc<'skills'>
  versions: Doc<'skillVersions'>[]
  variant?: 'card' | 'embedded'
}

type VersionOption = {
  value: Id<'skillVersions'>
  label: string
  group: 'Special' | 'Tags' | 'Versions'
  disabled?: boolean
}

type FileSide = 'left' | 'right'

type SizeWarning = {
  side: FileSide
  path: string
}

const EMPTY_DIFF_TEXT = ''

export function SkillDiffCard({ skill, versions, variant = 'card' }: SkillDiffCardProps) {
  const getFileText = useAction(api.skills.getFileText)
  const monaco = useMonaco()
  const [viewMode, setViewMode] = useState<'split' | 'inline'>('split')
  const [leftVersionId, setLeftVersionId] = useState<Id<'skillVersions'> | null>(null)
  const [rightVersionId, setRightVersionId] = useState<Id<'skillVersions'> | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [leftText, setLeftText] = useState(EMPTY_DIFF_TEXT)
  const [rightText, setRightText] = useState(EMPTY_DIFF_TEXT)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sizeWarning, setSizeWarning] = useState<SizeWarning | null>(null)
  const cacheRef = useRef(new Map<string, string>())
  const leftVersionSelectId = useId()
  const rightVersionSelectId = useId()

  const versionEntries = useMemo(
    () => versions.map((entry) => ({ id: entry._id, version: entry.version })),
    [versions],
  )
  const orderedVersions = useMemo(() => sortVersionsBySemver(versionEntries), [versionEntries])
  const versionById = useMemo(
    () => new Map(versions.map((entry) => [entry._id, entry])),
    [versions],
  )

  const latestId = useMemo(
    () => resolveLatestVersionId(versionEntries, skill.tags),
    [versionEntries, skill.tags],
  )
  const previousId = useMemo(
    () => resolvePreviousVersionId(versionEntries, latestId),
    [versionEntries, latestId],
  )

  const versionOptions = useMemo(() => {
    const options: VersionOption[] = []
    if (latestId) {
      const version = versionById.get(latestId)?.version
      options.push({
        value: latestId,
        label: version ? `latest (v${version})` : 'latest',
        group: 'Special',
      })
    }
    if (previousId) {
      const version = versionById.get(previousId)?.version
      options.push({
        value: previousId,
        label: version ? `previous (v${version})` : 'previous',
        group: 'Special',
      })
    } else if (versions.length > 0) {
      options.push({
        value: versions[0]._id,
        label: 'previous (unavailable)',
        group: 'Special',
        disabled: true,
      })
    }

    const tagEntries = Object.entries(skill.tags ?? {})
      .filter(([tag]) => tag !== 'latest')
      .sort(([a], [b]) => a.localeCompare(b))
    for (const [tag, versionId] of tagEntries) {
      const version = versionById.get(versionId)?.version
      options.push({
        value: versionId,
        label: version ? `tag: ${tag} (v${version})` : `tag: ${tag}`,
        group: 'Tags',
        disabled: !versionById.has(versionId),
      })
    }

    for (const entry of orderedVersions) {
      options.push({
        value: entry.id,
        label: `v${entry.version}`,
        group: 'Versions',
      })
    }

    return options
  }, [latestId, previousId, orderedVersions, skill.tags, versionById, versions])

  useEffect(() => {
    if (!versions.length) return
    const defaults = getDefaultDiffSelection(versionEntries, skill.tags)
    setLeftVersionId((current) => {
      if (current && versionById.has(current)) return current
      return defaults.leftId ? (defaults.leftId as Id<'skillVersions'>) : null
    })
    setRightVersionId((current) => {
      if (current && versionById.has(current)) return current
      return defaults.rightId ? (defaults.rightId as Id<'skillVersions'>) : null
    })
  }, [versionEntries, skill.tags, versionById, versions.length])

  const leftVersion = leftVersionId ? (versionById.get(leftVersionId) ?? null) : null
  const rightVersion = rightVersionId ? (versionById.get(rightVersionId) ?? null) : null

  const fileDiffItems = useMemo(() => {
    return buildFileDiffList(leftVersion?.files ?? [], rightVersion?.files ?? [])
  }, [leftVersion, rightVersion])

  useEffect(() => {
    if (!fileDiffItems.length) {
      setSelectedPath(null)
      return
    }
    setSelectedPath((current) => {
      if (current && fileDiffItems.some((item) => item.path === current)) return current
      return selectDefaultFilePath(fileDiffItems)
    })
  }, [fileDiffItems])

  const selectedItem = useMemo(
    () => fileDiffItems.find((item) => item.path === selectedPath) ?? null,
    [fileDiffItems, selectedPath],
  )

  useEffect(() => {
    let cancelled = false
    async function loadText(versionId: Id<'skillVersions'>, path: string) {
      const cacheKey = `${versionId}:${path}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached !== undefined) return cached
      const result = await getFileText({ versionId, path })
      cacheRef.current.set(cacheKey, result.text)
      return result.text
    }

    async function load() {
      if (!selectedItem || !leftVersionId || !rightVersionId) {
        setLeftText(EMPTY_DIFF_TEXT)
        setRightText(EMPTY_DIFF_TEXT)
        return
      }

      setIsLoading(true)
      setError(null)
      setSizeWarning(null)

      const leftFile = selectedItem.left
      const rightFile = selectedItem.right
      const warnings: SizeWarning[] = []

      if (leftFile && leftFile.size > MAX_DIFF_FILE_BYTES) {
        warnings.push({ side: 'left', path: leftFile.path })
      }
      if (rightFile && rightFile.size > MAX_DIFF_FILE_BYTES) {
        warnings.push({ side: 'right', path: rightFile.path })
      }

      if (warnings.length) {
        if (!cancelled) {
          setSizeWarning(warnings[0])
          setLeftText(EMPTY_DIFF_TEXT)
          setRightText(EMPTY_DIFF_TEXT)
          setIsLoading(false)
        }
        return
      }

      try {
        const [leftResult, rightResult] = await Promise.all([
          leftFile ? loadText(leftVersionId, leftFile.path) : Promise.resolve(''),
          rightFile ? loadText(rightVersionId, rightFile.path) : Promise.resolve(''),
        ])
        if (!cancelled) {
          setLeftText(leftResult)
          setRightText(rightResult)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unable to load diff'
          setError(message)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [getFileText, leftVersionId, rightVersionId, selectedItem])

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('molthub-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1b1513',
        'editor.lineHighlightBackground': '#221a17',
      },
    })
  }, [monaco])

  const containerClass = cn(
    'space-y-4',
    variant === 'card' && 'rounded-[var(--radius)] border border-border bg-card p-6',
  )

  const diffProps: DiffEditorProps = {
    original: leftText,
    modified: rightText,
    theme: 'molthub-dark',
    options: {
      renderSideBySide: viewMode === 'split',
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderIndicators: false,
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
      },
    },
  }

  return (
    <div className={containerClass}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Version diff</h2>
          <p className="text-sm text-muted-foreground">Compare file changes between versions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={viewMode === 'split' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('split')}
          >
            Split
          </Button>
          <Button
            type="button"
            variant={viewMode === 'inline' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('inline')}
          >
            Inline
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="text-xs font-medium" htmlFor={leftVersionSelectId}>
            From
          </label>
          <Select
            value={leftVersionId ? String(leftVersionId) : ''}
            onValueChange={(value) => setLeftVersionId(value as Id<'skillVersions'>)}
          >
            <SelectTrigger id={leftVersionSelectId}>
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              {versionOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={String(option.value)}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setLeftVersionId(rightVersionId)
            setRightVersionId(leftVersionId)
          }}
        >
          Swap
        </Button>
        <div className="flex-1">
          <label className="text-xs font-medium" htmlFor={rightVersionSelectId}>
            To
          </label>
          <Select
            value={rightVersionId ? String(rightVersionId) : ''}
            onValueChange={(value) => setRightVersionId(value as Id<'skillVersions'>)}
          >
            <SelectTrigger id={rightVersionSelectId}>
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              {versionOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={String(option.value)}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="w-full lg:w-64">
          <div className="rounded-[var(--radius)] border border-border bg-muted p-3 text-xs text-muted-foreground">
            {fileDiffItems.length} file{fileDiffItems.length === 1 ? '' : 's'}
          </div>
          <div className="mt-3 max-h-[360px] space-y-2 overflow-auto">
            {fileDiffItems.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-border p-3 text-xs text-muted-foreground">
                No files to compare.
              </div>
            ) : (
              fileDiffItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedPath(item.path)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-2 text-left text-xs transition',
                    item.path === selectedPath
                      ? 'border-primary/60 bg-background'
                      : 'bg-card hover:border-primary/40',
                  )}
                >
                  <Badge variant="secondary">{item.status}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{item.path}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1">
          {error ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-sm text-muted-foreground">
              {error}
            </div>
          ) : sizeWarning ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-sm text-muted-foreground">
              {sizeWarning.path} is too large to diff.
            </div>
          ) : !leftVersionId || !rightVersionId ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-sm text-muted-foreground">
              Select two versions to compare.
            </div>
          ) : !selectedItem ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-sm text-muted-foreground">
              Select a file to compare.
            </div>
          ) : (
            <ClientOnly
              fallback={
                <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Preparing diff…
                </div>
              }
            >
              <div className="relative h-[480px] overflow-hidden rounded-[var(--radius)] border border-border">
                <DiffEditor className="h-full w-full" {...diffProps} />
                {isLoading ? (
                  <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm">
                    Loading…
                  </div>
                ) : null}
              </div>
            </ClientOnly>
          )}
        </div>
      </div>
    </div>
  )
}
