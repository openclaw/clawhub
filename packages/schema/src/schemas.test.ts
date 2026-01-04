/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { parseArk } from './ark'
import {
  ApiSearchResponseSchema,
  CliPublishRequestSchema,
  LockfileSchema,
  WellKnownConfigSchema,
} from './schemas'

describe('clawdhub-schema', () => {
  it('parses lockfile records', () => {
    const lock = parseArk(
      LockfileSchema,
      { version: 1, skills: { demo: { version: '1.0.0', installedAt: 123 } } },
      'Lockfile',
    )
    expect(lock.skills.demo?.version).toBe('1.0.0')
  })

  it('allows publish payload without tags', () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: 'demo',
        displayName: 'Demo',
        version: '1.0.0',
        changelog: '',
        files: [{ path: 'SKILL.md', size: 1, storageId: 's', sha256: 'x' }],
      },
      'Publish payload',
    )
    expect(payload.tags).toBeUndefined()
    expect(payload.files[0]?.path).toBe('SKILL.md')
  })

  it('parses well-known config', () => {
    expect(
      parseArk(WellKnownConfigSchema, { registry: 'https://example.convex.site' }, 'WellKnown'),
    ).toEqual({ registry: 'https://example.convex.site' })

    expect(
      parseArk(
        WellKnownConfigSchema,
        { registry: 'https://example.convex.site', authBase: 'https://clawdhub.com' },
        'WellKnown',
      ),
    ).toEqual({ registry: 'https://example.convex.site', authBase: 'https://clawdhub.com' })

    expect(
      parseArk(
        WellKnownConfigSchema,
        { apiBase: 'https://example.convex.site', minCliVersion: '0.1.0' },
        'WellKnown',
      ),
    ).toEqual({ apiBase: 'https://example.convex.site', minCliVersion: '0.1.0' })

    const combined = parseArk(
      WellKnownConfigSchema,
      {
        apiBase: 'https://clawdhub.com',
        registry: 'https://clawdhub.com',
        authBase: 'https://clawdhub.com',
      },
      'WellKnown',
    ) as unknown as Record<string, unknown>
    expect(combined.apiBase).toBe('https://clawdhub.com')
    expect(combined.registry).toBe('https://clawdhub.com')
  })

  it('throws labeled errors', () => {
    expect(() => parseArk(LockfileSchema, null, 'Lockfile')).toThrow(/Lockfile:/)
  })

  it('parses search results arrays', () => {
    expect(parseArk(ApiSearchResponseSchema, { results: [] }, 'Search')).toEqual({ results: [] })

    const parsed = parseArk(
      ApiSearchResponseSchema,
      {
        results: [
          { slug: 'a', displayName: 'A', version: '1.0.0', score: 0.9 },
          { slug: 'b', displayName: 'B', version: null, score: 0.1 },
        ],
      },
      'Search',
    )
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0]?.slug).toBe('a')
  })
})
