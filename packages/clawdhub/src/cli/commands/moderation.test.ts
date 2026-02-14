/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from '../types'

vi.mock('../../config.js', () => ({
  readGlobalConfig: vi.fn(async () => ({ registry: 'https://clawhub.ai', token: 'tkn' })),
}))

vi.mock('../registry.js', () => ({
  getRegistry: vi.fn(async () => 'https://clawhub.ai'),
}))

const mockApiRequest = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
    mockApiRequest(registry, args, schema),
}))

vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn() })),
  fail: (message: string) => {
    throw new Error(message)
  },
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => false,
  promptConfirm: vi.fn(async () => true),
}))

const { cmdBanUser, cmdSetRole } = await import('./moderation')

function makeOpts(): GlobalOpts {
  return {
    workdir: '/work',
    dir: '/work/skills',
    site: 'https://clawhub.ai',
    registry: 'https://clawhub.ai',
    registrySource: 'default',
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('cmdBanUser', () => {
  it('requires --yes when input is disabled', async () => {
    await expect(cmdBanUser(makeOpts(), 'demo', {}, false)).rejects.toThrow(/--yes/i)
  })

  it('posts handle payload', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 1 })
    await cmdBanUser(makeOpts(), 'hightower6eu', { yes: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/users/ban',
        body: { handle: 'hightower6eu' },
      }),
      expect.anything(),
    )
  })

  it('includes reason when provided', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 })
    await cmdBanUser(
      makeOpts(),
      'hightower6eu',
      { yes: true, reason: 'malware distribution' },
      false,
    )
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/users/ban',
        body: { handle: 'hightower6eu', reason: 'malware distribution' },
      }),
      expect.anything(),
    )
  })

  it('posts user id payload when --id is set', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 })
    await cmdBanUser(makeOpts(), 'user_123', { yes: true, id: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/users/ban',
        body: { userId: 'user_123' },
      }),
      expect.anything(),
    )
  })

  it('resolves user via fuzzy search', async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        items: [
          {
            userId: 'users_123',
            handle: 'moonshine-100rze',
            displayName: null,
            name: null,
            role: 'user',
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 })
    await cmdBanUser(makeOpts(), 'moonshine-100rze', { yes: true, fuzzy: true }, false)
    expect(mockApiRequest).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        method: 'GET',
        path: expect.stringContaining('/api/v1/users?'),
      }),
      expect.anything(),
    )
    expect(mockApiRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/users/ban',
        body: { userId: 'users_123' },
      }),
      expect.anything(),
    )
  })

  it('fails fuzzy search with multiple matches when not interactive', async () => {
    mockApiRequest.mockResolvedValueOnce({
      items: [
        {
          userId: 'users_1',
          handle: 'moonshine-100rze',
          displayName: null,
          name: null,
          role: null,
        },
        {
          userId: 'users_2',
          handle: 'moonshine-100rze2',
          displayName: null,
          name: null,
          role: null,
        },
      ],
      total: 2,
    })
    await expect(
      cmdBanUser(makeOpts(), 'moonshine', { yes: true, fuzzy: true }, false),
    ).rejects.toThrow(/multiple users matched/i)
  })
})

describe('cmdSetRole', () => {
  it('requires --yes when input is disabled', async () => {
    await expect(cmdSetRole(makeOpts(), 'demo', 'moderator', {}, false)).rejects.toThrow(/--yes/i)
  })

  it('rejects invalid roles', async () => {
    await expect(cmdSetRole(makeOpts(), 'demo', 'owner', { yes: true }, false)).rejects.toThrow(
      /role/i,
    )
  })

  it('posts handle payload', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, role: 'moderator' })
    await cmdSetRole(makeOpts(), 'hightower6eu', 'moderator', { yes: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/users/role',
        body: { handle: 'hightower6eu', role: 'moderator' },
      }),
      expect.anything(),
    )
  })

  it('posts user id payload when --id is set', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, role: 'admin' })
    await cmdSetRole(makeOpts(), 'user_123', 'admin', { yes: true, id: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/users/role',
        body: { userId: 'user_123', role: 'admin' },
      }),
      expect.anything(),
    )
  })
})
