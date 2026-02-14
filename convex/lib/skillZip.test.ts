/* @vitest-environment node */

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildDeterministicZip, buildSkillMeta, type SkillZipMeta } from './skillZip'

describe('skillZip', () => {
  describe('buildSkillMeta', () => {
    it('returns metadata object with all fields', () => {
      const meta: SkillZipMeta = {
        ownerId: 'user123',
        slug: 'my-skill',
        version: '1.0.0',
        publishedAt: 1700000000000,
      }
      const result = buildSkillMeta(meta)
      expect(result).toEqual({
        ownerId: 'user123',
        slug: 'my-skill',
        version: '1.0.0',
        publishedAt: 1700000000000,
      })
    })
  })

  describe('buildDeterministicZip', () => {
    it('creates a zip with provided entries', () => {
      const entries = [
        { path: 'SKILL.md', bytes: new TextEncoder().encode('# My Skill') },
        { path: 'README.txt', bytes: new TextEncoder().encode('Hello') },
      ]
      const zip = buildDeterministicZip(entries)
      const unzipped = unzipSync(zip)

      expect(Object.keys(unzipped).sort()).toEqual(['README.txt', 'SKILL.md'])
      expect(new TextDecoder().decode(unzipped['SKILL.md'])).toBe('# My Skill')
      expect(new TextDecoder().decode(unzipped['README.txt'])).toBe('Hello')
    })

    it('sorts entries alphabetically for deterministic output', () => {
      const entries1 = [
        { path: 'b.txt', bytes: new TextEncoder().encode('B') },
        { path: 'a.txt', bytes: new TextEncoder().encode('A') },
      ]
      const entries2 = [
        { path: 'a.txt', bytes: new TextEncoder().encode('A') },
        { path: 'b.txt', bytes: new TextEncoder().encode('B') },
      ]

      const zip1 = buildDeterministicZip(entries1)
      const zip2 = buildDeterministicZip(entries2)

      // Both should produce identical zips regardless of input order
      expect(Array.from(zip1)).toEqual(Array.from(zip2))
    })

    it('includes _meta.json when meta is provided', () => {
      const entries = [{ path: 'SKILL.md', bytes: new TextEncoder().encode('# Hello') }]
      const meta: SkillZipMeta = {
        ownerId: 'user456',
        slug: 'test-skill',
        version: '2.0.0',
        publishedAt: 1700000000000,
      }

      const zip = buildDeterministicZip(entries, meta)
      const unzipped = unzipSync(zip)

      expect(Object.keys(unzipped).sort()).toEqual(['SKILL.md', '_meta.json'])
      const metaContent = JSON.parse(new TextDecoder().decode(unzipped['_meta.json']))
      expect(metaContent).toEqual({
        ownerId: 'user456',
        slug: 'test-skill',
        version: '2.0.0',
        publishedAt: 1700000000000,
      })
    })

    it('does not include _meta.json when meta is undefined', () => {
      const entries = [{ path: 'SKILL.md', bytes: new TextEncoder().encode('# Hello') }]
      const zip = buildDeterministicZip(entries)
      const unzipped = unzipSync(zip)

      expect(Object.keys(unzipped)).toEqual(['SKILL.md'])
    })

    it('produces deterministic output for same inputs', () => {
      const entries = [
        { path: 'file1.md', bytes: new TextEncoder().encode('content1') },
        { path: 'file2.md', bytes: new TextEncoder().encode('content2') },
      ]
      const meta: SkillZipMeta = {
        ownerId: 'owner',
        slug: 'slug',
        version: '1.0.0',
        publishedAt: 1700000000000,
      }

      const zip1 = buildDeterministicZip(entries, meta)
      const zip2 = buildDeterministicZip(entries, meta)

      // Should be byte-for-byte identical
      expect(Array.from(zip1)).toEqual(Array.from(zip2))
    })

    it('handles empty entries array', () => {
      const zip = buildDeterministicZip([])
      const unzipped = unzipSync(zip)

      expect(Object.keys(unzipped)).toEqual([])
    })

    it('handles empty entries array with meta', () => {
      const meta: SkillZipMeta = {
        ownerId: 'owner',
        slug: 'slug',
        version: '1.0.0',
        publishedAt: 1700000000000,
      }
      const zip = buildDeterministicZip([], meta)
      const unzipped = unzipSync(zip)

      expect(Object.keys(unzipped)).toEqual(['_meta.json'])
    })

    it('handles nested paths', () => {
      const entries = [
        { path: 'docs/readme.md', bytes: new TextEncoder().encode('docs') },
        { path: 'src/index.ts', bytes: new TextEncoder().encode('code') },
        { path: 'SKILL.md', bytes: new TextEncoder().encode('skill') },
      ]

      const zip = buildDeterministicZip(entries)
      const unzipped = unzipSync(zip)

      expect(Object.keys(unzipped).sort()).toEqual(['SKILL.md', 'docs/readme.md', 'src/index.ts'])
    })
  })
})
