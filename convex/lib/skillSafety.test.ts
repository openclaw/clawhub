import { describe, expect, it } from 'vitest'
import { isSkillSuspicious } from './skillSafety'

describe('isSkillSuspicious', () => {
  it('returns true when suspicious flag is present', () => {
    expect(
      isSkillSuspicious({
        moderationFlags: ['flagged.suspicious'],
        moderationReason: undefined,
      }),
    ).toBe(true)
  })

  it('returns true for scanner suspicious reason', () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: 'scanner.vt.suspicious',
      }),
    ).toBe(true)
  })

  it('returns false for clean moderation states', () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: 'scanner.vt.clean',
      }),
    ).toBe(false)
  })
})
