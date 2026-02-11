import { useEffect, useState } from 'react'
import type { PublicSkill } from '../lib/publicUser'

type SClawHubReport = {
  id: string
  trustScore: number
  riskLevel: 'critical' | 'high' | 'moderate' | 'low' | 'minimal'
  summary: string
  scannedAt: string
}

type SClawHubBadgeProps = {
  skill: PublicSkill
  ownerHandle?: string | null
  variant?: 'compact' | 'full'
}

/**
 * SClawHub security badge component
 * 
 * Displays a trust score badge for OpenClaw skills from sclawhub.com
 * Clicking the badge opens the full security report on sclawhub.com
 */
export function SClawHubBadge({ skill, ownerHandle, variant = 'compact' }: SClawHubBadgeProps) {
  const [report, setReport] = useState<SClawHubReport | null>(null)
  const [loading, setLoading] = useState(false)

  // Build skill slug for SClawHub
  const owner = ownerHandle?.trim() || String(skill.ownerUserId)
  const skillSlug = `${encodeURIComponent(owner)}/${encodeURIComponent(skill.slug)}`
  const reportUrl = `https://sclawhub.com/${skillSlug}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    // Fetch security report from SClawHub API
    fetch(`https://sclawhub.com/api/skills/${skillSlug}`)
      .then((res) => {
        if (!res.ok) {
          // Only permanently hide on 404 (not scanned)
          // Other errors (500, timeout) allow retry on next render
          if (res.status === 404) {
            throw new Error('Not scanned')
          }
          // For other errors, just don't set report but don't block future attempts
          return null
        }
        return res.json()
      })
      .then((data: SClawHubReport | null) => {
        if (!cancelled && data) {
          setReport(data)
          setLoading(false)
        } else if (!cancelled) {
          setLoading(false)
        }
      })
      .catch(() => {
        // 404 or network error - don't show badge
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [skillSlug])

  if (loading || !report) {
    // Don't render anything if not yet scanned or loading
    return null
  }

  const getTrustScoreColor = (score: number): string => {
    if (score >= 90) return '#10b981' // Green
    if (score >= 70) return '#84cc16' // Light green
    if (score >= 50) return '#eab308' // Yellow
    if (score >= 30) return '#f97316' // Orange
    return '#ef4444' // Red
  }

  const getTrustScoreEmoji = (score: number): string => {
    if (score >= 90) return '🛡️'
    if (score >= 70) return '✅'
    if (score >= 50) return '⚠️'
    return '🚨'
  }

  const color = getTrustScoreColor(report.trustScore)
  const emoji = getTrustScoreEmoji(report.trustScore)

  if (variant === 'full') {
    return (
      <a
        href={reportUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="sclawhub-badge sclawhub-badge-full"
        title={`Security report: ${report.summary}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          color: color,
          backgroundColor: `${color}15`,
          border: `1px solid ${color}40`,
          textDecoration: 'none',
          transition: 'all 0.2s',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = `${color}25`
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = `${color}15`
        }}
      >
        <span style={{ fontSize: '18px' }}>{emoji}</span>
        <span>Security: {report.trustScore}/100</span>
        <span style={{ fontSize: '12px', opacity: 0.7 }}>→ View Report</span>
      </a>
    )
  }

  // Compact variant
  return (
    <a
      href={reportUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="sclawhub-badge sclawhub-badge-compact"
      title={`Security score: ${report.trustScore}/100 - Click for full report`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 600,
        color: color,
        backgroundColor: `${color}10`,
        border: `1px solid ${color}40`,
        textDecoration: 'none',
        transition: 'all 0.2s',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = `${color}20`
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = `${color}10`
      }}
    >
      <span>{emoji}</span>
      <span>{report.trustScore}/100</span>
    </a>
  )
}
