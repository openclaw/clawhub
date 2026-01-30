/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { __handlers, __test } from './httpApi'

describe('httpApi', () => {
  it('parses publish payload', () => {
    const parsed = __test.parsePublishBody({
      slug: 'cool-skill',
      displayName: 'Cool Skill',
      version: '1.2.3',
      changelog: 'stuff',
      tags: ['latest', 'beta'],
      files: [
        {
          path: 'SKILL.md',
          size: 5,
          storageId: 'fakeStorageId',
          sha256: 'abcd',
          contentType: 'text/markdown',
        },
      ],
    })
    expect(parsed.slug).toBe('cool-skill')
    expect(parsed.tags).toEqual(['latest', 'beta'])
    expect(parsed.files[0]?.path).toBe('SKILL.md')
  })

  it('normalizes optional fields in publish payload', () => {
    const parsed = __test.parsePublishBody({
      slug: 'cool-skill',
      displayName: 'Cool Skill',
      version: '1.2.3',
      changelog: '',
      tags: [],
      forkOf: { slug: 'base-skill' },
      files: [
        {
          path: 'SKILL.md',
          size: 5,
          storageId: 'fakeStorageId',
          sha256: 'abcd',
          contentType: 'text/markdown',
        },
      ],
    })
    expect(parsed.tags).toBeUndefined()
    expect(parsed.source).toBeUndefined()
    expect(parsed.forkOf).toEqual({ slug: 'base-skill', version: undefined })
  })

  it('rejects invalid publish payloads', () => {
    expect(() => __test.parsePublishBody(null)).toThrow(/Publish payload/i)
    expect(() =>
      __test.parsePublishBody({
        slug: 'x',
        displayName: 'X',
        version: '1.0.0',
        changelog: 'c',
        files: [],
      }),
    ).toThrow(/files required/i)
  })

  it('parses optional numbers', () => {
    expect(__test.toOptionalNumber(null)).toBeUndefined()
    expect(__test.toOptionalNumber('')).toBeUndefined()
    expect(__test.toOptionalNumber('10')).toBe(10)
    expect(__test.toOptionalNumber('nope')).toBeUndefined()
  })

  it('returns maintenance status', async () => {
    const ctx = {
      runQuery: vi.fn(async () => ({ enabled: true, message: 'Updating', updatedAt: 123 })),
    }
    const response = await __handlers.maintenanceStatusHandler(
      ctx as unknown as Parameters<typeof __handlers.maintenanceStatusHandler>[0],
      new Request('https://example.com/maintenance'),
    )
    const payload = (await response.json()) as {
      enabled: boolean
      message: string | null
      updatedAt: number
    }
    expect(payload).toEqual({ enabled: true, message: 'Updating', updatedAt: 123 })
  })
})
