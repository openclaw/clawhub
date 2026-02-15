/* @vitest-environment node */

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiRoutes } from '../../schema/index.js'
import type { GlobalOpts } from '../types'

const mockApiRequest = vi.fn()
const mockDownloadZip = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  downloadZip: (...args: unknown[]) => mockDownloadZip(...args),
}))

const mockGetRegistry = vi.fn(async () => 'https://clawhub.ai')
vi.mock('../registry.js', () => ({
  getRegistry: () => mockGetRegistry(),
}))

const mockGetOptionalAuthToken = vi.fn(async () => undefined as string | undefined)
vi.mock('../authToken.js', () => ({
  getOptionalAuthToken: () => mockGetOptionalAuthToken(),
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
  isInteractive: vi.fn(() => false),
  promptConfirm: vi.fn(async () => false),
}))

vi.mock('../../skills.js', () => ({
  extractZipToDir: vi.fn(),
  hashSkillFiles: vi.fn(),
  listTextFiles: vi.fn(),
  readLockfile: vi.fn(),
  readSkillOrigin: vi.fn(),
  writeLockfile: vi.fn(),
  writeSkillOrigin: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}))

const { clampLimit, cmdExplore, cmdInstall, cmdUpdate, formatExploreLine } = await import(
  './skills'
)
const {
  extractZipToDir,
  hashSkillFiles,
  listTextFiles,
  readLockfile,
  readSkillOrigin,
  writeLockfile,
  writeSkillOrigin,
} = await import('../../skills.js')
const { rename, rm, stat } = await import('node:fs/promises')
const { isInteractive, promptConfirm } = await import('../ui.js')
const { execFileSync } = await import('node:child_process')

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})
const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

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
})

describe('cmdInstall', () => {
  beforeEach(() => {
    // Default mocks for a successful installation path
    mockApiRequest.mockResolvedValue({
      latestVersion: { version: '1.0.0' },
      moderation: { isMalwareBlocked: false, isSuspicious: false },
    })
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]))
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(writeSkillOrigin).mockResolvedValue()
    vi.mocked(extractZipToDir).mockResolvedValue()
    vi.mocked(stat).mockRejectedValue(new Error('missing')) // Simulate file not existing
    vi.mocked(rm).mockResolvedValue()
    vi.mocked(rename).mockResolvedValue()
    vi.mocked(execFileSync).mockReturnValue('{}') // Clean scan
  })

  it('installs a skill successfully when scan finds no violations', async () => {
    await cmdInstall(makeOpts(), 'test-skill')
    expect(extractZipToDir).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.stringMatching(/\/work\/skills\/test-skill\.tmp-.*/),
    )
    expect(execFileSync).toHaveBeenCalledWith(
      'uvx',
      [
        'mcp-scan@latest',
        '--skills',
        expect.stringMatching(/\/work\/skills\/test-skill\.tmp-.*/),
        '--json',
      ],
      { encoding: 'utf-8' },
    )
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/\/work\/skills\/test-skill\.tmp-.*/),
      '/work/skills/test-skill',
    )
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      'OK. Installed test-skill -> /work/skills/test-skill',
    )
  })

  it('installs a skill if user accepts after a violation warning', async () => {
    const violation = { issues: [{ code: 'W011', message: 'Third-party content' }] }
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ '/path/to/skill': violation }))
    vi.mocked(isInteractive).mockReturnValue(true)
    vi.mocked(promptConfirm).mockResolvedValue(true)

    await cmdInstall(makeOpts(), 'test-skill')

    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('⚠️  Warning'))
    expect(promptConfirm).toHaveBeenCalledWith('Install anyway?')
    expect(rename).toHaveBeenCalled()
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      'OK. Installed test-skill -> /work/skills/test-skill',
    )
  })

  it('aborts installation if user rejects after a violation warning', async () => {
    const violation = { issues: [{ code: 'W011', message: 'Third-party content' }] }
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ '/path/to/skill': violation }))
    vi.mocked(isInteractive).mockReturnValue(true)
    vi.mocked(promptConfirm).mockResolvedValue(false)

    await expect(cmdInstall(makeOpts(), 'test-skill')).rejects.toThrow('Installation cancelled')

    expect(promptConfirm).toHaveBeenCalledWith('Install anyway?')
    expect(rename).not.toHaveBeenCalled()
    expect(mockSpinner.succeed).not.toHaveBeenCalled()
  })

  it('skips scan and continues installation if scanner fails', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('Rate limit exceeded')
    })

    await cmdInstall(makeOpts(), 'test-skill')

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('⚠️  Skipping Snyk Agent Scan: Rate limit exceeded'),
    )
    expect(rename).toHaveBeenCalled()
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      'OK. Installed test-skill -> /work/skills/test-skill',
    )
  })

  it('passes optional auth token to API + download requests', async () => {
    mockGetOptionalAuthToken.mockResolvedValue('tkn')
    // Re-setup mocks as they might be overwritten by beforeEach if they clash,
    // but here we are specific about return values.
    mockApiRequest.mockResolvedValue({
      skill: { slug: 'demo', displayName: 'Demo', summary: null, tags: {}, stats: {}, createdAt: 0, updatedAt: 0 },
      latestVersion: { version: '1.0.0' },
      owner: null,
      moderation: null,
    })
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]))
    
    await cmdInstall(makeOpts(), 'demo')

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? []
    expect(requestArgs?.token).toBe('tkn')
    const [, zipArgs] = mockDownloadZip.mock.calls[0] ?? []
    expect(zipArgs?.token).toBe('tkn')
  })
})

describe('explore helpers', () => {
  it('clamps explore limits and handles non-finite values', () => {
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(1)).toBe(1)
    expect(clampLimit(50)).toBe(50)
    expect(clampLimit(99)).toBe(99)
    expect(clampLimit(200)).toBe(200)
    expect(clampLimit(250)).toBe(200)
    expect(clampLimit(Number.NaN)).toBe(25)
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(25)
    expect(clampLimit(Number.NaN, 10)).toBe(10)
  })

  it('formats explore lines with relative time and truncation', () => {
    const now = 4 * 60 * 60 * 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const summary = 'a'.repeat(60)
    const line = formatExploreLine({
      slug: 'weather',
      summary,
      updatedAt: now - 2 * 60 * 60 * 1000,
      latestVersion: null,
    })
    expect(line).toBe(`weather  v?  2h ago  ${'a'.repeat(49)}…`)
    nowSpy.mockRestore()
  })
})

describe('cmdExplore', () => {
  it('clamps limit and handles empty results', async () => {
    mockApiRequest.mockResolvedValue({ items: [] })

    await cmdExplore(makeOpts(), { limit: 0 })

    const [, args] = mockApiRequest.mock.calls[0] ?? []
    const url = new URL(String(args?.url))
    expect(url.searchParams.get('limit')).toBe('1')
    expect(mockLog).toHaveBeenCalledWith('No skills found.')
  })

  it('prints formatted results', async () => {
    const now = 10 * 60 * 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const item = {
      slug: 'gog',
      summary: 'Google Workspace CLI for Gmail, Calendar, Drive and more.',
      updatedAt: now - 90 * 1000,
      latestVersion: { version: '1.2.3' },
    }
    mockApiRequest.mockResolvedValue({ items: [item] })

    await cmdExplore(makeOpts(), { limit: 250 })

    const [, args] = mockApiRequest.mock.calls[0] ?? []
    const url = new URL(String(args?.url))
    expect(url.searchParams.get('limit')).toBe('200')
    expect(mockLog).toHaveBeenCalledWith(formatExploreLine(item))
    nowSpy.mockRestore()
  })

  it('supports sort and json output', async () => {
    const payload = { items: [], nextCursor: null }
    mockApiRequest.mockResolvedValue(payload)

    await cmdExplore(makeOpts(), { limit: 10, sort: 'installs', json: true })

    const [, args] = mockApiRequest.mock.calls[0] ?? []
    const url = new URL(String(args?.url))
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('sort')).toBe('installsCurrent')
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(payload, null, 2))
  })

  it('supports all-time installs and trending sorts', async () => {
    mockApiRequest.mockResolvedValue({ items: [], nextCursor: null })

    await cmdExplore(makeOpts(), { limit: 5, sort: 'installsAllTime' })
    await cmdExplore(makeOpts(), { limit: 5, sort: 'trending' })

    const first = new URL(String(mockApiRequest.mock.calls[0]?.[1]?.url))
    const second = new URL(String(mockApiRequest.mock.calls[1]?.[1]?.url))
    expect(first.searchParams.get('sort')).toBe('installsAllTime')
    expect(second.searchParams.get('sort')).toBe('trending')
  })
})

describe('cmdUpdate', () => {
  it('uses path-based skill lookup when no local fingerprint is available', async () => {
    mockApiRequest.mockResolvedValue({ latestVersion: { version: '1.0.0' } })
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]))
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '0.1.0', installedAt: 123 } },
    })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(readSkillOrigin).mockResolvedValue(null)
    vi.mocked(writeSkillOrigin).mockResolvedValue()
    vi.mocked(extractZipToDir).mockResolvedValue()
    vi.mocked(listTextFiles).mockResolvedValue([])
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: 'hash', files: [] })
    vi.mocked(stat).mockRejectedValue(new Error('missing'))
    vi.mocked(rm).mockResolvedValue()

    await cmdUpdate(makeOpts(), 'demo', {}, false)

    const [, args] = mockApiRequest.mock.calls[0] ?? []
    expect(args?.path).toBe(`${ApiRoutes.skills}/${encodeURIComponent('demo')}`)
    expect(args?.url).toBeUndefined()
  })
})
