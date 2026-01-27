import { useAction } from 'convex/react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
          <div className="file-viewer-body">
            {isLoading ? (
              <div className="stat">Loading…</div>
            ) : fileError ? (
              <div className="stat">Failed to load file: {fileError}</div>
            ) : fileContent ? (
              <pre className="file-viewer-code">{fileContent}</pre>
            ) : (
              <div className="stat">Select a file to preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
