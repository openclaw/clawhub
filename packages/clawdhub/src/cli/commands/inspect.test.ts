/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRoutes } from '../../schema/index.js'
import type { GlobalOpts } from '../types'

const mockApiRequest = vi.fn()
const mockFetchText = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  fetchText: (...args: unknown[]) => mockFetchText(...args),
}))

const mockGetRegistry = vi.fn(async () => 'https://clawhub.ai')
vi.mock('../registry.js', () => ({
  getRegistry: () => mockGetRegistry(),
}))

const mockReadGlobalConfig = vi.fn(async () => null as { token?: string } | null)
vi.mock('../../config.js', () => ({
  readGlobalConfig: () => mockReadGlobalConfig(),
}))

const mockSpinner = {
  stop: vi.fn(),
  fail: vi.fn(),
  start: vi.fn(),
  succeed: vi.fn(),
  isSpinning: false,
  text: '',
}
vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => {
    throw new Error(message)
  },
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

const { cmdInspect } = await import('./inspect')

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})
const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

function makeOpts(): GlobalOpts {
  return {
    workdir: '/work',
    dir: '/work/skills',
    site: 'https://clawhub.ai',
    registry: 'https://clawhub.ai',
    registrySource: 'default',
  }
}

afterEach(() => {
  vi.clearAllMocks()
  mockLog.mockClear()
  mockWrite.mockClear()
})

describe('cmdInspect', () => {
  it('fetches latest version files when --files is set', async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: 'demo',
          displayName: 'Demo',
          summary: null,
          tags: { latest: '1.2.3' },
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: { version: '1.2.3', createdAt: 3, changelog: 'init' },
        owner: null,
      })
      .mockResolvedValueOnce({
        skill: { slug: 'demo', displayName: 'Demo' },
        version: { version: '1.2.3', createdAt: 3, changelog: 'init', files: [] },
      })

    await cmdInspect(makeOpts(), 'demo', { files: true })

    const firstArgs = mockApiRequest.mock.calls[0]?.[1]
    const secondArgs = mockApiRequest.mock.calls[1]?.[1]
    expect(firstArgs?.path).toBe(`${ApiRoutes.skills}/${encodeURIComponent('demo')}`)
    expect(secondArgs?.path).toBe(
      `${ApiRoutes.skills}/${encodeURIComponent('demo')}/versions/${encodeURIComponent('1.2.3')}`,
    )
  })

  it('uses tag param when fetching a file', async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: 'demo',
          displayName: 'Demo',
          summary: null,
          tags: { latest: '2.0.0' },
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: { version: '2.0.0', createdAt: 3, changelog: 'init' },
        owner: null,
      })
      .mockResolvedValueOnce({
        skill: { slug: 'demo', displayName: 'Demo' },
        version: { version: '2.0.0', createdAt: 3, changelog: 'init', files: [] },
      })
    mockFetchText.mockResolvedValue('content')

    await cmdInspect(makeOpts(), 'demo', { file: 'SKILL.md', tag: 'latest' })

    const fetchArgs = mockFetchText.mock.calls[0]?.[1]
    const url = new URL(String(fetchArgs?.url))
    expect(url.pathname).toBe('/api/v1/skills/demo/file')
    expect(url.searchParams.get('path')).toBe('SKILL.md')
    expect(url.searchParams.get('tag')).toBe('latest')
    expect(url.searchParams.get('version')).toBeNull()
  })

  it('rejects when both version and tag are provided', async () => {
    await expect(
      cmdInspect(makeOpts(), 'demo', { version: '1.0.0', tag: 'latest' }),
    ).rejects.toThrow('Use either --version or --tag')
  })
})
