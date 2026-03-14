/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

const { getBySlug, getVersionById, getVersionBySoulAndVersion, listVersions } =
  await import('./souls')

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type PublicSoulVersionResult = {
  files: Array<{
    path: string
    size: number
    sha256: string
    contentType?: string
  }>
  parsed?: {
    clawdis?: unknown
  }
}

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<{
    slug: string
  }, {
    latestVersion: PublicSoulVersionResult | null
  } | null>
)._handler

const getVersionByIdHandler = (
  getVersionById as unknown as WrappedHandler<{
    versionId: string
  }, PublicSoulVersionResult | null>
)._handler

const getVersionBySoulAndVersionHandler = (
  getVersionBySoulAndVersion as unknown as WrappedHandler<{
    soulId: string
    version: string
  }, PublicSoulVersionResult | null>
)._handler

const listVersionsHandler = (
  listVersions as unknown as WrappedHandler<{
    soulId: string
    limit?: number
  }, PublicSoulVersionResult[]>
)._handler

function makeVersion() {
  return {
    _id: 'soulVersions:1',
    _creationTime: 1,
    soulId: 'souls:1',
    version: '1.0.0',
    fingerprint: 'fp',
    changelog: 'Initial release',
    changelogSource: 'auto',
    files: [
      {
        path: 'SOUL.md',
        size: 10,
        storageId: '_storage:1',
        sha256: 'abc123',
        contentType: 'text/markdown',
      },
    ],
    parsed: {
      frontmatter: { secret: 'value' },
      metadata: { hidden: true },
      clawdis: { persona: 'demo' },
      moltbot: { prompt: 'hidden' },
    },
    createdBy: 'users:1',
    createdAt: 100,
    softDeletedAt: undefined,
  }
}

describe('public soul version queries', () => {
  it('sanitizes latestVersion returned by getBySlug', async () => {
    const version = makeVersion()
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== 'souls') throw new Error(`Unexpected table ${table}`)
          return {
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([
                  {
                    _id: 'souls:1',
                    _creationTime: 1,
                    slug: 'demo-soul',
                    displayName: 'Demo Soul',
                    summary: 'Summary',
                    ownerUserId: 'users:1',
                    latestVersionId: version._id,
                    tags: {},
                    stats: {
                      downloads: 1,
                      stars: 1,
                      versions: 1,
                      comments: 0,
                    },
                    createdAt: 1,
                    updatedAt: 2,
                    softDeletedAt: undefined,
                  },
                ]),
              })),
            })),
          }
        }),
        get: vi.fn(async (id: string) => {
          if (id === version._id) return version
          if (id === 'users:1') {
            return {
              _id: 'users:1',
              _creationTime: 1,
              handle: 'demo',
              name: 'demo',
              displayName: 'Demo',
              image: null,
              bio: null,
            }
          }
          return null
        }),
      },
    } as never

    const result = await getBySlugHandler(ctx, { slug: 'demo-soul' } as never)

    expect(result?.latestVersion?.files[0]).not.toHaveProperty('storageId')
    expect(result?.latestVersion?.parsed).toEqual({
      clawdis: { persona: 'demo' },
    })
  })

  it('sanitizes direct public version queries', async () => {
    const version = makeVersion()
    const unique = vi.fn().mockResolvedValue(version)
    const take = vi.fn().mockResolvedValue([version])
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(version),
        query: vi.fn((table: string) => {
          if (table !== 'soulVersions') throw new Error(`Unexpected table ${table}`)
          return {
            withIndex: vi.fn(() => ({
              unique,
              order: vi.fn(() => ({ take })),
            })),
          }
        }),
      },
    } as never

    const byId = await getVersionByIdHandler(ctx, { versionId: version._id } as never)
    const byVersion = await getVersionBySoulAndVersionHandler(
      ctx,
      { soulId: 'souls:1', version: '1.0.0' } as never,
    )
    const list = await listVersionsHandler(ctx, { soulId: 'souls:1', limit: 5 } as never)

    for (const result of [byId, byVersion, list[0]]) {
      expect(result?.files[0]).not.toHaveProperty('storageId')
      expect(result?.parsed).not.toHaveProperty('frontmatter')
      expect(result?.parsed).not.toHaveProperty('metadata')
      expect(result?.parsed).not.toHaveProperty('moltbot')
    }
  })
})
