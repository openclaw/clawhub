/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMBEDDING_DIMENSIONS, generateEmbedding } from './embeddings'

const fetchMock = vi.fn<typeof fetch>()
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

const originalFetch = globalThis.fetch
const originalApiKey = process.env.OPENAI_API_KEY

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
    ...init,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as typeof fetch
  process.env.OPENAI_API_KEY = 'test-key'
  consoleWarnSpy.mockClear()
})

afterEach(() => {
  globalThis.fetch = originalFetch

  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = originalApiKey
  }

  vi.useRealTimers()
})

describe('generateEmbedding', () => {
  it('returns zero embedding when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    const result = await generateEmbedding('hello world')

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(result.every((value) => value === 0)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries on 429 responses and then succeeds', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [0.25, 0.75] }] }))

    const promise = generateEmbedding('retry me')
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual([0.25, 0.75])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable 4xx responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }))

    await expect(generateEmbedding('bad')).rejects.toThrow('Embedding failed: bad request')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on network failures and then succeeds', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [1, 2, 3] }] }))

    const promise = generateEmbedding('network retry')
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries timeouts up to max attempts and preserves timeout error', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))

    const promise = generateEmbedding('always timeout')
    const rejection = expect(promise).rejects.toThrow(
      'OpenAI API request timed out after 10 seconds',
    )
    await vi.runAllTimersAsync()

    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
