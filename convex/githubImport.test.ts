/* @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { __test } from './githubImport'
import { buildGitHubZipForTests } from './lib/githubImport'

describe('githubImport', () => {
  it('formats storage failure message with file context', () => {
    const message = __test.buildStoreFailureMessage('skill/SKILL.md', 123, new Error('disk full'))
    expect(message).toBe('Failed to store file "skill/SKILL.md" (123 bytes). disk full')
  })

  it('formats publish failure message with fallback text', () => {
    expect(__test.buildPublishFailureMessage(new Error('slug exists'))).toBe(
      'Import failed during publish: slug exists. Check skill format, slug availability, and try again.',
    )
    expect(__test.buildPublishFailureMessage('unexpected')).toBe(
      'Import failed during publish: unexpected. Check skill format, slug availability, and try again.',
    )
  })

  it('filters mac junk files while unzipping archive entries', () => {
    const zip = buildGitHubZipForTests({
      'demo-repo/skill/SKILL.md': '# Demo',
      'demo-repo/skill/notes.md': 'notes',
      'demo-repo/skill/.DS_Store': 'junk',
      'demo-repo/skill/._notes.md': 'junk',
      'demo-repo/__MACOSX/._SKILL.md': 'junk',
    })

    const entries = __test.unzipToEntries(zip)
    expect(Object.keys(entries).sort()).toEqual([
      'demo-repo/skill/SKILL.md',
      'demo-repo/skill/notes.md',
    ])
  })
})
