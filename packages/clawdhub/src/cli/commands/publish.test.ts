/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from '../types'

vi.mock('../../config.js', () => ({
  readGlobalConfig: vi.fn(async () => ({ registry: 'https://www.clawhub.ai', token: 'tkn' })),
}))

const mockGetRegistry = vi.fn(async (_opts: unknown, _params?: unknown) => 'https://www.clawhub.ai')
vi.mock('../registry.js', () => ({
  getRegistry: (opts: unknown, params?: unknown) => mockGetRegistry(opts, params),
}))

const mockApiRequestForm = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequestForm: (registry: unknown, args: unknown, schema?: unknown) =>
    mockApiRequestForm(registry, args, schema),
}))

const mockFail = vi.fn((message: string) => {
  throw new Error(message)
})
const mockSpinner = { text: '', succeed: vi.fn(), fail: vi.fn() }
vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => mockFail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

const { cmdPublish } = await import('./publish')

async function makeTmpWorkdir() {
  const root = await mkdtemp(join(tmpdir(), 'clawhub-publish-'))
  return root
}

function makeOpts(workdir: string): GlobalOpts {
  return {
    workdir,
    dir: join(workdir, 'skills'),
    site: 'https://www.clawhub.ai',
    registry: 'https://www.clawhub.ai',
    registrySource: 'default',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('cmdPublish', () => {
  it('publishes SKILL.md from disk (mocked HTTP)', async () => {
    const workdir = await makeTmpWorkdir()
    try {
      const folder = join(workdir, 'my-skill')
      await mkdir(folder, { recursive: true })
      const skillContent = '# Skill\n\nHello\n'
      const notesContent = 'notes\n'
      await writeFile(join(folder, 'SKILL.md'), skillContent, 'utf8')
      await writeFile(join(folder, 'notes.md'), notesContent, 'utf8')

      mockApiRequestForm.mockResolvedValueOnce({ ok: true, skillId: 'skill_1', versionId: 'ver_1' })

      await cmdPublish(makeOpts(workdir), 'my-skill', {
        slug: 'my-skill',
        name: 'My Skill',
        version: '1.0.0',
        changelog: '',
        tags: 'latest',
      })

      const publishCall = mockApiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined
        return req?.path === '/api/v1/skills'
      })
      if (!publishCall) throw new Error('Missing publish call')
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData
      const payloadEntry = publishForm.get('payload')
      if (typeof payloadEntry !== 'string') throw new Error('Missing publish payload')
      const payload = JSON.parse(payloadEntry)
      expect(payload.slug).toBe('my-skill')
      expect(payload.displayName).toBe('My Skill')
      expect(payload.version).toBe('1.0.0')
      expect(payload.changelog).toBe('')
      expect(payload.tags).toEqual(['latest'])
      const files = publishForm.getAll('files') as Array<Blob & { name?: string }>
      expect(files.map((file) => String(file.name ?? '')).sort()).toEqual(['SKILL.md', 'notes.md'])
    } finally {
      await rm(workdir, { recursive: true, force: true })
    }
  })

  it('allows empty changelog when updating an existing skill', async () => {
    const workdir = await makeTmpWorkdir()
    try {
      const folder = join(workdir, 'existing-skill')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'SKILL.md'), '# Skill\n', 'utf8')

      mockApiRequestForm.mockResolvedValueOnce({ ok: true, skillId: 'skill_1', versionId: 'ver_2' })

      await cmdPublish(makeOpts(workdir), 'existing-skill', {
        version: '1.0.1',
        changelog: '',
        tags: 'latest',
      })

      expect(mockApiRequestForm).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ path: '/api/v1/skills', method: 'POST' }),
        expect.anything(),
      )
    } finally {
      await rm(workdir, { recursive: true, force: true })
    }
  })
})
