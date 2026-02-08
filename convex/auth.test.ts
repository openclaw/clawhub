import { describe, expect, it, vi } from 'vitest'
import type { Id } from './_generated/dataModel'
import { BANNED_REAUTH_MESSAGE, handleSoftDeletedUserReauth } from './auth'

function makeCtx({
  user,
  banRecord,
}: {
  user: { deletedAt?: number } | null
  banRecord?: Record<string, unknown> | null
}) {
  const query = {
    withIndex: vi.fn().mockReturnValue({
      filter: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(banRecord ?? null),
      }),
    }),
  }
  const ctx = {
    db: {
      get: vi.fn().mockResolvedValue(user),
      patch: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockReturnValue(query),
    },
  }
  return { ctx, query }
}

describe('handleSoftDeletedUserReauth', () => {
  const userId = 'users:1' as Id<'users'>

  it('skips when user not found', async () => {
    const { ctx } = makeCtx({ user: null })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: userId })

    expect(ctx.db.get).toHaveBeenCalledWith(userId)
    expect(ctx.db.query).not.toHaveBeenCalled()
  })

  it('skips active users', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: undefined } })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: userId })

    expect(ctx.db.query).not.toHaveBeenCalled()
    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('restores soft-deleted users when not banned', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecord: null })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: userId })

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      updatedAt: expect.any(Number),
    })
  })

  it('blocks banned users with a custom message', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecord: { action: 'user.ban' } })

    await expect(
      handleSoftDeletedUserReauth(ctx as never, { userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })
})
