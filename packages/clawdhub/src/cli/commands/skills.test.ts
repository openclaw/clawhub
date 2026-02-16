/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
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
const mockIsInteractive = vi.fn(() => false)
const mockPromptConfirm = vi.fn(async () => false)
vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => {
    throw new Error(message)
  },
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: mockIsInteractive,
  promptConfirm: mockPromptConfirm,
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
  rm: vi.fn(),
  stat: vi.fn(),
}))

const { clampLimit, cmdExplore, cmdInstall, cmdUninstall, cmdUpdate, formatExploreLine } = await import('./skills')
const {
  extractZipToDir,
  hashSkillFiles,
  listTextFiles,
  readLockfile,
  readSkillOrigin,
  writeLockfile,
  writeSkillOrigin,
} = await import('../../skills.js')
const { rm, stat } = await import('node:fs/promises')

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})

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

describe('cmdInstall', () => {
  it('passes optional auth token to API + download requests', async () => {
    mockGetOptionalAuthToken.mockResolvedValue('tkn')
    mockApiRequest.mockResolvedValue({
      skill: { slug: 'demo', displayName: 'Demo', summary: null, tags: {}, stats: {}, createdAt: 0, updatedAt: 0 },
      latestVersion: { version: '1.0.0' },
      owner: null,
      moderation: null,
    })
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]))
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(writeSkillOrigin).mockResolvedValue()
    vi.mocked(extractZipToDir).mockResolvedValue()
    vi.mocked(stat).mockRejectedValue(new Error('missing'))
    vi.mocked(rm).mockResolvedValue()

    await cmdInstall(makeOpts(), 'demo')

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? []
    expect(requestArgs?.token).toBe('tkn')
    const [, zipArgs] = mockDownloadZip.mock.calls[0] ?? []
    expect(zipArgs?.token).toBe('tkn')
  })
})

describe('cmdUninstall', () => {
  it('requires --yes when input is disabled', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '1.0.0', installedAt: 123 } },
    })

    await expect(cmdUninstall(makeOpts(), 'demo', {}, false)).rejects.toThrow(/--yes/i)
  })

  it('prompts when interactive and proceeds on confirm', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '1.0.0', installedAt: 123 } },
    })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(rm).mockResolvedValue()
    mockIsInteractive.mockReturnValue(true)
    mockPromptConfirm.mockResolvedValue(true)

    await cmdUninstall(makeOpts(), 'demo', {}, true)

    expect(mockPromptConfirm).toHaveBeenCalledWith('Uninstall demo?')
    expect(rm).toHaveBeenCalledWith('/work/skills/demo', { recursive: true, force: true })
    expect(writeLockfile).toHaveBeenCalled()
  })

  it('prints Cancelled and does not remove when prompt declines', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '1.0.0', installedAt: 123 } },
    })
    mockIsInteractive.mockReturnValue(true)
    mockPromptConfirm.mockResolvedValue(false)

    await cmdUninstall(makeOpts(), 'demo', {}, true)

    expect(mockLog).toHaveBeenCalledWith('Cancelled.')
    expect(rm).not.toHaveBeenCalled()
    expect(writeLockfile).not.toHaveBeenCalled()
  })

  it('rejects unsafe slugs', async () => {
    await expect(cmdUninstall(makeOpts(), '../evil', { yes: true }, false)).rejects.toThrow(
      /invalid slug/i,
    )
    await expect(cmdUninstall(makeOpts(), 'demo/evil', { yes: true }, false)).rejects.toThrow(
      /invalid slug/i,
    )
  })

  it('fails when skill is not installed', async () => {
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} })

    await expect(cmdUninstall(makeOpts(), 'missing', {}, false)).rejects.toThrow(
      'Not installed: missing',
    )
  })

  it('removes skill directory and lockfile entry with --yes flag', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '1.0.0', installedAt: 123 } },
    })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(rm).mockResolvedValue()

    await cmdUninstall(makeOpts(), 'demo', { yes: true }, false)

    expect(rm).toHaveBeenCalledWith('/work/skills/demo', { recursive: true, force: true })
    expect(writeLockfile).toHaveBeenCalledWith('/work', {
      version: 1,
      skills: {},
    })
    expect(mockSpinner.succeed).toHaveBeenCalledWith('Uninstalled demo')
  })

  it('does not update lockfile if remove fails', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '1.0.0', installedAt: 123 } },
    })
    vi.mocked(rm).mockRejectedValue(new Error('nope'))

    await expect(cmdUninstall(makeOpts(), 'demo', { yes: true }, false)).rejects.toThrow('nope')

    expect(writeLockfile).not.toHaveBeenCalled()
  })

	  it('updates lockfile after removing directory', async () => {
	    vi.mocked(readLockfile).mockResolvedValue({
	      version: 1,
	      skills: { demo: { version: '1.0.0', installedAt: 123 } },
	    })
	    vi.mocked(writeLockfile).mockResolvedValue()
	    vi.mocked(rm).mockResolvedValue()

	    await cmdUninstall(makeOpts(), 'demo', { yes: true }, false)

	    const rmMock = vi.mocked(rm)
	    const writeLockfileMock = vi.mocked(writeLockfile)
	    expect(rmMock.mock.invocationCallOrder[0]).toBeLessThan(
	      writeLockfileMock.mock.invocationCallOrder[0],
	    )
	  })

  it('removes skill and updates lockfile keeping other skills', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: '1.0.0', installedAt: 123 },
        other: { version: '2.0.0', installedAt: 456 },
      },
    })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(rm).mockResolvedValue()

    await cmdUninstall(makeOpts(), 'demo', { yes: true }, false)

    expect(rm).toHaveBeenCalledWith('/work/skills/demo', { recursive: true, force: true })
    expect(writeLockfile).toHaveBeenCalledWith('/work', {
      version: 1,
      skills: { other: { version: '2.0.0', installedAt: 456 } },
    })
  })

  it('trims slug whitespace', async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: '1.0.0', installedAt: 123 } },
    })
    vi.mocked(writeLockfile).mockResolvedValue()
    vi.mocked(rm).mockResolvedValue()

    await cmdUninstall(makeOpts(), '  demo  ', { yes: true }, false)

    expect(rm).toHaveBeenCalledWith('/work/skills/demo', { recursive: true, force: true })
  })
})
