/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { internal } from '../_generated/api'
import { requireGitHubAccountAge } from './githubAccount'

vi.mock('../_generated/api', () => ({
  internal: {
    users: {
      getByIdInternal: Symbol('getByIdInternal'),
      getGithubAccountIdInternal: Symbol('getGithubAccountIdInternal'),
      updateGithubMetaInternal: Symbol('updateGithubMetaInternal'),
    },
  },
}))

const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe('requireGitHubAccountAge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses cached githubCreatedAt when fresh', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      handle: 'steipete',
      githubCreatedAt: now.getTime() - 10 * ONE_DAY_MS,
      githubFetchedAt: now.getTime() - ONE_DAY_MS + 1000,
    })
    const runMutation = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(runMutation).not.toHaveBeenCalled()
    expect(runQuery).toHaveBeenCalledWith(internal.users.getByIdInternal, { userId: 'users:1' })

    vi.useRealTimers()
  })

  it('rejects accounts younger than 7 days', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      handle: 'newbie',
      githubCreatedAt: now.getTime() - 2 * ONE_DAY_MS,
      githubFetchedAt: now.getTime() - ONE_DAY_MS / 2,
    })
    const runMutation = vi.fn()

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account must be at least 7 days old/i)

    vi.useRealTimers()
  })

  it('refreshes githubCreatedAt when cache is stale', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      handle: 'steipete',
      githubCreatedAt: undefined,
      githubFetchedAt: now.getTime() - 2 * ONE_DAY_MS,
    })
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
      'https://api.github.com/users/steipete',
      expect.objectContaining({ headers: { 'User-Agent': 'clawhub' } }),
    )
    expect(runMutation).toHaveBeenCalledWith(internal.users.updateGithubMetaInternal, {
      userId: 'users:1',
      githubCreatedAt: Date.parse('2020-01-01T00:00:00Z'),
      githubFetchedAt: now.getTime(),
    })

    vi.useRealTimers()
  })

  it('throws when GitHub lookup fails', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      handle: 'steipete',
      githubCreatedAt: undefined,
      githubFetchedAt: 0,
    })
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account lookup failed/i)
  })

  it('rejects when GitHub user ID does not match (username swap attack)', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        handle: 'oldusername',
        githubCreatedAt: undefined,
        githubFetchedAt: 0,
      })
      .mockResolvedValueOnce('12345') // getGithubAccountIdInternal returns stored ID
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 99999, // Different user now owns this username
        created_at: '2020-01-01T00:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account mismatch/i)

    vi.useRealTimers()
  })

  it('allows when GitHub user ID matches', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    const runQuery = vi.fn()
      .mockResolvedValueOnce({
        _id: 'users:1',
        handle: 'steipete',
        githubCreatedAt: undefined,
        githubFetchedAt: 0,
      })
      .mockResolvedValueOnce('12345') // getGithubAccountIdInternal returns stored ID
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 12345, // Same user ID
        created_at: '2020-01-01T00:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never)

    expect(runMutation).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
