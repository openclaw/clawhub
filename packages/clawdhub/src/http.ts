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
  const json = await pRetry(
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
        throwHttpStatusError(response.status, await readResponseTextSafe(response))
      }
      return (await response.json()) as unknown
    },
    { retries: 2 },
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
  const json = await pRetry(
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
        throwHttpStatusError(response.status, await readResponseTextSafe(response))
      }
      return (await response.json()) as unknown
    },
    { retries: 2 },
  )
  if (schema) return parseArk(schema, json, 'API response')
  return json as T
}

type TextRequestArgs = { path: string; token?: string } | { url: string; token?: string }

export async function fetchText(registry: string, args: TextRequestArgs): Promise<string> {
  const url = 'url' in args ? args.url : new URL(args.path, registry).toString()
  return pRetry(
    async () => {
      if (isBun) {
        return await fetchTextViaCurl(url, args)
      }

      const headers: Record<string, string> = { Accept: 'text/plain' }
      if (args.token) headers.Authorization = `Bearer ${args.token}`
      const response = await fetchWithTimeout(url, { method: 'GET', headers })
      const text = await response.text()
      if (!response.ok) {
        throwHttpStatusError(response.status, text)
      }
      return text
    },
    { retries: 2 },
  )
}

export async function downloadZip(
  registry: string,
  args: { slug: string; version?: string; token?: string },
) {
  const url = new URL(ApiRoutes.download, registry)
  url.searchParams.set('slug', args.slug)
  if (args.version) url.searchParams.set('version', args.version)
  return pRetry(
    async () => {
      if (isBun) {
        return await fetchBinaryViaCurl(url.toString(), args.token)
      }

      const headers: Record<string, string> = {}
      if (args.token) headers.Authorization = `Bearer ${args.token}`

      const response = await fetchWithTimeout(url.toString(), { method: 'GET', headers })
      if (!response.ok) {
        throwHttpStatusError(response.status, await readResponseTextSafe(response))
      }
      return new Uint8Array(await response.arrayBuffer())
    },
    { retries: 2 },
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

function throwHttpStatusError(status: number, text: string): never {
  const message = text || `HTTP ${status}`
  if (status === 429 || status >= 500) {
    throw new Error(message)
  }
  throw new AbortError(message)
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
    '\n%{http_code}',
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
  const output = result.stdout ?? ''
  const splitAt = output.lastIndexOf('\n')
  if (splitAt === -1) throw new Error('curl response missing status')
  const body = output.slice(0, splitAt)
  const status = Number(output.slice(splitAt + 1).trim())
  if (!Number.isFinite(status)) throw new Error('curl response missing status')
  if (status < 200 || status >= 300) {
    throwHttpStatusError(status, body)
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
      '\n%{http_code}',
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
    const output = result.stdout ?? ''
    const splitAt = output.lastIndexOf('\n')
    if (splitAt === -1) throw new Error('curl response missing status')
    const body = output.slice(0, splitAt)
    const status = Number(output.slice(splitAt + 1).trim())
    if (!Number.isFinite(status)) throw new Error('curl response missing status')
    if (status < 200 || status >= 300) {
      throwHttpStatusError(status, body)
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
    '\n%{http_code}',
    '-X',
    'GET',
    ...headers,
    url,
  ]
  const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'curl failed')
  }
  const output = result.stdout ?? ''
  const splitAt = output.lastIndexOf('\n')
  if (splitAt === -1) throw new Error('curl response missing status')
  const body = output.slice(0, splitAt)
  const status = Number(output.slice(splitAt + 1).trim())
  if (!Number.isFinite(status)) throw new Error('curl response missing status')
  if (status < 200 || status >= 300) {
    if (status === 429 || status >= 500) {
      throw new Error(body || `HTTP ${status}`)
    }
    throw new AbortError(body || `HTTP ${status}`)
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
      '%{http_code}',
      url,
    ]
    const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(result.stderr || 'curl failed')
    }
    const status = Number((result.stdout ?? '').trim())
    if (!Number.isFinite(status)) throw new Error('curl response missing status')
    if (status < 200 || status >= 300) {
      const body = await readFileSafe(filePath)
      throwHttpStatusError(status, body ? new TextDecoder().decode(body) : '')
    }
    const bytes = await readFileSafe(filePath)
    return bytes ? new Uint8Array(bytes) : new Uint8Array()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function readFileSafe(path: string) {
  try {
    const { readFile } = await import('node:fs/promises')
    return await readFile(path)
  } catch {
    return null
  }
}
