/* @vitest-environment node */

import { ApiCliWhoamiResponseSchema } from 'clawdhub-schema'
import { describe, expect, it, vi } from 'vitest'
import { apiRequest, downloadZip } from './http'

describe('apiRequest', () => {
  it('adds bearer token and parses json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { handle: null } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await apiRequest(
      'https://example.com',
      { method: 'GET', path: '/x', token: 'clh_token' },
      ApiCliWhoamiResponseSchema,
    )
    expect(result.user.handle).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer clh_token')
    vi.unstubAllGlobals()
  })

  it('posts json body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await apiRequest('https://example.com', {
      method: 'POST',
      path: '/x',
      body: { a: 1 },
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/x')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    vi.unstubAllGlobals()
  })

  it('throws text body on non-200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad',
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiRequest('https://example.com', { method: 'GET', path: '/x' })).rejects.toThrow(
      'bad',
    )
    vi.unstubAllGlobals()
  })

  it('falls back to HTTP status when body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      apiRequest('https://example.com', { method: 'GET', url: 'https://example.com/x' }),
    ).rejects.toThrow('HTTP 500')
    vi.unstubAllGlobals()
  })

  it('downloads zip bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)
    const bytes = await downloadZip('https://example.com', { slug: 'demo', version: '1.0.0' })
    expect(Array.from(bytes)).toEqual([1, 2, 3])
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('slug=demo')
    expect(url).toContain('version=1.0.0')
    vi.unstubAllGlobals()
  })
})
