import { describe, expect, it, vi } from 'vitest'
import { countPublicSkills } from './skills'

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const countPublicSkillsHandler = (
  countPublicSkills as unknown as WrappedHandler<Record<string, never>, number>
)._handler

function makeSkillsQuery(skills: Array<{ softDeletedAt?: number; moderationStatus?: string | null }>) {
  return {
    withIndex: (name: string) => {
      if (name !== 'by_active_updated') throw new Error(`unexpected skills index ${name}`)
      return {
        collect: async () => skills,
      }
    },
  }
}

describe('skills.countPublicSkills', () => {
  it('returns precomputed global stats count when available', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'globalStats') {
            return {
              withIndex: () => ({
                unique: async () => ({ _id: 'globalStats:1', activeSkillsCount: 123 }),
              }),
            }
          }
          if (table === 'skills') {
            return makeSkillsQuery([])
          }
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(123)
  })

  it('falls back to live count when global stats row is missing', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'globalStats') {
            return {
              withIndex: () => ({
                unique: async () => null,
              }),
            }
          }
          if (table === 'skills') {
            return makeSkillsQuery([
              { softDeletedAt: undefined, moderationStatus: 'active' },
              { softDeletedAt: undefined, moderationStatus: 'hidden' },
              { softDeletedAt: undefined, moderationStatus: 'active' },
            ])
          }
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(2)
  })

  it('falls back to live count when globalStats table is unavailable', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'globalStats') {
            throw new Error('unexpected table globalStats')
          }
          if (table === 'skills') {
            return makeSkillsQuery([
              { softDeletedAt: undefined, moderationStatus: 'active' },
              { softDeletedAt: undefined, moderationStatus: 'active' },
            ])
          }
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(2)
  })
})
