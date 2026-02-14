import { describe, expect, it } from 'vitest'
import { canHealSkillOwnershipByGitHubProviderAccountId } from './githubIdentity'

describe('canHealSkillOwnershipByGitHubProviderAccountId', () => {
  it('denies when either providerAccountId is missing', () => {
    expect(canHealSkillOwnershipByGitHubProviderAccountId(undefined, undefined)).toBe(false)
    expect(canHealSkillOwnershipByGitHubProviderAccountId('123', undefined)).toBe(false)
    expect(canHealSkillOwnershipByGitHubProviderAccountId(undefined, '123')).toBe(false)
    expect(canHealSkillOwnershipByGitHubProviderAccountId(null, '123')).toBe(false)
  })

  it('denies when providerAccountId differs', () => {
    expect(canHealSkillOwnershipByGitHubProviderAccountId('123', '456')).toBe(false)
  })

  it('allows when providerAccountId matches', () => {
    expect(canHealSkillOwnershipByGitHubProviderAccountId('123', '123')).toBe(true)
  })
})
