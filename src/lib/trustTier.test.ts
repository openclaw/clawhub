import { describe, expect, it } from 'vitest'
import {
  type TrustTier,
  getTrustTier,
  getTrustTierInfo,
  isEstablishedPublisher,
  isSafeTier,
  isWarningTier,
} from './trustTier'

const MS_PER_DAY = 24 * 60 * 60 * 1000

describe('getTrustTier', () => {
  it('returns malicious for removed skills', () => {
    const skill = { moderationStatus: 'removed' as const }
    expect(getTrustTier(skill, null, null)).toBe('malicious')
  })

  it('returns suspicious for hidden skills', () => {
    const skill = { moderationStatus: 'hidden' as const }
    expect(getTrustTier(skill, null, null)).toBe('suspicious')
  })

  it('returns malicious when moderationReason contains malicious', () => {
    const skill = { moderationReason: 'VT flagged as malicious' }
    expect(getTrustTier(skill, null, null)).toBe('malicious')
  })

  it('returns suspicious when moderationReason contains suspicious', () => {
    const skill = { moderationReason: 'Marked suspicious by VT' }
    expect(getTrustTier(skill, null, null)).toBe('suspicious')
  })

  it('returns pending when no VT analysis', () => {
    const skill = {}
    expect(getTrustTier(skill, null, null)).toBe('pending')
  })

  it('returns pending when VT status is pending', () => {
    const skill = {}
    const version = { vtAnalysis: { status: 'pending', checkedAt: Date.now() } }
    expect(getTrustTier(skill, null, version)).toBe('pending')
  })

  it('returns unknown when VT status is error', () => {
    const skill = {}
    const version = { vtAnalysis: { status: 'error', checkedAt: Date.now() } }
    expect(getTrustTier(skill, null, version)).toBe('unknown')
  })

  it('returns malicious when VT status is malicious', () => {
    const skill = {}
    const version = { vtAnalysis: { status: 'malicious', checkedAt: Date.now() } }
    expect(getTrustTier(skill, null, version)).toBe('malicious')
  })

  it('returns suspicious when VT status is suspicious', () => {
    const skill = {}
    const version = { vtAnalysis: { status: 'suspicious', checkedAt: Date.now() } }
    expect(getTrustTier(skill, null, version)).toBe('suspicious')
  })

  it('returns verified when VT is clean and publisher is established', () => {
    const skill = {}
    const owner = { githubCreatedAt: Date.now() - 60 * MS_PER_DAY } // 60 days old
    const version = { vtAnalysis: { status: 'clean', checkedAt: Date.now() } }
    expect(getTrustTier(skill, owner, version)).toBe('verified')
  })

  it('returns clean when VT is clean but publisher is new', () => {
    const skill = {}
    const owner = { githubCreatedAt: Date.now() - 5 * MS_PER_DAY } // 5 days old
    const version = { vtAnalysis: { status: 'clean', checkedAt: Date.now() } }
    expect(getTrustTier(skill, owner, version)).toBe('clean')
  })

  it('returns clean when VT is benign and publisher is new', () => {
    const skill = {}
    const owner = { githubCreatedAt: Date.now() - 10 * MS_PER_DAY }
    const version = { vtAnalysis: { status: 'benign', checkedAt: Date.now() } }
    expect(getTrustTier(skill, owner, version)).toBe('clean')
  })

  it('returns verified when VT is benign and publisher is established', () => {
    const skill = {}
    const owner = { githubCreatedAt: Date.now() - 100 * MS_PER_DAY }
    const version = { vtAnalysis: { status: 'benign', checkedAt: Date.now() } }
    expect(getTrustTier(skill, owner, version)).toBe('verified')
  })
})

describe('isEstablishedPublisher', () => {
  it('returns false for null owner', () => {
    expect(isEstablishedPublisher(null)).toBe(false)
  })

  it('returns false for owner without githubCreatedAt', () => {
    expect(isEstablishedPublisher({})).toBe(false)
  })

  it('returns false for account less than 30 days old', () => {
    const owner = { githubCreatedAt: Date.now() - 15 * MS_PER_DAY }
    expect(isEstablishedPublisher(owner)).toBe(false)
  })

  it('returns true for account 30+ days old', () => {
    const owner = { githubCreatedAt: Date.now() - 30 * MS_PER_DAY }
    expect(isEstablishedPublisher(owner)).toBe(true)
  })

  it('returns true for account 365 days old', () => {
    const owner = { githubCreatedAt: Date.now() - 365 * MS_PER_DAY }
    expect(isEstablishedPublisher(owner)).toBe(true)
  })
})

describe('getTrustTierInfo', () => {
  const tiers: TrustTier[] = ['verified', 'clean', 'pending', 'suspicious', 'malicious', 'unknown']

  it.each(tiers)('returns correct info for %s tier', (tier) => {
    const info = getTrustTierInfo(tier)
    expect(info.tier).toBe(tier)
    expect(info.label).toBeTruthy()
    expect(info.description).toBeTruthy()
    expect(info.className).toContain('trust-tier-')
    expect(info.icon).toBeTruthy()
  })
})

describe('isSafeTier', () => {
  it('returns true for verified', () => {
    expect(isSafeTier('verified')).toBe(true)
  })

  it('returns true for clean', () => {
    expect(isSafeTier('clean')).toBe(true)
  })

  it('returns false for pending', () => {
    expect(isSafeTier('pending')).toBe(false)
  })

  it('returns false for suspicious', () => {
    expect(isSafeTier('suspicious')).toBe(false)
  })

  it('returns false for malicious', () => {
    expect(isSafeTier('malicious')).toBe(false)
  })
})

describe('isWarningTier', () => {
  it('returns false for verified', () => {
    expect(isWarningTier('verified')).toBe(false)
  })

  it('returns false for clean', () => {
    expect(isWarningTier('clean')).toBe(false)
  })

  it('returns true for suspicious', () => {
    expect(isWarningTier('suspicious')).toBe(true)
  })

  it('returns true for malicious', () => {
    expect(isWarningTier('malicious')).toBe(true)
  })
})
