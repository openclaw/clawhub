/* @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { __test } from './githubImport'
import { buildGitHubZipForTests } from './lib/githubImport'

describe('githubImport', () => {
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
