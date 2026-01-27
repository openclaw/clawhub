import { useAction } from 'convex/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { formatBytes } from './skillDetailUtils'

type SkillFile = Doc<'skillVersions'>['files'][number]

type SkillFilesPanelProps = {
  versionId: Id<'skillVersions'> | null
  readmeContent: string | null
  readmeError: string | null
  latestFiles: SkillFile[]
}

export function SkillFilesPanel({
  versionId,
  readmeContent,
  readmeError,
  latestFiles,
}: SkillFilesPanelProps) {
  const getFileText = useAction(api.skills.getFileText)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileMeta, setFileMeta] = useState<{ size: number; sha256: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const isMounted = useRef(true)
  const activeRequest = useRef<AbortController | null>(null)
  const requestId = useRef(0)
  const warnings = useMemo(() => (fileContent ? collectWarnings(fileContent) : []), [fileContent])
  const highlightedContent = useMemo(
    () => (fileContent ? highlightDangerousCommands(fileContent) : null),
    [fileContent],
  )

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      activeRequest.current?.abort()
      activeRequest.current = null
    }
  }, [])

  useEffect(() => {
    activeRequest.current?.abort()
    activeRequest.current = null
    requestId.current += 1

    setSelectedPath(null)
    setFileContent(null)
    setFileMeta(null)
    setFileError(null)
    setIsLoading(false)

    if (versionId === null) return
  }, [versionId])

  const handleSelect = useCallback(
    (path: string) => {
      if (!versionId) return
      activeRequest.current?.abort()
      const controller = new AbortController()
      activeRequest.current = controller

      const current = requestId.current + 1
      requestId.current = current
      setSelectedPath(path)
      setFileContent(null)
      setFileMeta(null)
      setFileError(null)
      setIsLoading(true)
      void getFileText({ versionId, path })
        .then((data) => {
          if (!isMounted.current) return
          if (controller.signal.aborted) return
          if (requestId.current !== current) return
          setFileContent(data.text)
          setFileMeta({ size: data.size, sha256: data.sha256 })
          setIsLoading(false)
        })
        .catch((error) => {
          if (!isMounted.current) return
          if (controller.signal.aborted) return
          if (requestId.current !== current) return
          setFileError(error instanceof Error ? error.message : 'Failed to load file')
          setIsLoading(false)
        })
    },
    [getFileText, versionId],
  )

  return (
    <div className="tab-body">
      <div>
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          SKILL.md
        </h2>
        <div className="markdown">
          {readmeContent ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{readmeContent}</ReactMarkdown>
          ) : readmeError ? (
            <div className="stat">Failed to load SKILL.md: {readmeError}</div>
          ) : (
            <div>Loading…</div>
          )}
        </div>
      </div>
      <div className="file-browser">
        <div className="file-list">
          <div className="file-list-header">
            <h3 className="section-title" style={{ fontSize: '1.05rem', margin: 0 }}>
              Files
            </h3>
            <span className="section-subtitle" style={{ margin: 0 }}>
              {latestFiles.length} total
            </span>
          </div>
          <div className="file-list-body">
            {latestFiles.length === 0 ? (
              <div className="stat">No files available.</div>
            ) : (
              latestFiles.map((file) => (
                <button
                  key={file.path}
                  className={`file-row file-row-button${
                    selectedPath === file.path ? ' is-active' : ''
                  }`}
                  type="button"
                  onClick={() => handleSelect(file.path)}
                >
                  <span className="file-path">{file.path}</span>
                  <span className="file-meta">{formatBytes(file.size)}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="file-viewer">
          <div className="file-viewer-header">
            <div className="file-path">{selectedPath ?? 'Select a file'}</div>
            {fileMeta ? (
              <span className="file-meta">
                {formatBytes(fileMeta.size)} · {fileMeta.sha256.slice(0, 12)}…
              </span>
            ) : null}
          </div>
          {fileContent && warnings.length > 0 ? (
            <div className="file-warning">
              <strong>Potentially dangerous commands:</strong>{' '}
              {warnings.map((warning) => (
                <span key={warning.label} className="file-warning-item">
                  {warning.label} × {warning.count}
                </span>
              ))}
            </div>
          ) : null}
          <div className="file-viewer-body">
            {isLoading ? (
              <div className="stat">Loading…</div>
            ) : fileError ? (
              <div className="stat">Failed to load file: {fileError}</div>
            ) : fileContent ? (
              <pre className="file-viewer-code">{highlightedContent}</pre>
            ) : (
              <div className="stat">Select a file to preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const DANGEROUS_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'curl', regex: /\bcurl\b/gi },
  { label: 'wget', regex: /\bwget\b/gi },
  { label: 'bash', regex: /\bbash\b/gi },
  { label: 'sh', regex: /\bsh\b/gi },
  { label: 'eval', regex: /\beval\b/gi },
]

const HIGHLIGHT_PATTERN = /\b(?:curl|wget|bash|sh|eval)\b/gi

function collectWarnings(content: string) {
  return DANGEROUS_PATTERNS.flatMap((entry) => {
    const matches = content.match(entry.regex)
    if (!matches?.length) return []
    return [{ label: entry.label, count: matches.length }]
  })
}

function highlightDangerousCommands(content: string) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  for (const match of content.matchAll(HIGHLIGHT_PATTERN)) {
    if (match.index === undefined) continue
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }
    parts.push(
      <mark key={`${match.index}-${match[0]}`} className="danger-mark">
        {match[0]}
      </mark>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }
  return parts
}
