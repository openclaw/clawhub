/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GitHubBackupContext } from './githubBackup'
import { readGitHubBackupFile } from './githubRestoreHelpers'

function makeContext(): GitHubBackupContext {
  return {
    token: 'token',
    repo: 'owner/repo',
    repoOwner: 'owner',
    repoName: 'repo',
    branch: 'main',
    root: 'skills',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

  describe('githubRestoreHelpers', () => {
  it('decodes base64 payloads (including newlines) into bytes', async () => {
    const content = 'SGVs\n bG8h' // "Hello!" with whitespace/newline
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ content, encoding: 'base64' }),
        text: async () => '',
      })),
    )

    const bytes = await readGitHubBackupFile(makeContext(), 'Owner', 'slug', 'SKILL.md')
    expect(bytes).not.toBeNull()
    expect(Buffer.from(bytes!).toString('utf8')).toBe('Hello!')
  })

  it('throws on unsupported GitHub content encoding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ content: 'eA==', encoding: 'utf-16' }),
        text: async () => '',
      })),
    )

    await expect(readGitHubBackupFile(makeContext(), 'Owner', 'slug', 'SKILL.md')).rejects.toThrow(
      /Unsupported GitHub content encoding/i,
    )
  })
})
