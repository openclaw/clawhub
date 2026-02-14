/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { getSkillBadges, isSkillDeprecated, isSkillHighlighted, isSkillOfficial } from './badges'

describe('badges', () => {
  describe('isSkillHighlighted', () => {
    it('returns false when badges is undefined', () => {
      expect(isSkillHighlighted({})).toBe(false)
    })

    it('returns false when badges is null', () => {
      expect(isSkillHighlighted({ badges: null })).toBe(false)
    })

    it('returns false when highlighted is not set', () => {
      expect(isSkillHighlighted({ badges: {} })).toBe(false)
    })

    it('returns true when highlighted is set', () => {
      expect(
        isSkillHighlighted({
          badges: { highlighted: { byUserId: 'user1' as never, at: 123 } },
        }),
      ).toBe(true)
    })
  })

  describe('isSkillOfficial', () => {
    it('returns false when badges is undefined', () => {
      expect(isSkillOfficial({})).toBe(false)
    })

    it('returns true when official is set', () => {
      expect(
        isSkillOfficial({
          badges: { official: { byUserId: 'user1' as never, at: 123 } },
        }),
      ).toBe(true)
    })
  })

  describe('isSkillDeprecated', () => {
    it('returns false when badges is undefined', () => {
      expect(isSkillDeprecated({})).toBe(false)
    })

    it('returns true when deprecated is set', () => {
      expect(
        isSkillDeprecated({
          badges: { deprecated: { byUserId: 'user1' as never, at: 123 } },
        }),
      ).toBe(true)
    })
  })

  describe('getSkillBadges', () => {
    it('returns empty array when no badges', () => {
      expect(getSkillBadges({})).toEqual([])
    })

    it('returns Deprecated when deprecated is set', () => {
      expect(
        getSkillBadges({
          badges: { deprecated: { byUserId: 'user1' as never, at: 123 } },
        }),
      ).toEqual(['Deprecated'])
    })

    it('returns Official when official is set', () => {
      expect(
        getSkillBadges({
          badges: { official: { byUserId: 'user1' as never, at: 123 } },
        }),
      ).toEqual(['Official'])
    })

    it('returns Highlighted when highlighted is set', () => {
      expect(
        getSkillBadges({
          badges: { highlighted: { byUserId: 'user1' as never, at: 123 } },
        }),
      ).toEqual(['Highlighted'])
    })

    it('returns all badges in correct order', () => {
      expect(
        getSkillBadges({
          badges: {
            deprecated: { byUserId: 'user1' as never, at: 123 },
            official: { byUserId: 'user1' as never, at: 123 },
            highlighted: { byUserId: 'user1' as never, at: 123 },
          },
        }),
      ).toEqual(['Deprecated', 'Official', 'Highlighted'])
    })
  })
})
