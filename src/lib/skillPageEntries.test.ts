import { describe, expect, it } from 'vitest'
import type { PublicSkill } from './publicUser'
import { mapPublicSkillPageEntries } from './skillPageEntries'

function makeSkill(overrides: Partial<PublicSkill> = {}): PublicSkill {
  return {
    _id: 'skills:1' as PublicSkill['_id'],
    _creationTime: 1,
    slug: 'demo',
    displayName: 'Demo Skill',
    summary: 'summary',
    ownerUserId: 'users:1' as PublicSkill['ownerUserId'],
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: {},
    stats: {
      downloads: 12,
      stars: 3,
      installsCurrent: 5,
      installsAllTime: 7,
      versions: 2,
      comments: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('mapPublicSkillPageEntries', () => {
  it('extracts nested skill entries from listPublicPageV2 shape', () => {
    const skill = makeSkill({ slug: 'popular-skill' })
    const result = mapPublicSkillPageEntries([
      {
        skill,
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.slug).toBe('popular-skill')
  })

  it('normalizes missing stats fields to zero', () => {
    const skill = makeSkill({
      stats: undefined as unknown as PublicSkill['stats'],
    })
    const result = mapPublicSkillPageEntries([{ skill }])

    expect(result[0]?.stats).toEqual({
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 0,
      comments: 0,
    })
  })
})
