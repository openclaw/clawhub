/* @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import { apiRequest, apiRequestForm, downloadZip, fetchText } from './http'
import { ApiV1WhoamiResponseSchema } from './schema/index.js'

function mockImmediateTimeouts() {
  const setTimeoutMock = vi.fn((callback: () => void) => {
    callback()
    return 1 as unknown as ReturnType<typeof setTimeout>
  })
  const clearTimeoutMock = vi.fn()
  vi.stubGlobal('setTimeout', setTimeoutMock as unknown as typeof setTimeout)
  vi.stubGlobal('clearTimeout', clearTimeoutMock as typeof clearTimeout)
  return { setTimeoutMock, clearTimeoutMock }
}

function createAbortingFetchMock() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const signal = init?.signal
    if (!signal || !(signal instanceof AbortSignal)) {
      throw new Error('Missing abort signal')
    }
    if (signal.aborted) {
      throw signal.reason
    }
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(signal.reason)
        },
        { once: true },
      )
    })
  })
}

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
      ApiV1WhoamiResponseSchema,
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
    const bytes = await downloadZip('https://example.com', {
      slug: 'demo',
      version: '1.0.0',
      token: 'clh_token',
    })
    expect(Array.from(bytes)).toEqual([1, 2, 3])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('slug=demo')
    expect(url).toContain('version=1.0.0')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer clh_token')
    vi.unstubAllGlobals()
  })

  it('does not retry on non-retryable errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'nope',
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(downloadZip('https://example.com', { slug: 'demo' })).rejects.toThrow('nope')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('aborts with Error timeouts and retries', async () => {
    const { clearTimeoutMock } = mockImmediateTimeouts()
    const fetchMock = createAbortingFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    let caught: unknown
    try {
      await apiRequest('https://example.com', { method: 'GET', path: '/x' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Timeout')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(clearTimeoutMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    vi.unstubAllGlobals()
  })
})

describe('apiRequestForm', () => {
  it('posts form data and returns json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const form = new FormData()
    form.append('x', '1')
    const result = await apiRequestForm('https://example.com', {
      method: 'POST',
      path: '/upload',
      token: 'clh_token',
      form,
    })
    expect(result).toEqual({ ok: true })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(form)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer clh_token')
    vi.unstubAllGlobals()
  })

  it('retries on 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      apiRequestForm('https://example.com', {
        method: 'POST',
        path: '/upload',
        form: new FormData(),
      }),
    ).rejects.toThrow('rate limited')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })

  it('falls back to HTTP status when body cannot be read', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => {
        throw new Error('boom')
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      apiRequestForm('https://example.com', {
        method: 'POST',
        path: '/upload',
        form: new FormData(),
      }),
    ).rejects.toThrow('HTTP 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('fetchText', () => {
  it('aborts with Error timeouts and retries', async () => {
    const { clearTimeoutMock } = mockImmediateTimeouts()
    const fetchMock = createAbortingFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    let caught: unknown
    try {
      await fetchText('https://example.com', { path: '/x' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Timeout')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(clearTimeoutMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    vi.unstubAllGlobals()
  })
})
