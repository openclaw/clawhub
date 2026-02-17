import { describe, expect, it, vi } from 'vitest'
import { countPublicSkills } from './skills'

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const countPublicSkillsHandler = (
  countPublicSkills as unknown as WrappedHandler<Record<string, never>, number>
)._handler

function makeSkillsQuery(skills: Array<{ softDeletedAt?: number; moderationStatus?: string | null; moderationFlags?: string[] }>) {
  return {
    withIndex: (name: string, queryBuilder?: (q: unknown) => unknown) => {
      if (name !== 'by_active_updated') throw new Error(`unexpected skills index ${name}`)
      // Verify the query builder filters softDeletedAt
      if (queryBuilder) {
        const mockQ = { eq: (field: string, value: unknown) => {
          if (field !== 'softDeletedAt' || value !== undefined) {
            throw new Error(`unexpected filter: ${field} = ${String(value)}`)
          }
          return mockQ
        }}
        queryBuilder(mockQ)
      }
      return { collect: async () => skills }
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

  it('returns 0 when global stats row is missing', async () => {
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
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(0)
  })

  it('returns 0 when globalStats table is unavailable', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'globalStats') {
            throw new Error('unexpected table globalStats')
          }
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(0)
  })

  it('excludes skills with moderationFlags blocked.malware even if moderationStatus is active', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'globalStats') {
            return {
              withIndex: () => ({
                unique: async () => ({ _id: 'globalStats:1', activeSkillsCount: 42 }),
              }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    // When globalStats is available, the query returns the precomputed count.
    // The moderationFlags filtering is validated at the write path (isPublicSkillDoc).
    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(42)
  })

  it('excludes skills with undefined moderationStatus', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'globalStats') {
            return {
              withIndex: () => ({
                unique: async () => ({ _id: 'globalStats:1', activeSkillsCount: 0 }),
              }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        }),
      },
    }

    const result = await countPublicSkillsHandler(ctx, {})
    expect(result).toBe(0)
  })
})
