import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pRetry, { AbortError } from 'p-retry'
import { Agent, setGlobalDispatcher } from 'undici'
import type { ArkValidator } from './schema/index.js'
import { ApiRoutes, parseArk } from './schema/index.js'

const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_SECONDS = Math.ceil(REQUEST_TIMEOUT_MS / 1000)
const RETRY_COUNT = 2
const RETRY_BACKOFF_BASE_MS = 300
const RETRY_BACKOFF_MAX_MS = 5_000
const RETRY_AFTER_JITTER_MS = 250
const CURL_META_MARKER = '__CLAWHUB_CURL_META__'
const CURL_WRITE_OUT_FORMAT = [
  '',
  CURL_META_MARKER,
  '%{http_code}',
  '%{header:x-ratelimit-limit}',
  '%{header:x-ratelimit-remaining}',
  '%{header:x-ratelimit-reset}',
  '%{header:ratelimit-limit}',
  '%{header:ratelimit-remaining}',
  '%{header:ratelimit-reset}',
  '%{header:retry-after}',
].join('\n')
const isBun = typeof process !== 'undefined' && Boolean(process.versions?.bun)

if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    setGlobalDispatcher(
      new Agent({
        connect: { timeout: REQUEST_TIMEOUT_MS },
      }),
    )
  } catch {
    // ignore dispatcher setup failures in non-node runtimes
  }
}

type RequestArgs =
  | { method: 'GET' | 'POST' | 'DELETE'; path: string; token?: string; body?: unknown }
  | { method: 'GET' | 'POST' | 'DELETE'; url: string; token?: string; body?: unknown }

type HeaderSource = Headers | Record<string, string> | null | undefined

type RateLimitInfo = {
  limit?: number
  remaining?: number
  resetDelaySeconds?: number
  retryAfterSeconds?: number
}

class HttpStatusError extends Error {
  readonly status: number
  readonly rateLimit: RateLimitInfo

  constructor(status: number, message: string, rateLimit: RateLimitInfo) {
    super(message)
    this.name = 'HttpStatusError'
    this.status = status
    this.rateLimit = rateLimit
  }
}

export async function apiRequest<T>(registry: string, args: RequestArgs): Promise<T>
export async function apiRequest<T>(
  registry: string,
  args: RequestArgs,
  schema: ArkValidator<T>,
): Promise<T>
export async function apiRequest<T>(
  registry: string,
  args: RequestArgs,
  schema?: ArkValidator<T>,
): Promise<T> {
  const url = 'url' in args ? args.url : new URL(args.path, registry).toString()
  const json = await runWithRetries(
    async () => {
      if (isBun) {
        return await fetchJsonViaCurl(url, args)
      }

      const headers: Record<string, string> = { Accept: 'application/json' }
      if (args.token) headers.Authorization = `Bearer ${args.token}`
      let body: string | undefined
      if (args.method === 'POST') {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(args.body ?? {})
      }
      const response = await fetchWithTimeout(url, {
        method: args.method,
        headers,
        body,
      })
      if (!response.ok) {
        throwHttpStatusError(response.status, await readResponseTextSafe(response), response.headers)
      }
      return (await response.json()) as unknown
    },
  )
  if (schema) return parseArk(schema, json, 'API response')
  return json as T
}

type FormRequestArgs =
  | { method: 'POST'; path: string; token?: string; form: FormData }
  | { method: 'POST'; url: string; token?: string; form: FormData }

export async function apiRequestForm<T>(registry: string, args: FormRequestArgs): Promise<T>
export async function apiRequestForm<T>(
  registry: string,
  args: FormRequestArgs,
  schema: ArkValidator<T>,
): Promise<T>
export async function apiRequestForm<T>(
  registry: string,
  args: FormRequestArgs,
  schema?: ArkValidator<T>,
): Promise<T> {
  const url = 'url' in args ? args.url : new URL(args.path, registry).toString()
  const json = await runWithRetries(
    async () => {
      if (isBun) {
        return await fetchJsonFormViaCurl(url, args)
      }

      const headers: Record<string, string> = { Accept: 'application/json' }
      if (args.token) headers.Authorization = `Bearer ${args.token}`
      const response = await fetchWithTimeout(url, {
        method: args.method,
        headers,
        body: args.form,
      })
      if (!response.ok) {
        throwHttpStatusError(response.status, await readResponseTextSafe(response), response.headers)
      }
      return (await response.json()) as unknown
    },
  )
  if (schema) return parseArk(schema, json, 'API response')
  return json as T
}

type TextRequestArgs = { path: string; token?: string } | { url: string; token?: string }

export async function fetchText(registry: string, args: TextRequestArgs): Promise<string> {
  const url = 'url' in args ? args.url : new URL(args.path, registry).toString()
  return runWithRetries(
    async () => {
      if (isBun) {
        return await fetchTextViaCurl(url, args)
      }

      const headers: Record<string, string> = { Accept: 'text/plain' }
      if (args.token) headers.Authorization = `Bearer ${args.token}`
      const response = await fetchWithTimeout(url, { method: 'GET', headers })
      const text = await response.text()
      if (!response.ok) {
        throwHttpStatusError(response.status, text, response.headers)
      }
      return text
    },
  )
}

export async function downloadZip(
  registry: string,
  args: { slug: string; version?: string; token?: string },
) {
  const url = new URL(ApiRoutes.download, registry)
  url.searchParams.set('slug', args.slug)
  if (args.version) url.searchParams.set('version', args.version)
  return runWithRetries(
    async () => {
      if (isBun) {
        return await fetchBinaryViaCurl(url.toString(), args.token)
      }

      const headers: Record<string, string> = {}
      if (args.token) headers.Authorization = `Bearer ${args.token}`

      const response = await fetchWithTimeout(url.toString(), { method: 'GET', headers })
      if (!response.ok) {
        throwHttpStatusError(response.status, await readResponseTextSafe(response), response.headers)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  )
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Timeout')), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function readResponseTextSafe(response: Response): Promise<string> {
  return await response.text().catch(() => '')
}

async function runWithRetries<T>(fn: () => Promise<T>): Promise<T> {
  return await pRetry(fn, {
    retries: RETRY_COUNT,
    minTimeout: 0,
    maxTimeout: 0,
    factor: 1,
    randomize: false,
    onFailedAttempt: async (attemptError) => {
      const delayMs = getRetryDelayMs(attemptError)
      if (delayMs <= 0) return
      await sleep(delayMs)
    },
  })
}

function getRetryDelayMs(attemptError: unknown): number {
  const failed = attemptError as {
    attemptNumber?: number
    cause?: unknown
    error?: unknown
  }
  const attemptNumber = Math.max(1, Number(failed.attemptNumber ?? 1))
  const rootError = failed.cause ?? failed.error ?? attemptError
  if (rootError instanceof HttpStatusError && rootError.rateLimit.retryAfterSeconds !== undefined) {
    return rootError.rateLimit.retryAfterSeconds * 1000 + jitterMs(RETRY_AFTER_JITTER_MS)
  }
  const baseMs = Math.min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * 2 ** (attemptNumber - 1))
  return baseMs + jitterMs(RETRY_BACKOFF_BASE_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function jitterMs(maxMs: number): number {
  if (maxMs <= 0) return 0
  return Math.floor(Math.random() * maxMs)
}

function throwHttpStatusError(status: number, text: string, headers?: HeaderSource): never {
  const rateLimit = parseRateLimitInfo(headers)
  const message = buildHttpErrorMessage(status, text, rateLimit)
  if (status === 429 || status >= 500) {
    throw new HttpStatusError(status, message, rateLimit)
  }
  throw new AbortError(message)
}

function buildHttpErrorMessage(status: number, text: string, rateLimit: RateLimitInfo): string {
  const base = text || `HTTP ${status}`
  const details: string[] = []
  if (rateLimit.retryAfterSeconds !== undefined) {
    details.push(`retry in ${rateLimit.retryAfterSeconds}s`)
  }
  if (rateLimit.remaining !== undefined && rateLimit.limit !== undefined) {
    details.push(`remaining: ${rateLimit.remaining}/${rateLimit.limit}`)
  }
  if (rateLimit.resetDelaySeconds !== undefined) {
    details.push(`reset in ${rateLimit.resetDelaySeconds}s`)
  }
  if (details.length === 0) {
    return base
  }
  return `${base} (${details.join(', ')})`
}

function parseRateLimitInfo(headers?: HeaderSource): RateLimitInfo {
  if (!headers) return {}
  const limit = parseIntHeader(getHeader(headers, 'x-ratelimit-limit') ?? getHeader(headers, 'ratelimit-limit'))
  const remaining = parseIntHeader(
    getHeader(headers, 'x-ratelimit-remaining') ?? getHeader(headers, 'ratelimit-remaining'),
  )
  const nowMs = Date.now()
  const retryAfterSeconds = parseRetryAfterSeconds(getHeader(headers, 'retry-after'), nowMs)
  const resetDelaySeconds = parseResetDelaySeconds(headers, nowMs, retryAfterSeconds)

  return {
    limit,
    remaining,
    resetDelaySeconds,
    retryAfterSeconds,
  }
}

function parseResetDelaySeconds(
  headers: HeaderSource,
  nowMs: number,
  retryAfterSeconds: number | undefined,
): number | undefined {
  if (retryAfterSeconds !== undefined) return retryAfterSeconds

  const standardized = parseIntHeader(getHeader(headers, 'ratelimit-reset'))
  if (standardized !== undefined) {
    return Math.max(1, standardized)
  }
  const legacyEpochSeconds = parseIntHeader(getHeader(headers, 'x-ratelimit-reset'))
  if (legacyEpochSeconds === undefined) return undefined
  const nowSeconds = Math.floor(nowMs / 1000)
  return Math.max(1, legacyEpochSeconds - nowSeconds)
}

function parseRetryAfterSeconds(value: string | undefined, nowMs: number): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    // Compatibility guard for older servers that accidentally sent Unix epoch seconds.
    if (asNumber > 31_536_000) {
      const nowSeconds = Math.floor(nowMs / 1000)
      return Math.max(1, Math.ceil(asNumber - nowSeconds))
    }
    return Math.max(1, Math.ceil(asNumber))
  }

  const asDateMs = Date.parse(trimmed)
  if (!Number.isFinite(asDateMs)) return undefined
  return Math.max(1, Math.ceil((asDateMs - nowMs) / 1000))
}

function parseIntHeader(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function getHeader(headers: HeaderSource, key: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) {
    const value = headers.get(key)
    return value === null ? undefined : value
  }
  const normalizedKey = key.toLowerCase()
  const direct = headers[normalizedKey] ?? headers[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const match = Object.entries(headers).find(
    ([entryKey, entryValue]) =>
      entryKey.toLowerCase() === normalizedKey && typeof entryValue === 'string' && entryValue.trim(),
  )
  return typeof match?.[1] === 'string' ? match[1].trim() : undefined
}

async function fetchJsonViaCurl(url: string, args: RequestArgs) {
  const headers = ['-H', 'Accept: application/json']
  if (args.token) {
    headers.push('-H', `Authorization: Bearer ${args.token}`)
  }
  const curlArgs = [
    '--silent',
    '--show-error',
    '--location',
    '--max-time',
    String(REQUEST_TIMEOUT_SECONDS),
    '--write-out',
    CURL_WRITE_OUT_FORMAT,
    '-X',
    args.method,
    ...headers,
    url,
  ]
  if (args.method === 'POST') {
    curlArgs.push('-H', 'Content-Type: application/json')
    curlArgs.push('--data-binary', JSON.stringify(args.body ?? {}))
  }

  const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'curl failed')
  }
  const { body, status, headers: responseHeaders } = parseCurlBodyAndMeta(result.stdout ?? '')
  if (status < 200 || status >= 300) {
    throwHttpStatusError(status, body, responseHeaders)
  }
  return JSON.parse(body || 'null') as unknown
}

async function fetchJsonFormViaCurl(url: string, args: FormRequestArgs) {
  const headers = ['-H', 'Accept: application/json']
  if (args.token) {
    headers.push('-H', `Authorization: Bearer ${args.token}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'clawhub-upload-'))
  try {
    const formArgs: string[] = []
    for (const [key, value] of args.form.entries()) {
      if (value instanceof Blob) {
        const filename = typeof (value as File).name === 'string' ? (value as File).name : 'file'
        const filePath = join(tempDir, filename)
        const bytes = new Uint8Array(await value.arrayBuffer())
        await writeFile(filePath, bytes)
        formArgs.push('-F', `${key}=@${filePath};filename=${filename}`)
      } else {
        formArgs.push('-F', `${key}=${String(value)}`)
      }
    }

    const curlArgs = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      String(REQUEST_TIMEOUT_SECONDS),
      '--write-out',
      CURL_WRITE_OUT_FORMAT,
      '-X',
      args.method,
      ...headers,
      ...formArgs,
      url,
    ]

    const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(result.stderr || 'curl failed')
    }
    const { body, status, headers: responseHeaders } = parseCurlBodyAndMeta(result.stdout ?? '')
    if (status < 200 || status >= 300) {
      throwHttpStatusError(status, body, responseHeaders)
    }
    return JSON.parse(body || 'null') as unknown
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function fetchTextViaCurl(url: string, args: { token?: string }) {
  const headers = ['-H', 'Accept: text/plain']
  if (args.token) {
    headers.push('-H', `Authorization: Bearer ${args.token}`)
  }
  const curlArgs = [
    '--silent',
    '--show-error',
    '--location',
    '--max-time',
    String(REQUEST_TIMEOUT_SECONDS),
    '--write-out',
    CURL_WRITE_OUT_FORMAT,
    '-X',
    'GET',
    ...headers,
    url,
  ]
  const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'curl failed')
  }
  const { body, status, headers: responseHeaders } = parseCurlBodyAndMeta(result.stdout ?? '')
  if (status < 200 || status >= 300) {
    throwHttpStatusError(status, body, responseHeaders)
  }
  return body
}

async function fetchBinaryViaCurl(url: string, token?: string) {
  const tempDir = await mkdtemp(join(tmpdir(), 'clawhub-download-'))
  const filePath = join(tempDir, 'payload.bin')
  try {
    const headers: string[] = []
    if (token) {
      headers.push('-H', `Authorization: Bearer ${token}`)
    }

    const curlArgs = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      String(REQUEST_TIMEOUT_SECONDS),
      ...headers,
      '-o',
      filePath,
      '--write-out',
      CURL_WRITE_OUT_FORMAT,
      url,
    ]
    const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(result.stderr || 'curl failed')
    }
    const { status, headers: responseHeaders } = parseCurlBodyAndMeta(result.stdout ?? '')
    if (status < 200 || status >= 300) {
      const body = await readFileSafe(filePath)
      throwHttpStatusError(status, body ? new TextDecoder().decode(body) : '', responseHeaders)
    }
    const bytes = await readFileSafe(filePath)
    return bytes ? new Uint8Array(bytes) : new Uint8Array()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function parseCurlBodyAndMeta(output: string): {
  body: string
  status: number
  headers: Record<string, string>
} {
  const marker = `\n${CURL_META_MARKER}\n`
  const markerIndex = output.lastIndexOf(marker)
  if (markerIndex === -1) {
    // Backward compatibility for older tests that only provide "<body>\n<status>".
    const splitAt = output.lastIndexOf('\n')
    if (splitAt === -1) {
      const statusOnly = Number(output.trim())
      if (!Number.isFinite(statusOnly)) throw new Error('curl response missing status')
      return { body: '', status: statusOnly, headers: {} }
    }
    const body = output.slice(0, splitAt)
    const status = Number(output.slice(splitAt + 1).trim())
    if (!Number.isFinite(status)) throw new Error('curl response missing status')
    return { body, status, headers: {} }
  }

  const body = output.slice(0, markerIndex)
  const meta = output.slice(markerIndex + marker.length).replace(/\r/g, '')
  const lines = meta.split('\n')
  const status = Number((lines[0] ?? '').trim())
  if (!Number.isFinite(status)) throw new Error('curl response missing status')

  const [
    xRateLimitLimit,
    xRateLimitRemaining,
    xRateLimitReset,
    rateLimitLimit,
    rateLimitRemaining,
    rateLimitReset,
    retryAfter,
  ] = lines.slice(1)

  const headers: Record<string, string> = {}
  setHeaderIfPresent(headers, 'x-ratelimit-limit', xRateLimitLimit)
  setHeaderIfPresent(headers, 'x-ratelimit-remaining', xRateLimitRemaining)
  setHeaderIfPresent(headers, 'x-ratelimit-reset', xRateLimitReset)
  setHeaderIfPresent(headers, 'ratelimit-limit', rateLimitLimit)
  setHeaderIfPresent(headers, 'ratelimit-remaining', rateLimitRemaining)
  setHeaderIfPresent(headers, 'ratelimit-reset', rateLimitReset)
  setHeaderIfPresent(headers, 'retry-after', retryAfter)

  return { body, status, headers }
}

function setHeaderIfPresent(headers: Record<string, string>, key: string, value: string | undefined) {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed) return
  headers[key] = trimmed
}

async function readFileSafe(path: string) {
  try {
    const { readFile } = await import('node:fs/promises')
    return await readFile(path)
  } catch {
    return null
  }
}
