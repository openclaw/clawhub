/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chmodMock = vi.fn()
const mkdirMock = vi.fn()
const readFileMock = vi.fn()
const writeFileMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  chmod: (...args: unknown[]) => chmodMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}))

const { writeGlobalConfig } = await import('./config')

const originalPlatform = process.platform
const testConfigPath = '/tmp/clawhub-config-test/config.json'

function makeErr(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

beforeEach(() => {
  vi.stubEnv('CLAWHUB_CONFIG_PATH', testConfigPath)
  Object.defineProperty(process, 'platform', { value: 'linux' })
  chmodMock.mockResolvedValue(undefined)
  mkdirMock.mockResolvedValue(undefined)
  readFileMock.mockResolvedValue('')
  writeFileMock.mockResolvedValue(undefined)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('writeGlobalConfig', () => {
  it('writes config with restricted modes', async () => {
    await writeGlobalConfig({ registry: 'https://example.com', token: 'clh_test' })

    expect(mkdirMock).toHaveBeenCalledWith('/tmp/clawhub-config-test', {
      recursive: true,
      mode: 0o700,
    })
    expect(writeFileMock).toHaveBeenCalledWith(
      testConfigPath,
      expect.stringContaining('"token": "clh_test"'),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    )
    expect(chmodMock).toHaveBeenCalledWith(testConfigPath, 0o600)
  })

  it('ignores non-fatal chmod errors', async () => {
    chmodMock.mockRejectedValueOnce(makeErr('ENOTSUP'))

    await expect(writeGlobalConfig({ registry: 'https://example.com' })).resolves.toBeUndefined()
  })

  it('rethrows unexpected chmod errors', async () => {
    chmodMock.mockRejectedValueOnce(new Error('boom'))

    await expect(writeGlobalConfig({ registry: 'https://example.com' })).rejects.toThrow('boom')
  })
})
