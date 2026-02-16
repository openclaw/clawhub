/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSkillBadgeMapMock, getSkillBadgeMapsMock, isSkillHighlightedMock } = vi.hoisted(() => ({
  getSkillBadgeMapMock: vi.fn(),
  getSkillBadgeMapsMock: vi.fn(),
  isSkillHighlightedMock: vi.fn(),
}))

vi.mock('./lib/badges', () => ({
  getSkillBadgeMap: getSkillBadgeMapMock,
  getSkillBadgeMaps: getSkillBadgeMapsMock,
  isSkillHighlighted: isSkillHighlightedMock,
}))

import { listPublicPageV2 } from './skills'

type ListArgs = {
  paginationOpts: { cursor: string | null; numItems: number; id?: number }
  sort?: 'newest' | 'updated' | 'downloads' | 'installs' | 'stars' | 'name'
  dir?: 'asc' | 'desc'
  highlightedOnly?: boolean
  nonSuspiciousOnly?: boolean
}

type ListResult = {
  page: Array<{ skill: { slug: string } }>
  continueCursor: string | null
  isDone: boolean
}

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const listPublicPageV2Handler = (listPublicPageV2 as unknown as WrappedHandler<ListArgs, ListResult>)
  ._handler

describe('skills.listPublicPageV2', () => {
  beforeEach(() => {
    getSkillBadgeMapMock.mockReset()
    getSkillBadgeMapsMock.mockReset()
    getSkillBadgeMapsMock.mockResolvedValue(new Map())
    isSkillHighlightedMock.mockReset()
    isSkillHighlightedMock.mockImplementation((skill: { slug?: string }) =>
      Boolean(skill.slug?.startsWith('hl-')),
    )
  })

  it('applies highlightedOnly and nonSuspiciousOnly together', async () => {
    const highlightedClean = makeSkill('skills:hl-clean', 'hl-clean', 'users:1', 'skillVersions:1')
    const plainClean = makeSkill('skills:plain', 'plain', 'users:2', 'skillVersions:2')
    const highlightedSuspicious = makeSkill(
      'skills:hl-suspicious',
      'hl-suspicious',
      'users:3',
      'skillVersions:3',
      ['flagged.suspicious'],
    )

    const paginateMock = vi.fn().mockResolvedValue({
      page: [highlightedClean, plainClean, highlightedSuspicious],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const orderMock = vi.fn(() => ({ paginate: paginateMock }))
    const eqMock = vi.fn(() => ({}))
    const withIndexMock = vi.fn((_index: string, builder: (q: { eq: typeof eqMock }) => unknown) => {
      builder({ eq: eqMock })
      return { order: orderMock }
    })
    const getMock = vi.fn(async (id: string) => {
      if (id.startsWith('users:')) return makeUser(id)
      if (id.startsWith('skillVersions:')) return makeVersion(id)
      return null
    })
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== 'skills') throw new Error(`unexpected table ${table}`)
          return { withIndex: withIndexMock }
        }),
        get: getMock,
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: true,
      nonSuspiciousOnly: true,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('hl-clean')
    expect(result.continueCursor).toBe('next-cursor')
    expect(result.isDone).toBe(false)
    expect(withIndexMock).toHaveBeenCalledWith('by_active_stats_downloads', expect.any(Function))
    expect(orderMock).toHaveBeenCalledWith('desc')
    expect(paginateMock).toHaveBeenCalledWith({ cursor: null, numItems: 25 })
    expect(eqMock).toHaveBeenCalledWith('softDeletedAt', undefined)
  })

  it('preserves pagination cursor when filtering removes the whole page', async () => {
    const plain = makeSkill('skills:plain', 'plain', 'users:1', 'skillVersions:1')
    const paginateMock = vi.fn().mockResolvedValue({
      page: [plain],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: true,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toEqual([])
    expect(result.continueCursor).toBe('next-cursor')
    expect(result.isDone).toBe(false)
  })

  it('restarts pagination from first page when cursor is stale', async () => {
    const plain = makeSkill('skills:plain', 'plain', 'users:1', 'skillVersions:1')
    const paginateMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to parse cursor'))
      .mockResolvedValueOnce({
        page: [plain],
        continueCursor: 'next-cursor',
        isDone: false,
        pageStatus: null,
        splitCursor: null,
      })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(async (id: string) => {
          if (id.startsWith('users:')) return makeUser(id)
          if (id.startsWith('skillVersions:')) return makeVersion(id)
          return null
        }),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: 'stale-cursor', numItems: 25, id: 123456 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('plain')
    expect(result.continueCursor).toBe('next-cursor')
    expect(result.isDone).toBe(false)
    expect(paginateMock).toHaveBeenNthCalledWith(1, { cursor: 'stale-cursor', numItems: 25 })
    expect(paginateMock).toHaveBeenNthCalledWith(2, { cursor: null, numItems: 25 })
    expect(paginateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(Number),
      }),
    )
  })

  it('drops pagination id from client options on first-page queries', async () => {
    const plain = makeSkill('skills:plain', 'plain', 'users:1', 'skillVersions:1')
    const paginateMock = vi.fn().mockResolvedValue({
      page: [plain],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(async (id: string) => {
          if (id.startsWith('users:')) return makeUser(id)
          if (id.startsWith('skillVersions:')) return makeVersion(id)
          return null
        }),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25, id: 999_999_999 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(paginateMock).toHaveBeenCalledTimes(1)
    expect(paginateMock).toHaveBeenCalledWith({ cursor: null, numItems: 25 })
    expect(paginateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(Number),
      }),
    )
  })

  it('does not swallow non-cursor paginate errors', async () => {
    const paginateMock = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(),
      },
    }

    await expect(
      listPublicPageV2Handler(ctx, {
        paginationOpts: { cursor: 'stale-cursor', numItems: 25, id: 999_999_999 },
        sort: 'downloads',
        dir: 'desc',
        highlightedOnly: false,
        nonSuspiciousOnly: false,
      }),
    ).rejects.toThrow('database unavailable')

    expect(paginateMock).toHaveBeenCalledTimes(1)
    expect(paginateMock).toHaveBeenCalledWith({ cursor: 'stale-cursor', numItems: 25 })
  })
})

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
    stats: {
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    softDeletedAt: undefined,
    moderationStatus: 'active',
    moderationFlags,
  }
}

function makeUser(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    handle: 'owner',
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
