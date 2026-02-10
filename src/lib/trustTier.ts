// (remove unused import)
 * Trust tier levels for skills.
 *
 * These tiers help users make informed decisions about skill safety:
 * - verified: Clean VT scan + established publisher (GitHub 30+ days)
 * - clean: Clean VT scan but publisher is new or unverified
 * - pending: No VT scan results yet
 * - suspicious: VT flagged as suspicious
 * - malicious: VT flagged as malicious
 * - unknown: Unable to determine (error or missing data)
 */
export type TrustTier =
  | 'verified'
  | 'clean'
  | 'pending'
  | 'suspicious'
  | 'malicious'
  | 'unknown'

export type TrustTierInfo = {
  tier: TrustTier
  label: string
  description: string
  className: string
  icon: string
}

const TRUST_TIER_INFO: Record<TrustTier, Omit<TrustTierInfo, 'tier'>> = {
  verified: {
    label: 'Verified',
    description: 'Clean security scan from an established publisher',
    className: 'trust-tier-verified',
    icon: '🛡️',
  },
  clean: {
    label: 'Clean',
    description: 'Passed security scan',
    className: 'trust-tier-clean',
    icon: '✅',
  },
  pending: {
    label: 'Pending',
    description: 'Security scan in progress',
    className: 'trust-tier-pending',
    icon: '⏳',
  },
  suspicious: {
    label: 'Suspicious',
    description: 'Flagged as potentially suspicious by security scan',
    className: 'trust-tier-suspicious',
    icon: '⚠️',
  },
  malicious: {
    label: 'Malicious',
    description: 'Flagged as malicious by security scan',
    className: 'trust-tier-malicious',
    icon: '🚫',
  },
  unknown: {
    label: 'Unknown',
    description: 'Security status could not be determined',
    className: 'trust-tier-unknown',
    icon: '❓',
  },
}

// Publisher is considered "established" if GitHub account is 30+ days old
const ESTABLISHED_PUBLISHER_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

type VTAnalysis = {
  status: string
  verdict?: string
  checkedAt: number
}

type SkillForTrust = {
  moderationReason?: string | null
  moderationStatus?: 'active' | 'hidden' | 'removed' | null
  reportCount?: number | null
}

type OwnerForTrust = {
  githubCreatedAt?: number | null
}

type VersionForTrust = {
  vtAnalysis?: VTAnalysis | null
}

/**
 * Determine the trust tier for a skill based on:
 * - VT scan results (from latest version)
 * - Publisher GitHub account age
 * - Moderation status
 */
export function getTrustTier(
  skill: SkillForTrust,
  owner: OwnerForTrust | null,
  latestVersion: VersionForTrust | null,
): TrustTier {
  // If skill is hidden/removed or has moderation issues, mark as suspicious/malicious
  if (skill.moderationStatus === 'removed') {
    return 'malicious'
  }
  if (skill.moderationStatus === 'hidden') {
    return 'suspicious'
  }

  // Check moderation reason for VT-based flags
  const reason = skill.moderationReason?.toLowerCase() ?? ''
  if (reason.includes('malicious')) {
    return 'malicious'
  }
  if (reason.includes('suspicious')) {
    return 'suspicious'
  }

  // Check VT analysis from latest version
  const vtStatus = latestVersion?.vtAnalysis?.status?.toLowerCase()

  if (!vtStatus || vtStatus === 'pending' || vtStatus === 'not_found') {
    return 'pending'
  }

  if (vtStatus === 'error' || vtStatus === 'failed') {
    return 'unknown'
  }

  if (vtStatus === 'malicious') {
    return 'malicious'
  }

  if (vtStatus === 'suspicious') {
    return 'suspicious'
  }

  // VT scan is clean - check if publisher is established
  if (vtStatus === 'clean' || vtStatus === 'benign') {
    const isEstablished = isEstablishedPublisher(owner)
    return isEstablished ? 'verified' : 'clean'
  }

  return 'unknown'
}

/**
 * Check if a publisher is "established" (GitHub account 30+ days old)
 */
export function isEstablishedPublisher(owner: OwnerForTrust | null): boolean {
  if (!owner?.githubCreatedAt) {
    return false
  }

  const accountAgeMs = Date.now() - owner.githubCreatedAt
  const accountAgeDays = accountAgeMs / MS_PER_DAY

  return accountAgeDays >= ESTABLISHED_PUBLISHER_DAYS
}

/**
 * Get full trust tier info including label, description, and styling
 */
export function getTrustTierInfo(tier: TrustTier): TrustTierInfo {
  return {
    tier,
    ...TRUST_TIER_INFO[tier],
  }
}

/**
 * Check if a trust tier indicates the skill is safe to install
 */
export function isSafeTier(tier: TrustTier): boolean {
  return tier === 'verified' || tier === 'clean'
}

/**
 * Check if a trust tier indicates a warning should be shown
 */
export function isWarningTier(tier: TrustTier): boolean {
  return tier === 'suspicious' || tier === 'malicious'
}
