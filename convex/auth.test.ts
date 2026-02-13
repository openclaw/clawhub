import { describe, expect, it, vi } from 'vitest'
import type { Id } from './_generated/dataModel'
import { BANNED_REAUTH_MESSAGE, handleSoftDeletedUserReauth } from './auth'

function makeCtx({
  user,
  banRecords,
}: {
  user: { deletedAt?: number } | null
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
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [] })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: userId })

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      updatedAt: expect.any(Number),
    })
  })

  it('restores soft-deleted users on fresh login (existingUserId is null)', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [] })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: null })

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      updatedAt: expect.any(Number),
    })
  })

  it('skips reactivation when existingUserId does not match userId', async () => {
    const otherUserId = 'users:999' as Id<'users'>
    const { ctx } = makeCtx({ user: { deletedAt: 123 } })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: otherUserId })

    expect(ctx.db.query).not.toHaveBeenCalled()
    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks banned users with a custom message', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [{ action: 'user.ban' }] })

    await expect(
      handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks banned users on fresh login (existingUserId is null)', async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [{ action: 'user.ban' }] })

    await expect(
      handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: null }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks users auto-banned for malware on fresh login', async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123 },
      banRecords: [{ action: 'user.autoban.malware' }],
    })

    await expect(
      handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: null }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks users auto-banned for malware when existingUserId matches', async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123 },
      banRecords: [{ action: 'user.autoban.malware' }],
    })

    await expect(
      handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('blocks reauth when ban records include mixed actions', async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123 },
      banRecords: [{ action: 'profile.update' }, { action: 'user.autoban.malware' }],
    })

    await expect(
      handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: null }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE)

    expect(ctx.db.patch).not.toHaveBeenCalled()
  })

  it('does not block reauth for non-ban audit actions', async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123 },
      banRecords: [{ action: 'profile.update' }, { action: 'user.role.change' }],
    })

    await handleSoftDeletedUserReauth(ctx as never, { userId, existingUserId: null })

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      updatedAt: expect.any(Number),
    })
  })
})
