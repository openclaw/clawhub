import { describe, expect, it } from 'vitest'
import { canManageSkill, isAdmin, isModerator } from './roles'

describe('roles helpers', () => {
  it('identifies admin and moderator roles', () => {
    expect(isAdmin({ role: 'admin' } as { role: string })).toBe(true)
    expect(isAdmin({ role: 'moderator' } as { role: string })).toBe(false)
    expect(isModerator({ role: 'admin' } as { role: string })).toBe(true)
    expect(isModerator({ role: 'moderator' } as { role: string })).toBe(true)
    expect(isModerator({ role: 'user' } as { role: string })).toBe(false)
  })

  it('checks skill ownership or moderation', () => {
    const owner = { _id: 'users:1', role: 'user' }
    const moderator = { _id: 'users:2', role: 'moderator' }
    const skill = { ownerUserId: 'users:1' }

    expect(canManageSkill(owner, skill)).toBe(true)
    expect(canManageSkill(moderator, skill)).toBe(true)
    expect(canManageSkill({ _id: 'users:3', role: 'user' }, skill)).toBe(false)
    expect(canManageSkill(null, skill)).toBe(false)
    expect(canManageSkill(owner, null)).toBe(false)
  })
})
