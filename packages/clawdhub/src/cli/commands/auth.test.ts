/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from '../types'

const mockReadGlobalConfig = vi.fn(async () => null as { registry?: string; token?: string } | null)
const mockWriteGlobalConfig = vi.fn(async (_cfg: unknown) => {})
vi.mock('../../config.js', () => ({
  readGlobalConfig: () => mockReadGlobalConfig(),
  writeGlobalConfig: (cfg: unknown) => mockWriteGlobalConfig(cfg),
}))

const mockGetRegistry = vi.fn(async () => 'https://clawhub.ai')
vi.mock('../registry.js', () => ({
  getRegistry: () => mockGetRegistry(),
}))

const { cmdLogout } = await import('./auth')

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
  mockLog.mockClear()
})

describe('cmdLogout', () => {
  it('removes token and logs a clear message', async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({ registry: 'https://clawhub.ai', token: 'tkn' })

    await cmdLogout(makeOpts())

    expect(mockWriteGlobalConfig).toHaveBeenCalledWith({
      registry: 'https://clawhub.ai',
      token: undefined,
    })
    expect(mockGetRegistry).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith(
      'OK. Logged out locally. Token still valid until revoked (Settings -> API tokens).',
    )
  })

  it('falls back to resolved registry when config has no registry', async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({ token: 'tkn' })
    mockGetRegistry.mockResolvedValueOnce('https://registry.example')

    await cmdLogout(makeOpts())

    expect(mockGetRegistry).toHaveBeenCalled()
    expect(mockWriteGlobalConfig).toHaveBeenCalledWith({
      registry: 'https://registry.example',
      token: undefined,
    })
  })
})
