/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/apiTokenAuth', () => ({
  requireApiTokenUser: vi.fn(),
}))

vi.mock('./skills', () => ({
  publishVersionForUser: vi.fn(),
}))

const { requireApiTokenUser } = await import('./lib/apiTokenAuth')
const { publishVersionForUser } = await import('./skills')
const { __handlers } = await import('./httpApiV1')

type ActionCtx = import('./_generated/server').ActionCtx

function makeCtx(partial: Record<string, unknown>) {
  return partial as unknown as ActionCtx
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

  it('lists skills with resolved tags', async () => {
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
      if ('versionId' in args) return { version: '1.0.0' }
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
      if ('versionId' in args) return { version: '1.0.0' }
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
          contentType: 'image/svg+xml',
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
      get: vi.fn().mockResolvedValue(new Blob(['hello'], { type: 'image/svg+xml' })),
    }
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request('https://example.com/api/v1/skills/demo/file?path=SKILL.md'),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'")
    expect(response.headers.get('X-Content-SHA256')).toBe('abcd')
  })

  it('serves soul raw file content with safe headers', async () => {
    const version = {
      version: '1.0.0',
      createdAt: 1,
      changelog: 'c',
      files: [
        {
          path: 'SOUL.md',
          size: 5,
          storageId: 'storage:1',
          sha256: 'abcd',
          contentType: 'image/svg+xml',
        },
      ],
      softDeletedAt: undefined,
    }
    const runQuery = vi.fn().mockResolvedValue({
      soul: {
        _id: 'souls:1',
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
      get: vi.fn().mockResolvedValue(new Blob(['hello'], { type: 'image/svg+xml' })),
    }
    const response = await __handlers.soulsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request('https://example.com/api/v1/souls/demo/file?path=SOUL.md'),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'")
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
})
