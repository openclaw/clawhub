/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { listPublicPage } from './skills'

type ListArgs = {
  cursor?: string
  limit?: number
  sort?: 'updated' | 'downloads' | 'stars' | 'installsCurrent' | 'installsAllTime' | 'trending'
  nonSuspiciousOnly?: boolean
}

type ListResult = {
  items: Array<{ skill: { slug: string } }>
  nextCursor: string | null
}

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const listPublicPageHandler = (listPublicPage as unknown as WrappedHandler<ListArgs, ListResult>)
  ._handler

describe('skills.listPublicPage', () => {
  it('filters suspicious skills when nonSuspiciousOnly is enabled', async () => {
    const clean = makeSkill('skills:clean', 'clean', 'users:1', 'skillVersions:1')
    const suspicious = makeSkill(
      'skills:suspicious',
      'suspicious',
      'users:2',
      'skillVersions:2',
      ['flagged.suspicious'],
    )

    const paginateMock = vi.fn().mockResolvedValue({
      page: [clean, suspicious],
      continueCursor: 'next',
      isDone: false,
    })
    const ctx = makeCtx({
      by_updated: paginateMock,
      users: [makeUser('users:1'), makeUser('users:2')],
      versions: [makeVersion('skillVersions:1'), makeVersion('skillVersions:2')],
    })

    const result = await listPublicPageHandler(ctx, {
      sort: 'updated',
      limit: 10,
      nonSuspiciousOnly: true,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.skill.slug).toBe('clean')
    expect(result.nextCursor).toBe('next')
  })

  it('returns suspicious skills when nonSuspiciousOnly is disabled', async () => {
    const clean = makeSkill('skills:clean', 'clean', 'users:1', 'skillVersions:1')
    const suspicious = makeSkill(
      'skills:suspicious',
      'suspicious',
      'users:2',
      'skillVersions:2',
      ['flagged.suspicious'],
    )

    const paginateMock = vi.fn().mockResolvedValue({
      page: [clean, suspicious],
      continueCursor: null,
      isDone: true,
    })
    const ctx = makeCtx({
      by_updated: paginateMock,
      users: [makeUser('users:1'), makeUser('users:2')],
      versions: [makeVersion('skillVersions:1'), makeVersion('skillVersions:2')],
    })

    const result = await listPublicPageHandler(ctx, {
      sort: 'updated',
      limit: 10,
      nonSuspiciousOnly: false,
    })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((entry) => entry.skill.slug)).toEqual(['clean', 'suspicious'])
  })
})

function makeCtx({
  by_updated,
  users,
  versions,
}: {
  by_updated: ReturnType<typeof vi.fn>
  users: Array<ReturnType<typeof makeUser>>
  versions: Array<ReturnType<typeof makeVersion>>
}) {
  const userMap = new Map(users.map((user) => [user._id, user]))
  const versionMap = new Map(versions.map((version) => [version._id, version]))
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table !== 'skills') throw new Error(`unexpected table ${table}`)
        return {
          withIndex: vi.fn((index: string, _builder: unknown) => {
            if (index !== 'by_updated') throw new Error(`unexpected index ${index}`)
            return {
              order: vi.fn((dir: string) => {
                if (dir !== 'desc') throw new Error(`unexpected order ${dir}`)
                return { paginate: by_updated }
              }),
            }
          }),
        }
      }),
      get: vi.fn(async (id: string) => {
        if (id.startsWith('users:')) return userMap.get(id) ?? null
        if (id.startsWith('skillVersions:')) return versionMap.get(id) ?? null
        return null
      }),
    },
  }
}

function makeSkill(
  id: string,
  slug: string,
  ownerUserId: string,
  latestVersionId: string,
  moderationFlags?: string[],
) {
  return {
    _id: id,
    _creationTime: 1,
    slug,
    displayName: slug,
    summary: `${slug} summary`,
    ownerUserId,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId,
    tags: {},
    badges: {},
    statsDownloads: 0,
    statsStars: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    stats: {
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 1,
      comments: 0,
    },
    moderationStatus: 'active',
    moderationReason: undefined,
    moderationFlags,
    softDeletedAt: undefined,
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeUser(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    handle: `h-${id}`,
    name: 'Owner',
    displayName: 'Owner',
    image: null,
    bio: null,
    deletedAt: undefined,
    deactivatedAt: undefined,
  }
}

function makeVersion(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    version: '1.0.0',
    createdAt: 1,
    changelog: '',
    changelogSource: 'user',
    parsed: {},
  }
}
