/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/apiTokenAuth', () => ({
  requireApiTokenUser: vi.fn(),
  getOptionalApiTokenUserId: vi.fn(),
}))

vi.mock('./skills', () => ({
  publishVersionForUser: vi.fn(),
}))

const { getOptionalApiTokenUserId, requireApiTokenUser } = await import('./lib/apiTokenAuth')
const { publishVersionForUser } = await import('./skills')
const { __handlers } = await import('./httpApiV1')

type ActionCtx = import('./_generated/server').ActionCtx

type RateLimitArgs = { key: string; limit: number; windowMs: number }

function isRateLimitArgs(args: unknown): args is RateLimitArgs {
  if (!args || typeof args !== 'object') return false
  const value = args as Record<string, unknown>
  return (
    typeof value.key === 'string' &&
    typeof value.limit === 'number' &&
    typeof value.windowMs === 'number'
  )
}

function hasSlugArgs(args: unknown): args is { slug: string } {
  if (!args || typeof args !== 'object') return false
  const value = args as Record<string, unknown>
  return typeof value.slug === 'string'
}

function makeCtx(partial: Record<string, unknown>) {
  const partialRunQuery =
    typeof partial.runQuery === 'function'
      ? (partial.runQuery as (query: unknown, args: Record<string, unknown>) => unknown)
      : null
  const runQuery = vi.fn(async (query: unknown, args: Record<string, unknown>) => {
    if (isRateLimitArgs(args)) return okRate()
    return partialRunQuery ? await partialRunQuery(query, args) : null
  })
  const runMutation =
    typeof partial.runMutation === 'function'
      ? partial.runMutation
      : vi.fn().mockResolvedValue(okRate())

  return { ...partial, runQuery, runMutation } as unknown as ActionCtx
}

const okRate = () => ({
  allowed: true,
  remaining: 10,
  limit: 100,
  resetAt: Date.now() + 60_000,
})

const blockedRate = () => ({
  allowed: false,
  remaining: 0,
  limit: 100,
  resetAt: Date.now() + 60_000,
})

beforeEach(() => {
  vi.mocked(getOptionalApiTokenUserId).mockReset()
  vi.mocked(getOptionalApiTokenUserId).mockResolvedValue(null)
  vi.mocked(requireApiTokenUser).mockReset()
  vi.mocked(publishVersionForUser).mockReset()
})

describe('httpApiV1 handlers', () => {
  it('search returns empty results for blank query', async () => {
    const runAction = vi.fn()
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request('https://example.com/api/v1/search?q=%20%20'),
    )
    if (response.status !== 200) {
      throw new Error(await response.text())
    }
    expect(await response.json()).toEqual({ results: [] })
    expect(runAction).not.toHaveBeenCalled()
  })

  it('users/restore forbids non-admin api tokens', async () => {
    const runQuery = vi.fn()
    const runAction = vi.fn()
    const runMutation = vi.fn().mockResolvedValue(okRate())
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:actor',
      user: { _id: 'users:actor', role: 'user' },
    } as never)

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request('https://example.com/api/v1/users/restore', {
        method: 'POST',
        body: JSON.stringify({ handle: 'target', slugs: ['a'] }),
      }),
    )
    expect(response.status).toBe(403)
    expect(runQuery).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
  })

  it('users/restore calls restore action for admin', async () => {
    const runAction = vi.fn().mockResolvedValue({ ok: true, totalRestored: 1, results: [] })
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate()
      return { ok: true }
    })
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('handle' in args) return { _id: 'users:target' }
      return null
    })
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request('https://example.com/api/v1/users/restore', {
        method: 'POST',
        body: JSON.stringify({
          handle: 'Target',
          slugs: ['a', 'b'],
          forceOverwriteSquatter: true,
        }),
      }),
    )
    if (response.status !== 200) throw new Error(await response.text())
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: 'users:admin',
      ownerHandle: 'target',
      ownerUserId: 'users:target',
      slugs: ['a', 'b'],
      forceOverwriteSquatter: true,
    })
  })

  it('users/reclaim forbids non-admin api tokens', async () => {
    const runQuery = vi.fn()
    const runAction = vi.fn()
    const runMutation = vi.fn().mockResolvedValue(okRate())
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:actor',
      user: { _id: 'users:actor', role: 'user' },
    } as never)

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request('https://example.com/api/v1/users/reclaim', {
        method: 'POST',
        body: JSON.stringify({ handle: 'target', slugs: ['a'] }),
      }),
    )
    expect(response.status).toBe(403)
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('users/reclaim calls reclaim mutation for admin', async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate()
      return { ok: true }
    })
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('handle' in args) return { _id: 'users:target' }
      return null
    })
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction: vi.fn(), runMutation }),
      new Request('https://example.com/api/v1/users/reclaim', {
        method: 'POST',
        body: JSON.stringify({ handle: 'Target', slugs: [' A ', 'b'], reason: 'r' }),
      }),
    )
    if (response.status !== 200) throw new Error(await response.text())

    const reclaimCalls = runMutation.mock.calls.filter(([, args]) => hasSlugArgs(args))
    expect(reclaimCalls).toHaveLength(2)
    expect(reclaimCalls[0]?.[1]).toMatchObject({
      actorUserId: 'users:admin',
      slug: 'a',
      rightfulOwnerUserId: 'users:target',
      reason: 'r',
    })
    expect(reclaimCalls[1]?.[1]).toMatchObject({
      actorUserId: 'users:admin',
      slug: 'b',
      rightfulOwnerUserId: 'users:target',
      reason: 'r',
    })
  })

  it('search forwards limit and highlightedOnly', async () => {
    const runAction = vi.fn().mockResolvedValue([
      {
        score: 1,
        skill: { slug: 'a', displayName: 'A', summary: null, updatedAt: 1 },
        version: { version: '1.0.0' },
      },
    ])
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request('https://example.com/api/v1/search?q=test&limit=5&highlightedOnly=true'),
    )
    if (response.status !== 200) {
      throw new Error(await response.text())
    }
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: 'test',
      limit: 5,
      highlightedOnly: true,
    })
  })

  it('search rate limits', async () => {
    const runMutation = vi.fn().mockResolvedValue(blockedRate())
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction: vi.fn(), runMutation }),
      new Request('https://example.com/api/v1/search?q=test'),
    )
    expect(response.status).toBe(429)
  })

  it('resolve validates hash', async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.resolveSkillVersionV1Handler(
      makeCtx({ runQuery: vi.fn(), runMutation }),
      new Request('https://example.com/api/v1/resolve?slug=demo&hash=bad'),
    )
    expect(response.status).toBe(400)
  })

  it('resolve returns 404 when missing', async () => {
    const runQuery = vi.fn().mockResolvedValue(null)
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.resolveSkillVersionV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        'https://example.com/api/v1/resolve?slug=demo&hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    )
    expect(response.status).toBe(404)
  })

  it('resolve returns match and latestVersion', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      match: { version: '1.0.0' },
      latestVersion: { version: '2.0.0' },
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.resolveSkillVersionV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        'https://example.com/api/v1/resolve?slug=demo&hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.match.version).toBe('1.0.0')
  })

  it('lists skills with resolved tags using batch query', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('cursor' in args || 'limit' in args) {
        return {
          items: [
            {
              skill: {
                _id: 'skills:1',
                slug: 'demo',
                displayName: 'Demo',
                summary: 's',
                tags: { latest: 'versions:1' },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: '1.0.0', createdAt: 3, changelog: 'c' },
            },
          ],
          nextCursor: null,
        }
      }
      // Batch query: versionIds (plural)
      if ('versionIds' in args) {
        return [{ _id: 'versions:1', version: '1.0.0', softDeletedAt: undefined }]
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills?limit=1'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.items[0].tags.latest).toBe('1.0.0')
  })

  it('batches tag resolution across multiple skills into single query', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('cursor' in args || 'limit' in args) {
        return {
          items: [
            {
              skill: {
                _id: 'skills:1',
                slug: 'skill-a',
                displayName: 'Skill A',
                summary: 's',
                tags: { latest: 'versions:1', stable: 'versions:2' },
                stats: { downloads: 0, stars: 0, versions: 2, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: '2.0.0', createdAt: 3, changelog: 'c' },
            },
            {
              skill: {
                _id: 'skills:2',
                slug: 'skill-b',
                displayName: 'Skill B',
                summary: 's',
                tags: { latest: 'versions:3' },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: '1.0.0', createdAt: 3, changelog: 'c' },
            },
          ],
          nextCursor: null,
        }
      }
      // Batch query should receive all version IDs from all skills
      if ('versionIds' in args) {
        const ids = args.versionIds as string[]
        expect(ids).toHaveLength(3)
        expect(ids).toContain('versions:1')
        expect(ids).toContain('versions:2')
        expect(ids).toContain('versions:3')
        return [
          { _id: 'versions:1', version: '2.0.0', softDeletedAt: undefined },
          { _id: 'versions:2', version: '1.0.0', softDeletedAt: undefined },
          { _id: 'versions:3', version: '1.0.0', softDeletedAt: undefined },
        ]
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    // Verify tags are correctly resolved for each skill
    expect(json.items[0].tags.latest).toBe('2.0.0')
    expect(json.items[0].tags.stable).toBe('1.0.0')
    expect(json.items[1].tags.latest).toBe('1.0.0')
    // Verify batch query was called exactly once (not per-tag)
    const batchCalls = runQuery.mock.calls.filter(
      ([, args]) => args && 'versionIds' in (args as Record<string, unknown>),
    )
    expect(batchCalls).toHaveLength(1)
  })

  it('lists souls with resolved tags using batch query', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('cursor' in args || 'limit' in args) {
        return {
          items: [
            {
              soul: {
                _id: 'souls:1',
                slug: 'demo-soul',
                displayName: 'Demo Soul',
                summary: 's',
                tags: { latest: 'soulVersions:1' },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: '1.0.0', createdAt: 3, changelog: 'c' },
            },
          ],
          nextCursor: null,
        }
      }
      if ('versionIds' in args) {
        return [{ _id: 'soulVersions:1', version: '1.0.0', softDeletedAt: undefined }]
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.listSoulsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/souls?limit=1'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.items[0].tags.latest).toBe('1.0.0')
  })

  it('batches tag resolution across multiple souls into single query', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('cursor' in args || 'limit' in args) {
        return {
          items: [
            {
              soul: {
                _id: 'souls:1',
                slug: 'soul-a',
                displayName: 'Soul A',
                summary: 's',
                tags: { latest: 'soulVersions:1', stable: 'soulVersions:2' },
                stats: { downloads: 0, stars: 0, versions: 2, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: '2.0.0', createdAt: 3, changelog: 'c' },
            },
            {
              soul: {
                _id: 'souls:2',
                slug: 'soul-b',
                displayName: 'Soul B',
                summary: 's',
                tags: { latest: 'soulVersions:3' },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: '1.0.0', createdAt: 3, changelog: 'c' },
            },
          ],
          nextCursor: null,
        }
      }
      if ('versionIds' in args) {
        const ids = args.versionIds as string[]
        expect(ids).toHaveLength(3)
        expect(ids).toContain('soulVersions:1')
        expect(ids).toContain('soulVersions:2')
        expect(ids).toContain('soulVersions:3')
        return [
          { _id: 'soulVersions:1', version: '2.0.0', softDeletedAt: undefined },
          { _id: 'soulVersions:2', version: '1.0.0', softDeletedAt: undefined },
          { _id: 'soulVersions:3', version: '1.0.0', softDeletedAt: undefined },
        ]
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.listSoulsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/souls'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.items[0].tags.latest).toBe('2.0.0')
    expect(json.items[0].tags.stable).toBe('1.0.0')
    expect(json.items[1].tags.latest).toBe('1.0.0')
    const batchCalls = runQuery.mock.calls.filter(
      ([, args]) => args && 'versionIds' in (args as Record<string, unknown>),
    )
    expect(batchCalls).toHaveLength(1)
  })

  it('souls get resolves tags using batch query', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('slug' in args) {
        return {
          soul: {
            _id: 'souls:1',
            slug: 'demo-soul',
            displayName: 'Demo Soul',
            summary: 's',
            tags: { latest: 'soulVersions:1' },
            stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: { version: '1.0.0', createdAt: 3, changelog: 'c' },
          owner: null,
        }
      }
      if ('versionIds' in args) {
        return [{ _id: 'soulVersions:1', version: '1.0.0', softDeletedAt: undefined }]
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.soulsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/souls/demo-soul'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.soul.tags.latest).toBe('1.0.0')
  })

  it('lists skills supports sort aliases', async () => {
    const checks: Array<[string, string]> = [
      ['rating', 'stars'],
      ['installs', 'installsCurrent'],
      ['installs-all-time', 'installsAllTime'],
      ['trending', 'trending'],
    ]

    for (const [input, expected] of checks) {
      const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if ('sort' in args || 'cursor' in args || 'limit' in args) {
          expect(args.sort).toBe(expected)
          return { items: [], nextCursor: null }
        }
        return null
      })
      const runMutation = vi.fn().mockResolvedValue(okRate())
      const response = await __handlers.listSkillsV1Handler(
        makeCtx({ runQuery, runMutation }),
        new Request(`https://example.com/api/v1/skills?sort=${input}`),
      )
      expect(response.status).toBe(200)
    }
  })

  it('get skill returns 404 when missing', async () => {
    const runQuery = vi.fn().mockResolvedValue(null)
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills/missing'),
    )
    expect(response.status).toBe(404)
  })

  it('get skill returns pending-scan message for owner api token', async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue('users:1' as never)
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('slug' in args) {
        return {
          _id: 'skills:1',
          slug: 'demo',
          ownerUserId: 'users:1',
          moderationStatus: 'hidden',
          moderationReason: 'pending.scan',
        }
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills/demo'),
    )
    expect(response.status).toBe(423)
    expect(await response.text()).toContain('security scan is pending')
  })

  it('get skill returns undelete hint for owner soft-deleted skill', async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue('users:1' as never)
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('slug' in args) {
        return {
          _id: 'skills:1',
          slug: 'demo',
          ownerUserId: 'users:1',
          softDeletedAt: 1,
          moderationStatus: 'hidden',
        }
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills/demo'),
    )
    expect(response.status).toBe(410)
    expect(await response.text()).toContain('clawhub undelete demo')
  })

  it('get skill returns payload', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('slug' in args) {
        return {
          skill: {
            _id: 'skills:1',
            slug: 'demo',
            displayName: 'Demo',
            summary: 's',
            tags: { latest: 'versions:1' },
            stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            version: '1.0.0',
            createdAt: 3,
            changelog: 'c',
            files: [],
          },
          owner: { handle: 'p', displayName: 'Peter', image: null },
        }
      }
      // Batch query for tag resolution
      if ('versionIds' in args) {
        return [{ _id: 'versions:1', version: '1.0.0', softDeletedAt: undefined }]
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills/demo'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.skill.slug).toBe('demo')
    expect(json.latestVersion.version).toBe('1.0.0')
  })

  it('lists versions', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('slug' in args) {
        return { _id: 'skills:1', slug: 'demo', displayName: 'Demo' }
      }
      if ('skillId' in args && 'cursor' in args) {
        return {
          items: [
            {
              version: '1.0.0',
              createdAt: 1,
              changelog: 'c',
              changelogSource: 'user',
              files: [],
            },
          ],
          nextCursor: null,
        }
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills/demo/versions?limit=1'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.items[0].version).toBe('1.0.0')
  })

  it('returns version detail', async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('slug' in args) {
        return { _id: 'skills:1', slug: 'demo', displayName: 'Demo' }
      }
      if ('skillId' in args && 'version' in args) {
        return {
          version: '1.0.0',
          createdAt: 1,
          changelog: 'c',
          changelogSource: 'auto',
          files: [
            {
              path: 'SKILL.md',
              size: 1,
              storageId: 'storage:1',
              sha256: 'abc',
              contentType: 'text/plain',
            },
          ],
        }
      }
      return null
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/skills/demo/versions/1.0.0'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.version.files[0].path).toBe('SKILL.md')
  })

  it('returns raw file content', async () => {
    const version = {
      version: '1.0.0',
      createdAt: 1,
      changelog: 'c',
      files: [
        {
          path: 'SKILL.md',
          size: 5,
          storageId: 'storage:1',
          sha256: 'abcd',
          contentType: 'text/plain',
        },
      ],
      softDeletedAt: undefined,
    }
    const runQuery = vi.fn().mockResolvedValue({
      skill: {
        _id: 'skills:1',
        slug: 'demo',
        displayName: 'Demo',
        summary: 's',
        tags: {},
        stats: {},
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: version,
      owner: null,
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const storage = {
      get: vi.fn().mockResolvedValue(new Blob(['hello'], { type: 'text/plain' })),
    }
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request('https://example.com/api/v1/skills/demo/file?path=SKILL.md'),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
    expect(response.headers.get('X-Content-SHA256')).toBe('abcd')
  })

  it('returns 413 when raw file too large', async () => {
    const version = {
      version: '1.0.0',
      createdAt: 1,
      changelog: 'c',
      files: [
        {
          path: 'SKILL.md',
          size: 210 * 1024,
          storageId: 'storage:1',
          sha256: 'abcd',
          contentType: 'text/plain',
        },
      ],
      softDeletedAt: undefined,
    }
    const runQuery = vi.fn().mockResolvedValue({
      skill: {
        _id: 'skills:1',
        slug: 'demo',
        displayName: 'Demo',
        summary: 's',
        tags: {},
        stats: {},
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: version,
      owner: null,
    })
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request('https://example.com/api/v1/skills/demo/file?path=SKILL.md'),
    )
    expect(response.status).toBe(413)
  })

  it('publish json succeeds', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: 's',
      versionId: 'v',
      embeddingId: 'e',
    } as never)
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const body = JSON.stringify({
      slug: 'demo',
      displayName: 'Demo',
      version: '1.0.0',
      changelog: 'c',
      files: [
        {
          path: 'SKILL.md',
          size: 1,
          storageId: 'storage:1',
          sha256: 'abc',
          contentType: 'text/plain',
        },
      ],
    })
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer clh_test' },
        body,
      }),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(publishVersionForUser).toHaveBeenCalled()
  })

  it('publish multipart succeeds', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: 's',
      versionId: 'v',
      embeddingId: 'e',
    } as never)
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const form = new FormData()
    form.set(
      'payload',
      JSON.stringify({
        slug: 'demo',
        displayName: 'Demo',
        version: '1.0.0',
        changelog: '',
        tags: ['latest'],
      }),
    )
    form.append('files', new Blob(['hello'], { type: 'text/plain' }), 'SKILL.md')
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation, storage: { store: vi.fn().mockResolvedValue('storage:1') } }),
      new Request('https://example.com/api/v1/skills', {
        method: 'POST',
        headers: { Authorization: 'Bearer clh_test' },
        body: form,
      }),
    )
    if (response.status !== 200) {
      throw new Error(await response.text())
    }
  })

  it('publish rejects missing token', async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/skills', { method: 'POST' }),
    )
    expect(response.status).toBe(401)
  })

  it('whoami returns user payload', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: 'users:1',
      user: { handle: 'p', displayName: 'Peter', image: null },
    } as never)
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.whoamiV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/whoami', {
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.user.handle).toBe('p')
  })

  it('delete and undelete require auth', async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error('Unauthorized'))
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/skills/demo', { method: 'DELETE' }),
    )
    expect(response.status).toBe(401)

    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error('Unauthorized'))
    const response2 = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/skills/demo/undelete', { method: 'POST' }),
    )
    expect(response2.status).toBe(401)
  })

  it('delete and undelete succeed', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runMutation = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('key' in args) return okRate()
      return { ok: true }
    })

    const response = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/skills/demo', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(response.status).toBe(200)

    const response2 = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/skills/demo/undelete', {
        method: 'POST',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(response2.status).toBe(200)
  })

  it('ban user requires auth', async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error('Unauthorized'))
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/users/ban', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'demo' }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('ban user succeeds with handle', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runQuery = vi.fn().mockResolvedValue({ _id: 'users:2' })
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 2 })
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/users/ban', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'demo' }),
      }),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.deletedSkills).toBe(2)
  })

  it('ban user forwards reason', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runQuery = vi.fn().mockResolvedValue({ _id: 'users:2' })
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 })
    await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/users/ban', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'demo', reason: 'malware' }),
      }),
    )
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: 'users:1',
        targetUserId: 'users:2',
        reason: 'malware',
      }),
    )
  })

  it('set role requires auth', async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error('Unauthorized'))
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/users/role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'demo', role: 'moderator' }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('set role succeeds with handle', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runQuery = vi.fn().mockResolvedValue({ _id: 'users:2' })
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, role: 'moderator' })
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/users/role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'demo', role: 'moderator' }),
      }),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.role).toBe('moderator')
  })

  it('stars require auth', async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error('Unauthorized'))
    const runMutation = vi.fn().mockResolvedValue(okRate())
    const response = await __handlers.starsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request('https://example.com/api/v1/stars/demo', { method: 'POST' }),
    )
    expect(response.status).toBe(401)
  })

  it('stars add succeeds', async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue('users:1' as never)
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runQuery = vi.fn().mockResolvedValue({ _id: 'skills:1' })
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, starred: true, alreadyStarred: false })
    const response = await __handlers.starsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/stars/demo', {
        method: 'POST',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.starred).toBe(true)
  })

  it('stars delete succeeds', async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue('users:1' as never)
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runQuery = vi.fn().mockResolvedValue({ _id: 'skills:1' })
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, unstarred: true, alreadyUnstarred: false })
    const response = await __handlers.starsDeleteRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request('https://example.com/api/v1/stars/demo', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.unstarred).toBe(true)
  })

  it('delete/undelete map forbidden/not-found/unknown to 403/404/500', async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)

    const runMutationForbidden = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('key' in args) return okRate()
      throw new Error('Forbidden')
    })
    const forbidden = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation: runMutationForbidden }),
      new Request('https://example.com/api/v1/skills/demo', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(forbidden.status).toBe(403)
    expect(await forbidden.text()).toBe('Forbidden')

    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runMutationNotFound = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('key' in args) return okRate()
      throw new Error('Skill not found')
    })
    const notFound = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation: runMutationNotFound }),
      new Request('https://example.com/api/v1/skills/demo/undelete', {
        method: 'POST',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(notFound.status).toBe(404)
    expect(await notFound.text()).toBe('Skill not found')

    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: 'users:1',
      user: { handle: 'p' },
    } as never)
    const runMutationUnknown = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ('key' in args) return okRate()
      throw new Error('boom')
    })
    const unknown = await __handlers.soulsDeleteRouterV1Handler(
      makeCtx({ runMutation: runMutationUnknown }),
      new Request('https://example.com/api/v1/souls/demo-soul', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer clh_test' },
      }),
    )
    expect(unknown.status).toBe(500)
    expect(await unknown.text()).toBe('Internal Server Error')
  })
})
