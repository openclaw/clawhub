import type { DiffEditorProps } from '@monaco-editor/react'
import { DiffEditor, useMonaco } from '@monaco-editor/react'
import { useAction } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { ClientOnly } from './ClientOnly'

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
        const [nextLeft, nextRight] = await Promise.all([
          leftFile ? loadText(leftVersionId, leftFile.path) : Promise.resolve(''),
          rightFile ? loadText(rightVersionId, rightFile.path) : Promise.resolve(''),
        ])
        if (cancelled) return
        setLeftText(nextLeft ?? EMPTY_DIFF_TEXT)
        setRightText(nextRight ?? EMPTY_DIFF_TEXT)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load diff')
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
    if (!monaco || typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      applyMonacoTheme(monaco)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    applyMonacoTheme(monaco)
    return () => observer.disconnect()
  }, [monaco])

  const leftLabel = leftVersion ? `v${leftVersion.version}` : '—'
  const rightLabel = rightVersion ? `v${rightVersion.version}` : '—'
  const diffUnavailable = versions.length < 2
  const selectionReady = Boolean(leftVersionId && rightVersionId)
  const fileSelected = Boolean(selectedItem)

  const containerClass = variant === 'card' ? 'card diff-card' : 'diff-card diff-card-embedded'

  return (
    <div className={containerClass}>
      <div className="diff-header">
        <div>
          <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
            Compare versions
          </h2>
          <p className="section-subtitle" style={{ margin: 0 }}>
            Inline or side-by-side diff for any file.
          </p>
        </div>
        <fieldset className="diff-toggle-group">
          <legend className="sr-only">Diff layout</legend>
          <button
            className={`diff-toggle${viewMode === 'split' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setViewMode('split')}
          >
            Side-by-side
          </button>
          <button
            className={`diff-toggle${viewMode === 'inline' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setViewMode('inline')}
          >
            Inline
          </button>
        </fieldset>
      </div>

      <div className="diff-controls">
        <div className="diff-select">
          <label htmlFor="diff-left">Left</label>
          <select
            id="diff-left"
            className="search-input"
            value={leftVersionId ?? ''}
            onChange={(event) => setLeftVersionId(event.target.value as Id<'skillVersions'>)}
          >
            <option value="" disabled>
              Select version
            </option>
            {renderOptions(versionOptions)}
          </select>
        </div>
        <button
          className="btn diff-swap"
          type="button"
          onClick={() => {
            setLeftVersionId(rightVersionId)
            setRightVersionId(leftVersionId)
          }}
          disabled={!leftVersionId || !rightVersionId}
        >
          Swap
        </button>
        <div className="diff-select">
          <label htmlFor="diff-right">Right</label>
          <select
            id="diff-right"
            className="search-input"
            value={rightVersionId ?? ''}
            onChange={(event) => setRightVersionId(event.target.value as Id<'skillVersions'>)}
          >
            <option value="" disabled>
              Select version
            </option>
            {renderOptions(versionOptions)}
          </select>
        </div>
      </div>

      <div className="diff-meta">
        <span>
          Left {leftLabel} • Right {rightLabel}
        </span>
        {diffUnavailable ? <span>Need at least 2 versions.</span> : null}
      </div>

      <div className="diff-layout">
        <div className="diff-files">
          {fileDiffItems.length === 0 ? (
            <div className="diff-empty">No files to compare.</div>
          ) : (
            fileDiffItems.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`diff-file${item.path === selectedPath ? ' is-active' : ''}`}
                onClick={() => setSelectedPath(item.path)}
              >
                <span className={`diff-pill diff-pill-${item.status}`}>{item.status}</span>
                <span className="diff-file-name">{item.path}</span>
              </button>
            ))
          )}
        </div>
        <div className="diff-view">
          {error ? (
            <div className="diff-empty">{error}</div>
          ) : sizeWarning ? (
            <div className="diff-empty">
              {sizeWarning.side === 'left' ? 'Left' : 'Right'} file exceeds 200KB:{' '}
              {sizeWarning.path}
            </div>
          ) : diffUnavailable ? (
            <div className="diff-empty">Publish another version to compare.</div>
          ) : !selectionReady ? (
            <div className="diff-empty">Select two versions to compare.</div>
          ) : !fileSelected ? (
            <div className="diff-empty">Select a file to compare.</div>
          ) : (
            <ClientOnly fallback={<div className="diff-empty">Preparing diff…</div>}>
              <DiffEditor
                className="diff-monaco"
                original={leftText}
                modified={rightText}
                theme={getMonacoThemeName()}
                loading={<div className="diff-empty">Loading diff…</div>}
                options={buildDiffOptions(viewMode)}
              />
              {isLoading ? <div className="diff-loading">Loading…</div> : null}
            </ClientOnly>
          )}
        </div>
      </div>
    </div>
  )
}

function renderOptions(options: VersionOption[]) {
  const groups: Record<VersionOption['group'], VersionOption[]> = {
    Special: [],
    Tags: [],
    Versions: [],
  }
  for (const option of options) {
    groups[option.group].push(option)
  }
  return (['Special', 'Tags', 'Versions'] as const)
    .filter((group) => groups[group].length > 0)
    .map((group) => (
      <optgroup key={group} label={group}>
        {groups[group].map((option) => (
          <option key={`${group}-${option.value}`} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </optgroup>
    ))
}

function getMonacoThemeName() {
  if (typeof document === 'undefined') return 'clawdhub-light'
  return document.documentElement.dataset.theme === 'dark' ? 'clawdhub-dark' : 'clawdhub-light'
}

function buildDiffOptions(viewMode: 'split' | 'inline'): DiffEditorProps['options'] {
  return {
    readOnly: true,
    renderSideBySide: viewMode === 'split',
    renderSideBySideInlineBreakpoint: 860,
    wordWrap: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    overviewRulerBorder: false,
    renderIndicators: true,
    diffAlgorithm: 'advanced',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
  }
}

function applyMonacoTheme(monaco: NonNullable<ReturnType<typeof useMonaco>>) {
  const styles = getComputedStyle(document.documentElement)
  const surface = normalizeHex(styles.getPropertyValue('--surface').trim() || '#ffffff')
  const surfaceMuted = styles.getPropertyValue('--surface-muted').trim() || '#f6f1ec'
  const ink = styles.getPropertyValue('--ink').trim() || '#1d1a17'
  const inkSoft = styles.getPropertyValue('--ink-soft').trim() || '#4c463f'
  const line = styles.getPropertyValue('--line').trim() || 'rgba(29, 26, 23, 0.12)'
  const accent = styles.getPropertyValue('--accent').trim() || '#ff6b4a'
  const seafoam = styles.getPropertyValue('--seafoam').trim() || '#2bc6a4'
  const diffAdded = styles.getPropertyValue('--diff-added').trim() || seafoam
  const diffRemoved = styles.getPropertyValue('--diff-removed').trim() || accent
  const background = surface
  const gutter = surfaceMuted
  const isDark = document.documentElement.dataset.theme === 'dark'
  const base = isDark ? 'vs-dark' : 'vs'

  const diffInserted = toRgba(diffAdded, isDark ? 0.12 : 0.16)
  const diffRemovedBg = toRgba(diffRemoved, isDark ? 0.12 : 0.16)

  monaco.editor.defineTheme(`clawdhub-${isDark ? 'dark' : 'light'}`, {
    base,
    inherit: true,
    rules: [
      { token: '', foreground: normalizeHex(ink) },
      { token: 'comment', foreground: normalizeHex(inkSoft) },
    ],
    colors: {
      'editor.background': background,
      'editor.foreground': ink,
      'editorLineNumber.foreground': inkSoft,
      'editorLineNumber.activeForeground': ink,
      'editorGutter.background': gutter,
      'editor.selectionBackground': toRgba(accent, 0.18),
      'editor.inactiveSelectionBackground': toRgba(accent, 0.12),
      'editorWidget.background': surface,
      'editorWidget.border': line,
      'editorWidget.foreground': ink,
      'diffEditor.insertedTextBackground': diffInserted,
      'diffEditor.removedTextBackground': diffRemovedBg,
      'diffEditor.insertedLineBackground': diffInserted,
      'diffEditor.removedLineBackground': diffRemovedBg,
      'diffEditor.border': line,
      'scrollbarSlider.background': toRgba(inkSoft, 0.15),
      'scrollbarSlider.hoverBackground': toRgba(inkSoft, 0.28),
      'scrollbarSlider.activeBackground': toRgba(inkSoft, 0.4),
    },
  })

  monaco.editor.setTheme(`clawdhub-${isDark ? 'dark' : 'light'}`)
}

function normalizeHex(value: string) {
  if (!value.startsWith('#')) return '#000000'
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return value
}

function toRgba(color: string, alpha: number) {
  const hex = normalizeHex(color).replace('#', '')
  if (hex.length !== 6) return color
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
