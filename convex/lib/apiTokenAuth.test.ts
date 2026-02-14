import { describe, expect, it, vi } from 'vitest'
import { getOptionalApiTokenUserId } from './apiTokenAuth'
import { hashToken } from './tokens'

describe('getOptionalApiTokenUserId', () => {
  it('returns null when auth header is missing', async () => {
    const ctx = {
      runQuery: vi.fn(),
    }
    const request = new Request('https://example.com')

    const userId = await getOptionalApiTokenUserId(ctx as never, request)

    expect(userId).toBeNull()
    expect(ctx.runQuery).not.toHaveBeenCalled()
  })

  it('returns null for unknown token', async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
    }
    const request = new Request('https://example.com', {
      headers: { authorization: 'Bearer token-1' },
    })

    const userId = await getOptionalApiTokenUserId(ctx as never, request)

    expect(userId).toBeNull()
    expect(ctx.runQuery).toHaveBeenCalledTimes(1)
    expect(ctx.runQuery.mock.calls[0]?.[1]).toEqual({
      tokenHash: await hashToken('token-1'),
    })
  })

  it('returns user id when token and user are valid', async () => {
    const tokenId = 'apiTokens_1'
    const expectedUserId = 'users_1'
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined }
          }
          if (args.tokenId) {
            return { _id: expectedUserId, deletedAt: undefined }
          }
          return null
        }),
    }
    const request = new Request('https://example.com', {
      headers: { authorization: 'Bearer token-2' },
    })

    const userId = await getOptionalApiTokenUserId(ctx as never, request)

    expect(userId).toBe(expectedUserId)
    expect(ctx.runQuery).toHaveBeenCalledTimes(2)
  })

  it('returns null when user is deleted', async () => {
    const tokenId = 'apiTokens_2'
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined }
          }
          if (args.tokenId) {
            return { _id: 'users_deleted', deletedAt: Date.now() }
          }
          return null
        }),
    }
    const request = new Request('https://example.com', {
      headers: { authorization: 'Bearer token-3' },
    })

    const userId = await getOptionalApiTokenUserId(ctx as never, request)

    expect(userId).toBeNull()
    expect(ctx.runQuery).toHaveBeenCalledTimes(2)
  })
})
