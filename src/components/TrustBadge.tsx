import { type TrustTier, getTrustTierInfo, isWarningTier } from '../lib/trustTier'

type TrustBadgeProps = {
  tier: TrustTier
  /** Show only the icon (compact mode for cards) */
  compact?: boolean
  /** Show full description on hover */
  showTooltip?: boolean
}

/**
 * Visual badge indicating the trust tier of a skill.
 *
 * Displays security scan status and publisher verification level
 * to help users make informed decisions about skill safety.
 */
export function TrustBadge({ tier, compact = false, showTooltip = true }: TrustBadgeProps) {
  const info = getTrustTierInfo(tier)
  const isWarning = isWarningTier(tier)

  if (compact) {
    return (
      <span
        className={`trust-badge trust-badge-compact ${info.className}`}
        title={showTooltip ? `${info.label}: ${info.description}` : undefined}
        aria-label={`Trust tier: ${info.label}`}
      >
        <span className="trust-badge-icon" aria-hidden="true">
          {info.icon}
        </span>
      </span>
    )
  }

  return (
    <span
      className={`trust-badge ${info.className}`}
      title={showTooltip ? info.description : undefined}
      aria-label={`Trust tier: ${info.label}`}
    >
      <span className="trust-badge-icon" aria-hidden="true">
        {info.icon}
      </span>
      <span className="trust-badge-label">{info.label}</span>
      {isWarning && (
        <span className="trust-badge-warning" aria-hidden="true">
          !
        </span>
      )}
    </span>
  )
}

type TrustBadgeWithDetailsProps = {
  tier: TrustTier
  publisherEstablished?: boolean
  scanDate?: number
}

/**
 * Extended trust badge with additional context shown on expansion.
 * Useful for skill detail pages where users want more information.
 */
export function TrustBadgeWithDetails({
  tier,
  publisherEstablished,
  scanDate,
}: TrustBadgeWithDetailsProps) {
  const info = getTrustTierInfo(tier)
  const isWarning = isWarningTier(tier)

  const formattedScanDate = scanDate
    ? new Date(scanDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <div className={`trust-badge-detailed ${info.className}`}>
      <div className="trust-badge-header">
        <span className="trust-badge-icon" aria-hidden="true">
          {info.icon}
        </span>
        <span className="trust-badge-label">{info.label}</span>
        {isWarning && (
          <span className="trust-badge-warning" aria-hidden="true">
            ⚠️
          </span>
        )}
      </div>
      <p className="trust-badge-description">{info.description}</p>
      <div className="trust-badge-meta">
        {publisherEstablished !== undefined && (
          <span className="trust-badge-meta-item">
            Publisher: {publisherEstablished ? '✓ Established' : 'New'}
          </span>
        )}
        {formattedScanDate && (
          <span className="trust-badge-meta-item">Last scanned: {formattedScanDate}</span>
        )}
      </div>
    </div>
  )
}
