import { describe, expect, it } from 'vitest'
import type { Doc } from '../_generated/dataModel'
import { toPublicSkill } from './public'

function makeSkill(overrides: Partial<Doc<'skills'>> = {}): Doc<'skills'> {
  return {
    _id: 'skills:1' as Doc<'skills'>['_id'],
    _creationTime: 1,
    slug: 'demo',
    displayName: 'Demo',
    summary: 'Demo summary',
    ownerUserId: 'users:1' as Doc<'skills'>['ownerUserId'],
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: {},
    moderationStatus: 'active',
    moderationReason: undefined,
    moderationNotes: undefined,
    moderationFlags: undefined,
    hiddenAt: undefined,
    lastReviewedAt: undefined,
    softDeletedAt: undefined,
    reportCount: 0,
    lastReportedAt: undefined,
    quality: undefined,
    statsDownloads: 0,
    statsStars: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    stats: {
      downloads: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 0,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Doc<'skills'>
}

describe('public skill mapping', () => {
  it('normalizes stats when legacy skill record is missing stats object', () => {
    const legacySkill = makeSkill({
      stats: undefined as unknown as Doc<'skills'>['stats'],
      statsDownloads: 12,
      statsStars: 3,
      statsInstallsCurrent: 5,
      statsInstallsAllTime: 7,
    })

    const mapped = toPublicSkill(legacySkill)

    expect(mapped).not.toBeNull()
    expect(mapped?.stats).toEqual({
      downloads: 12,
      stars: 3,
      installsCurrent: 5,
      installsAllTime: 7,
      versions: 0,
      comments: 0,
    })
  })
})
