/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { internal } from '../_generated/api'
import { requireGitHubAccountAge, syncGitHubProfile } from './githubAccount'

vi.mock('../_generated/api', () => ({
  internal: {
    githubIdentity: {
      getGitHubProviderAccountIdInternal: Symbol('getGitHubProviderAccountIdInternal'),
    },
    users: {
      getByIdInternal: Symbol('getByIdInternal'),
      setGitHubCreatedAtInternal: Symbol('setGitHubCreatedAtInternal'),
      syncGitHubProfileInternal: Symbol('syncGitHubProfileInternal'),
    },
  },
}))

const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe('requireGitHubAccountAge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses cached githubCreatedAt when present', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      githubCreatedAt: now.getTime() - 10 * ONE_DAY_MS,
    })
    const runMutation = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(runMutation).not.toHaveBeenCalled()
    expect(runQuery).toHaveBeenCalledWith(internal.users.getByIdInternal, { userId: 'users:1' })
    expect(runQuery).not.toHaveBeenCalledWith(
      internal.githubIdentity.getGitHubProviderAccountIdInternal,
      { userId: 'users:1' },
    )
  })

  it('rejects deactivated users', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      deactivatedAt: Date.now(),
    })
    const runMutation = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/User not found/i)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects accounts younger than 7 days', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      githubCreatedAt: now.getTime() - 2 * ONE_DAY_MS,
    })
    const runMutation = vi.fn()

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account must be at least 7 days old/i)
  })

  it('fetches githubCreatedAt when missing (by providerAccountId)', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        created_at: '2020-01-01T00:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/user/12345',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'clawhub' }),
      }),
    )
    expect(runMutation).toHaveBeenCalledWith(internal.users.setGitHubCreatedAtInternal, {
      userId: 'users:1',
      githubCreatedAt: Date.parse('2020-01-01T00:00:00Z'),
    })
  })

  it('rejects when providerAccountId is missing', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce(null)
    const runMutation = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account required/i)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects when providerAccountId is invalid', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('abc123')
    const runMutation = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account lookup failed/i)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when GitHub lookup fails', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account lookup failed/i)
  })

  it('throws rate-limit error on 403', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/rate limit exceeded/i)
  })

  it('throws rate-limit error on 429', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/rate limit exceeded/i)
  })

  it('throws when GitHub returns an invalid payload', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account lookup failed/i)
  })

  it('includes Authorization header when GITHUB_TOKEN is set', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123')

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        githubCreatedAt: undefined,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        created_at: '2020-01-01T00:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/user/12345',
      expect.objectContaining({
        headers: {
          'User-Agent': 'clawhub',
          Authorization: 'Bearer ghp_test123',
        },
      }),
    )
  })
})

describe('syncGitHubProfile', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('skips recent syncs (throttle)', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        name: 'oldname',
        githubProfileSyncedAt: now.getTime(),
      })
    const runMutation = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await syncGitHubProfile({ runQuery, runMutation } as never, 'users:1' as never)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(runMutation).not.toHaveBeenCalled()
  })

  it('updates profile even when only avatar changes', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        name: 'same',
        image: 'https://avatars.githubusercontent.com/u/1?v=3',
        githubProfileSyncedAt: now.getTime() - 10 * ONE_DAY_MS,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        login: 'same',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await syncGitHubProfile({ runQuery, runMutation } as never, 'users:1' as never)

    expect(runMutation).toHaveBeenCalledWith(internal.users.syncGitHubProfileInternal, {
      userId: 'users:1',
      name: 'same',
      image: 'https://avatars.githubusercontent.com/u/1?v=4',
      syncedAt: now.getTime(),
    })
  })

  it('updates name and records sync timestamp', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        name: 'old',
        githubProfileSyncedAt: now.getTime() - 10 * ONE_DAY_MS,
      })
      .mockResolvedValueOnce('12345')
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        login: 'new',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=1',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await syncGitHubProfile({ runQuery, runMutation } as never, 'users:1' as never)

    expect(runMutation).toHaveBeenCalledWith(internal.users.syncGitHubProfileInternal, {
      userId: 'users:1',
      name: 'new',
      image: 'https://avatars.githubusercontent.com/u/1?v=1',
      syncedAt: now.getTime(),
    })
  })
})
