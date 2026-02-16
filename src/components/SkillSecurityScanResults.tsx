import { useState } from 'react'

type LlmAnalysisDimension = {
  name: string
  label: string
  rating: string
  detail: string
}

export type VtAnalysis = {
  status: string
  verdict?: string
  analysis?: string
  source?: string
  checkedAt: number
}

export type LlmAnalysis = {
  status: string
  verdict?: string
  confidence?: string
  summary?: string
  dimensions?: LlmAnalysisDimension[]
  guidance?: string
  findings?: string
  model?: string
  checkedAt: number
}

type SecurityScanResultsProps = {
  sha256hash?: string
  vtAnalysis?: VtAnalysis | null
  llmAnalysis?: LlmAnalysis | null
  variant?: 'panel' | 'badge'
}

function VirusTotalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 89"
      aria-label="VirusTotal"
    >
      <title>VirusTotal</title>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M45.292 44.5 0 89h100V0H0l45.292 44.5zM90 80H22l35.987-35.2L22 9h68v71z"
      />
    </svg>
  )
}

function OpenClawIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="OpenClaw"
    >
      <title>OpenClaw</title>
      <path
        d="M12 2C8.5 2 5.5 4 4 7c-2 4-1 8 2 11 1.5 1.5 3.5 2.5 6 2.5s4.5-1 6-2.5c3-3 4-7 2-11-1.5-3-4.5-5-8-5z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M9 8c1-2 3-3 5-2s3 3 2 5l-3 4-2-1 3-4c.5-1 0-2-1-2.5S11 7 10.5 8L8 12l-2-1 3-4z"
        fill="currentColor"
      />
      <path
        d="M15 8c-1-2-3-3-5-2s-3 3-2 5l3 4 2-1-3-4c-.5-1 0-2 1-2.5S14 7 14.5 8L17 12l2-1-4-3z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  )
}

function getScanStatusInfo(status: string) {
  switch (status.toLowerCase()) {
    case 'benign':
    case 'clean':
      return { label: 'Benign', className: 'scan-status-clean' }
    case 'malicious':
      return { label: 'Malicious', className: 'scan-status-malicious' }
    case 'suspicious':
      return { label: 'Suspicious', className: 'scan-status-suspicious' }
    case 'loading':
      return { label: 'Loading...', className: 'scan-status-pending' }
    case 'pending':
    case 'not_found':
      return { label: 'Pending', className: 'scan-status-pending' }
    case 'error':
    case 'failed':
      return { label: 'Error', className: 'scan-status-error' }
    default:
      return { label: status, className: 'scan-status-unknown' }
  }
}

function getDimensionIcon(rating: string) {
  switch (rating) {
    case 'ok':
      return { className: 'dimension-icon-ok', symbol: '\u2713' }
    case 'note':
      return { className: 'dimension-icon-note', symbol: '\u2139' }
    case 'concern':
      return { className: 'dimension-icon-concern', symbol: '!' }
    default:
      return { className: 'dimension-icon-danger', symbol: '\u2717' }
  }
}

function LlmAnalysisDetail({ analysis }: { analysis: LlmAnalysis }) {
  const verdict = analysis.verdict ?? analysis.status
  const [isOpen, setIsOpen] = useState(false)

  const guidanceClass =
    verdict === 'malicious' ? 'malicious' : verdict === 'suspicious' ? 'suspicious' : 'benign'

  return (
    <div className={`analysis-detail${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="analysis-detail-header"
        onClick={() => {
          const selection = window.getSelection()
          if (selection && !selection.isCollapsed) return
          setIsOpen((prev) => !prev)
        }}
        aria-expanded={isOpen}
      >
        <span className="analysis-summary-text">{analysis.summary}</span>
        <span className="analysis-detail-toggle">
          Details <span className="chevron">{'\u25BE'}</span>
        </span>
      </button>
      <div className="analysis-body">
        {analysis.dimensions && analysis.dimensions.length > 0 ? (
          <div className="analysis-dimensions">
            {analysis.dimensions.map((dim) => {
              const icon = getDimensionIcon(dim.rating)
              return (
                <div key={dim.name} className="dimension-row">
                  <div className={`dimension-icon ${icon.className}`}>{icon.symbol}</div>
                  <div className="dimension-content">
                    <div className="dimension-label">{dim.label}</div>
                    <div className="dimension-detail">{dim.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {analysis.findings ? (
          <div className="scan-findings-section">
            <div className="scan-findings-title">Scan Findings in Context</div>
            {(() => {
              const counts = new Map<string, number>()
              return analysis.findings.split('\n').map((line) => {
                const count = (counts.get(line) ?? 0) + 1
                counts.set(line, count)
                return (
                  <div key={`${line}-${count}`} className="scan-finding-row">
                    {line}
                  </div>
                )
              })
            })()}
          </div>
        ) : null}
        {analysis.guidance ? (
          <div className={`analysis-guidance ${guidanceClass}`}>
            <div className="analysis-guidance-label">
              {verdict === 'malicious'
                ? 'Do not install this skill'
                : verdict === 'suspicious'
                  ? 'What to consider before installing'
                  : 'Assessment'}
            </div>
            {analysis.guidance}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function SecurityScanResults({
  sha256hash,
  vtAnalysis,
  llmAnalysis,
  variant = 'panel',
}: SecurityScanResultsProps) {
  if (!sha256hash && !llmAnalysis) return null

  const vtStatus = vtAnalysis?.status ?? 'pending'
  const vtUrl = sha256hash ? `https://www.virustotal.com/gui/file/${sha256hash}` : null
  const vtStatusInfo = getScanStatusInfo(vtStatus)
  const isCodeInsight = vtAnalysis?.source === 'code_insight'
  const aiAnalysis = vtAnalysis?.analysis

  const llmVerdict = llmAnalysis?.verdict ?? llmAnalysis?.status
  const llmStatusInfo = llmVerdict ? getScanStatusInfo(llmVerdict) : null

  if (variant === 'badge') {
    return (
      <>
        {sha256hash ? (
          <div className="version-scan-badge">
            <VirusTotalIcon className="version-scan-icon version-scan-icon-vt" />
            <span className={vtStatusInfo.className}>{vtStatusInfo.label}</span>
            {vtUrl ? (
              <a
                href={vtUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="version-scan-link"
                onClick={(event) => event.stopPropagation()}
              >
                ↗
              </a>
            ) : null}
          </div>
        ) : null}
        {llmStatusInfo ? (
          <div className="version-scan-badge">
            <OpenClawIcon className="version-scan-icon version-scan-icon-oc" />
            <span className={llmStatusInfo.className}>{llmStatusInfo.label}</span>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div className="scan-results-panel">
      <div className="scan-results-title">Security Scan</div>
      <div className="scan-results-list">
        {sha256hash ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <VirusTotalIcon className="scan-result-icon scan-result-icon-vt" />
              <span className="scan-result-scanner-name">VirusTotal</span>
            </div>
            <div className={`scan-result-status ${vtStatusInfo.className}`}>{vtStatusInfo.label}</div>
            {vtUrl ? (
              <a
                href={vtUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scan-result-link"
              >
                View report →
              </a>
            ) : null}
          </div>
        ) : null}
        {isCodeInsight && aiAnalysis && (vtStatus === 'malicious' || vtStatus === 'suspicious') ? (
          <div className={`code-insight-analysis ${vtStatus}`}>
            <div className="code-insight-label">Code Insight</div>
            <p className="code-insight-text">{aiAnalysis}</p>
          </div>
        ) : null}
        {llmStatusInfo && llmAnalysis ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <OpenClawIcon className="scan-result-icon scan-result-icon-oc" />
              <span className="scan-result-scanner-name">OpenClaw</span>
            </div>
            <div className={`scan-result-status ${llmStatusInfo.className}`}>{llmStatusInfo.label}</div>
            {llmAnalysis.confidence ? (
              <span className="scan-result-confidence">{llmAnalysis.confidence} confidence</span>
            ) : null}
          </div>
        ) : null}
        {llmAnalysis &&
        llmAnalysis.status !== 'error' &&
        llmAnalysis.status !== 'pending' &&
        llmAnalysis.summary ? (
          <LlmAnalysisDetail analysis={llmAnalysis} />
        ) : null}
      </div>
    </div>
  )
}
