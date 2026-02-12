/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { internal } from '../_generated/api'
import { requireGitHubAccountAge } from './githubAccount'

vi.mock('../_generated/api', () => ({
  internal: {
    users: {
      getByIdInternal: Symbol('getByIdInternal'),
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/GitHub account lookup failed/i)
  })

  it('throws rate-limit error on 403', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      handle: 'steipete',
      githubCreatedAt: undefined,
      githubFetchedAt: 0,
    })
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/rate limit exceeded/i)
  })

  it('throws rate-limit error on 429', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'users:1',
      handle: 'steipete',
      githubCreatedAt: undefined,
      githubFetchedAt: 0,
    })
    const runMutation = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requireGitHubAccountAge({ runQuery, runMutation } as never, 'users:1' as never),
    ).rejects.toThrow(/rate limit exceeded/i)
  })

  it('includes Authorization header when GITHUB_TOKEN is set', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-02T12:00:00Z')
    vi.setSystemTime(now)

    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123')

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
      expect.objectContaining({
        headers: {
          'User-Agent': 'clawhub',
          Authorization: 'Bearer ghp_test123',
        },
      }),
    )

    vi.useRealTimers()
  })
})
