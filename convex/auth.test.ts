import { describe, expect, it, vi } from 'vitest'
import type { Id } from './_generated/dataModel'
import {
  BANNED_REAUTH_MESSAGE,
  DELETED_ACCOUNT_REAUTH_MESSAGE,
  handleDeletedUserSignIn,
} from './auth'

function makeCtx({
  user,
  banRecords,
}: {
  user: { deletedAt?: number; deactivatedAt?: number; purgedAt?: number } | null
  banRecords?: Array<Record<string, unknown>>
}) {
  const query = {
    withIndex: vi.fn().mockReturnValue({
      collect: vi.fn().mockResolvedValue(banRecords ?? []),
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

describe('handleDeletedUserSignIn', () => {
  const userId = 'users:1' as Id<'users'>

  it('skips when user not found', async () => {
    const { ctx } = makeCtx({ user: null })

    await handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId })

    expect(ctx.db.get).toHaveBeenCalledWith(userId)
    expect(ctx.db.query).not.toHaveBeenCalled()
  })

  it('skips active users', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: undefined, deactivatedAt: undefined } })

    await handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId })

    expect(ctx.db.query).not.toHaveBeenCalled()
    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks sign-in for deactivated users', async () => {
    const { ctx } = makeCtx({ user: { deactivatedAt: 123, purgedAt: 123 } })

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(DELETED_ACCOUNT_REAUTH_MESSAGE)

    expect(ctx.db.query).not.toHaveBeenCalled()
    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('migrates legacy self-deleted users and blocks sign-in', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [] })

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(DELETED_ACCOUNT_REAUTH_MESSAGE)

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      deactivatedAt: 123,
      purgedAt: 123,
      updatedAt: expect.any(Number),
    })
  })

  it('migrates legacy users on fresh login (existingUserId is null)', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [] })

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: null }),
    ).rejects.toThrow(DELETED_ACCOUNT_REAUTH_MESSAGE)

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      deactivatedAt: 123,
      purgedAt: 123,
      updatedAt: expect.any(Number),
    })
  })

  it('skips mutation when existingUserId does not match userId', async () => {
    const otherUserId = 'users:999' as Id<'users'>
    const { ctx } = makeCtx({ user: { deletedAt: 123 } })

    await handleDeletedUserSignIn(ctx as never, { userId, existingUserId: otherUserId })

    expect(ctx.db.query).not.toHaveBeenCalled()
    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks banned users with a custom message', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [{ action: 'user.ban' }] })

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks users auto-banned for malware', async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123 },
      banRecords: [{ action: 'user.autoban.malware' }],
    })

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })
})
