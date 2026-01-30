import { describe, expect, it } from 'vitest'
import { getResourceBadge, getResourceLabel, getResourceLink, getResourceOwner, toCanonicalResourcePath } from './resources'

const makeBadge = (kind: string) => ({ byUserId: 'users:1', at: 123, kind })

describe('resources helpers', () => {
  it('labels resource types with pluralization', () => {
    expect(getResourceLabel('skill')).toBe('Skill')
    expect(getResourceLabel('skill', { plural: true })).toBe('Skills')
    expect(getResourceLabel('soul')).toBe('Soul')
    expect(getResourceLabel('soul', { plural: true })).toBe('Souls')
    expect(getResourceLabel('extension')).toBe('Extension')
    expect(getResourceLabel('extension', { plural: true })).toBe('Extensions')
  })

  it('resolves resource owner from overrides and fallbacks', () => {
    expect(getResourceOwner({ ownerHandle: 'alice', ownerUserId: 'users:1' }, 'bob')).toBe('bob')
    expect(getResourceOwner({ ownerHandle: 'alice', ownerUserId: 'users:1' })).toBe('alice')
    expect(getResourceOwner({ ownerUserId: 'users:2' })).toBe('users:2')
    expect(getResourceOwner(null)).toBe('unknown')
  })

  it('builds canonical paths and links', () => {
    expect(toCanonicalResourcePath('skill', 'alice', 'demo')).toBe('/skills/alice/demo')
    expect(toCanonicalResourcePath('soul', 'alice', 'demo')).toBe('/souls/alice/demo')
    expect(toCanonicalResourcePath('extension', 'alice', 'demo')).toBe('/extensions/alice/demo')
    expect(getResourceLink('skill', { ownerHandle: 'bob' }, 'demo')).toBe('/skills/bob/demo')
  })

  it('returns badges for resources with badge maps', () => {
    const resource = {
      badges: {
        official: makeBadge('official'),
      },
    }
    expect(getResourceBadge('skill', resource)).toEqual(['Official'])
    expect(getResourceBadge('skill', null)).toEqual([])
  })
})
