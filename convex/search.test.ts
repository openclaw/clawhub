/* @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import { tokenize } from './lib/searchText'
import { __test, lexicalFallbackSkills, searchSkills } from './search'

const { generateEmbeddingMock, getSkillBadgeMapsMock } = vi.hoisted(() => ({
  generateEmbeddingMock: vi.fn(),
  getSkillBadgeMapsMock: vi.fn(),
}))

vi.mock('./lib/embeddings', () => ({
  generateEmbedding: generateEmbeddingMock,
}))

vi.mock('./lib/badges', () => ({
  getSkillBadgeMaps: getSkillBadgeMapsMock,
  isSkillHighlighted: (skill: { badges?: Record<string, unknown> }) =>
    Boolean(skill.badges?.highlighted),
}))

type WrappedHandler = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>
}

const searchSkillsHandler = (searchSkills as unknown as WrappedHandler)._handler
const lexicalFallbackSkillsHandler = (lexicalFallbackSkills as unknown as WrappedHandler)._handler

describe('search helpers', () => {
  it('returns fallback results when vector candidates are empty', async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2])
    const fallback = [
      {
        skill: makePublicSkill({ id: 'skills:orf', slug: 'orf', displayName: 'ORF' }),
        version: null,
        ownerHandle: 'steipete',
      },
    ]
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(fallback)

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([]),
        runQuery,
      },
      { query: 'orf', limit: 10 },
    )

    expect(result).toHaveLength(1)
    expect(result[0].skill.slug).toBe('orf')
    expect(runQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ query: 'orf', queryTokens: ['orf'] }),
    )
  })

  it('applies highlightedOnly filtering in lexical fallback', async () => {
    const highlighted = makeSkillDoc({
      id: 'skills:hl',
      slug: 'orf-highlighted',
      displayName: 'ORF Highlighted',
    })
    const plain = makeSkillDoc({ id: 'skills:plain', slug: 'orf-plain', displayName: 'ORF Plain' })
    getSkillBadgeMapsMock.mockResolvedValueOnce(
      new Map([
        ['skills:hl', { highlighted: { byUserId: 'users:mod', at: 1 } }],
        ['skills:plain', {}],
      ]),
    )

    const result = await lexicalFallbackSkillsHandler(
      makeLexicalCtx({
        exactSlugSkill: null,
        recentSkills: [highlighted, plain],
      }),
      { query: 'orf', queryTokens: ['orf'], highlightedOnly: true, limit: 10 },
    )

    expect(result).toHaveLength(1)
    expect(result[0].skill.slug).toBe('orf-highlighted')
  })

  it('includes exact slug match from by_slug even when recent scan is empty', async () => {
    const exactSlugSkill = makeSkillDoc({ id: 'skills:orf', slug: 'orf', displayName: 'ORF' })
    getSkillBadgeMapsMock.mockResolvedValueOnce(new Map([['skills:orf', {}]]))
    const ctx = makeLexicalCtx({
      exactSlugSkill,
      recentSkills: [],
    })

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: 'orf',
      queryTokens: ['orf'],
      limit: 10,
    })

    expect(result).toHaveLength(1)
    expect(result[0].skill.slug).toBe('orf')
    expect(ctx.db.query).toHaveBeenCalledWith('skills')
  })

  it('dedupes overlap and enforces rank + limit across vector and fallback', async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2])
    const vectorEntries = [
      {
        embeddingId: 'skillEmbeddings:a',
        skill: makePublicSkill({
          id: 'skills:a',
          slug: 'foo-a',
          displayName: 'Foo Alpha',
          downloads: 10,
        }),
        version: null,
        ownerHandle: 'one',
      },
      {
        embeddingId: 'skillEmbeddings:b',
        skill: makePublicSkill({
          id: 'skills:b',
          slug: 'foo-b',
          displayName: 'Foo Beta',
          downloads: 2,
        }),
        version: null,
        ownerHandle: 'two',
      },
    ]
    const fallbackEntries = [
      {
        skill: makePublicSkill({
          id: 'skills:a',
          slug: 'foo-a',
          displayName: 'Foo Alpha',
          downloads: 10,
        }),
        version: null,
        ownerHandle: 'one',
      },
      {
        skill: makePublicSkill({
          id: 'skills:c',
          slug: 'foo-c',
          displayName: 'Foo Classic',
          downloads: 1,
        }),
        version: null,
        ownerHandle: 'three',
      },
    ]

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(vectorEntries)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(fallbackEntries)

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([
          { _id: 'skillEmbeddings:a', _score: 0.4 },
          { _id: 'skillEmbeddings:b', _score: 0.9 },
        ]),
        runQuery,
      },
      { query: 'foo', limit: 2 },
    )

    expect(result).toHaveLength(2)
    expect(result[0].skill.slug).toBe('foo-b')
    expect(new Set(result.map((entry: { skill: { _id: string } }) => entry.skill._id)).size).toBe(2)
  })

  it('advances candidate limit until max', () => {
    expect(__test.getNextCandidateLimit(50, 1000)).toBe(100)
    expect(__test.getNextCandidateLimit(800, 1000)).toBe(1000)
    expect(__test.getNextCandidateLimit(1000, 1000)).toBeNull()
  })

  it('boosts exact slug/name matches over loose matches', () => {
    const queryTokens = tokenize('notion')
    const exactScore = __test.scoreSkillResult(queryTokens, 0.4, 'Notion Sync', 'notion-sync', 5)
    const looseScore = __test.scoreSkillResult(queryTokens, 0.6, 'Notes Sync', 'notes-sync', 500)
    expect(exactScore).toBeGreaterThan(looseScore)
  })

  it('adds a popularity prior for equally relevant matches', () => {
    const queryTokens = tokenize('notion')
    const lowDownloads = __test.scoreSkillResult(
      queryTokens,
      0.5,
      'Notion Helper',
      'notion-helper',
      0,
    )
    const highDownloads = __test.scoreSkillResult(
      queryTokens,
      0.5,
      'Notion Helper',
      'notion-helper',
      1000,
    )
    expect(highDownloads).toBeGreaterThan(lowDownloads)
  })

  it('merges fallback matches without duplicate skill ids', () => {
    const primary = [
      {
        embeddingId: 'skillEmbeddings:1',
        skill: { _id: 'skills:1' },
      },
    ] as unknown as Parameters<typeof __test.mergeUniqueBySkillId>[0]
    const fallback = [
      {
        skill: { _id: 'skills:1' },
      },
      {
        skill: { _id: 'skills:2' },
      },
    ] as unknown as Parameters<typeof __test.mergeUniqueBySkillId>[1]

    const merged = __test.mergeUniqueBySkillId(primary, fallback)
    expect(merged).toHaveLength(2)
    expect(merged.map((entry) => entry.skill._id)).toEqual(['skills:1', 'skills:2'])
  })
})

function makePublicSkill(params: {
  id: string
  slug: string
  displayName: string
  downloads?: number
}) {
  return {
    _id: params.id,
    _creationTime: 1,
    slug: params.slug,
    displayName: params.displayName,
    summary: `${params.displayName} summary`,
    ownerUserId: 'users:owner',
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: 'skillVersions:1',
    tags: {},
    badges: {},
    stats: {
      downloads: params.downloads ?? 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeSkillDoc(params: { id: string; slug: string; displayName: string }) {
  return {
    ...makePublicSkill(params),
    _creationTime: 1,
    moderationStatus: 'active',
    moderationFlags: [],
    softDeletedAt: undefined,
  }
}

function makeLexicalCtx(params: {
  exactSlugSkill: ReturnType<typeof makeSkillDoc> | null
  recentSkills: Array<ReturnType<typeof makeSkillDoc>>
}) {
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table !== 'skills') throw new Error(`Unexpected table ${table}`)
        return {
          withIndex: (index: string) => {
            if (index === 'by_slug') {
              return {
                unique: vi.fn().mockResolvedValue(params.exactSlugSkill),
              }
            }
            if (index === 'by_active_updated') {
              return {
                order: () => ({
                  take: vi.fn().mockResolvedValue(params.recentSkills),
                }),
              }
            }
            throw new Error(`Unexpected index ${index}`)
          },
        }
      }),
      get: vi.fn(async (id: string) => {
        if (id.startsWith('users:')) return { _id: id, handle: 'owner' }
        if (id.startsWith('skillVersions:')) return { _id: id, version: '1.0.0' }
        return null
      }),
    },
  }
}
