/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from '../types'

vi.mock('../../config.js', () => ({
  readGlobalConfig: vi.fn(async () => ({ registry: 'https://www.clawhub.ai', token: 'tkn' })),
}))

vi.mock('../registry.js', () => ({
  getRegistry: vi.fn(async () => 'https://www.clawhub.ai'),
}))

const mockApiRequest = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
    mockApiRequest(registry, args, schema),
}))

const mockFail = vi.fn((message: string) => {
  throw new Error(message)
})

vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn() })),
  fail: (message: string) => mockFail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => false,
  promptConfirm: vi.fn(async () => true),
}))

const { cmdDeleteSkill, cmdHideSkill, cmdUndeleteSkill, cmdUnhideSkill } = await import('./delete')

function makeOpts(): GlobalOpts {
  return {
    workdir: '/work',
    dir: '/work/skills',
    site: 'https://www.clawhub.ai',
    registry: 'https://www.clawhub.ai',
    registrySource: 'default',
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('delete/undelete', () => {
  it('requires --yes when input is disabled', async () => {
    await expect(cmdDeleteSkill(makeOpts(), 'demo', {}, false)).rejects.toThrow(/--yes/i)
    await expect(cmdUndeleteSkill(makeOpts(), 'demo', {}, false)).rejects.toThrow(/--yes/i)
    await expect(cmdHideSkill(makeOpts(), 'demo', {}, false)).rejects.toThrow(/--yes/i)
    await expect(cmdUnhideSkill(makeOpts(), 'demo', {}, false)).rejects.toThrow(/--yes/i)
  })

  it('calls delete endpoint with --yes', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true })
    await cmdDeleteSkill(makeOpts(), 'demo', { yes: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE', path: '/api/v1/skills/demo' }),
      expect.anything(),
    )
  })

  it('calls undelete endpoint with --yes', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true })
    await cmdUndeleteSkill(makeOpts(), 'demo', { yes: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST', path: '/api/v1/skills/demo/undelete' }),
      expect.anything(),
    )
  })

  it('supports hide/unhide aliases', async () => {
    mockApiRequest.mockResolvedValue({ ok: true })
    await cmdHideSkill(makeOpts(), 'demo', { yes: true }, false)
    await cmdUnhideSkill(makeOpts(), 'demo', { yes: true }, false)
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE', path: '/api/v1/skills/demo' }),
      expect.anything(),
    )
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST', path: '/api/v1/skills/demo/undelete' }),
      expect.anything(),
    )
  })
})
