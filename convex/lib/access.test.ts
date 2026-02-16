import { describe, expect, it, vi } from 'vitest'

vi.mock('@convex-dev/auth/server', () => ({
  getAuthUserId: vi.fn(),
}))

const { getAuthUserId } = await import('@convex-dev/auth/server')
const {
  assertAdmin,
  assertModerator,
  assertRole,
  requireUser,
  requireUserFromAction,
} = await import('./access')

describe('access.requireUser', () => {
  it('throws when auth is missing', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null)
    await expect(
      requireUser({
        db: { get: vi.fn() },
      } as never),
    ).rejects.toThrow('Unauthorized')
  })

  it('throws when user is deleted/deactivated/missing', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue('users:1' as never)

    for (const value of [null, { _id: 'users:1', deletedAt: Date.now() }, { _id: 'users:1', deactivatedAt: Date.now() }]) {
      const dbGet = vi.fn().mockResolvedValue(value as never)
      await expect(
        requireUser({
          db: { get: dbGet },
        } as never),
      ).rejects.toThrow('User not found')
    }
  })

  it('returns auth user when active', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue('users:2' as never)
    const user = { _id: 'users:2', role: 'user' }
    const dbGet = vi.fn().mockResolvedValue(user as never)

    const result = await requireUser({
      db: { get: dbGet },
    } as never)

    expect(dbGet).toHaveBeenCalledWith('users:2')
    expect(result).toEqual({ userId: 'users:2', user })
  })
})

describe('access.requireUserFromAction', () => {
  it('throws when auth is missing', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null)
    await expect(
      requireUserFromAction({
        runQuery: vi.fn(),
      } as never),
    ).rejects.toThrow('Unauthorized')
  })

  it('throws when action lookup returns deleted/deactivated/missing user', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue('users:1' as never)

    for (const value of [null, { _id: 'users:1', deletedAt: Date.now() }, { _id: 'users:1', deactivatedAt: Date.now() }]) {
      const runQuery = vi.fn().mockResolvedValue(value as never)
      await expect(
        requireUserFromAction({
          runQuery,
        } as never),
      ).rejects.toThrow('User not found')
    }
  })

  it('returns active user from action query', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue('users:9' as never)
    const user = { _id: 'users:9', role: 'admin' }
    const runQuery = vi.fn().mockResolvedValue(user as never)

    const result = await requireUserFromAction({
      runQuery,
    } as never)

    expect(runQuery).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ userId: 'users:9', user })
  })
})

describe('access role assertions', () => {
  it('assertRole allows matching roles and rejects missing role', () => {
    expect(() => assertRole({ role: 'admin' } as never, ['admin'])).not.toThrow()
    expect(() => assertRole({ role: undefined } as never, ['admin'])).toThrow('Forbidden')
    expect(() => assertRole({ role: 'user' } as never, ['admin'])).toThrow('Forbidden')
  })

  it('assertAdmin/assertModerator enforce expected policy', () => {
    expect(() => assertAdmin({ role: 'admin' } as never)).not.toThrow()
    expect(() => assertAdmin({ role: 'moderator' } as never)).toThrow('Forbidden')

    expect(() => assertModerator({ role: 'admin' } as never)).not.toThrow()
    expect(() => assertModerator({ role: 'moderator' } as never)).not.toThrow()
    expect(() => assertModerator({ role: 'user' } as never)).toThrow('Forbidden')
  })
})
