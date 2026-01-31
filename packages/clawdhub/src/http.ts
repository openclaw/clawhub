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
        allowH2: false,
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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort('Timeout'), REQUEST_TIMEOUT_MS)
      const response = await fetch(url, {
        method: args.method,
        headers,
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const message = text || `HTTP ${response.status}`
        if (response.status === 429 || response.status >= 500) {
          throw new Error(message)
        }
        throw new AbortError(message)
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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort('Timeout'), REQUEST_TIMEOUT_MS)
      const response = await fetch(url, {
        method: args.method,
        headers,
        body: args.form,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const message = text || `HTTP ${response.status}`
        if (response.status === 429 || response.status >= 500) {
          throw new Error(message)
        }
        throw new AbortError(message)
      }
      return (await response.json()) as unknown
    },
    { retries: 2 },
  )
  if (schema) return parseArk(schema, json, 'API response')
  return json as T
}

export async function downloadZip(registry: string, args: { slug: string; version?: string }) {
  const url = new URL(ApiRoutes.download, registry)
  url.searchParams.set('slug', args.slug)
  if (args.version) url.searchParams.set('version', args.version)
  return pRetry(
    async () => {
      if (isBun) {
        return await fetchBinaryViaCurl(url.toString())
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort('Timeout'), REQUEST_TIMEOUT_MS)
      const response = await fetch(url.toString(), { method: 'GET', signal: controller.signal })
      clearTimeout(timeout)
      if (!response.ok) {
        const message = (await response.text().catch(() => '')) || `HTTP ${response.status}`
        if (response.status === 429 || response.status >= 500) {
          throw new Error(message)
        }
        throw new AbortError(message)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
    { retries: 2 },
  )
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
    if (status === 429 || status >= 500) {
      throw new Error(body || `HTTP ${status}`)
    }
    throw new AbortError(body || `HTTP ${status}`)
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
      if (status === 429 || status >= 500) {
        throw new Error(body || `HTTP ${status}`)
      }
      throw new AbortError(body || `HTTP ${status}`)
    }
    return JSON.parse(body || 'null') as unknown
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function fetchBinaryViaCurl(url: string) {
  const tempDir = await mkdtemp(join(tmpdir(), 'clawhub-download-'))
  const filePath = join(tempDir, 'payload.bin')
  try {
    const curlArgs = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      String(REQUEST_TIMEOUT_SECONDS),
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
      const message = body ? new TextDecoder().decode(body) : `HTTP ${status}`
      if (status === 429 || status >= 500) {
        throw new Error(message)
      }
      throw new AbortError(message)
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
