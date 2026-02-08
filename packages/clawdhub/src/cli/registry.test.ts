/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from './types'

const readGlobalConfig = vi.fn()
const writeGlobalConfig = vi.fn()
const discoverRegistryFromSite = vi.fn()

vi.mock('../config.js', () => ({
  readGlobalConfig: (...args: unknown[]) => readGlobalConfig(...args),
  writeGlobalConfig: (...args: unknown[]) => writeGlobalConfig(...args),
}))

vi.mock('../discovery.js', () => ({
  discoverRegistryFromSite: (...args: unknown[]) => discoverRegistryFromSite(...args),
}))

const { DEFAULT_REGISTRY, getRegistry, resolveRegistry } = await import('./registry')

function makeOpts(overrides: Partial<GlobalOpts> = {}): GlobalOpts {
  return {
    workdir: '/work',
    dir: '/work/skills',
    site: 'https://www.clawhub.ai',
    registry: DEFAULT_REGISTRY,
    registrySource: 'default',
    ...overrides,
  }
}

beforeEach(() => {
  readGlobalConfig.mockReset()
  writeGlobalConfig.mockReset()
  discoverRegistryFromSite.mockReset()
})

describe('registry resolution', () => {
  it('prefers explicit registry over discovery/cache', async () => {
    readGlobalConfig.mockResolvedValue({ registry: 'https://auth.clawdhub.com' })
    discoverRegistryFromSite.mockResolvedValue({ apiBase: 'https://www.clawhub.ai' })

    const registry = await resolveRegistry(
      makeOpts({ registry: 'https://custom.example', registrySource: 'cli' }),
    )

    expect(registry).toBe('https://custom.example')
    expect(discoverRegistryFromSite).not.toHaveBeenCalled()
  })

  it('ignores legacy registry and updates cache from discovery', async () => {
    readGlobalConfig.mockResolvedValue({ registry: 'https://auth.clawdhub.com', token: 'tkn' })
    discoverRegistryFromSite.mockResolvedValue({ apiBase: 'https://www.clawhub.ai' })

    const registry = await getRegistry(makeOpts(), { cache: true })

    expect(registry).toBe('https://www.clawhub.ai')
    expect(writeGlobalConfig).toHaveBeenCalledWith({
      registry: 'https://www.clawhub.ai',
      token: 'tkn',
    })
  })
})
