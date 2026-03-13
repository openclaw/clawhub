/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { takeTopNonSuspiciousTrendingEntries, type LeaderboardEntry } from './leaderboards'

describe('takeTopNonSuspiciousTrendingEntries', () => {
  it('keeps scanning past suspicious entries until it finds enough clean skills', async () => {
    const entries: LeaderboardEntry[] = [
      { skillId: 'skills:suspicious-1', score: 300, installs: 300, downloads: 10 },
      { skillId: 'skills:suspicious-2', score: 200, installs: 200, downloads: 9 },
      { skillId: 'skills:clean', score: 100, installs: 100, downloads: 8 },
    ]

    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === 'skills:clean') {
            return {
              _id: id,
              softDeletedAt: undefined,
              moderationFlags: [],
              moderationReason: undefined,
            }
          }
          return {
            _id: id,
            softDeletedAt: undefined,
            moderationFlags: ['flagged.suspicious'],
            moderationReason: undefined,
          }
        }),
      },
    }

    const items = await takeTopNonSuspiciousTrendingEntries(
      ctx as never,
      entries,
      1,
    )

    expect(items).toEqual([
      { skillId: 'skills:clean', score: 100, installs: 100, downloads: 8 },
    ])
  })
})
